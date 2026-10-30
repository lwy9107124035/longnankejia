import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { createMediaBucket } from './helpers/media-r2.mjs';
import { storeMedia, readMedia, migrateD1Media, expandRecordMedia, archiveHistoryMedia, expandHistoryMedia, mediaResponse } from '../functions/_lib/admin-media.js';
import { onRequestGet, onRequestHead } from '../functions/api/media/[id].js';

test('media byte ranges seek across old D1 chunks and real R2 without loading the whole object', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  const bucket = await createMediaBucket(t);
  const bytes = Buffer.alloc(850000); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const data = 'data:image/png;base64,' + bytes.toString('base64');
  const stored = await storeMedia(backend.db, data);
  for (const target of [undefined, bucket]) {
    if (target) await storeMedia(backend.db, data, target);
    const env = { ADMIN_DB: backend.db, ADMIN_MEDIA: target };
    for (const [range, start, end] of [['bytes=299990-300010', 299990, 300011], ['bytes=-17', bytes.length - 17, bytes.length], ['bytes=849990-', 849990, bytes.length]]) {
      const response = await onRequestGet({ request: new Request('http://localhost' + stored.url, { headers: { Range: range } }), env });
      assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Length'), String(end - start));
      assert.equal(response.headers.get('Content-Range'), 'bytes ' + start + '-' + (end - 1) + '/' + bytes.length);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end));
    }
    const invalid = await onRequestGet({ request: new Request('http://localhost' + stored.url, { headers: { Range: 'bytes=900000-' } }), env });
    assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('Content-Range'), 'bytes */850000');
  }
});

test('real R2 binary images retain legacy identity, expand history and fall back to D1', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  const bucket = await createMediaBucket(t);
  const bytes = Buffer.alloc(750000); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const data = 'data:image/png;base64,' + bytes.toString('base64');
  const legacy = await storeMedia(backend.db, data), uploaded = await storeMedia(backend.db, data, bucket);
  assert.deepEqual(uploaded, legacy);
  const first = await bucket.head('media/' + uploaded.id);
  await storeMedia(backend.db, data, bucket);
  assert.equal((await bucket.head('media/' + uploaded.id)).etag, first.etag);
  const request = new Request('http://localhost' + uploaded.url);
  const env = { ADMIN_DB: backend.db, ADMIN_MEDIA: bucket };
  assert.deepEqual(Buffer.from(await (await onRequestGet({ request, env })).arrayBuffer()), bytes);
  const head = await onRequestHead({ request: new Request(request, { method: 'HEAD' }), env });
  assert.equal(head.headers.get('Content-Length'), String(bytes.length)); assert.equal(await head.text(), '');
  assert.equal((await expandRecordMedia(backend.db, { imageUrl: uploaded.url }, bucket)).imageUrl, data);
  const history = await archiveHistoryMedia(backend.db, { _history: [{ before: { image: data } }] }, 0, bucket);
  assert.deepEqual(await expandHistoryMedia(backend.db, history._history[0].before, bucket), { image: data });
  await bucket.delete('media/' + uploaded.id);
  assert.deepEqual(Buffer.from(await mediaResponse(await readMedia(backend.db, uploaded.id, bucket), request).arrayBuffer()), bytes);
  const fresh = await storeMedia(backend.db, 'data:image/jpeg;base64,AQID', bucket);
  assert.equal(backend.sqlite.prepare('SELECT key FROM admin_state WHERE key = ?').get('media:' + fresh.id + ':manifest'), undefined);
  for (const spelling of ['AQI', 'AQJ=', 'AQ', 'AR==']) {
    const original = 'data:image/png;base64,' + spelling;
    const stored = await storeMedia(backend.db, original, bucket);
    assert.equal(await expandHistoryMedia(backend.db, { $image: stored.id }, bucket), original);
  }
});

test('R2 write and read failures never silently fall back or acknowledge success', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  const data = 'data:image/png;base64,AQID', legacy = await storeMedia(backend.db, data);
  const bucket = { head() { throw new Error('R2 offline'); }, get() { throw new Error('R2 offline'); } };
  await assert.rejects(storeMedia(backend.db, data, bucket), /R2 offline/);
  const response = await onRequestGet({ request: new Request('http://localhost' + legacy.url), env: { ADMIN_DB: backend.db, ADMIN_MEDIA: bucket } });
  assert.equal(response.status, 503);
  await assert.rejects(storeMedia(backend.db, 'data:image/svg+xml;base64,AQID', bucket), TypeError);
});

test('old D1 images migrate in bounded resumable batches with unchanged URLs, spelling and original chunks', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  const bucket = await createMediaBucket(t), sources = ['AQ', 'AQI', 'AQJ=', 'AQID', 'AR=='];
  const images = [];
  for (const spelling of sources) images.push(await storeMedia(backend.db, 'data:image/png;base64,' + spelling));
  const before = backend.sqlite.prepare("SELECT key,value FROM admin_state WHERE key LIKE 'media:%' ORDER BY key").all();
  let cursor = '', copied = 0, verified = 0, batches = 0;
  do {
    const result = await migrateD1Media(backend.db, bucket, cursor);
    assert.ok(result.verified <= 3); copied += result.copied; verified += result.verified; cursor = result.cursor; batches++;
  } while (cursor);
  assert.equal(copied, 5); assert.equal(verified, 5); assert.equal(batches, 2);
  for (let i = 0; i < images.length; i++) assert.equal(await expandHistoryMedia(backend.db, { $image: images[i].id }, bucket), 'data:image/png;base64,' + sources[i]);
  const repeated = await migrateD1Media(backend.db, bucket); assert.equal(repeated.copied, 0);
  assert.deepEqual(backend.sqlite.prepare("SELECT key,value FROM admin_state WHERE key LIKE 'media:%' ORDER BY key").all(), before);
  await assert.rejects(migrateD1Media(backend.db, null), error => error.code === 'MEDIA_NOT_CONFIGURED');
  await assert.rejects(migrateD1Media(backend.db, bucket, 'invalid'), error => error.status === 400);
  await assert.rejects(migrateD1Media(backend.db, { head() { throw Error('synthetic R2 failure'); } }), /synthetic R2 failure/);
  assert.deepEqual(backend.sqlite.prepare("SELECT key,value FROM admin_state WHERE key LIKE 'media:%' ORDER BY key").all(), before);
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'synthetic-media-migration' })).data.bearer;
  const unavailable = await backend.call({ action: 'migrate_media' }, root);
  assert.equal(unavailable.status, 503); assert.equal(unavailable.data.code, 'MEDIA_NOT_CONFIGURED');
  backend.env.ADMIN_MEDIA = bucket;
  const invalid = await backend.call({ action: 'migrate_media', cursor: 'invalid' }, root);
  assert.equal(invalid.status, 400); assert.equal(invalid.data.code, 'INVALID_CURSOR');
});
