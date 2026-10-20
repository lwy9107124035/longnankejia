// Credentials and shared state belong in D1, never in a Worker isolate.
const DEFAULTS = {
  kbCustom: [], kbEdited: {}, kbDeleted: [], kepuCustom: [], kepuEdited: {},
  kepuDeleted: [], dialectCustom: [], dialectDeleted: [], apiConfig: {}, workflowConfig: {}, auditLogs: []
};
const LOCK_MS = 60000;
const encoder = new TextEncoder();
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
  const row = await db.prepare('SELECT value, revision FROM admin_state WHERE key = ?').bind(key).first();
  return row ? { value: JSON.parse(row.value), revision: row.revision } : { value: fallback, revision: 0 };
}
async function saveState(db, key, value, revision) {
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
function requireSuper(user) {
  if (user.role !== 'super_admin') throw new ApiError(403, 'FORBIDDEN', '此操作需要超级管理员权限。');
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
  const value = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const input = body[key];
    const valid = Array.isArray(fallback) ? Array.isArray(input) : input && typeof input === 'object' && !Array.isArray(input);
    if (!valid) throw new ApiError(400, 'INVALID_CONTENT', '同步内容格式不正确：' + key);
    value[key] = input;
  }
  for (const key of Object.keys(value.apiConfig)) if (!['mode', 'model', 'temperature', 'maxTokens'].includes(key)) delete value.apiConfig[key];
  return value;
}
async function getData(db, request) {
  const user = await session(db, request, false);
  const content = await state(db, 'content', DEFAULTS);
  const result = { ok: true, ...content.value, revision: content.revision };
  delete result.auditLogs;
  if (user) {
    result.session = { role: user.role, name: user.name, tokenId: user.tokenId, expiresAt: user.expiresAt };
    result.auditLogs = content.value.auditLogs || [];
    if (user.role === 'super_admin') {
      const tokens = await state(db, 'tokens', []);
      result.tokens = tokens.value;
      result.tokenRevision = tokens.revision;
      const locks = await db.prepare("SELECT id, attempts, locked_until, updated_at, device FROM admin_attempts WHERE id LIKE 'client:%' ORDER BY updated_at DESC LIMIT 50").all();
      result.lockouts = locks.results.map(l => ({ id: l.id, device: l.device, attempts: l.attempts, lockedUntil: l.locked_until, lockedAt: l.updated_at, status: l.locked_until > Date.now() ? 'locked' : 'unlocked' }));
    }
  }
  return result;
}
async function postData(db, env, request, body) {
  if (body.action === 'login') return login(db, env, request, body);
  const user = await session(db, request);
  switch (body.action) {
    case 'logout':
      await db.prepare('DELETE FROM admin_sessions WHERE id = ?').bind(user.sessionId).run();
      return { ok: true };
    case 'update_custom_bundle': {
      const current = await state(db, 'content', DEFAULTS);
      const next = contentPayload(body);
      if (user.role !== 'super_admin') for (const key of ['apiConfig', 'workflowConfig']) {
        if (JSON.stringify(next[key]) !== JSON.stringify(current.value[key])) requireSuper(user);
      }
      const revision = await saveState(db, 'content', next, body.revision);
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
    if (request.method === 'GET') result = await getData(env.ADMIN_DB, request);
    else if (request.method === 'POST') {
      if (!request.headers.get('Content-Type')?.includes('application/json')) throw new ApiError(415, 'INVALID_TYPE', '请求需要使用 JSON。');
      const text = await request.text();
      if (encoder.encode(text).length > 2 * 1024 * 1024) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '同步内容超过 2 MB，请分批导入。');
      let body;
      try { body = JSON.parse(text); } catch { throw new ApiError(400, 'INVALID_JSON', '请求内容格式不正确。'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new ApiError(400, 'INVALID_JSON', '请求内容格式不正确。');
      result = await postData(env.ADMIN_DB, env, request, body);
    } else throw new ApiError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法。');
    return json(200, result, request);
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { ok: false, code: error.code, error: error.message, ...error.extra }, request);
    console.error('Admin storage request failed:', error.name);
    return json(503, { ok: false, code: 'STORAGE_UNAVAILABLE', error: '云端数据库暂时不可用，请稍后重试。本机编辑不会因此删除。' }, request);
  }
}
export const onRequestGet = handle;
export const onRequestPost = handle;
export const onRequestOptions = handle;
