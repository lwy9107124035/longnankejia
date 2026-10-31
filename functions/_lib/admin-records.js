import { DEFAULTS, validateContent, safeAudit } from './admin-content.js';

const schema = globalThis.HeritageContent;
const encoder = new TextEncoder();
export const MAX_RECORD_BYTES = 1500000;
const fields = Object.keys(schema.defaults);
const privateKinds = ['_history', 'auditLogs', '_notifications'];
const empty = () => structuredClone(DEFAULTS);
const bytes = value => encoder.encode(value).length;
const sourceSizes = new WeakMap();
function dialectCounters(value) {
  if (!value) return [];
  return ['dialectCustom/media/' + (schema.isAudioTrack(value) ? 'audio' : 'video')];
}
export class RecordError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}

export async function recordsManifest(db) {
  const row = await db.prepare("SELECT value, revision FROM admin_state WHERE key='content'").first();
  if (!row) return null;
  const manifest = JSON.parse(row.value);
  return manifest.storage === 'records-v1' ? { ...manifest, revision: row.revision } : null;
}

function cellRows(content) {
  const rows = new Map(schema.contentCells(content));
  for (const kind of privateKinds) for (const item of content[kind] || []) rows.set(kind + '/' + item.id, item);
  return rows;
}
function addRow(content, row) {
  const value = JSON.parse(row.value);
  if (privateKinds.includes(row.kind)) content[row.kind].push(value);
  else if (value !== null) schema.setContentCell(content, row.key, value);
}
function assembledState(results, manifest) {
  const content = { ...empty(), _history: [], _notifications: [] };
  for (const row of results) addRow(content, row);
  sourceSizes.set(content, new Map(results.map(row => [row.key, row.storedBytes ?? bytes(row.value)])));
  content.auditLogs.reverse(); content._notifications.reverse();
  return { value: content, revision: manifest.revision, bytes: manifest.bytes };
}

export async function readRecordState(db, manifest, keys) {
  let sql = 'SELECT key,kind,value FROM admin_content_items WHERE generation=?';
  const params = [manifest.generation];
  if (keys) {
    if (keys.length > 32) throw new RecordError(400, 'TOO_MANY_CHANGES', '每批最多保存32条，请分批提交');
    if (!keys.length) return { value: { ...empty(), _history: [], _notifications: [] }, revision: manifest.revision, bytes: manifest.bytes };
    sql += ' AND key IN (' + keys.map(() => '?').join(',') + ')'; params.push(...keys);
  }
  sql += ' ORDER BY rowid';
  const { results } = await db.prepare(sql).bind(...params).all();
  return assembledState(results, manifest);
}
export async function readRecordKinds(db, manifest, kinds, owner) {
  if (!kinds.length || kinds.some(kind => !privateKinds.includes(kind))) throw new TypeError('Only private metadata kinds may be selected');
  const { results } = await db.prepare('SELECT key,kind,value FROM admin_content_items WHERE generation=? AND kind IN (' + kinds.map(() => '?').join(',') + ')' + (owner === undefined ? '' : ' AND owner=?') + ' ORDER BY rowid')
    .bind(manifest.generation, ...kinds, ...(owner === undefined ? [] : [owner])).all();
  return assembledState(results, manifest);
}
export async function rollbackRecordKeys(db, manifest, tokenId, { cursor = '', cutoff, limit = 8 }) {
  const { results } = await db.prepare("SELECT target FROM (SELECT target_key AS target FROM admin_content_items WHERE generation=? AND kind='_history' AND owner=? AND COALESCE(json_extract(value,'$.undone'),0)=0 AND json_extract(value,'$.time')<=? UNION SELECT r.key AS target FROM admin_content_items r WHERE r.generation=? AND r.owner=? AND r.kind IN ('kbCustom','kepuCustom','dialectCustom') AND r.value!='null' AND NOT EXISTS(SELECT 1 FROM admin_content_items h WHERE h.generation=r.generation AND h.kind='_history' AND h.target_key=r.key)) WHERE target>? ORDER BY target LIMIT ?")
    .bind(manifest.generation, tokenId, cutoff, manifest.generation, tokenId, cursor, limit + 1).all();
  return { keys: results.slice(0, limit).map(row => row.target), more: results.length > limit };
}
export async function readRollbackState(db, manifest, keys) {
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await db.prepare("SELECT key,kind,CASE WHEN kind='_history' THEN json_remove(value,'$.before','$.remove') ELSE value END AS value,json_type(value,'$.before') AS beforeType,length(CAST(value AS BLOB)) AS storedBytes FROM admin_content_items WHERE generation=? AND (key IN (" + placeholders + ") OR (kind='_history' AND target_key IN (" + placeholders + '))) ORDER BY rowid')
    .bind(manifest.generation, ...keys, ...keys).all();
  for (const row of results) if (row.kind === '_history') {
    const value = JSON.parse(row.value); value.before = row.beforeType && row.beforeType !== 'null' ? { $operation: value.id } : null; row.value = JSON.stringify(value);
  }
  return assembledState(results, manifest);
}
export async function recordSummaries(db, manifest, tokens) {
  const [logs, history] = await Promise.all([
    db.prepare("SELECT value FROM admin_content_items WHERE generation=? AND kind='auditLogs' ORDER BY rowid DESC LIMIT 200").bind(manifest.generation).all(),
    db.prepare("SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.title') AS title,json_extract(value,'$.kind') AS kind,json_extract(value,'$.time') AS time FROM admin_content_items WHERE generation=? AND kind='_history' AND COALESCE(json_extract(value,'$.undone'),0)=0 AND json_type(value,'$.before') IS NOT NULL AND json_type(value,'$.before')!='null' ORDER BY rowid DESC LIMIT 50").bind(manifest.generation).all()
  ]);
  return { auditLogs: safeAudit({ auditLogs: logs.results.map(row => JSON.parse(row.value)) }, tokens), recovery: history.results };
}

export async function pageRecoveryHistory(db, manifest, cursor = '') {
  let before = Number.MAX_SAFE_INTEGER;
  if (cursor) {
    const parts = cursor.split('.');
    if (cursor.length > 200 || parts.length !== 3 || !/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2]) || !Number.isSafeInteger(Number(parts[2]))) throw new RecordError(400, 'INVALID_CURSOR', '历史分页标记不正确');
    if (parts[0] !== manifest.generation || Number(parts[1]) !== manifest.revision) throw new RecordError(409, 'PAGE_CHANGED', '内容已更新，请重新打开历史列表');
    before = Number(parts[2]);
  }
  const { results } = await db.prepare("SELECT rowid AS position,json_extract(value,'$.id') AS id,json_extract(value,'$.title') AS title,json_extract(value,'$.kind') AS kind,json_extract(value,'$.time') AS time FROM admin_content_items WHERE generation=? AND kind='_history' AND COALESCE(json_extract(value,'$.undone'),0)=0 AND json_type(value,'$.before') IS NOT NULL AND json_type(value,'$.before')!='null' AND rowid<? ORDER BY rowid DESC LIMIT 51")
    .bind(manifest.generation, before).all();
  const rows = results.slice(0, 50);
  return { ok: true, revision: manifest.revision, rows: rows.map(({ position, ...row }) => row),
    cursor: results.length > 50 ? manifest.generation + '.' + manifest.revision + '.' + rows.at(-1).position : '' };
}

export async function recordMetadata(db, manifest, user, tokens) {
  if (!user) return {};
  const root = user.role === 'super_admin';
  const { results } = await db.prepare("SELECT value FROM admin_content_items WHERE generation=? AND kind='_notifications' AND COALESCE(json_extract(value,'$.read'),0)=0" + (root ? '' : ' AND owner=?') + ' ORDER BY rowid DESC LIMIT 200')
    .bind(manifest.generation, ...(root ? [] : [user.tokenId])).all();
  const result = { auditLogs: [], notifications: results.map(row => JSON.parse(row.value)) };
  if (user.role === 'super_admin') {
    Object.assign(result, await recordSummaries(db, manifest, tokens));
    const page = await pageContributions(db, manifest);
    result.contributions = page.rows; result.contributionCursor = page.cursor;
    result.contributionCounts = (await db.prepare(contributionSql + ' SELECT tokenId,type,COUNT(*) AS count FROM contributions GROUP BY tokenId,type').bind(manifest.generation, manifest.generation).all()).results;
  }
  return result;
}

const contributionSql = `WITH source AS (
  SELECT owner AS tokenId, CASE WHEN target_key LIKE 'kepu%' THEN 'kepu' WHEN target_key LIKE 'dialect%' THEN 'dialect' ELSE 'kb' END AS type,
    substr(target_key,instr(target_key,'/')+1) AS id,json_extract(value,'$.title') AS title,json_extract(value,'$.kind') AS preview,json_extract(value,'$.time') AS createdAt,rowid AS sequence
  FROM admin_content_items WHERE generation=? AND kind='_history' AND owner!='' AND COALESCE(json_extract(value,'$.undone'),0)=0
  UNION ALL
  SELECT owner,replace(kind,'Custom',''),json_extract(value,'$.id'),COALESCE(json_extract(value,'$.title'),json_extract(value,'$.name'),json_extract(value,'$.item.name')),'历史新增内容',COALESCE(json_extract(value,'$.createdAt'),0),0
  FROM admin_content_items WHERE generation=? AND owner!='' AND kind IN ('kbCustom','kepuCustom','dialectCustom') AND value!='null'
), ranked AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY tokenId,type,id ORDER BY createdAt DESC,sequence DESC) AS position FROM source),
contributions AS (SELECT tokenId,type,id,title,preview,createdAt,tokenId||'/'||type||'/'||id AS rowKey FROM ranked WHERE position=1)`;

export async function pageContributions(db, manifest, { tokenId = '', cursor = '' } = {}) {
  let after = '';
  if (cursor) {
    let value;
    try { if (cursor.length > 2048) throw new Error(); value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor), char => char.charCodeAt(0)))); }
    catch { throw new RecordError(400, 'INVALID_CURSOR', '审查分页标记不正确'); }
    if (value.revision !== manifest.revision || value.generation !== manifest.generation) throw new RecordError(409, 'PAGE_CHANGED', '内容已更新，请重新打开审查列表');
    if (value.tokenId !== tokenId || typeof value.key !== 'string' || value.key.length > 500) throw new RecordError(400, 'INVALID_CURSOR', '审查分页标记与人员不匹配');
    after = value.key;
  }
  const params = [manifest.generation, manifest.generation, after, ...(tokenId ? [tokenId] : [])];
  const { results } = await db.prepare(contributionSql + ' SELECT * FROM contributions WHERE rowKey>?' + (tokenId ? ' AND tokenId=?' : '') + ' ORDER BY rowKey LIMIT 51').bind(...params).all();
  const rows = results.slice(0, 50), value = { generation: manifest.generation, revision: manifest.revision, tokenId, key: rows.at(-1)?.rowKey };
  return { ok: true, revision: manifest.revision, rows: rows.map(({ rowKey, ...row }) => row), cursor: results.length > 50 ? btoa(Array.from(encoder.encode(JSON.stringify(value)), char => String.fromCharCode(char)).join('')) : '' };
}

async function rowInfo(key, value) {
  const kind = key.includes('/') ? key.split('/')[0] : key;
  const owner = value && typeof value === 'object' ? value.tokenId || value.creatorTokenId || '' : '';
  const text = JSON.stringify(value);
  if (bytes(text) > MAX_RECORD_BYTES) throw new RecordError(413, 'RECORD_TOO_LARGE', '单条内容过长，请分篇保存；草稿已保留');
  return { kind, owner, text, targetKey: kind === '_history' && value ? value.key : '', mediaType: kind === 'dialectCustom' && value ? schema.isAudioTrack(value) ? 'audio' : 'video' : '', digest: await schema.cellHash(value, true) };
}

export async function writeRecordState(db, manifest, previous, next, { receipt } = {}) {
  const before = cellRows(previous), after = cellRows(next);
  const sizes = sourceSizes.get(previous);
  const revision = manifest.revision + 1, statements = [], upserts = [], removals = [];
  const counts = { ...manifest.counts };
  let delta = 0;
  const guard = "EXISTS (SELECT 1 FROM admin_state WHERE key='content' AND revision=? AND json_extract(value,'$.generation')=?)";
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldValue = before.get(key) ?? null, value = after.get(key) ?? null;
    if (schema.canonical(oldValue) === schema.canonical(value)) continue;
    const row = await rowInfo(key, value);
    counts[row.kind] = (counts[row.kind] || 0) + (value === null ? 0 : 1) - (oldValue === null ? 0 : 1);
    if (row.kind === 'dialectCustom') {
      for (const key of dialectCounters(oldValue)) counts[key] = (counts[key] || 0) - 1;
      for (const key of dialectCounters(value)) counts[key] = (counts[key] || 0) + 1;
    }
    delta += (privateKinds.includes(row.kind) && value === null ? 0 : bytes(row.text)) - (sizes?.get(key) ?? (before.has(key) ? bytes(JSON.stringify(oldValue)) : 0));
    if (privateKinds.includes(row.kind) && value === null) {
      removals.push(key);
    } else {
      upserts.push({ key, kind: row.kind, owner: row.owner, media: row.mediaType, target: row.targetKey, value, digest: row.digest });
    }
  }
  function groups(values) {
    const result = []; let group = [], size = 2;
    for (const value of values) {
      const length = bytes(JSON.stringify(value)) + 1;
      if (group.length && size + length > 1800000) { result.push(group); group = []; size = 2; }
      group.push(value); size += length;
    }
    if (group.length) result.push(group); return result;
  }
  for (const rows of groups(upserts)) statements.push(db.prepare("INSERT INTO admin_content_items(generation,key,kind,owner,media_type,target_key,value,digest,revision) SELECT ?,json_extract(j.value,'$.key'),json_extract(j.value,'$.kind'),json_extract(j.value,'$.owner'),json_extract(j.value,'$.media'),json_extract(j.value,'$.target'),json(j.value -> '$.value'),json_extract(j.value,'$.digest'),? FROM json_each(?) j WHERE " + guard + ' ON CONFLICT(generation,key) DO UPDATE SET value=excluded.value,owner=excluded.owner,media_type=excluded.media_type,target_key=excluded.target_key,digest=excluded.digest,revision=excluded.revision')
    .bind(manifest.generation, revision, JSON.stringify(rows), manifest.revision, manifest.generation));
  for (const keys of groups(removals)) statements.push(db.prepare('DELETE FROM admin_content_items WHERE generation=? AND key IN (SELECT value FROM json_each(?)) AND ' + guard).bind(manifest.generation, JSON.stringify(keys), manifest.revision, manifest.generation));
  if (statements.length > 40) throw new RecordError(409, 'BATCH_REQUIRED', '本次变更多，请刷新页面后分批保存');
  if (!statements.length && !receipt) return manifest.revision;
  if (receipt) {
    statements.push(db.prepare('INSERT INTO admin_content_receipts(generation,id,owner,request_hash,value,created_at) SELECT ?,?,?,?,?,? WHERE ' + guard + ' ON CONFLICT(generation,id) DO NOTHING')
      .bind(manifest.generation, receipt.id, receipt.owner, receipt.hash, JSON.stringify(receipt.value), Date.now(), manifest.revision, manifest.generation));
  }
  const marker = { storage: 'records-v1', generation: manifest.generation, counts, bytes: Math.max(0, (manifest.bytes || 0) + delta) };
  statements.push(db.prepare("UPDATE admin_state SET value=?,revision=revision+1 WHERE key='content' AND revision=?").bind(JSON.stringify(marker), manifest.revision));
  const results = await db.batch(statements);
  if (results.at(-1).meta.changes !== 1) throw new RecordError(409, 'SYNC_CONFLICT', '另一台设备刚保存了内容，请重试；本机草稿已保留');
  return revision;
}

export async function migrateRecordStorage(db, current, { generation = crypto.randomUUID(), batchSize = 35 } = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 40) throw new TypeError('Invalid migration batch size');
  validateContent(current.value);
  const rows = [...schema.contentCells(current.value)];
  for (const kind of privateKinds) {
    const items = kind === '_history' ? current.value[kind] || [] : [...current.value[kind] || []].reverse();
    for (const item of items) rows.push([kind + '/' + item.id, item]);
  }
  const prepared = await Promise.all(rows.map(async ([key, value]) => ({ key, ...await rowInfo(key, value) })));
  // Staging is invisible until the revision-guarded manifest switch below succeeds.
  for (let offset = 0; offset < prepared.length; offset += batchSize) {
    await db.batch(prepared.slice(offset, offset + batchSize).map(row => db.prepare('INSERT INTO admin_content_items(generation,key,kind,owner,media_type,target_key,value,digest,revision) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(generation, row.key, row.kind, row.owner, row.mediaType, row.targetKey, row.text, row.digest, current.revision)));
  }
  const byteLength = prepared.reduce((sum, row) => sum + bytes(row.text), 0);
  const staged = await readRecordState(db, { generation, revision: current.revision, bytes: byteLength });
  if (schema.canonical(staged.value) !== schema.canonical({ ...current.value, _history: current.value._history || [], _notifications: current.value._notifications || [], auditLogs: current.value.auditLogs || [] })) {
    throw new Error('Staged record migration failed its full content comparison');
  }
  const counts = {};
  for (const row of prepared) counts[row.kind] = (counts[row.kind] || 0) + (row.text === 'null' ? 0 : 1);
  for (const row of prepared.filter(row => row.kind === 'dialectCustom')) for (const key of dialectCounters(JSON.parse(row.text))) counts[key] = (counts[key] || 0) + 1;
  const marker = { storage: 'records-v1', generation, counts, bytes: byteLength };
  const result = await db.batch([
    db.prepare("INSERT INTO admin_state(key,value,revision) SELECT ?,value,revision FROM admin_state WHERE key='content' AND revision=?")
      .bind('content:legacy:' + generation, current.revision),
    db.prepare("UPDATE admin_state SET value=?,revision=revision+1 WHERE key='content' AND revision=?").bind(JSON.stringify(marker), current.revision)
  ]);
  if (result.at(-1).meta.changes !== 1) throw new RecordError(409, 'SYNC_CONFLICT', '迁移期间有新内容，未切换存储，请按新版本重试');
  return { ...marker, revision: current.revision + 1, rows: prepared.length };
}

function pageStatement(db, clause, params, after, limit, summary) {
  const selector = summary ? "CASE WHEN kind IN ('kbCustom','kbEdited','kepuCustom','kepuEdited') THEN json_remove(value,'$.detail','$.answer') ELSE value END" : 'value';
  return db.prepare('SELECT key,kind,digest,value FROM (SELECT *,SUM(length(CAST(value AS BLOB))) OVER (ORDER BY key) AS runningBytes,ROW_NUMBER() OVER (ORDER BY key) AS position FROM (SELECT key,kind,digest,' + selector + ' AS value FROM admin_content_items WHERE ' + clause + ' AND key>? ORDER BY key LIMIT ?)) WHERE runningBytes<=1800000 OR position=1').bind(...params, after, limit);
}
function encodeRecordCursor(value) {
  return btoa(Array.from(encoder.encode(JSON.stringify(value)), value => String.fromCharCode(value)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function pageRows(rows, summary) {
  return rows.map(row => ({ key: row.key, value: JSON.parse(row.value), hash: row.digest, summary: summary && /^(?:kb|kepu)(?:Custom|Edited)$/.test(row.kind) }));
}

function snapshotManifest(row, manifest) {
  const current = { ...JSON.parse(row.value), revision: row.revision };
  if (current.storage !== 'records-v1' || current.generation !== manifest.generation) throw new RecordError(409, 'PAGE_CHANGED', '存储已更新，请刷新列表');
  return current;
}

export async function recordSnapshot(db, manifest, key) {
  const [state, record] = await db.batch([
    db.prepare("SELECT key,value,revision FROM admin_state WHERE key IN ('content','tokens')"),
    db.prepare('SELECT key,kind,value FROM admin_content_items WHERE generation=? AND key=?').bind(manifest.generation, key)
  ]);
  const current = snapshotManifest(state.results.find(row => row.key === 'content'), manifest);
  return { manifest: current, tokens: JSON.parse(state.results.find(row => row.key === 'tokens')?.value || '[]'),
    value: assembledState(record.results, current).value };
}

export async function initialRecordPages(db, manifest) {
  const result = await db.batch([
    db.prepare("SELECT value,revision FROM admin_state WHERE key='content'"),
    ...fields.map(field => pageStatement(db, "generation=? AND kind=? AND value!='null'", [manifest.generation, field], '', 50, true))
  ]);
  const current = snapshotManifest(result[0].results[0], manifest);
  const pages = {};
  for (const [index, field] of fields.entries()) {
    const rows = result[index + 1].results, total = current.counts[field] || 0;
    const value = { generation: current.generation, revision: current.revision, key: rows.at(-1)?.key || '', field, query: '', category: '', media: '', since: null };
    pages[field] = { rows: pageRows(rows, true), cursor: rows.length && total > rows.length ? encodeRecordCursor(value) : '' };
  }
  return { manifest: current, pages };
}

export async function pageRecords(db, manifest, { field, cursor = '', limit = 50, summary = false, query = '', category = '', media = '', since } = {}) {
  if (field && !fields.includes(field)) throw new RecordError(400, 'INVALID_PAGE', '内容类型不正确');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RecordError(400, 'INVALID_PAGE', '每页应为1到100条');
  let after = '';
  if (cursor) {
    let parsed;
    try {
      if (cursor.length > 8192) throw new Error('cursor too long');
      parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')), value => value.charCodeAt(0))));
    } catch { throw new RecordError(400, 'INVALID_CURSOR', '分页标记不正确'); }
    if (parsed.revision !== manifest.revision || parsed.generation !== manifest.generation) throw new RecordError(409, 'PAGE_CHANGED', '内容已更新，请刷新列表');
    if (typeof parsed.key !== 'string' || parsed.key.length > 300 || parsed.field !== (field || '') || parsed.query !== query || parsed.category !== category || parsed.media !== media || parsed.since !== (since ?? null)) throw new RecordError(400, 'INVALID_CURSOR', '分页标记与查询不匹配');
    after = parsed.key;
  }
  let clause = 'generation=? AND kind IN (' + fields.map(() => '?').join(',') + ')';
  const params = [manifest.generation, ...fields];
  if (field) { clause += ' AND kind=?'; params.push(field); }
  if (since !== undefined) {
    if (!Number.isSafeInteger(since) || since < 0 || since > manifest.revision) throw new RecordError(400, 'INVALID_REVISION', '版本号不正确');
    clause += ' AND revision>?'; params.push(since);
  } else clause += " AND value!='null'";
  if (query) { clause += " AND value LIKE ? ESCAPE '\\'"; params.push('%' + query.replace(/[\\%_]/g, '\\$&') + '%'); }
  if (category) {
    if (!['craft', 'arch', 'food', 'folk'].includes(category)) throw new RecordError(400, 'INVALID_CATEGORY', '分类不正确');
    clause += " AND (json_extract(value,'$.category')=? OR json_extract(value,'$.category') IS NULL)"; params.push(category);
  }
  if (media) {
    if (field !== 'dialectCustom' || !['audio', 'video'].includes(media)) throw new RecordError(400, 'INVALID_MEDIA_FILTER', '媒体分类不正确');
    clause += ' AND media_type=?'; params.push(media);
  }
  const total = !query && !category && since === undefined && manifest.counts ? field ? manifest.counts[field + (media ? '/media/' + media : '')] || 0 : fields.reduce((sum, kind) => sum + (manifest.counts[kind] || 0), 0)
    : (await db.prepare('SELECT COUNT(*) AS count FROM admin_content_items WHERE ' + clause).bind(...params).first()).count;
  const { results: rows } = await pageStatement(db, clause, params, after, limit, summary).all();
  const more = rows.length && await db.prepare('SELECT 1 AS found FROM admin_content_items WHERE ' + clause + ' AND key>? LIMIT 1').bind(...params, rows.at(-1).key).first();
  const cursorValue = { generation: manifest.generation, revision: manifest.revision, key: rows.at(-1)?.key || '', field: field || '', query, category, media, since: since ?? null };
  const nextCursor = more ? encodeRecordCursor(cursorValue) : '';
  return { ok: true, model: 'records-v1', revision: manifest.revision, total, rows: pageRows(rows, summary), cursor: nextCursor };
}

export async function recordCounts(db, manifest) {
  if (manifest.counts) return publicRecordCounts(manifest.counts);
  const { results } = await db.prepare("SELECT kind,COUNT(*) AS count FROM admin_content_items WHERE generation=? AND value!='null' GROUP BY kind").bind(manifest.generation).all();
  return Object.fromEntries(results.map(row => [row.kind, row.count]));
}
export function publicRecordCounts(counts) {
  return Object.fromEntries(Object.entries(counts).filter(([key]) => fields.includes(key) || key.startsWith('dialectCustom/media/')));
}

export async function searchKnowledgeRecords(db, manifest, query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new RecordError(400, 'INVALID_QUERY', '请输入500字以内的问题');
  const keywordMatch = "length(k.value)>1 AND instr(lower(?),lower(k.value))>0";
  const titleMatch = "length(json_extract(t.value,'$.title'))>1 AND instr(lower(?),lower(json_extract(t.value,'$.title')))>0";
  const score = 'CASE WHEN ' + titleMatch + ' THEN 1000 ELSE 0 END + COALESCE((SELECT SUM(length(k.value)*10) FROM json_each(t.value,\'$.keywords\') k WHERE ' + keywordMatch + '),0)';
  const match = "t.value LIKE ? ESCAPE '\\' OR (" + titleMatch + ') OR EXISTS(SELECT 1 FROM json_each(t.value,\'$.keywords\') k WHERE ' + keywordMatch + ')';
  const { results } = await db.prepare('SELECT key,digest,value FROM (SELECT *,SUM(length(CAST(value AS BLOB))) OVER (ORDER BY score DESC,key) AS runningBytes,ROW_NUMBER() OVER (ORDER BY score DESC,key) AS position FROM (SELECT t.key,t.digest,t.value,' + score + " AS score FROM admin_content_items t WHERE t.generation=? AND t.kind IN ('kbCustom','kbEdited') AND t.value!='null' AND (" + match + ') ORDER BY score DESC,t.key LIMIT 20)) WHERE runningBytes<=1800000 OR position=1')
    .bind(query, query, manifest.generation, '%' + query.replace(/[\\%_]/g, '\\$&') + '%', query, query).all();
  return { ok: true, model: 'records-v1', revision: manifest.revision, rows: results.map(row => ({ key: row.key, value: JSON.parse(row.value), hash: row.digest, summary: false })), cursor: '' };
}
