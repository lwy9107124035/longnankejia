import '../../js/content-schema.js';

const PART = 400000;
const IMAGE = /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-z0-9+/=]+)$/i;
const ID = /^[a-f0-9]{64}$/;
export const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'video/mp4', 'video/webm', 'video/ogg']);
const rawReference = value => typeof value === 'string' && value.match(/^\/api\/media\/([a-f0-9]{64})$/)?.[1];
export const mediaKey = id => 'media/' + id;
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

export function mediaDataUrl(type, bytes) {
  const pieces = [];
  for (let i = 0; i < bytes.length; i += 32768) pieces.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return 'data:' + type + ';base64,' + btoa(pieces.join(''));
}

export function verifiedMedia(object, type, size, sha256) {
  return object && object.size === size && object.httpMetadata.contentType === type &&
    object.checksums.sha256 && hex(object.checksums.sha256) === sha256;
}

export async function storeBinaryMedia(bucket, id, bytes, type, sha256, encoding = {}) {
  const key = mediaKey(id);
  let object = await bucket.head(key);
  if (!object) object = await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256,
    httpMetadata: { contentType: type }, customMetadata: { mediaId: id, ...encoding } });
  if (!object) object = await bucket.head(key);
  return object;
}

export async function storeMedia(db, data, bucket) {
  const match = typeof data === 'string' && IMAGE.exec(data);
  if (!match || data.length > 5000000) throw new TypeError('图片格式不正确或超过允许大小');
  let binary;
  try { binary = atob(match[2]); } catch { throw new TypeError('图片编码不完整，请重新选择图片'); }
  const url = await globalThis.HeritageContent.mediaIdentity(data), id = rawReference(url), key = 'media:' + id + ':';
  if (bucket) {
    const bytes = new Uint8Array(binary.length), type = match[1].toLowerCase();
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    // Legacy identities include the original base64 spelling, including omitted padding and final pad bits.
    const object = await storeBinaryMedia(bucket, id, bytes, type, sha256, { base64Length: String(match[2].length), base64Tail: match[2].slice(-4) });
    if (!verifiedMedia(object, type, bytes.length, sha256)) throw new Error('Image storage verification failed');
    return { id, url };
  }
  const found = await db.prepare('SELECT value FROM admin_state WHERE key = ?').bind(key + 'manifest').first();
  if (!found) {
    const parts = [];
    for (let offset = 0; offset < match[2].length; offset += PART) parts.push(match[2].slice(offset, offset + PART));
    const manifest = { type: match[1].toLowerCase(), count: parts.length, length: atob(match[2]).length };
    await db.batch(parts.map((part, i) => db.prepare('INSERT OR IGNORE INTO admin_state (key,value,revision) VALUES (?,?,0)').bind(key + i, part))
      .concat(db.prepare('INSERT OR IGNORE INTO admin_state (key,value,revision) VALUES (?,?,0)').bind(key + 'manifest', JSON.stringify(manifest))));
  }
  return { id, url };
}

function byteRange(header, length) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= length) return null;
  return { offset: start, length: end - start + 1 };
}
export async function readMedia(db, id, bucket, rangeHeader) {
  if (!ID.test(id)) return null;
  if (bucket) {
    let range;
    if (rangeHeader) {
      const head = await bucket.head(mediaKey(id));
      if (head) { range = byteRange(rangeHeader, head.size); if (!range) return { rangeInvalid: true, totalLength: head.size }; }
    }
    const object = await bucket.get(mediaKey(id), range ? { range } : undefined);
    if (object) {
      const type = object.httpMetadata.contentType;
      if (!MEDIA_TYPES.has(type) || object.customMetadata.mediaId !== id) throw new Error('Invalid media metadata');
      return { type, length: range ? range.length : object.size, totalLength: object.size, range, body: object.body, base64Length: Number(object.customMetadata.base64Length), base64Tail: object.customMetadata.base64Tail };
    }
  }
  if (!db) return null;
  const prefix = 'media:' + id + ':';
  const { results } = await db.prepare('SELECT key,value FROM admin_state WHERE key >= ? AND key < ?').bind(prefix, prefix + '~').all();
  const row = results.find(row => row.key === prefix + 'manifest');
  if (!row) return null;
  const info = JSON.parse(row.value), values = new Map(results.map(row => [row.key, row.value]));
  const parts = [];
  for (let i = 0; i < info.count; i++) {
    const part = values.get(prefix + i);
    if (typeof part !== 'string') throw new Error('Incomplete image snapshot');
    parts.push(part);
  }
  const range = rangeHeader ? byteRange(rangeHeader, info.length) : undefined;
  if (rangeHeader && !range) return { rangeInvalid: true, totalLength: info.length };
  return { ...info, parts, range, totalLength: info.length, length: range ? range.length : info.length,
    base64Length: parts.reduce((sum, part) => sum + part.length, 0), base64Tail: parts.at(-1)?.slice(-4) };
}

export async function migrateD1Media(db, bucket, cursor = '') {
  if (!bucket) throw Object.assign(new Error('媒体存储尚未接入'), { status: 503, code: 'MEDIA_NOT_CONFIGURED' });
  if (cursor && !ID.test(cursor)) throw Object.assign(new Error('图片迁移分页标记不正确'), { status: 400, code: 'INVALID_CURSOR' });
  const { results } = await db.prepare("SELECT key FROM admin_state WHERE key GLOB 'media:*:manifest' AND key>? ORDER BY key LIMIT 4").bind(cursor ? 'media:' + cursor + ':manifest' : 'media:').all();
  let copied = 0, last = cursor;
  for (const row of results.slice(0, 3)) {
    const id = row.key.slice(6, -9), source = await readMedia(db, id);
    if (!source?.parts) throw Object.assign(new Error('原图片不完整，迁移已停止'), { status: 503, code: 'MEDIA_UNAVAILABLE' });
    const existed = await bucket.head(mediaKey(id));
    const saved = await storeMedia(db, 'data:' + source.type + ';base64,' + source.parts.join(''), bucket);
    if (saved.id !== id) throw Object.assign(new Error('图片摘要不一致，原图已保留'), { status: 503, code: 'MEDIA_UNAVAILABLE' });
    if (!existed) copied++;
    last = id;
  }
  return { ok: true, verified: Math.min(3, results.length), copied, cursor: results.length > 3 ? last : '', more: results.length > 3 };
}

export async function archiveHistoryMedia(db, content, from, bucket) {
  const history = (content._history || []).slice();
  const memo = new Map();
  async function pack(value) {
    if (typeof value === 'string' && IMAGE.test(value)) {
      if (!memo.has(value)) memo.set(value, (await storeMedia(db, value, bucket)).id);
      return { $image: memo.get(value) };
    }
    if (Array.isArray(value)) return Promise.all(value.map(pack));
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, child] of Object.entries(value)) result[key] = await pack(child);
      return result;
    }
    return value;
  }
  for (let i = from; i < history.length; i++) history[i] = { ...history[i], before: await pack(history[i].before) };
  return { ...content, _history: history };
}

export async function expandHistoryMedia(db, value, bucket) {
  if (value && typeof value === 'object' && ID.test(value.$image || '')) {
    const media = await readMedia(db, value.$image, bucket);
    if (!media) throw new Error('历史图片暂时无法读取，请稍后重试');
    if (!media.body) return 'data:' + media.type + ';base64,' + media.parts.join('');
    const data = mediaDataUrl(media.type, new Uint8Array(await new Response(media.body).arrayBuffer()));
    if (!media.base64Tail) return data;
    const prefixLength = ('data:' + media.type + ';base64,').length;
    return data.slice(0, prefixLength + media.base64Length - media.base64Tail.length) + media.base64Tail;
  }
  if (Array.isArray(value)) return Promise.all(value.map(child => expandHistoryMedia(db, child, bucket)));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = await expandHistoryMedia(db, child, bucket);
    return result;
  }
  return value;
}
export async function expandRecordMedia(db, value, bucket) {
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  for (const field of ['image', 'imageUrl']) {
    const id = rawReference(result[field]);
    if (id) result[field] = await expandHistoryMedia(db, { $image: id }, bucket);
  }
  if (result.item && rawReference(result.item.imageUrl)) result.item = { ...result.item, imageUrl: await expandHistoryMedia(db, { $image: rawReference(result.item.imageUrl) }, bucket) };
  return result;
}
export async function storeRecordMedia(db, value, cache = new Map(), bucket) {
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  async function store(data) {
    if (!cache.has(data)) cache.set(data, (await storeMedia(db, data, bucket)).url);
    return cache.get(data);
  }
  for (const field of ['image', 'imageUrl']) if (IMAGE.test(result[field] || '')) result[field] = await store(result[field]);
  if (result.item && IMAGE.test(result.item.imageUrl || '')) result.item = { ...result.item, imageUrl: await store(result.item.imageUrl) };
  return result;
}

export function mediaResponse(media, request) {
  if (media.rangeInvalid) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + media.totalLength, 'Cache-Control': 'no-store' } });
  const headers = { 'Content-Type': media.type, 'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Length': String(media.length), 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes',
    'Access-Control-Expose-Headers': 'Content-Range,X-Media-Base64-Length,X-Media-Base64-Tail' };
  if (media.range) headers['Content-Range'] = 'bytes ' + media.range.offset + '-' + (media.range.offset + media.range.length - 1) + '/' + media.totalLength;
  if (Number.isSafeInteger(media.base64Length) && media.base64Length > 0 && /^[a-zA-Z0-9+/=]{1,4}$/.test(media.base64Tail || '')) {
    headers['X-Media-Base64-Length'] = String(media.base64Length); headers['X-Media-Base64-Tail'] = media.base64Tail;
  }
  if (request.method === 'HEAD') return new Response(null, { headers });
  let index = 0, offset = 0;
  return new Response(media.body || new ReadableStream({
    pull(controller) {
      let data;
      while (index < media.parts.length) {
        data = atob(media.parts[index++]); const previous = offset; offset += data.length;
        if (media.range) data = data.slice(Math.max(0, media.range.offset - previous), Math.max(0, Math.min(data.length, media.range.offset + media.range.length - previous)));
        if (data.length) break;
      }
      if (!data?.length) { controller.close(); return; }
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      controller.enqueue(bytes);
    }
  }), { status: media.range ? 206 : 200, headers });
}
