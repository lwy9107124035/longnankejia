import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import '../js/content-schema.js';
import { checkHealth } from '../scripts/maintenance-health.mjs';

const schema = globalThis.HeritageContent;
const baseline = { revision: 10, ids: ['existing-1'] };

function content({ revision = 11, records = [{ id: 'existing-1', name: '已有条目' }, { id: 'new-1', name: '新增条目' }] } = {}) {
  const bundle = Object.fromEntries(Object.entries(schema.defaults).map(([key, value]) => [key, Array.isArray(value) ? [] : {}]));
  bundle.kepuCustom = records;
  return { ok: true, revision, ...bundle };
}

async function serve(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    const result = await handler(req);
    res.writeHead(result.status ?? 200, result.headers ?? {});
    res.end(result.body ?? '');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { origin: `http://127.0.0.1:${address.port}`, requests };
}

function jsonResponse(value, extraHeaders = {}) {
  return {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
    body: JSON.stringify(value)
  };
}

test('healthy public JSON validates through a real local HTTP response and permits additions', async t => {
  const payload = content();
  const site = await serve(t, req => {
    assert.equal(req.method, 'GET');
    assert.match(req.url, /^\/api\/admin\/sync\?_health=/);
    assert.equal(req.headers['cache-control'], 'no-cache');
    return jsonResponse(payload);
  });
  const report = await checkHealth({ origin: site.origin, baseline });
  assert.deepEqual(report.problems, []);
  assert.equal(report.httpStatus, 200);
  assert.equal(report.revision, 11);
  assert.equal(report.count, 2);
  assert.equal(report.uniqueIdCount, 2);
  assert.equal(report.addedCount, 1);
  assert.deepEqual(report.missingIds, []);
});

test('HTML and service errors are reported as failures', async t => {
  const htmlSite = await serve(t, () => ({ headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }, body: '<html>oops</html>' }));
  const html = await checkHealth({ origin: htmlSite.origin, baseline });
  assert.ok(html.problems.some(problem => problem.includes('not JSON')));
  assert.ok(html.problems.some(problem => problem.includes('could not be parsed')));

  const errorSite = await serve(t, () => ({ status: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, body: 'unavailable' }));
  const error = await checkHealth({ origin: errorSite.origin, baseline });
  assert.ok(error.problems.some(problem => problem.includes('HTTP 503')));
});

test('missing baseline IDs and revision rollback fail independently', async t => {
  const site = await serve(t, () => jsonResponse(content({ revision: 9, records: [{ id: 'other', name: '别的条目' }] })));
  const report = await checkHealth({ origin: site.origin, baseline });
  assert.ok(report.problems.includes('revision is below baseline'));
  assert.ok(report.problems.includes('baseline IDs are missing'));
  assert.deepEqual(report.missingIds, ['existing-1']);
});

test('sampled media uses GET and verifies MIME and content-derived media identity', async t => {
  const bytes = Buffer.from('synthetic image bytes');
  const mediaHash = (await schema.mediaIdentity(`data:image/png;base64,${bytes.toString('base64')}`)).split('/').at(-1);
  const payload = content({ records: [{ id: 'existing-1', name: '带图条目', imageUrl: `/api/media/${mediaHash}` }] });
  const site = await serve(t, req => req.url.startsWith('/api/media/')
    ? { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' }, body: Buffer.from('corrupt bytes') }
    : jsonResponse(payload));
  const report = await checkHealth({ origin: site.origin, baseline });
  assert.ok(report.problems.some(problem => problem.includes('content hash mismatch')));
  assert.deepEqual(site.requests.map(request => request.method), ['GET', 'GET']);
  assert.equal(report.mediaChecked, 0);
});

test('snapshot archive saves every referenced local media object before marking the backup complete', async t => {
  const bytes = Buffer.from('synthetic archived image');
  const mediaHash = (await schema.mediaIdentity(`data:image/jpeg;base64,${bytes.toString('base64')}`)).split('/').at(-1);
  const payload = content({ records: [
    { id: 'existing-1', name: '带图一', imageUrl: `/api/media/${mediaHash}` },
    { id: 'second', name: '带图二', image: `/api/media/${mediaHash}` }
  ] });
  const site = await serve(t, req => req.url.startsWith('/api/media/')
    ? { headers: { 'Content-Type': 'image/jpeg' }, body: bytes }
    : jsonResponse(payload));
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-health-media-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const report = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(report.problems, []);
  assert.equal(report.snapshotComplete, true);
  assert.equal(report.mediaArchived, 1);
  assert.equal(report.mediaReused, 0);
  assert.equal(site.requests.filter(request => request.url.startsWith('/api/media/')).length, 1);
  assert.deepEqual(await fs.readFile(path.join(snapshotDir, 'media', `${mediaHash}.jpeg`)), bytes);
  const reused = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(reused.problems, []);
  assert.equal(reused.mediaArchived, 0);
  assert.equal(reused.mediaReused, 1);
  assert.equal(site.requests.filter(request => request.url.startsWith('/api/media/')).length, 2);
});

test('a bad media response prevents the snapshot JSON from being recorded as complete', async t => {
  const bytes = Buffer.from('expected image');
  const mediaHash = (await schema.mediaIdentity(`data:image/png;base64,${bytes.toString('base64')}`)).split('/').at(-1);
  const payload = content({ records: [{ id: 'existing-1', name: '坏图', imageUrl: `/api/media/${mediaHash}` }] });
  const site = await serve(t, req => req.url.startsWith('/api/media/')
    ? { headers: { 'Content-Type': 'image/png' }, body: 'incorrect bytes' }
    : jsonResponse(payload));
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-health-fail-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const report = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.equal(report.snapshotComplete, false);
  assert.equal(report.snapshotPath, null);
  assert.ok(report.problems.some(problem => problem.includes('content hash mismatch')));
  assert.deepEqual(await fs.readdir(snapshotDir), []);
});

test('successful snapshot uses revision and content hash and never overwrites an existing copy', async t => {
  const payload = content();
  const site = await serve(t, () => jsonResponse(payload));
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-health-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const first = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(first.problems, []);
  assert.equal(first.snapshotComplete, true);
  const original = await fs.readFile(first.snapshotPath);
  const preserved = Buffer.from(original.toString() + '\n');
  await fs.writeFile(first.snapshotPath, preserved);
  const second = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(second.problems, []);
  assert.equal(second.snapshotPath, first.snapshotPath);
  assert.deepEqual(await fs.readFile(first.snapshotPath), preserved);
  assert.equal((await fs.readdir(snapshotDir)).length, 1);
});

test('storage warnings keep a valid snapshot available for backup', async t => {
  const payload = { ...content(), storage: { metadataBytes: 900, metadataLimit: 1000 } };
  const site = await serve(t, () => jsonResponse(payload));
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-health-capacity-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const report = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(report.problems, []); assert.equal(report.storage.usedPercent, 90);
  assert.equal(report.warnings.length, 1); assert.equal(report.snapshotComplete, true);
});
