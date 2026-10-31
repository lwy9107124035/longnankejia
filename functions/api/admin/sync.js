// Credentials and shared state belong in D1, never in a Worker isolate.
import { DEFAULTS, validateContent, validateChanges, updatedContent, safeContent, safeAudit, audit, rollback, contributions, applyChanges, restoreOperation, recoveryHistory } from '../../_lib/admin-content.js';
import { readLimited } from '../../_lib/read-limited.js';
import { storeMedia, migrateD1Media, archiveHistoryMedia, expandHistoryMedia, expandRecordMedia, storeRecordMedia } from '../../_lib/admin-media.js';
import { recordsManifest, readRecordState, readRecordKinds, readRollbackState, rollbackRecordKeys, writeRecordState, recordMetadata, recordSummaries, pageRecords, recordSnapshot, initialRecordPages, pageRecoveryHistory, pageContributions, recordCounts, publicRecordCounts, searchKnowledgeRecords, MAX_RECORD_BYTES, RecordError } from '../../_lib/admin-records.js';
import { archiveHistoryBefore, expandArchivedHistory } from '../../_lib/admin-history-archive.js';
const LOCK_MS = 60000;
const encoder = new TextEncoder();
const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
const CHUNK_CHARS = 400000;
class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, extra }); }
}
function allowedOrigin(request, origin) {
  return origin === new URL(request.url).origin || origin === 'https://lwy9107124035.github.io';
}
function json(status, value, request) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigin(request, origin)) Object.assign(headers, {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
}
function normalize(input) {
  return String(input || '').replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ').trim();
}
function normalizeToken(input) { return normalize(input).replace(/[\u2010-\u2015\u2212]/g, '-').toUpperCase(); }
function randomHex(bytes = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}
async function state(db, key, fallback) {
  if (key === 'content') {
    const manifest = await recordsManifest(db);
    if (manifest) return readRecordState(db, manifest);
    // Read the manifest and all parts in one SQL snapshot during concurrent writes.
    const { results } = await db.prepare("SELECT key, value, revision, length(CAST(value AS BLOB)) AS bytes FROM admin_state WHERE key = 'content' OR key GLOB 'content:chunk:*'").all();
    const row = results.find(item => item.key === 'content');
    if (!row) return { value: fallback, revision: 0, bytes: encoder.encode(JSON.stringify(fallback)).length };
    let value = JSON.parse(row.value);
    let byteLength = row.bytes;
    if (value.storage === 'chunks-v1') {
      const parts = new Map(results.map(item => [item.key, item]));
      let text = '';
      byteLength = 0;
      for (let i = 0; i < value.count; i++) {
        const part = parts.get('content:chunk:' + i);
        if (part === undefined) throw new Error('Incomplete content snapshot');
        text += part.value; byteLength += part.bytes;
      }
      value = JSON.parse(text);
    }
    return { value, revision: row.revision, bytes: byteLength };
  }
  const row = await db.prepare('SELECT value, revision FROM admin_state WHERE key = ?').bind(key).first();
  return row ? { value: JSON.parse(row.value), revision: row.revision } : { value: fallback, revision: 0 };
}
async function saveState(db, key, value, revision) {
  if (key === 'content') {
    const manifest = await recordsManifest(db);
    if (manifest) {
      if (manifest.revision !== revision) throw new ApiError(409, 'SYNC_CONFLICT', '云端已有新内容，请重新同步。本机草稿已保留。');
      const previous = await readRecordState(db, manifest);
      return writeRecordState(db, manifest, previous.value, value);
    }
    const text = JSON.stringify(value);
    if (encoder.encode(text).length > MAX_CONTENT_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '本站内容已达到当前容量上限，请联系维护人员扩容；本机草稿已保留，请导出备份。');
    const chunks = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + CHUNK_CHARS, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end--;
      chunks.push(text.slice(start, end)); start = end;
    }
    const statements = [db.prepare("DELETE FROM admin_state WHERE key GLOB 'content:chunk:*' AND EXISTS (SELECT 1 FROM admin_state WHERE key = 'content' AND revision = ?)").bind(revision)];
    chunks.forEach((part, i) => statements.push(db.prepare("INSERT INTO admin_state (key, value, revision) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_state WHERE key = 'content' AND revision = ?)")
      .bind('content:chunk:' + i, part, revision + 1, revision)));
    statements.push(db.prepare("UPDATE admin_state SET value = ?, revision = revision + 1 WHERE key = 'content' AND revision = ?")
      .bind(JSON.stringify({ storage: 'chunks-v1', count: chunks.length }), revision));
    const results = await db.batch(statements);
    if (results.at(-1).meta.changes !== 1) throw new ApiError(409, 'SYNC_CONFLICT', '云端已有新内容，请重新同步。本机草稿已保留。');
    return revision + 1;
  }
  const result = await db.prepare('UPDATE admin_state SET value = ?, revision = revision + 1 WHERE key = ? AND revision = ?')
    .bind(JSON.stringify(value), key, revision).run();
  if (result.meta.changes !== 1) throw new ApiError(409, 'SYNC_CONFLICT', '另一台设备已保存新内容。本机编辑已保留，请先导出备份，再重新加载云端内容。');
  return revision + 1;
}
async function credentials(db, env) {
  let saved = await state(db, 'password', null);
  if (!saved.value) {
    const initial = normalize(env.ADMIN_BOOTSTRAP_PASSWORD);
    if (initial.length < 8) throw new ApiError(503, 'ADMIN_NOT_CONFIGURED', '管理员初始密码尚未在服务器配置，请联系网站维护人员。');
    const salt = randomHex(16);
    const value = { salt, hash: await passwordHash(initial, salt) };
    await db.prepare('INSERT OR IGNORE INTO admin_state (key, value, revision) VALUES (?, ?, 0)').bind('password', JSON.stringify(value)).run();
    saved = await state(db, 'password', null);
  }
  return saved;
}
function activeInvite(invite) { return invite && !invite.revoked && !invite.paused && (!invite.expiresAt || invite.expiresAt > Date.now()); }
async function session(db, request, required = true) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization && !required) return null;
  const bearer = authorization.match(/^Bearer ([a-f0-9]{64})$/);
  let found = bearer && await db.prepare('SELECT * FROM admin_sessions WHERE id = ? AND expires_at > ?').bind(await digest(bearer[1]), Date.now()).first();
  if (found && found.role === 'editor') {
    const invites = await state(db, 'tokens', []);
    if (!activeInvite(invites.value.find(t => t.id === found.token_id))) found = null;
  }
  if (!found) throw new ApiError(401, 'SESSION_EXPIRED', '登录已失效，请重新登录。');
  return { role: found.role, name: found.name, tokenId: found.token_id, sessionId: found.id, expiresAt: found.expires_at };
}
export async function authorizeAdmin(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && !allowedOrigin(request, origin)) throw new ApiError(403, 'ORIGIN_DENIED', '此网址不允许访问管理接口。');
  if (!env.ADMIN_DB) throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', '云端数据库尚未配置');
  return session(env.ADMIN_DB, request);
}
export async function loadContentState(db) { return state(db, 'content', DEFAULTS); }
function requireSuper(user) {
  if (!user || user.role !== 'super_admin') throw new ApiError(403, 'FORBIDDEN', '此操作需要超级管理员权限。');
}
async function clientKeys(request, body) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return ['client:' + await digest(ip + ':' + String(body.clientId || '').slice(0, 100)), 'ip:' + await digest(ip)];
}
async function login(db, env, request, body) {
  const input = normalize(body.credential);
  if (!input || input.length > 2048) throw new ApiError(400, 'INVALID_INPUT', '请输入密码或邀请令牌。');
  const now = Date.now();
  const keys = await clientKeys(request, body);
  for (const key of keys) {
    const lock = await db.prepare('SELECT locked_until FROM admin_attempts WHERE id = ?').bind(key).first();
    if (lock?.locked_until > now) throw new ApiError(429, 'LOGIN_LOCKED', '尝试次数过多，请稍后再登录。', { lockedUntil: lock.locked_until });
  }
  const saved = await credentials(db, env);
  let user;
  if (await passwordHash(input, saved.value.salt) === saved.value.hash) user = { role: 'super_admin', name: '超级管理员', tokenId: '' };
  else {
    const invites = await state(db, 'tokens', []);
    const invite = invites.value.find(t => normalizeToken(t.token) === normalizeToken(input));
    if (activeInvite(invite)) user = { role: 'editor', name: invite.name, tokenId: invite.id };
  }
  if (!user) {
    let lockedUntil = 0;
    for (let i = 0; i < keys.length; i++) {
      const row = await db.prepare(`INSERT INTO admin_attempts (id, attempts, locked_until, updated_at, device)
        VALUES (?, 1, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET
        attempts = CASE WHEN updated_at < ? THEN 1 ELSE attempts + 1 END,
        locked_until = CASE WHEN updated_at >= ? AND attempts + 1 >= ? THEN ? ELSE 0 END,
        updated_at = excluded.updated_at, device = excluded.device RETURNING attempts, locked_until`)
        .bind(keys[i], now, String(body.device || '').slice(0, 150), now - LOCK_MS, now - LOCK_MS, i === 0 ? 5 : 30, now + LOCK_MS).first();
      lockedUntil = Math.max(lockedUntil, row.locked_until);
    }
    if (lockedUntil) throw new ApiError(429, 'LOGIN_LOCKED', '连续输入错误，请一分钟后再登录。', { lockedUntil });
    throw new ApiError(401, 'INVALID_CREDENTIALS', '密码错误或邀请令牌无效。');
  }
  await db.prepare('DELETE FROM admin_attempts WHERE id = ?').bind(keys[0]).run();
  const bearer = randomHex();
  const expiresAt = now + 12 * 3600000;
  // A concurrent password change must not issue a session for the previous password.
  const issued = await db.prepare(`INSERT INTO admin_sessions (id, role, name, token_id, expires_at)
    SELECT ?, ?, ?, ?, ? WHERE (SELECT revision FROM admin_state WHERE key = 'password') = ?`)
    .bind(await digest(bearer), user.role, user.name, user.tokenId, expiresAt, saved.revision).run();
  if (!issued.meta.changes) throw new ApiError(409, 'AUTH_CHANGED', '管理员密码刚刚更新，请重新登录。');
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now).run();
  await db.prepare('DELETE FROM admin_attempts WHERE updated_at < ?').bind(now - 86400000).run();
  return { ok: true, ...user, title: user.role === 'super_admin' ? user.name : '受邀管理员 · ' + user.name, bearer, expiresAt };
}
function contentPayload(body) {
  if (['kbCustom', 'kepuCustom', 'dialectCustom'].some(key => Array.isArray(body[key]) && body[key].length > 10000)) throw new ApiError(400, 'BATCH_REQUIRED', '请刷新页面后分批导入内容');
  try { return validateContent(body); }
  catch (error) { throw new ApiError(400, 'INVALID_CONTENT', error.message); }
}
async function getData(db, request, env) {
  const user = await session(db, request, false);
  const params = new URL(request.url).searchParams;
  const since = params.get('revision');
  let manifest = await recordsManifest(db);
  if (manifest && params.get('format') === 'history') {
    requireSuper(user);
    const page = await pageRecoveryHistory(db, manifest, params.get('cursor') || '');
    if ((await recordsManifest(db)).revision !== manifest.revision) throw new ApiError(409, 'PAGE_CHANGED', '内容已更新，请重新打开历史列表');
    return page;
  }
  if (manifest && params.get('format') === 'contributions') {
    requireSuper(user);
    return pageContributions(db, manifest, { tokenId: (params.get('tokenId') || '').slice(0, 200), cursor: params.get('cursor') || '' });
  }
  if (manifest && manifest.bytes > MAX_CONTENT_BYTES && !params.has('format')) throw new ApiError(409, 'CLIENT_UPGRADE_REQUIRED', '内容存储已升级，请刷新页面后继续使用；本机草稿已保留');
  if (manifest && ['records', 'record', 'search'].includes(params.get('format'))) {
    let result, tokens;
    if (params.get('format') === 'record') {
      const key = params.get('key') || '';
      if (!Object.keys(DEFAULTS).some(field => key === field || key.startsWith(field + '/')) || key.startsWith('auditLogs')) throw new ApiError(400, 'INVALID_RECORD', '内容编号不正确');
      const current = await recordSnapshot(db, manifest, key);
      manifest = current.manifest; tokens = { value: current.tokens };
      result = { ok: true, model: 'records-v1', revision: manifest.revision, rows: [{ key, value: globalThis.HeritageContent.contentCells(current.value).get(key) ?? null, summary: false }] };
    } else {
      tokens = await state(db, 'tokens', []);
      result = params.get('format') === 'search' ? await searchKnowledgeRecords(db, manifest, params.get('q') || '')
        : await pageRecords(db, manifest, { field: params.get('field') || undefined, cursor: params.get('cursor') || '', query: (params.get('q') || '').slice(0, 500), category: params.get('category') || '', media: params.get('media') || '', summary: params.get('summary') === '1', since: params.has('since') ? Number(params.get('since')) : undefined });
    }
    const pageContent = structuredClone(DEFAULTS);
    for (const row of result.rows) globalThis.HeritageContent.setContentCell(pageContent, row.key, row.value);
    const redacted = globalThis.HeritageContent.contentCells(safeContent(pageContent, tokens.value));
    result.rows = await Promise.all(result.rows.map(async row => ({ ...row, value: redacted.get(row.key) ?? null, hash: row.hash || await globalThis.HeritageContent.cellHash(row.value, true) })));
    if (params.get('format') === 'search' && (await recordsManifest(db)).revision !== manifest.revision) throw new ApiError(409, 'PAGE_CHANGED', '内容已更新，请刷新列表');
    return result;
  }
  const known = since !== null && await db.prepare("SELECT revision FROM admin_state WHERE key = 'content'").first();
  const unchanged = known && String(known.revision) === since;
  let content, paging;
  if (!unchanged && manifest && params.get('format') === 'pages') {
    const snapshot = await initialRecordPages(db, manifest);
    manifest = snapshot.manifest;
    const value = structuredClone(DEFAULTS), pages = {}, summaryKeys = [], hashes = {};
    for (const field of Object.keys(globalThis.HeritageContent.defaults)) {
      const page = snapshot.pages[field];
      pages[field] = page.cursor;
      for (const row of page.rows) { globalThis.HeritageContent.setContentCell(value, row.key, row.value); hashes[row.key] = row.hash; if (row.summary) summaryKeys.push(row.key); }
    }
    content = { value, revision: manifest.revision, bytes: manifest.bytes };
    paging = { model: 'records-v1', pages, summaryKeys, hashes, counts: await recordCounts(db, manifest) };
  } else content = unchanged ? { value: {}, revision: known.revision } : await state(db, 'content', DEFAULTS);
  const tokens = await state(db, 'tokens', []);
  const result = { ok: true, ...(!unchanged && safeContent(content.value, tokens.value)), ...paging, capabilities: { mediaUploads: !!env.ADMIN_MEDIA, separateImageDatabase: !!env.ADMIN_MEDIA_DB }, revision: content.revision, ...(unchanged && { unchanged: true }) };
  if (!unchanged) result.storage = { metadataBytes: content.bytes, metadataLimit: manifest ? null : MAX_CONTENT_BYTES, ...(manifest && { model: 'records-v1', maxRecordBytes: MAX_RECORD_BYTES }) };
  if (user) {
    result.session = { role: user.role, name: user.name, tokenId: user.tokenId, expiresAt: user.expiresAt };
    if (!unchanged) {
      result.auditLogs = user.role === 'super_admin' ? safeAudit(content.value, tokens.value) : [];
      result.notifications = (content.value._notifications || []).filter(n => user.role === 'super_admin' || n.tokenId === user.tokenId);
      if (user.role === 'super_admin') result.contributions = contributions(content.value, tokens.value);
      if (user.role === 'super_admin') result.recovery = recoveryHistory(content.value);
      if (manifest && paging) Object.assign(result, await recordMetadata(db, manifest, user, tokens.value));
    }
    if (user.role === 'super_admin') {
      result.tokens = tokens.value;
      result.tokenRevision = tokens.revision;
      const locks = await db.prepare("SELECT id, attempts, locked_until, updated_at, device FROM admin_attempts WHERE id LIKE 'client:%' ORDER BY updated_at DESC LIMIT 50").all();
      result.lockouts = locks.results.map(l => ({ id: l.id, device: l.device, attempts: l.attempts, lockedUntil: l.locked_until, lockedAt: l.updated_at, status: l.locked_until > Date.now() ? 'locked' : 'unlocked' }));
    }
  }
  return result;
}
async function postData(db, env, request, body) {
  const mediaDb = env.ADMIN_MEDIA_DB || db;
  if (body.action === 'login') return login(db, env, request, body);
  const user = await session(db, request);
  switch (body.action) {
    case 'storage_info': {
      requireSuper(user);
      const manifest = await recordsManifest(db);
      const row = await db.prepare("SELECT SUM(CASE WHEN key LIKE 'media:%' THEN length(CAST(value AS BLOB)) ELSE 0 END) AS mediaBytes, SUM(CASE WHEN key='content' OR key GLOB 'content:chunk:*' THEN length(CAST(value AS BLOB)) ELSE 0 END) AS metadataBytes FROM admin_state").first();
      const separate = mediaDb !== db;
      const images = separate ? await mediaDb.prepare("SELECT SUM(length(CAST(value AS BLOB))) AS bytes FROM admin_state WHERE key LIKE 'media:%'").first() : { bytes: 0 };
      return { ok: true, model: manifest ? 'records-v1' : 'snapshot', r2Enabled: !!env.ADMIN_MEDIA, separateImageDatabase: separate,
        imageDatabaseBytes: images.bytes || 0, legacyImageBytes: row.mediaBytes || 0, mediaBytes: (row.mediaBytes || 0) + (images.bytes || 0), metadataBytes: manifest ? manifest.bytes : row.metadataBytes || 0, metadataLimit: manifest ? null : MAX_CONTENT_BYTES, maxRecordBytes: MAX_RECORD_BYTES, imageLimit: 5000000 };
    }
    case 'archive_history': {
      requireSuper(user);
      const manifest = await recordsManifest(db);
      if (!manifest) throw new ApiError(409, 'MIGRATION_REQUIRED', '请先完成逐条存储迁移');
      return archiveHistoryBefore(db, manifest, env.ADMIN_MEDIA, user);
    }
    case 'store_media': {
      try { return { ok: true, ...await storeMedia(mediaDb, body.dataUrl, env.ADMIN_MEDIA) }; }
      catch (error) { if (error instanceof TypeError) throw new ApiError(400, 'INVALID_IMAGE', error.message); throw error; }
    }
    case 'migrate_media': {
      requireSuper(user);
      if (body.source && !['images', 'legacy'].includes(body.source)) throw new ApiError(400, 'INVALID_MEDIA_SOURCE', '图片来源不正确');
      try { return await migrateD1Media(body.source === 'legacy' ? db : mediaDb, env.ADMIN_MEDIA, body.cursor || ''); }
      catch (error) { if (error.code && [400, 503].includes(error.status)) throw new ApiError(error.status, error.code, error.message); throw error; }
    }
    case 'restore_operation': {
      requireSuper(user);
      const manifest = await recordsManifest(db), tokens = await state(db, 'tokens', []);
      let current;
      if (manifest) {
        if (typeof body.operationId !== 'string' || body.operationId.length > 200) throw new ApiError(400, 'INVALID_OPERATION', '请选择要恢复的记录');
        const row = await db.prepare("SELECT value FROM admin_content_items WHERE generation=? AND key=? AND kind='_history'").bind(manifest.generation, '_history/' + body.operationId).first();
        if (!row) throw new ApiError(404, 'HISTORY_NOT_FOUND', '未找到该历史记录');
        current = await readRecordState(db, manifest, ['_history/' + body.operationId, JSON.parse(row.value).key]);
      } else current = await state(db, 'content', DEFAULTS);
      let restored;
      try { restored = await restoreOperation(current.value, body.operationId, user, tokens.value, async value => expandHistoryMedia(mediaDb, await expandArchivedHistory(value, env.ADMIN_MEDIA), env.ADMIN_MEDIA, db), value => storeRecordMedia(mediaDb, value, new Map(), env.ADMIN_MEDIA), value => expandRecordMedia(mediaDb, value, env.ADMIN_MEDIA, db)); }
      catch (error) { if (error.status >= 500) throw error; throw new ApiError(409, 'RESTORE_CONFLICT', error.message); }
      const revision = manifest ? await writeRecordState(db, manifest, current.value, restored.next) : await saveState(db, 'content', restored.next, current.revision);
      return { ok: true, revision, title: restored.title };
    }
    case 'logout':
      await db.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(user.sessionId).run();
      return { ok: true };
    case 'update_content': {
      if (Array.isArray(body.changes) && body.changes.some(change => ['apiConfig', 'workflowConfig'].includes(change?.key))) requireSuper(user);
      const tokens = await state(db, 'tokens', []);
      const mediaCache = new Map();
      for (let attempt = 0; attempt < 5; attempt++) {
        const manifest = await recordsManifest(db);
        if (manifest && (!Array.isArray(body.changes) || body.changes.length > 16)) throw new ApiError(400, 'TOO_MANY_CHANGES', '每批最多保存16条，请分批提交');
        try { validateChanges(body.changes, user); }
        catch (error) { throw new ApiError(400, 'INVALID_CONTENT', error.message); }
        const current = manifest ? await readRecordState(db, manifest, body.changes.map(change => change.key)) : await state(db, 'content', DEFAULTS);
        let operation;
        if (manifest && body.operationId) {
          if (!/^[a-zA-Z0-9-]{16,100}$/.test(body.operationId)) throw new ApiError(400, 'INVALID_OPERATION_ID', '保存编号不正确');
          operation = { id: body.operationId, owner: user.tokenId || 'super_admin', hash: await digest(JSON.stringify(body.changes)) };
          const found = await db.prepare('SELECT owner,request_hash,value FROM admin_content_receipts WHERE generation=? AND id=?').bind(manifest.generation, operation.id).first();
          if (found) {
            if (found.owner !== operation.owner || found.request_hash !== operation.hash) throw new ApiError(409, 'OPERATION_MISMATCH', '保存编号已用于其他内容，请刷新后重试');
            const receipt = JSON.parse(found.value), values = globalThis.HeritageContent.contentCells(safeContent(current.value, tokens.value));
            return { ...receipt, revision: manifest.revision, counts: publicRecordCounts(manifest.counts), baseRevision: -1, replayed: true, updates: receipt.conflicts.map(key => ({ key, value: values.get(key) ?? null })) };
          }
        }
        let result;
        try { result = await applyChanges(current.value, body.changes, user, tokens.value, value => expandRecordMedia(mediaDb, value, env.ADMIN_MEDIA, db), async value => {
          try { return await storeRecordMedia(mediaDb, value, mediaCache, env.ADMIN_MEDIA); }
          catch (error) { if (error instanceof TypeError) throw error; throw new ApiError(503, 'MEDIA_UNAVAILABLE', '图片存储暂不可用，草稿已保留'); }
        }); }
        catch (error) { if (error.status) throw error; throw new ApiError(400, 'INVALID_CONTENT', error.message); }
        if (result.changed) result.next = await archiveHistoryMedia(mediaDb, result.next, (current.value._history || []).length, env.ADMIN_MEDIA);
        const values = globalThis.HeritageContent.contentCells(safeContent(result.next, tokens.value));
        const reply = { ok: true, baseRevision: current.revision, accepted: result.accepted, conflicts: result.conflicts,
          receipts: result.accepted.map(key => {
            const value = values.get(key);
            const provenance = value && typeof value === 'object' ? Object.fromEntries(['creatorName', 'creatorTokenId', 'createdAt'].filter(prop => Object.hasOwn(value, prop)).map(prop => [prop, value[prop]])) : {};
            return { key, provenance };
          }) };
        let revision = current.revision;
        try {
          if (manifest) {
            if (operation) operation.value = reply;
            if (result.changed || operation) revision = await writeRecordState(db, manifest, current.value, result.next, { receipt: operation });
          } else if (result.changed) revision = await saveState(db, 'content', result.next, current.revision);
        } catch (error) {
          if (error.code === 'SYNC_CONFLICT' && attempt < 4) continue;
          throw error;
        }
        const logs = user.role === 'super_admin' ? safeAudit(result.next, tokens.value) : [];
        const savedManifest = manifest && await recordsManifest(db);
        const summaries = savedManifest && user.role === 'super_admin' ? await recordSummaries(db, savedManifest, tokens.value) : null;
        return { ...reply, revision, ...(savedManifest && savedManifest.revision === revision && { counts: publicRecordCounts(savedManifest.counts) }), auditLogs: logs,
          recovery: user.role === 'super_admin' ? recoveryHistory(result.next) : undefined,
          ...summaries,
          updates: result.conflicts.map(key => ({ key, value: values.get(key) ?? null })) };
      }
      break;
    }
    case 'update_custom_bundle': {
      if (await recordsManifest(db)) throw new ApiError(409, 'CLIENT_UPGRADE_REQUIRED', '存储已升级，请刷新页面后继续录入；本机草稿已保留');
      const current = await state(db, 'content', DEFAULTS);
      const submitted = contentPayload(body);
      if (user.role !== 'super_admin') for (const key of ['apiConfig', 'workflowConfig']) {
        if (JSON.stringify(submitted[key]) !== JSON.stringify(current.value[key])) requireSuper(user);
      }
      const tokens = await state(db, 'tokens', []);
      const next = await archiveHistoryMedia(mediaDb, await updatedContent(current.value, submitted, user, tokens.value), (current.value._history || []).length, env.ADMIN_MEDIA);
      const revision = await saveState(db, 'content', next, body.revision);
      return { ok: true, revision, content: { ...safeContent(next, tokens.value), auditLogs: user.role === 'super_admin' ? safeAudit(next, tokens.value) : [] } };
    }
    case 'rollback_token':
    case 'reject_item': {
      requireSuper(user);
      const tokens = await state(db, 'tokens', []);
      const token = tokens.value.find(t => t.id === body.tokenId);
      if (!token) throw new ApiError(404, 'INVITE_NOT_FOUND', '邀请记录不存在。');
      if (body.action === 'reject_item' && (!['kb', 'kepu', 'dialect'].includes(body.itemType) || typeof body.itemId !== 'string')) throw new ApiError(400, 'INVALID_INPUT', '请选择需要审核的条目。');
      const manifest = await recordsManifest(db);
      let batch, receipt;
      if (manifest) {
        if (body.chunked !== true) throw new ApiError(409, 'CLIENT_UPGRADE_REQUIRED', '请刷新页面后分批撤回修改');
        if (!Number.isSafeInteger(body.cutoff) || body.cutoff < 0 || body.cutoff > Date.now() + 5000 || typeof body.cursor !== 'string' || body.cursor.length > 300 || !/^[a-f0-9]{64}$/.test(body.requestId || '')) throw new ApiError(400, 'INVALID_ROLLBACK_BATCH', '撤回批次不正确，请刷新后重试');
        receipt = { id: body.requestId, owner: 'super_admin', hash: await digest(JSON.stringify(body)) };
        const found = await db.prepare('SELECT owner,request_hash,value FROM admin_content_receipts WHERE generation=? AND id=?').bind(manifest.generation, receipt.id).first();
        if (found) {
          if (found.owner !== receipt.owner || found.request_hash !== receipt.hash) throw new ApiError(409, 'OPERATION_MISMATCH', '操作编号已使用，请重试');
          return { ...JSON.parse(found.value), replayed: true };
        }
        batch = body.action === 'reject_item' ? { keys: ['Custom', 'Edited', 'Deleted'].map(kind => body.itemType + kind + '/' + body.itemId), more: false }
          : await rollbackRecordKeys(db, manifest, token.id, { cursor: body.cursor, cutoff: body.cutoff });
        if (!batch.keys.length) return { ok: true, revision: manifest.revision, totalRemoved: 0, skipped: 0, removedKeys: [], skippedKeys: [], more: false, tokenName: token.name };
      }
      const current = manifest ? await readRollbackState(db, manifest, batch.keys) : await state(db, 'content', DEFAULTS);
      const item = body.action === 'reject_item' ? contributions(current.value, tokens.value).find(c => c.tokenId === token.id && c.id === body.itemId && c.type === body.itemType) : null;
      if (body.action === 'reject_item' && !item) throw new ApiError(404, 'ITEM_NOT_FOUND', '未找到该人员可撤回的修改。');
      const reason = String(body.reason || '超级管理员已撤回相关修改').trim().slice(0, 2000);
      const result = await rollback(current.value, token, user, tokens.value, item, reason, {
        cutoff: manifest ? body.cutoff : undefined, maxOperations: manifest ? 4 : undefined,
        prepareOperation: manifest ? async op => {
          const row = await db.prepare("SELECT value FROM admin_content_items WHERE generation=? AND key=? AND kind='_history'").bind(manifest.generation, '_history/' + op.id).first();
          if (!row) throw new ApiError(409, 'SYNC_CONFLICT', '历史已更新，请重试');
          Object.assign(op, JSON.parse(row.value));
        } : undefined,
        expand: async value => expandHistoryMedia(mediaDb, await expandArchivedHistory(value, env.ADMIN_MEDIA), env.ADMIN_MEDIA, db), normalize: value => storeRecordMedia(mediaDb, value, new Map(), env.ADMIN_MEDIA), legacyCurrent: value => expandRecordMedia(mediaDb, value, env.ADMIN_MEDIA, db)
      });
      validateContent(result.next);
      const reply = { ok: true, revision: current.revision + 1, totalRemoved: result.totalRemoved, skipped: result.skipped, removedKeys: result.removedKeys, skippedKeys: result.skippedKeys, tokenName: token.name, itemTitle: item?.title,
        ...(manifest ? { more: result.limited || batch.more, cursor: result.limited ? body.cursor : batch.keys.at(-1), cutoff: body.cutoff } : {}) };
      if (receipt) receipt.value = reply;
      reply.revision = manifest ? await writeRecordState(db, manifest, current.value, result.next, { receipt }) : await saveState(db, 'content', result.next, current.revision);
      return reply;
    }
    case 'read_notifications': {
      const manifest = await recordsManifest(db);
      const current = manifest ? await readRecordKinds(db, manifest, ['_notifications'], user.role === 'super_admin' ? undefined : user.tokenId) : await state(db, 'content', DEFAULTS);
      const next = structuredClone(current.value);
      for (const n of next._notifications || []) if ((user.role === 'super_admin' || n.tokenId === user.tokenId) && (!body.id || n.id === body.id)) n.read = true;
      const revision = manifest ? await writeRecordState(db, manifest, current.value, next) : await saveState(db, 'content', next, current.revision);
      return { ok: true, revision };
    }
    case 'clear_audit_logs': {
      requireSuper(user);
      const manifest = await recordsManifest(db);
      const current = manifest ? await readRecordKinds(db, manifest, ['auditLogs']) : await state(db, 'content', DEFAULTS);
      const next = structuredClone(current.value); next.auditLogs = [];
      audit(next, user, '归档日志', '已清空显示日志，版本回滚历史仍保留', []);
      const revision = manifest ? await writeRecordState(db, manifest, current.value, next) : await saveState(db, 'content', next, current.revision);
      return { ok: true, revision };
    }
    case 'update_password': {
      requireSuper(user);
      const password = normalize(body.password);
      if (password.length < 8 || password.length > 200) throw new ApiError(400, 'INVALID_PASSWORD', '密码长度需要在 8 到 200 位之间。');
      const saved = await credentials(db, env);
      const salt = randomHex(16);
      await saveState(db, 'password', { salt, hash: await passwordHash(password, salt) }, saved.revision);
      await db.prepare("DELETE FROM admin_sessions WHERE role = 'super_admin' AND id != ?").bind(user.sessionId).run();
      return { ok: true };
    }
    case 'create_token': {
      requireSuper(user);
      const name = String(body.name || '').trim().slice(0, 100);
      const days = Number(body.days);
      if (!name || !Number.isFinite(days) || days < 0 || days > 3650) throw new ApiError(400, 'INVALID_INVITE', '请填写姓名和有效天数（0 表示长期有效）。');
      const saved = await state(db, 'tokens', []);
      const now = Date.now();
      const token = { id: crypto.randomUUID(), token: 'NFYJ-INV-' + randomHex(16).toUpperCase(), name, role: 'editor', createdAt: now, expiresAt: days ? now + days * 86400000 : 0, revoked: false, paused: false };
      const tokens = [token, ...saved.value];
      const tokenRevision = await saveState(db, 'tokens', tokens, saved.revision);
      return { ok: true, token, tokens, tokenRevision };
    }
    case 'change_token': {
      requireSuper(user);
      const saved = await state(db, 'tokens', []);
      const found = saved.value.find(t => t.id === body.id);
      if (!found) throw new ApiError(404, 'INVITE_NOT_FOUND', '邀请令牌不存在。');
      if (body.operation === 'pause') found.paused = true;
      else if (body.operation === 'resume') found.paused = false;
      else if (body.operation === 'revoke') found.revoked = true;
      else if (body.operation === 'delete') saved.value = saved.value.filter(t => t.id !== body.id);
      else throw new ApiError(400, 'INVALID_OPERATION', '不支持的令牌操作。');
      const tokenRevision = await saveState(db, 'tokens', saved.value, saved.revision);
      return { ok: true, tokens: saved.value, tokenRevision };
    }
    case 'unlock':
      requireSuper(user);
      await db.prepare('DELETE FROM admin_attempts WHERE id = ?').bind(String(body.id || '')).run();
      return { ok: true };
    case 'unlock_all':
      requireSuper(user);
      await db.prepare('DELETE FROM admin_attempts').run();
      return { ok: true };
    default: throw new ApiError(400, 'UNKNOWN_ACTION', '不支持的操作，请刷新页面后重试。');
  }
}
async function handle({ request, env = {} }) {
  try {
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigin(request, origin)) throw new ApiError(403, 'ORIGIN_DENIED', '此网址不允许访问管理接口。');
    if (request.method === 'OPTIONS') return json(204, null, request);
    if (!env.ADMIN_DB) throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', '云端数据库尚未配置，管理登录和同步暂不可用。');
    let result;
    if (request.method === 'GET') result = await getData(env.ADMIN_DB, request, env);
    else if (request.method === 'POST') {
      if (!request.headers.get('Content-Type')?.includes('application/json')) throw new ApiError(415, 'INVALID_TYPE', '请求需要使用 JSON。');
      // Login stays available with an expired bearer; only validated sessions get the large upload budget.
      let authenticated = false;
      if (request.headers.has('Authorization')) {
        try { authenticated = !!(await session(env.ADMIN_DB, request)); }
        catch (error) { if (!(error instanceof ApiError) || error.status !== 401) throw error; }
      }
      let bytes;
      try { bytes = await readLimited(request, authenticated ? MAX_CONTENT_BYTES : 8192); }
      catch (error) { if (error instanceof RangeError) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求内容超过允许大小，本机草稿已保留。'); throw error; }
      const text = new TextDecoder().decode(bytes);
      let body;
      try { body = JSON.parse(text); } catch { throw new ApiError(400, 'INVALID_JSON', '请求内容格式不正确。'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new ApiError(400, 'INVALID_JSON', '请求内容格式不正确。');
      result = await postData(env.ADMIN_DB, env, request, body);
    } else throw new ApiError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法。');
    return json(200, result, request);
  } catch (error) {
    if (error instanceof ApiError || error instanceof RecordError) return json(error.status, { ok: false, code: error.code, error: error.message, ...error.extra }, request);
    console.error('Admin storage request failed:', error.name);
    return json(503, { ok: false, code: 'STORAGE_UNAVAILABLE', error: '云端数据库暂时不可用，请稍后重试。本机编辑不会因此删除。' }, request);
  }
}
export const onRequestGet = handle;
export const onRequestPost = handle;
export const onRequestOptions = handle;
