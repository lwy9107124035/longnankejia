import { readRecordState, writeRecordState, RecordError, MAX_RECORD_BYTES } from './admin-records.js';
import { readLimited } from './read-limited.js';

const encoder = new TextEncoder();
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
const unavailable = () => new RecordError(503, 'HISTORY_ARCHIVE_UNAVAILABLE', '历史归档暂时无法读取，请保留当前内容并稍后重试。');

export async function expandArchivedHistory(value, bucket) {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, '$history')) return value;
  if (!bucket) throw new RecordError(503, 'MEDIA_NOT_CONFIGURED', '对象存储尚未配置，历史归档暂不可用。');
  if (typeof value.$history !== 'string' || !value.$history.startsWith('history/') || value.$history.length > 1024 ||
      typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw unavailable();
  const object = await bucket.get(value.$history);
  if (!object || object.size > MAX_RECORD_BYTES) throw unavailable();
  let bytes;
  try { bytes = await readLimited(new Response(object.body), MAX_RECORD_BYTES); }
  catch (error) { if (error instanceof RangeError) throw unavailable(); throw error; }
  if (await digest(bytes) !== value.sha256) throw unavailable();
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw unavailable(); }
}

export async function archiveHistoryBefore(db, manifest, bucket, user, { cutoff = Date.now() - 30 * 86400000, limit = 16 } = {}) {
  if (user.role !== 'super_admin') throw new RecordError(403, 'FORBIDDEN', '此操作需要超级管理员权限。');
  if (!bucket) throw new RecordError(503, 'MEDIA_NOT_CONFIGURED', '对象存储尚未配置，历史归档暂不可用。');
  if (!Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > Date.now() || !Number.isInteger(limit) || limit < 1 || limit > 16)
    throw new RecordError(400, 'INVALID_ARCHIVE_BATCH', '历史归档每批最多16条，且只能归档指定时间以前的记录。');
  const { results } = await db.prepare(`SELECT key FROM admin_content_items
    WHERE generation=? AND kind='_history' AND json_extract(value,'$.time') < ?
    AND json_type(value,'$.before') IS NOT NULL AND json_type(value,'$.before') != 'null'
    AND json_type(value,'$.before.$history') IS NULL ORDER BY json_extract(value,'$.time'),key LIMIT ?`)
    .bind(manifest.generation, cutoff, limit).all();
  if (!results.length) return { ok: true, archived: 0, ids: [], revision: manifest.revision, cutoff };
  const previous = await readRecordState(db, manifest, results.map(row => row.key));
  const next = structuredClone(previous.value), ids = [];
  for (const op of next._history) {
    if (op.before === null || Object.hasOwn(op.before, '$history')) continue;
    const bytes = encoder.encode(JSON.stringify(op.before)), sha256 = await digest(bytes);
    const key = 'history/' + encodeURIComponent(manifest.generation) + '/' + encodeURIComponent(op.id) + '/' + sha256 + '.json';
    await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256, httpMetadata: { contentType: 'application/json' },
      customMetadata: { historyId: op.id, generation: manifest.generation } });
    const reference = { $history: key, sha256 };
    await expandArchivedHistory(reference, bucket);
    op.before = reference; ids.push(op.id);
  }
  const revision = await writeRecordState(db, manifest, previous.value, next);
  return { ok: true, archived: ids.length, ids, revision, cutoff };
}
