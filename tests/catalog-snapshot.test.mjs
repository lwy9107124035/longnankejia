import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';

test('a concurrent save cannot mix catalog counts and page rows or invalidate an already coherent snapshot', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = Array.from({ length: 70 }, (_, i) => ({ id: 'snapshot-' + String(i).padStart(3, '0'), name: '快照资料' + i, detail: '完整正文' }));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'snapshot-reader' })).data;
  const prepare = backend.db.prepare.bind(backend.db), batch = backend.db.batch.bind(backend.db); let written = false;
  async function writeDuringRead() {
    if (written) return; written = true;
    const saved = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/snapshot-new', baseHash: await globalThis.HeritageContent.cellHash(null), value: { id: 'snapshot-new', name: '并发新增', detail: '新正文' } }] }, root.bearer);
    assert.equal(saved.status, 200);
  }
  backend.db.prepare = sql => {
    const statement = prepare(sql), all = statement.all.bind(statement);
    statement.all = async () => { const result = await all(); if (sql.includes('AS runningBytes')) await writeDuringRead(); return result; };
    return statement;
  };
  backend.db.batch = async statements => { await writeDuringRead(); return batch(statements); };
  const response = await backend.fetchApi('/api/admin/sync?format=pages');
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(written, true); assert.equal(data.revision, 2); assert.equal(data.counts.kepuCustom, 71);
  assert.equal(data.kepuCustom.length, 50); assert.ok(data.pages.kepuCustom);
  assert.ok(data.kepuCustom.every(row => row.detail === undefined));
  const cursor = JSON.parse(Buffer.from(data.pages.kepuCustom.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString());
  assert.equal(cursor.revision, data.revision);
});
