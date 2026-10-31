import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';
import { createMediaRuntime } from './helpers/media-r2.mjs';

async function fixture(t, name = '旧内容') {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = [{ id: 'public-catalog-row', name, detail: '完整正文' }];
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  return { backend, content };
}
function holdFirstRead(db, matches) {
  const prepare = db.prepare.bind(db); let release, entered, held = false, calls = 0;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  db.prepare = sql => {
    const statement = prepare(sql), bind = statement.bind.bind(statement), first = statement.first.bind(statement); let params = [];
    statement.bind = (...values) => { params = values; return bind(...values); };
    statement.first = async () => {
      const result = await first();
      if (matches(sql, params)) { calls++; if (!held) { held = true; entered(); await gate; } }
      return result;
    };
    return statement;
  };
  return { started, release, get calls() { return calls; } };
}
const catalog = '/api/admin/sync?format=pages';

test('simultaneous anonymous catalog requests share database work and create their own responses', async t => {
  const { backend } = await fixture(t);
  const held = holdFirstRead(backend.db, sql => sql.includes("WHERE key='content'")); t.after(held.release);
  const origins = Array.from({ length: 50 }, (_, i) => i % 2 ? 'https://lwy9107124035.github.io' : 'http://127.0.0.1:8931');
  const requests = origins.map(origin => backend.fetchApi(catalog, { headers: { Origin: origin } }));
  await held.started; held.release();
  const responses = await Promise.all(requests);
  for (const [i, response] of responses.entries()) {
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('Server-Timing'), /^content;dur=\d+(?:\.\d+)?$/);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origins[i]);
    const value = await response.json(); assert.equal(value.counts.kepuCustom, 1); assert.equal(value.kepuCustom[0].name, '旧内容');
    for (const field of ['tokens', 'session', 'auditLogs', 'recovery', 'notifications']) assert.equal(Object.hasOwn(value, field), false);
  }
  assert.equal(held.calls, 1);
  await backend.fetchApi(catalog); assert.equal(held.calls, 2, 'finished reads must not become a stale data cache');
});

test('authenticated and invalid bearer requests never join a public catalog read', async t => {
  const { backend } = await fixture(t);
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'catalog-private' })).data.bearer;
  const held = holdFirstRead(backend.db, sql => sql.includes("WHERE key='content'")); t.after(held.release);
  const pending = backend.fetchApi(catalog); await held.started;
  const admin = await backend.fetchApi(catalog, { headers: { Authorization: 'Bearer ' + root } });
  assert.equal((await admin.json()).session.role, 'super_admin');
  const rejected = await backend.fetchApi(catalog, { headers: { Authorization: 'Bearer invalid' } }); assert.equal(rejected.status, 401);
  const unchanged = await (await backend.fetchApi(catalog + '&revision=1')).json(); assert.equal(unchanged.unchanged, true);
  held.release(); assert.equal(Object.hasOwn(await (await pending).json(), 'tokens'), false);
});

test('different databases never share a public catalog even at the same HTTP origin', async t => {
  const a = await fixture(t, '甲站资料'), b = await fixture(t, '乙站资料');
  const held = holdFirstRead(a.backend.db, sql => sql.includes("WHERE key='content'")); t.after(held.release);
  const pending = a.backend.fetchApi(catalog); await held.started;
  const other = await (await b.backend.fetchApi(catalog)).json(); assert.equal(other.kepuCustom[0].name, '乙站资料');
  held.release(); assert.equal((await (await pending).json()).kepuCustom[0].name, '甲站资料');
});

test('a completed write invalidates an older in-flight public read before another visitor joins', async t => {
  const { backend, content } = await fixture(t);
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'catalog-writer' })).data.bearer;
  const held = holdFirstRead(backend.db, (sql, params) => sql.includes('admin_state') && params[0] === 'tokens'); t.after(held.release);
  const pending = backend.fetchApi(catalog); await held.started;
  const before = content.kepuCustom[0];
  const saved = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/' + before.id,
    baseHash: await globalThis.HeritageContent.cellHash(before), value: { ...before, name: '新内容' } }] }, root);
  assert.equal(saved.data.accepted.length, 1);
  let timer;
  try {
    const response = await Promise.race([backend.fetchApi(catalog), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('new visitor joined the stale read')), 3000); })]);
    const current = await response.json(); assert.equal(current.revision, 2); assert.equal(current.kepuCustom[0].name, '新内容');
  } finally { clearTimeout(timer); held.release(); }
  assert.equal((await (await pending).json()).kepuCustom[0].name, '旧内容');
});

test('a rejected public read does not leave a rejected promise for subsequent visitors', async t => {
  const { backend } = await fixture(t), prepare = backend.db.prepare;
  const original = console.error; console.error = () => {}; t.after(() => { console.error = original; });
  backend.db.prepare = () => { throw Error('D1 overloaded'); };
  const failed = await Promise.all(Array.from({ length: 25 }, () => backend.fetchApi(catalog)));
  assert.ok(failed.every(response => response.status === 503)); backend.db.prepare = prepare;
  const recovered = await backend.fetchApi(catalog); assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).kepuCustom[0].name, '旧内容');
});

test('conditional refresh reads independently after another isolate writes without a local invalidation', async t => {
  const { backend, content } = await fixture(t);
  const held = holdFirstRead(backend.db, (sql, params) => sql.includes('admin_state') && params[0] === 'tokens'); t.after(held.release);
  const pending = backend.fetchApi(catalog + '&revision=1'); await held.started;
  const changed = { ...content.kepuCustom[0], name: '另一实例更新' }, hash = await globalThis.HeritageContent.cellHash(changed, true);
  backend.sqlite.exec('BEGIN');
  backend.sqlite.prepare('UPDATE admin_content_items SET value=?,digest=?,revision=2 WHERE key=?').run(JSON.stringify(changed), hash, 'kepuCustom/' + changed.id);
  backend.sqlite.exec("UPDATE admin_state SET revision=2 WHERE key='content'; COMMIT");
  let timer;
  try {
    const response = await Promise.race([backend.fetchApi(catalog + '&revision=1'), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('conditional refresh joined an old read')), 3000); })]);
    const current = await response.json(); assert.equal(current.revision, 2); assert.equal(current.kepuCustom[0].name, changed.name);
  } finally { clearTimeout(timer); held.release(); }
  assert.equal((await (await pending).json()).unchanged, true);
});

for (const params of [
  { format: 'records', field: 'kepuCustom', summary: '1' },
  { format: 'record', key: 'kepuCustom/public-catalog-row' },
  { format: 'search', q: '合成检索词' }
]) test(`anonymous ${params.format} requests share identical queries without mixing different filters`, async t => {
  const { backend } = await fixture(t);
  const held = holdFirstRead(backend.db, sql => sql.includes("WHERE key='content'")); t.after(held.release);
  const queries = [Object.entries(params), Object.entries(params).reverse()].map(entries => new URLSearchParams(entries));
  const pending = Array.from({ length: 25 }, (_, i) => backend.fetchApi('/api/admin/sync?' + queries[i % 2]));
  await held.started;
  const distinct = params.format === 'records' ? 'format=records&field=kbCustom' : params.format === 'record' ? 'format=record&key=kepuCustom/absent' : 'format=search&q=不同检索词';
  const other = await (await backend.fetchApi('/api/admin/sync?' + distinct)).json();
  assert.ok(!other.rows.length || other.rows[0].value === null); held.release();
  for (const response of await Promise.all(pending)) { assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.model, 'records-v1'); }
  assert.equal(held.calls, params.format === 'search' ? 4 : 2, 'only two distinct queries execute; search also checks its ending revision');
});

test('real Worker contexts can share parsed catalog data without sharing request I/O objects', async t => {
  const runtime = await createMediaRuntime(t, { api: true });
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = Array.from({ length: 70 }, (_, i) => ({ id: 'worker-public-' + i, name: '运行时资料' + i, detail: '完整正文' }));
  await migrateRecordStorage(runtime.db, { value: content, revision: 0 });
  const responses = await Promise.all(Array.from({ length: 50 }, () => runtime.fetch('http://localhost' + catalog)));
  for (const response of responses) {
    assert.equal(response.status, 200); const data = await response.json();
    assert.equal(data.counts.kepuCustom, 70); assert.equal(data.kepuCustom.length, 50); assert.ok(data.pages.kepuCustom);
    assert.equal(Object.hasOwn(data, 'tokens'), false);
  }
});

test('one thousand isolated Worker reads preserve three same-invitation editors saves and conflicting-operation receipts', { timeout: 60000 }, async t => {
  const runtime = await createMediaRuntime(t, { api: true }), schema = globalThis.HeritageContent;
  const content = structuredClone(schema.defaults);
  content.kepuCustom = Array.from({ length: 188 }, (_, i) => ({ id: 'local-peak-' + i, name: '隔离资料' + i, detail: '合成正文\n'.repeat(350) }));
  const manifest = await migrateRecordStorage(runtime.db, { value: content, revision: 0 });
  async function call(body, bearer) {
    const response = await runtime.fetch('http://localhost/api/admin/sync', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer && { Authorization: 'Bearer ' + bearer }) }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  }
  const root = await call({ action: 'login', credential: 'admin123', clientId: 'local-peak-root' });
  const invite = (await call({ action: 'create_token', name: '隔离三人同邀请码', days: 1 }, root.bearer)).token;
  const editors = [];
  for (let i = 0; i < 3; i++) editors.push(await call({ action: 'login', credential: invite.token, clientId: 'local-peak-editor-' + i }));
  assert.equal(new Set(editors.map(editor => editor.bearer)).size, 3); assert.ok(editors.every(editor => editor.role === 'editor' && editor.tokenId === invite.id));
  const originalHashes = await Promise.all(content.kepuCustom.slice(0, 4).map(row => schema.cellHash(row)));
  const bodies = Array.from({ length: 5 }, (_, i) => {
    const index = Math.min(i, 3), row = content.kepuCustom[index];
    return { action: 'update_content', operationId: 'local-peak-operation-' + i,
      changes: [{ key: 'kepuCustom/' + row.id, baseHash: originalHashes[index], value: { ...row, tag: '同邀请码并发保存' + i } }] };
  });
  let finishedReads = 0, privacyChecks = 0, lastReadFinishedAt;
  const firstReadStartedAt = Date.now();
  const reads = Array.from({ length: 1000 }, async () => {
    const response = await runtime.fetch('http://localhost' + catalog); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.counts.kepuCustom, 188); assert.equal(new Set(data.kepuCustom.map(row => row.id)).size, 50);
    for (const field of ['tokens', 'session', 'auditLogs', 'recovery', 'notifications']) assert.equal(Object.hasOwn(data, field), false);
    privacyChecks++; finishedReads++; lastReadFinishedAt = Date.now();
  });
  const unfinishedAtWriteStart = 1000 - finishedReads; assert.ok(unfinishedAtWriteStart > 0);
  let writesAcknowledgedAt;
  const saving = Promise.all(bodies.map((body, i) => call(body, editors[i % 3].bearer))).then(replies => { writesAcknowledgedAt = Date.now(); return replies; });
  const [saved] = await Promise.all([saving, Promise.all(reads)]);
  assert.equal(privacyChecks, 1000);
  assert.ok(saved.slice(0, 3).every(reply => reply.accepted.length === 1));
  assert.equal(saved.slice(3).reduce((n, reply) => n + reply.accepted.length, 0), 1); assert.equal(saved.slice(3).reduce((n, reply) => n + reply.conflicts.length, 0), 1);
  const confirmations = await runtime.db.prepare('SELECT owner,value,created_at FROM admin_content_receipts WHERE generation=? ORDER BY id').bind(manifest.generation).all();
  assert.equal(confirmations.results.length, 5); assert.ok(confirmations.results.every(row => row.owner === invite.id));
  const serverWritesDuringReadWindow = confirmations.results.slice(0, 3).filter(row => row.created_at >= firstReadStartedAt && row.created_at <= lastReadFinishedAt).length;
  assert.equal(serverWritesDuringReadWindow, 3); assert.ok(writesAcknowledgedAt <= lastReadFinishedAt, 'all five save responses must arrive while reads are still in progress');
  for (const [i, body] of bodies.entries()) {
    const replay = await call(body, editors[i % 3].bearer); assert.equal(replay.replayed, true);
    assert.deepEqual(replay.accepted, saved[i].accepted); assert.deepEqual(replay.conflicts, saved[i].conflicts);
  }
  const final = await (await runtime.fetch('http://localhost' + catalog + '&revision=1')).json();
  for (let i = 0; i < 3; i++) {
    const response = await runtime.fetch('http://localhost/api/admin/sync?format=record&key=kepuCustom/local-peak-' + i);
    assert.equal(response.status, 200); const detail = await response.json();
    assert.equal(detail.rows[0].value.tag, '同邀请码并发保存' + i); assert.equal(detail.rows[0].value.detail, content.kepuCustom[i].detail);
  }
  assert.equal(final.counts.kepuCustom, 188);
  assert.equal((await runtime.db.prepare("SELECT COUNT(*) AS count FROM admin_content_items WHERE generation=? AND kind='_history'").bind(manifest.generation).first()).count, 4);
  t.diagnostic(JSON.stringify({ localOnly: true, realWorkerRuntime: true, reads: finishedReads, unfinishedAtWriteStart, independentEditorSessions: 3, invitationCount: 1,
    independentSaves: 3, conflictAccepted: 1, conflictRejected: 1, receiptReplays: 5,
    serverWritesDuringReadWindow, saveAcknowledgementsDuringReads: writesAcknowledgedAt <= lastReadFinishedAt }));
});
