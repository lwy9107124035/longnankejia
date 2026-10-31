import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend, captureQueryPlans } from './helpers/admin-harness.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';

for (const format of ['pages', 'records']) test(`a concurrent save cannot mix ${format} counts and page rows or invalidate an already coherent snapshot`, async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = Array.from({ length: 70 }, (_, i) => ({ id: 'snapshot-' + String(i).padStart(3, '0'), name: '快照资料' + i, detail: '完整正文' }));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'snapshot-reader' })).data;
  const prepare = backend.db.prepare.bind(backend.db), batch = backend.db.batch.bind(backend.db); let written = false, writes = 0;
  async function writeDuringRead() {
    if (written) return; written = true;
    const id = 'snapshot-new-' + ++writes;
    const saved = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/' + id, baseHash: await globalThis.HeritageContent.cellHash(null), value: { id, name: '并发新增', detail: '新正文' } }] }, root.bearer);
    assert.equal(saved.status, 200); assert.equal(saved.data.accepted.length, 1);
  }
  backend.db.prepare = sql => {
    const statement = prepare(sql), all = statement.all.bind(statement);
    statement.all = async () => { const result = await all(); if (sql.includes('AS runningBytes')) await writeDuringRead(); return result; };
    return statement;
  };
  backend.db.batch = async statements => { await writeDuringRead(); return batch(statements); };
  const response = await backend.fetchApi('/api/admin/sync?format=' + format + '&field=kepuCustom&summary=1');
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(written, true); assert.equal(data.revision, 2);
  const rows = format === 'pages' ? data.kepuCustom : data.rows.map(row => row.value), marker = format === 'pages' ? data.pages.kepuCustom : data.cursor;
  assert.equal(format === 'pages' ? data.counts.kepuCustom : data.total, 71);
  assert.equal(rows.length, 50); assert.ok(marker); assert.ok(rows.every(row => row.detail === undefined));
  const cursor = JSON.parse(Buffer.from(marker.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString());
  assert.equal(cursor.revision, data.revision);
  if (format === 'records') {
    written = false;
    const stale = await backend.fetchApi('/api/admin/sync?format=records&field=kepuCustom&summary=1&cursor=' + encodeURIComponent(marker));
    assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'PAGE_CHANGED');
  }
});

test('record detail reads its value and revision together while redacting legacy invitation credentials', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  const invite = 'NFYJ-INV-SYNTHETIC-DETAIL-ONLY';
  content.kepuCustom = [{ id: 'detail-snapshot', name: '原名称', detail: '原正文', creatorTokenId: invite }];
  backend.sqlite.prepare("UPDATE admin_state SET value=?,revision=1 WHERE key='tokens'").run(JSON.stringify([{ id: 'detail-author', token: invite }]));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'detail-reader' })).data;
  const prepare = backend.db.prepare.bind(backend.db), batch = backend.db.batch.bind(backend.db); let written = false;
  async function writeDuringRead() {
    if (written) return; written = true;
    const row = content.kepuCustom[0];
    const saved = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/' + row.id,
      baseHash: await globalThis.HeritageContent.cellHash({ ...row, creatorTokenId: 'detail-author' }), value: { ...row, name: '新名称', detail: '新正文' } }] }, root.bearer);
    assert.equal(saved.status, 200); assert.equal(saved.data.accepted.length, 1);
  }
  backend.db.prepare = sql => {
    const statement = prepare(sql), all = statement.all.bind(statement);
    statement.all = async () => { const result = await all(); if (sql.startsWith('SELECT key,kind,value FROM admin_content_items')) await writeDuringRead(); return result; };
    return statement;
  };
  backend.db.batch = async statements => { await writeDuringRead(); return batch(statements); };
  const response = await backend.fetchApi('/api/admin/sync?format=record&key=kepuCustom/detail-snapshot');
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.revision, 2); assert.equal(data.rows[0].value.detail, '新正文');
  assert.equal(data.rows[0].value.creatorTokenId, 'detail-author'); assert.equal(JSON.stringify(data).includes(invite), false);
  assert.equal(data.rows[0].hash, await globalThis.HeritageContent.cellHash(data.rows[0].value, true));
  assert.equal((await backend.fetchApi('/api/admin/sync?format=record&key=auditLogs/private')).status, 400);
  assert.equal((await backend.fetchApi('/api/admin/sync?format=record&key=_history/private')).status, 400);
});

test('live pages skip retained deletion markers while incremental synchronization still returns deletions', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = Array.from({ length: 50 }, (_, i) => ({ id: 'z-live-' + i, name: '有效资料' + i, detail: '完整正文' }));
  const manifest = await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const insert = backend.sqlite.prepare("INSERT INTO admin_content_items(generation,key,kind,value,digest,revision) VALUES(?,?,'kepuCustom','null','synthetic-null',1)");
  backend.sqlite.exec('BEGIN');
  for (let i = 0; i < 2000; i++) insert.run(manifest.generation, 'kepuCustom/a-deleted-' + i);
  backend.sqlite.exec('COMMIT');
  const plans = captureQueryPlans(backend, sql => sql.includes('AS runningBytes'));
  const live = await (await backend.fetchApi('/api/admin/sync?format=records&field=kepuCustom&summary=1')).json();
  assert.equal(live.rows.length, 50); assert.equal(live.total, 50); assert.equal(live.cursor, '');
  assert.match(plans.at(-1), /admin_content_live/);
  const changes = await (await backend.fetchApi('/api/admin/sync?format=records&field=kepuCustom&since=0')).json();
  assert.equal(changes.rows.length, 50); assert.ok(changes.rows.every(row => row.value === null)); assert.ok(changes.cursor);
  assert.doesNotMatch(plans.at(-1), /admin_content_live/);
});
