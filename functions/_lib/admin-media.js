import '../../js/content-schema.js';

const PART = 400000;
const IMAGE = /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-z0-9+/=]+)$/i;
const ID = /^[a-f0-9]{64}$/;
const rawReference = value => typeof value === 'string' && value.match(/^\/api\/media\/([a-f0-9]{64})$/)?.[1];

export async function storeMedia(db, data) {
  const match = typeof data === 'string' && IMAGE.exec(data);
  if (!match || data.length > 5000000) throw new TypeError('图片格式不正确或超过允许大小');
  try { atob(match[2]); } catch { throw new TypeError('图片编码不完整，请重新选择图片'); }
  const url = await globalThis.HeritageContent.mediaIdentity(data), id = rawReference(url), key = 'media:' + id + ':';
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

export async function readMedia(db, id) {
  if (!ID.test(id)) return null;
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
  return { ...info, parts };
}

export async function archiveHistoryMedia(db, content, from) {
  const history = (content._history || []).slice();
  const memo = new Map();
  async function pack(value) {
    if (typeof value === 'string' && IMAGE.test(value)) {
      if (!memo.has(value)) memo.set(value, (await storeMedia(db, value)).id);
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

export async function expandHistoryMedia(db, value) {
  if (value && typeof value === 'object' && ID.test(value.$image || '')) {
    const media = await readMedia(db, value.$image);
    if (!media) throw new Error('历史图片暂时无法读取，请稍后重试');
    return 'data:' + media.type + ';base64,' + media.parts.join('');
  }
  if (Array.isArray(value)) return Promise.all(value.map(child => expandHistoryMedia(db, child)));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = await expandHistoryMedia(db, child);
    return result;
  }
  return value;
}
export async function expandRecordMedia(db, value) {
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  for (const field of ['image', 'imageUrl']) {
    const id = rawReference(result[field]);
    if (id) result[field] = await expandHistoryMedia(db, { $image: id });
  }
  if (result.item && rawReference(result.item.imageUrl)) result.item = { ...result.item, imageUrl: await expandHistoryMedia(db, { $image: rawReference(result.item.imageUrl) }) };
  return result;
}
export async function storeRecordMedia(db, value) {
  if (!value || typeof value !== 'object') return value;
  const result = { ...value };
  for (const field of ['image', 'imageUrl']) if (IMAGE.test(result[field] || '')) result[field] = (await storeMedia(db, result[field])).url;
  if (result.item && IMAGE.test(result.item.imageUrl || '')) result.item = { ...result.item, imageUrl: (await storeMedia(db, result.item.imageUrl)).url };
  return result;
}

export function mediaResponse(media, request) {
  const headers = { 'Content-Type': media.type, 'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Length': String(media.length), 'Access-Control-Allow-Origin': '*' };
  if (request.method === 'HEAD') return new Response(null, { headers });
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index === media.parts.length) { controller.close(); return; }
      const data = atob(media.parts[index++]);
      controller.enqueue(Uint8Array.from(data, char => char.charCodeAt(0)));
    }
  }), { headers });
}
