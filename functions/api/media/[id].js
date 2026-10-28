import { readMedia, mediaResponse } from '../../_lib/admin-media.js';

async function handle({ request, env }) {
  if (!env.ADMIN_DB) return new Response('Image storage is unavailable', { status: 503 });
  const id = new URL(request.url).pathname.split('/').at(-1);
  try {
    const media = await readMedia(env.ADMIN_DB, id);
    return media ? mediaResponse(media, request) : new Response('Image not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  } catch { return new Response('Image storage is temporarily unavailable', { status: 503 }); }
}
export const onRequestGet = handle;
export const onRequestHead = handle;
