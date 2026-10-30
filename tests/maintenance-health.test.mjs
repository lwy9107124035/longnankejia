import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import '../js/content-schema.js';
import { checkHealth, readDatabaseCapacity } from '../scripts/maintenance-health.mjs';

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

test('missing baseline IDs and revision rollback remain failures without blocking the current content backup or capacity check', async t => {
  const bytes = Buffer.from('current image after a missing baseline record');
  const imageUrl = await schema.mediaIdentity(`data:image/png;base64,${bytes.toString('base64')}`);
  const payload = content({ revision: 9, records: [{ id: 'other', name: '别的条目', imageUrl }] });
  const site = await serve(t, req => req.url.startsWith('/api/media/')
    ? { headers: { 'Content-Type': 'image/png' }, body: bytes }
    : jsonResponse(payload));
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-missing-baseline-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const report = await checkHealth({ origin: site.origin, baseline, snapshotDir, databaseName: 'synthetic-db', readCapacity: async database => ({
    database, sizeBytes: 17_000_000, warningBytes: 350 * 1024 * 1024, planLimitBytes: null
  }) });
  assert.ok(report.problems.includes('revision is below baseline'));
  assert.ok(report.problems.includes('baseline IDs are missing'));
  assert.deepEqual(report.missingIds, ['existing-1']);
  assert.equal(report.snapshotComplete, true);
  assert.equal(report.databaseStorage.sizeBytes, 17_000_000);
  assert.equal(report.mediaArchived, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(report.snapshotPath, 'utf8')), payload);
  assert.deepEqual(await fs.readFile(path.join(snapshotDir, 'media', imageUrl.split('/').at(-1) + '.png')), bytes);
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

test('large snapshots warn before reaching the historical 16 MiB storage limit', async t => {
  const payload = { ...content(), storage: { metadataBytes: 3 * 1024 * 1024, metadataLimit: 16 * 1024 * 1024 } };
  const site = await serve(t, () => jsonResponse(payload));
  const report = await checkHealth({ origin: site.origin, baseline });
  assert.deepEqual(report.problems, []); assert.equal(report.warnings.length, 1);
  assert.equal(report.storage.warningBytes, 2 * 1024 * 1024); assert.ok(report.storage.usedPercent < 85);
});

test('physical D1 size uses read-only info and does not claim an account quota', async () => {
  const capacity = await readDatabaseCapacity('synthetic-db', { run: async (command, args, options) => {
    assert.ok([command, ...args].join(' ').includes('d1 info synthetic-db --json'));
    assert.equal(options.windowsHide, true);
    return { stdout: JSON.stringify({ name: 'synthetic-db', database_size: 17_000_000 }) };
  } });
  assert.equal(capacity.sizeBytes, 17_000_000); assert.equal(capacity.planLimitBytes, null);
  await assert.rejects(readDatabaseCapacity('db & echo secret'), /Invalid D1 database name/);
  await assert.rejects(readDatabaseCapacity('synthetic-db', { run: async () => ({ stdout: '{}' }) }), /invalid database or size/);
});

test('D1 capacity pre-warning preserves a complete content backup', async t => {
  const site = await serve(t, () => jsonResponse(content()));
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-d1-capacity-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const report = await checkHealth({ origin: site.origin, baseline, snapshotDir, databaseName: 'synthetic-db', readCapacity: async database => ({
    database, sizeBytes: 351 * 1024 * 1024, warningBytes: 350 * 1024 * 1024, planLimitBytes: null
  }) });
  assert.deepEqual(report.problems, []); assert.equal(report.warnings.length, 1);
  assert.equal(report.snapshotComplete, true); assert.equal(report.databaseStorage.planLimitBytes, null);
});

test('unavailable D1 authorization is explicit and does not block the public backup', async t => {
  const site = await serve(t, () => jsonResponse(content()));
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-d1-unavailable-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const report = await checkHealth({ origin: site.origin, baseline, snapshotDir, databaseName: 'synthetic-db', readCapacity: async () => { throw new Error('authorization unavailable'); } });
  assert.deepEqual(report.problems, []); assert.match(report.warnings[0], /capacity check incomplete/);
  assert.equal(report.databaseStorage, null); assert.equal(report.snapshotComplete, true);
  await assert.rejects(readDatabaseCapacity('synthetic-db', { run: async () => { throw new Error('secret stderr'); } }), /^Error: D1 capacity unavailable;/);
});

test('row storage backs up every detail page and streams binary audio/video to a verified reusable file', async t => {
  const bytes = Buffer.alloc(1200000, 37), hash = createHash('sha256').update(bytes).digest('hex');
  const full = content({ records: [{ id: 'existing-1', name: '已有内容', detail: '完整正文', videoUrl: '/api/media/' + hash }, { id: 'new-1', name: '第二页内容', detail: '不能遗漏' }] });
  const cells = [...schema.contentCells(full)], counts = {};
  cells.forEach(([key]) => { const field = key.split('/')[0]; counts[field] = (counts[field] || 0) + 1; });
  const initial = { ...content({ records: [{ id: 'existing-1', name: '已有内容' }] }), model: 'records-v1', counts,
    storage: { model: 'records-v1', metadataBytes: 30 * 1024 * 1024, metadataLimit: null, maxRecordBytes: 1500000 } };
  const site = await serve(t, req => {
    if (req.url.startsWith('/api/media/')) return { headers: { 'Content-Type': 'video/mp4' }, body: bytes };
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('format') !== 'records') return jsonResponse(initial);
    const field = url.searchParams.get('field'), rows = cells.filter(([key]) => key.split('/')[0] === field).map(([key, value]) => ({ key, value, summary: false }));
    const cursor = url.searchParams.get('cursor');
    return jsonResponse({ ok: true, revision: 11, rows: field === 'kepuCustom' ? rows.slice(cursor ? 1 : 0, cursor ? 2 : 1) : rows, cursor: field === 'kepuCustom' && !cursor ? 'second' : '' });
  });
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-row-video-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const report = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(report.problems, []); assert.deepEqual(report.warnings, []); assert.equal(report.count, 2); assert.equal(report.snapshotComplete, true);
  assert.equal(report.storage.usedPercent, null); assert.equal(report.mediaArchived, 1);
  const saved = JSON.parse(await fs.readFile(report.snapshotPath, 'utf8'));
  assert.equal(saved.kepuCustom[1].detail, '不能遗漏');
  assert.deepEqual(await fs.readFile(path.join(snapshotDir, 'media', hash + '.mp4')), bytes);
  const second = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(second.problems, []); assert.equal(second.mediaReused, 1);
});

test('legacy non-canonical base64 spelling is preserved in the media cache verification', async t => {
  const image = 'data:image/png;base64,AQ', url = await schema.mediaIdentity(image), hash = url.split('/').at(-1);
  const site = await serve(t, req => req.url.startsWith('/api/media/') ? {
    headers: { 'Content-Type': 'image/png', 'X-Media-Base64-Length': '2', 'X-Media-Base64-Tail': 'AQ' }, body: Buffer.from([1])
  } : jsonResponse(content({ records: [{ id: 'existing-1', name: '旧图片', imageUrl: url }] })));
  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maintenance-old-encoding-'));
  t.after(() => fs.rm(snapshotDir, { recursive: true, force: true }));
  const first = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(first.problems, []); assert.equal(first.snapshotComplete, true);
  const encoding = JSON.parse(await fs.readFile(path.join(snapshotDir, 'media', hash + '.png.encoding.json'), 'utf8'));
  assert.deepEqual(encoding, { length: 2, tail: 'AQ' });
  const second = await checkHealth({ origin: site.origin, baseline, snapshotDir });
  assert.deepEqual(second.problems, []); assert.equal(second.mediaReused, 1);
});
