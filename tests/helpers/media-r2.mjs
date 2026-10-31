import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

function createRuntime(t, options) {
  const require = createRequire(import.meta.url);
  // The project uses the installed Wrangler runtime and has no npm manifest.
  const modulePath = require.resolve('miniflare', { paths: [process.cwd(), path.join(process.cwd(), '.cache/test-runtime/node_modules/wrangler'), path.join(process.env.APPDATA || '', 'npm/node_modules/wrangler')] });
  const { Miniflare, convertV4MiniflareOptions } = require(modulePath);
  const runtime = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-09-01', r2Buckets: ['ADMIN_MEDIA'], ...options }));
  t.after(() => runtime.dispose());
  return runtime;
}

export async function createMediaBucket(t, { persistPath } = {}) {
  const runtime = createRuntime(t, { modules: true, script: 'export default { fetch() { return new Response("local R2"); } };', ...(persistPath && { resourcePersistencePath: persistPath }) });
  return runtime.getR2Bucket('ADMIN_MEDIA');
}

export async function createMediaRuntime(t, { api = false, persistPath } = {}) {
  const root = process.cwd();
  const script = api ? `import { onRequestPost as upload } from '../../functions/api/admin/uploads.js';
    import { onRequestPost as sync } from '../../functions/api/admin/sync.js';
    import { onRequestGet as media } from '../../functions/api/media/[id].js';
    export default { fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      return (path === '/api/admin/uploads' ? upload : path.startsWith('/api/media/') ? media : sync)({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    } };` : `import * as uploads from '../../functions/_lib/admin-uploads.js';
    import * as media from '../../functions/_lib/admin-media.js';
    export default { async fetch(request, env) {
      const { method, user, args } = await request.json();
      if (method === 'storeImage') {
        const stored = await media.storeMedia(env.ADMIN_DB, args[0], env.ADMIN_MEDIA);
        const object = await env.ADMIN_MEDIA.get(media.mediaKey(stored.id)), bytes = await object.arrayBuffer();
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        return Response.json({ ...stored, sha256, size: bytes.byteLength, type: object.httpMetadata.contentType, version: object.version });
      }
      try { return Response.json(await uploads[method](env.ADMIN_DB, env.ADMIN_MEDIA, user, ...args)); }
      catch (error) { return Response.json({ message: error.message, code: error.code }, { status: error.status || 503 }); }
    } };`;
  const files = ['functions/_lib/admin-uploads.js', 'functions/_lib/admin-media.js', 'js/content-schema.js'];
  if (api) files.push('functions/api/admin/uploads.js', 'functions/api/admin/sync.js', 'functions/api/media/[id].js', 'functions/_lib/admin-records.js', 'functions/_lib/admin-content.js', 'functions/_lib/admin-history-archive.js', 'functions/_lib/read-limited.js');
  const modules = [{ type: 'ESModule', path: path.join(root, 'tests/helpers/media-r2-worker.js'), contents: script },
    ...files.map(file => ({ type: 'ESModule', path: path.join(root, file), contents: fs.readFileSync(path.join(root, file), 'utf8') }))];
  const runtime = createRuntime(t, { modules, modulesRoot: root, d1Databases: ['ADMIN_DB'], bindings: { ADMIN_BOOTSTRAP_PASSWORD: 'admin123' }, ...(persistPath && { resourcePersistencePath: persistPath }) });
  const db = await runtime.getD1Database('ADMIN_DB'), bucket = await runtime.getR2Bucket('ADMIN_MEDIA');
  const migration = (api ? ['0001_admin.sql', '0002_content_records.sql', '0003_media_uploads.sql'] : ['0003_media_uploads.sql'])
    .map(file => fs.readFileSync(path.join(root, 'migrations/admin', file), 'utf8')).join('\n');
  await db.batch(migration.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  return { db, bucket, fetch: (...args) => runtime.dispatchFetch(...args), async call(method, user, ...args) {
    const response = await runtime.dispatchFetch('http://localhost/', { method: 'POST', body: JSON.stringify({ method, user, args }) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message), { status: response.status, code: result.code });
    return result;
  } };
}
