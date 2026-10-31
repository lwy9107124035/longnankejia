import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend, captureQueryPlans } from './helpers/admin-harness.mjs';
import { migrateRecordStorage, recordSummaries, pageRecoveryHistory } from '../functions/_lib/admin-records.js';

test('administrator summaries and recovery pages use ordered indexes instead of sorting the accumulated history', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const manifest = await migrateRecordStorage(backend.db, { value: structuredClone(globalThis.HeritageContent.defaults), revision: 0 });
  const insert = backend.sqlite.prepare('INSERT INTO admin_content_items(generation,key,kind,value,digest,revision) VALUES(?,?,?,?,?,1)');
  backend.sqlite.exec('BEGIN');
  for (let i = 0; i < 20; i++) insert.run(manifest.generation, '_history/recover-' + i, '_history', JSON.stringify({ id: 'recover-' + i, title: '可恢复记录', time: i, before: { name: '旧内容' } }), 'synthetic');
  for (let i = 0; i < 5000; i++) insert.run(manifest.generation, '_history/create-' + i, '_history', JSON.stringify({ id: 'create-' + i, title: '新增记录', time: 100 + i, before: null }), 'synthetic');
  for (let i = 0; i < 1000; i++) insert.run(manifest.generation, 'auditLogs/log-' + i, 'auditLogs', JSON.stringify({ id: 'log-' + i, time: i, action: '合成操作', detail: '' }), 'synthetic');
  backend.sqlite.exec('COMMIT');
  const plans = captureQueryPlans(backend), result = await recordSummaries(backend.db, manifest, []);
  assert.equal(result.auditLogs.length, 200); assert.equal(result.auditLogs[0].id, 'log-999');
  assert.equal(result.recovery.length, 20); assert.equal(result.recovery[0].id, 'recover-19');
  assert.ok(plans.some(plan => plan.includes('admin_content_sequence'))); assert.ok(plans.some(plan => plan.includes('admin_content_recovery')));
  assert.ok(plans.every(plan => !plan.includes('TEMP B-TREE')));
  const page = await pageRecoveryHistory(backend.db, manifest); assert.equal(page.rows.length, 20); assert.equal(page.cursor, '');
  assert.match(plans.at(-1), /admin_content_recovery/); assert.doesNotMatch(plans.at(-1), /TEMP B-TREE/);
});
