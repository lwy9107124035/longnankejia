import { readMedia, mediaResponse } from '../../_lib/admin-media.js';

async function handle({ request, env }) {
  if (!env.ADMIN_DB && !env.ADMIN_MEDIA_DB && !env.ADMIN_MEDIA) return new Response('Media storage is unavailable', { status: 503 });
  const id = new URL(request.url).pathname.split('/').at(-1);
  try {
    const media = await readMedia(env.ADMIN_MEDIA_DB || env.ADMIN_DB, id, env.ADMIN_MEDIA, request.method === 'GET' ? request.headers.get('Range') : undefined, env.ADMIN_DB);
    return media ? mediaResponse(media, request) : new Response('Image not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  } catch { return new Response('Image storage is temporarily unavailable', { status: 503 }); }
}
export const onRequestGet = handle;
export const onRequestHead = handle;
