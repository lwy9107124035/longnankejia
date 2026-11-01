import { readMedia, mediaResponse } from '../../_lib/admin-media.js';

const pendingReads = new WeakMap(), pendingCacheWrites = new Set();

async function readPublicMedia(context, id) {
  const { request, env } = context, range = request.method === 'GET' ? request.headers.get('Range') : undefined;
  if (env.ADMIN_MEDIA) return readMedia(env.ADMIN_MEDIA_DB || env.ADMIN_DB, id, env.ADMIN_MEDIA, range, env.ADMIN_DB);
  const primary = env.ADMIN_DB || env.ADMIN_MEDIA_DB, images = env.ADMIN_MEDIA_DB || primary;
  let scopes = pendingReads.get(primary);
  if (!scopes) { scopes = new WeakMap(); pendingReads.set(primary, scopes); }
  let reads = scopes.get(images);
  if (!reads) { reads = new Map(); scopes.set(images, reads); }
  const key = id + ':' + (range || '');
  if (reads.has(key)) return reads.get(key);
  // D1 parts are plain strings. R2 streams above must remain owned by their request.
  const work = readMedia(images, id, undefined, range, primary);
  reads.set(key, work); context.waitUntil?.(Promise.allSettled([work]));
  try { return await work; } finally { reads.delete(key); }
}

async function handle(context) {
  const { request, env } = context, started = performance.now();
  const finish = (response, source) => {
    response.headers.set('X-Media-Cache', source);
    response.headers.set('Server-Timing', 'media;dur=' + (performance.now() - started).toFixed(1));
    return response;
  };
  if (!env.ADMIN_DB && !env.ADMIN_MEDIA_DB && !env.ADMIN_MEDIA) return finish(new Response('Media storage is unavailable', { status: 503, headers:{'Cache-Control':'no-store'} }), 'BYPASS');
  const url = new URL(request.url), path = globalThis.HeritageContent.mediaPath(url.pathname);
  if (!path) return finish(new Response('Image not found', {status:404,headers:{'Cache-Control':'no-store'}}), 'BYPASS');
  const id = path.split('/').at(-1), cache = request.method === 'GET' && !request.headers.has('Range') ? globalThis.caches?.default : null;
  const key = new Request(url.origin + path);
  try {
    if (cache) {
      try {
        const found = await cache.match(key);
        if (found) return found;
      } catch (error) { console.warn('Public media cache read failed:', error.name); }
    }
    const media = await readPublicMedia(context, id);
    if (!media) return finish(new Response('Image not found', {status:404,headers:{'Cache-Control':'no-store'}}), 'MISS');
    const response = mediaResponse(media);
    if (cache && request.method === 'GET' && response.status === 200 && media.type.startsWith('image/') && media.length <= 5000000
        && context.waitUntil && !pendingCacheWrites.has(key.url)) {
      pendingCacheWrites.add(key.url);
      const copy = response.clone();
      copy.headers.set('X-Media-Cache', 'HIT');
      const task = Promise.resolve().then(() => cache.put(key, copy))
        .catch(error => { console.warn('Public media cache write failed:', error.name); })
        .finally(() => pendingCacheWrites.delete(key.url));
      context.waitUntil(task);
    }
    return finish(response, cache ? 'MISS' : 'BYPASS');
  } catch { return finish(new Response('Image storage is temporarily unavailable', {status:503,headers:{'Cache-Control':'no-store'}}), 'BYPASS'); }
}
export const onRequestGet = handle;
export const onRequestHead = handle;
