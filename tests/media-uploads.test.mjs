import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { createMediaBucket, createMediaRuntime } from './helpers/media-r2.mjs';
import { UPLOAD_PART_BYTES, UPLOAD_MAX_BYTES, beginUpload, uploadStatus, uploadPart, completeUpload, abortUpload } from '../functions/_lib/admin-uploads.js';
import { onRequestGet as read } from '../functions/api/media/[id].js';
import { onRequestPost as uploadApi } from '../functions/api/admin/uploads.js';

const owner = { sessionId: 'test-owner-session', role: 'editor' }, other = { sessionId: 'test-other-session', role: 'editor' }, root = { sessionId: 'test-root-session', role: 'super_admin' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const input = (bytes, type = 'video/mp4', clientId = 'test-upload-00000001') => ({ clientId, size: bytes.length, type, sha256: digest(bytes) });
async function setup(t) {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0003_media_uploads.sql', import.meta.url), 'utf8'));
  return { ...backend, bucket: await createMediaBucket(t) };
}

test('real R2 multipart resumes out of order, retries immutable parts, completes with a durable byte-correct receipt', async t => {
  const runtime = await createMediaRuntime(t), { db, bucket } = runtime, bytes = Buffer.alloc(UPLOAD_PART_BYTES + 1031, 71);
  const started = await beginUpload(db, bucket, owner, input(bytes));
  assert.equal((await beginUpload(db, bucket, owner, input(bytes))).uploadId, started.uploadId);
  await assert.rejects(beginUpload(db, bucket, owner, { ...input(bytes), size: bytes.length + 1 }), { status: 409 });
  await assert.rejects(uploadStatus(db, other, started.uploadId), { status: 404 });
  assert.equal((await uploadStatus(db, root, started.uploadId)).partCount, 2);
  await uploadPart(db, bucket, owner, started.uploadId, 2, bytes.subarray(UPLOAD_PART_BYTES));
  await assert.rejects(completeUpload(db, bucket, owner, started.uploadId), { code: 'PARTS_MISSING' });
  await uploadPart(db, bucket, owner, started.uploadId, 1, bytes.subarray(0, UPLOAD_PART_BYTES));
  await uploadPart(db, bucket, owner, started.uploadId, 1, bytes.subarray(0, UPLOAD_PART_BYTES));
  await assert.rejects(uploadPart(db, bucket, owner, started.uploadId, 1, Buffer.alloc(UPLOAD_PART_BYTES)), { code: 'PART_CHANGED' });
  assert.equal((await uploadStatus(db, owner, started.uploadId)).parts.length, 2);
  const receipt = await runtime.call('completeUpload', owner, started.uploadId);
  assert.deepEqual(await runtime.call('completeUpload', owner, started.uploadId), receipt);
  const { ok, ...saved } = receipt;
  assert.deepEqual((await uploadStatus(db, owner, started.uploadId)).receipt, saved);
  const response = await read({ request: new Request('http://localhost' + receipt.url), env: { ADMIN_DB: db, ADMIN_MEDIA: bucket } });
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  await assert.rejects(abortUpload(db, bucket, owner, started.uploadId), { code: 'UPLOAD_COMPLETED' });
});

test('lost R2 completion confirmation and failed D1 receipt both recover without false success', async t => {
  const { db, bucket } = await setup(t), bytes = Buffer.from('audio content for confirmation recovery');
  const started = await beginUpload(db, bucket, owner, input(bytes, 'image/png'));
  await uploadPart(db, bucket, owner, started.uploadId, 1, bytes);
  let loseConfirmation = true;
  const interrupted = new Proxy(bucket, { get(target, name) {
    if (name === 'resumeMultipartUpload') return (...args) => {
      const multipart = target.resumeMultipartUpload(...args);
      return { async complete(parts) { const result = await multipart.complete(parts); if (loseConfirmation) { loseConfirmation = false; throw new Error('connection lost after R2 commit'); } return result; } };
    };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(completeUpload(db, interrupted, owner, started.uploadId), /connection lost/);
  assert.equal((await uploadStatus(db, owner, started.uploadId)).status, 'uploading');
  let failReceipt = true;
  const brokenDb = { ...db, prepare(sql) {
    if (sql.includes("status = 'completed'") && failReceipt) { failReceipt = false; throw new Error('D1 confirmation unavailable'); }
    return db.prepare(sql);
  } };
  await assert.rejects(completeUpload(brokenDb, bucket, owner, started.uploadId), /D1 confirmation unavailable/);
  assert.equal((await uploadStatus(db, owner, started.uploadId)).status, 'uploading');
  const receipt = await completeUpload(db, bucket, owner, started.uploadId);
  assert.equal(receipt.sha256, digest(bytes));
  assert.equal((await uploadStatus(db, owner, started.uploadId)).status, 'completed');
});

test('image uploads preserve old canonical URLs and all input limits are enforced before storage', async t => {
  const { db, bucket } = await setup(t), bytes = Buffer.from([1, 2, 3, 4, 5]);
  const started = await beginUpload(db, bucket, owner, input(bytes, 'image/png'));
  await uploadPart(db, bucket, owner, started.uploadId, 1, bytes);
  const receipt = await completeUpload(db, bucket, owner, started.uploadId);
  assert.equal(receipt.url, await globalThis.HeritageContent.mediaIdentity('data:image/png;base64,' + bytes.toString('base64')));
  for (const patch of [{ type: 'image/svg+xml' }, { type: 'text/html' }, { type: 'audio/unknown' }, { type: 'video/quicktime' }])
    await assert.rejects(beginUpload(db, bucket, owner, { ...input(bytes), ...patch }), { status: 415 });
  for (const patch of [{ size: UPLOAD_MAX_BYTES + 1 }, { size: 0 }, { size: 1.5 }, { type: 'image/png', size: 3749983 }])
    await assert.rejects(beginUpload(db, bucket, owner, { ...input(bytes), ...patch }), { status: 413 });
  await assert.rejects(beginUpload(db, bucket, owner, { ...input(bytes), sha256: 'invalid' }), { status: 400 });
});

test('digest mismatch cannot publish; expiration, concurrent locks, ownership and abort are enforced', async t => {
  const { db, bucket, sqlite } = await setup(t), bytes = Buffer.from('wrong digest');
  const started = await beginUpload(db, bucket, owner, { ...input(bytes, 'image/png'), sha256: '0'.repeat(64) });
  await assert.rejects(uploadPart(db, bucket, other, started.uploadId, 1, bytes), { status: 404 });
  await uploadPart(db, bucket, owner, started.uploadId, 1, bytes);
  await assert.rejects(completeUpload(db, bucket, owner, started.uploadId), { code: 'DIGEST_MISMATCH' });
  assert.equal((await bucket.list({ prefix: 'media/' })).objects.length, 0);
  const fresh = await beginUpload(db, bucket, owner, input(bytes, 'audio/mpeg', 'test-upload-00000002'));
  sqlite.prepare('UPDATE admin_media_uploads SET lock_until = ? WHERE id = ?').run(Date.now() + 60000, fresh.uploadId);
  await assert.rejects(uploadPart(db, bucket, owner, fresh.uploadId, 1, bytes), { code: 'UPLOAD_BUSY' });
  sqlite.prepare('UPDATE admin_media_uploads SET lock_until = 0, expires_at = 1 WHERE id = ?').run(fresh.uploadId);
  assert.equal((await uploadStatus(db, owner, fresh.uploadId)).status, 'expired');
  await assert.rejects(completeUpload(db, bucket, owner, fresh.uploadId), { status: 410 });
  assert.equal((await abortUpload(db, bucket, root, fresh.uploadId)).status, 'aborted');
  assert.equal((await abortUpload(db, bucket, owner, fresh.uploadId)).status, 'aborted');
});

test('HTTP uploads authenticate every operation, isolate login sessions and bound actual streamed bytes', async t => {
  const backend = await setup(t), { db, bucket, env } = backend;
  const rootUser = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'uploads-root-test' })).data;
  const invited = (await backend.call({ action: 'create_token', name: '上传老师', days: 1 }, rootUser.bearer)).data.token;
  const editor = (await backend.call({ action: 'login', credential: invited.token, clientId: 'uploads-editor-test' })).data;
  const secondLogin = (await backend.call({ action: 'login', credential: invited.token, clientId: 'uploads-editor-other' })).data;
  const origin = 'http://127.0.0.1:8931';
  async function call(body, bearer = editor.bearer, options = {}) {
    const request = new Request(origin + '/api/admin/uploads' + (options.query || ''), { method: options.method || 'POST',
      headers: { Origin: origin, ...(bearer && { Authorization: 'Bearer ' + bearer }), 'Content-Type': 'application/json', ...options.headers },
      ...(body && { body: JSON.stringify(body) }) });
    const response = await uploadApi({ request, env: options.env || { ...env, ADMIN_MEDIA: bucket } });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  const bytes = Buffer.from([1, 2, 3]), payload = { action: 'begin', ...input(bytes, 'image/png') };
  assert.equal((await call(payload, null)).status, 401);
  assert.equal((await call(payload, editor.bearer, { env })).status, 503);
  assert.equal((await call(payload, editor.bearer, { headers: { Origin: 'https://hostile.example' } })).status, 403);
  assert.equal((await call(null, null, { method: 'OPTIONS' })).status, 204);
  assert.equal((await call(null, null, { method: 'OPTIONS', headers: { Origin: 'https://hostile.example' } })).status, 403);
  const started = (await call(payload)).data;
  assert.equal((await call(null, secondLogin.bearer, { method: 'GET', query: '?uploadId=' + started.uploadId })).status, 404);
  assert.equal((await call(null, rootUser.bearer, { method: 'GET', query: '?uploadId=' + started.uploadId })).status, 200);
  const oversized = new Request(origin + '/api/admin/uploads?action=part&uploadId=' + started.uploadId + '&partNumber=1', { method: 'POST',
    headers: { Origin: origin, Authorization: 'Bearer ' + editor.bearer, 'Content-Type': 'application/octet-stream', 'Content-Length': '1' }, duplex: 'half',
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(UPLOAD_PART_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } }) });
  assert.equal((await uploadApi({ request: oversized, env: { ...env, ADMIN_MEDIA: bucket } })).status, 413);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM admin_media_upload_parts').first()).n, 0);
  const partRequest = new Request(origin + '/api/admin/uploads?action=part&uploadId=' + started.uploadId + '&partNumber=1', { method: 'POST',
    headers: { Origin: origin, Authorization: 'Bearer ' + editor.bearer, 'Content-Type': 'application/octet-stream' }, body: bytes });
  assert.equal((await uploadApi({ request: partRequest, env: { ...env, ADMIN_MEDIA: bucket } })).status, 200);
  const saved = await call({ action: 'complete', uploadId: started.uploadId });
  assert.equal(saved.status, 200); assert.deepEqual(await call({ action: 'complete', uploadId: started.uploadId }), saved);
  assert.equal((await call({ action: 'status', uploadId: started.uploadId })).data.receipt.url, saved.data.url);
  await backend.call({ action: 'change_token', id: invited.id, operation: 'pause' }, rootUser.bearer);
  assert.equal((await call({ action: 'status', uploadId: started.uploadId })).status, 401);
});

test('upload service failures remain retryable and active sessions and media sizes have finite limits', async t => {
  const { db, bucket } = await setup(t), bytes = Buffer.from('upload with lost begin or part confirmation');
  const broken = new Proxy(bucket, { get(target, name) {
    if (name === 'createMultipartUpload') return async () => { throw new Error('R2 unavailable'); };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(beginUpload(db, broken, owner, input(bytes)), /R2 unavailable/);
  const started = await beginUpload(db, bucket, owner, input(bytes));
  assert.equal(started.status, 'uploading');
  let failPart = true;
  const brokenDb = { ...db, prepare(sql) {
    if (sql.includes('SET etag =') && failPart) { failPart = false; throw new Error('part confirmation unavailable'); }
    return db.prepare(sql);
  } };
  await assert.rejects(uploadPart(brokenDb, bucket, owner, started.uploadId, 1, bytes), /part confirmation unavailable/);
  assert.equal((await uploadStatus(db, owner, started.uploadId)).parts.length, 0);
  await uploadPart(db, bucket, owner, started.uploadId, 1, bytes);
  const max = await beginUpload(db, bucket, owner, { ...input(bytes, 'video/mp4', 'test-upload-max-size'), size: UPLOAD_MAX_BYTES });
  assert.equal(max.partCount, 32);
  await beginUpload(db, bucket, owner, input(bytes, 'audio/ogg', 'test-upload-active-3'));
  await beginUpload(db, bucket, owner, input(bytes, 'audio/ogg', 'test-upload-active-4'));
  await assert.rejects(beginUpload(db, bucket, owner, input(bytes, 'audio/ogg', 'test-upload-active-5')), { status: 429 });
  await abortUpload(db, bucket, owner, max.uploadId);
  await beginUpload(db, bucket, owner, input(bytes, 'audio/ogg', 'test-upload-active-5'));
  const interruptedAbort = new Proxy(bucket, { get(target, name) {
    if (name === 'resumeMultipartUpload') return (...args) => {
      const multipart = target.resumeMultipartUpload(...args);
      return { async abort() { await multipart.abort(); throw new Error('abort confirmation lost'); } };
    };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(abortUpload(db, interruptedAbort, owner, started.uploadId), /abort confirmation lost/);
  assert.equal((await uploadStatus(db, owner, started.uploadId)).status, 'aborting');
  assert.equal((await abortUpload(db, bucket, owner, started.uploadId)).status, 'aborted');
});

test('real Worker rejects an audio checksum mismatch before a public object can be created', async t => {
  const runtime = await createMediaRuntime(t), bytes = Buffer.from('wrong audio bytes');
  const started = await runtime.call('beginUpload', owner, { ...input(bytes, 'audio/mpeg'), sha256: '0'.repeat(64) });
  await uploadPart(runtime.db, runtime.bucket, owner, started.uploadId, 1, bytes);
  await assert.rejects(runtime.call('completeUpload', owner, started.uploadId), { status: 503 });
  assert.equal((await runtime.bucket.list({ prefix: 'media/' })).objects.length, 0);
  assert.equal((await uploadStatus(runtime.db, owner, started.uploadId)).status, 'uploading');
});
