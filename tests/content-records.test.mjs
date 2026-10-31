import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { loadContentState } from '../functions/api/admin/sync.js';
import { migrateRecordStorage, recordsManifest, readRecordState } from '../functions/_lib/admin-records.js';

const schema = globalThis.HeritageContent;
function setup(t) {
  const backend = createAdminBackend({ password: 'Synthetic-records-2026!' });
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  t.after(() => backend.close()); return backend;
}
async function login(backend, suffix = '') {
  const result = await backend.call({ action: 'login', credential: 'Synthetic-records-2026!', clientId: 'records-' + suffix });
  assert.equal(result.status, 200); return result.data.bearer;
}
async function read(backend, query, bearer) {
  const response = await backend.fetchApi('/api/admin/sync?' + query, { headers: bearer ? { Authorization: 'Bearer ' + bearer } : {} });
  return { status: response.status, data: await response.json() };
}
test('row migration preserves content, private history, credentials and a legacy recovery marker', async t => {
  const backend = setup(t), bearer = await login(backend);
  const initial = (await backend.call()).data;
  const saved = await backend.call({ action: 'update_custom_bundle', ...initial, revision: initial.revision, kepuCustom: [{ id: 'record-one', name: '迁移内容', detail: '第一行\n第二行' }] }, bearer);
  assert.equal(saved.status, 200);
  const before = await loadContentState(backend.db);
  const password = backend.sqlite.prepare("SELECT value FROM admin_state WHERE key='password'").get().value;
  const migrated = await migrateRecordStorage(backend.db, before);
  const after = await loadContentState(backend.db);
  assert.deepEqual(after.value, before.value);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(backend.sqlite.prepare("SELECT value FROM admin_state WHERE key='password'").get().value, password);
  assert.ok(backend.sqlite.prepare('SELECT value FROM admin_state WHERE key=?').get('content:legacy:' + migrated.generation));
  const stale = await backend.call({ action: 'update_custom_bundle', ...initial, revision: initial.revision }, bearer);
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'CLIENT_UPGRADE_REQUIRED');
});

test('independent row writes merge, same-row conflicts persist, operation receipts replay without duplicate history', async t => {
  const backend = setup(t), bearer = await login(backend);
  await migrateRecordStorage(backend.db, await loadContentState(backend.db));
  const create = id => ({ key: 'kepuCustom/' + id, baseHash: '', value: { id, name: id, detail: '正文' } });
  const absent = await schema.cellHash(null);
  const results = await Promise.all(['first', 'second', 'third'].map(id => backend.call({ action: 'update_content', changes: [{ ...create(id), baseHash: absent }], operationId: 'records-operation-' + id }, bearer)));
  for (const result of results) { assert.equal(result.status, 200); assert.equal(result.data.accepted.length, 1); }
  const current = await loadContentState(backend.db);
  assert.equal(current.value.kepuCustom.length, 3); assert.equal(current.value._history.length, 3);
  const repeated = await backend.call({ action: 'update_content', changes: [{ ...create('first'), baseHash: absent }], operationId: 'records-operation-first' }, bearer);
  assert.equal(repeated.status, 200); assert.equal(repeated.data.replayed, true);
  assert.equal((await loadContentState(backend.db)).value._history.length, 3);
  const base = current.value.kepuCustom.find(row => row.id === 'first');
  const baseHash = await schema.cellHash(base);
  const edits = await Promise.all(['A', 'B'].map(name => backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/first', baseHash, value: { ...base, name } }] }, bearer)));
  assert.equal(edits.reduce((sum, result) => sum + result.data.accepted.length, 0), 1);
  assert.equal(edits.reduce((sum, result) => sum + result.data.conflicts.length, 0), 1);
  const tamper = await backend.call({ action: 'update_content', changes: [{ ...create('different'), baseHash: absent }], operationId: 'records-operation-first' }, bearer);
  assert.equal(tamper.status, 409); assert.equal(tamper.data.code, 'OPERATION_MISMATCH');
});

test('staging failure or a concurrent legacy edit cannot switch the live manifest', async t => {
  const backend = setup(t), before = await loadContentState(backend.db);
  backend.sqlite.exec("CREATE TRIGGER fail_staging BEFORE INSERT ON admin_content_items BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  await assert.rejects(migrateRecordStorage(backend.db, before), /synthetic failure/);
  assert.equal(await recordsManifest(backend.db), null);
  backend.sqlite.exec('DROP TRIGGER fail_staging');
  backend.sqlite.prepare("UPDATE admin_state SET revision=revision+1 WHERE key='content'").run();
  await assert.rejects(migrateRecordStorage(backend.db, before), error => error.code === 'SYNC_CONFLICT');
  assert.equal(await recordsManifest(backend.db), null);
});

test('paged Store loads details on demand, preserves other records and recovers an ambiguous acknowledgement', async t => {
  const backend = setup(t), bearer = await login(backend);
  const content = structuredClone(schema.defaults); content.auditLogs = [];
  content.kepuCustom = Array.from({ length: 118 }, (_, index) => ({ id: 'paged-' + String(index).padStart(3, '0'), name: '资料' + index, detail: '全文' + index }));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const device = setupEnvironment(backend);
  device.store.saveSession({ bearer, role: 'super_admin', name: 'test', tokenId: '', expiresAt: Date.now() + 3600000 });
  await device.store.syncWithCloud();
  assert.equal(device.store.getCatalog().model, 'records-v1'); assert.equal(device.store.getContentCount('kepuCustom'), 118);
  assert.equal(device.store.getSyncStatus().cloudCustomCount, 118);
  let list = device.store.getHeritageCards([]);
  assert.equal(list.length, 50); assert.equal(list[0].detail, undefined);
  const full = await device.store.loadRecord('kepu', 'paged-000');
  assert.equal(full.detail, '全文0');
  await device.store.loadContentPage('kepuCustom', { cursor: device.store.getCatalog().pages.kepuCustom });
  assert.equal(device.store.getHeritageCards([]).length, 100);
  const version = device.store.getEditVersion('kepu', full.id);
  device.store.updateHeritageCard(full.id, { ...full, detail: '修改后全文' }, version);
  assert.equal(await device.store.flushPending(), true, JSON.stringify(device.store.getSyncStatus()));
  assert.equal(device.store.getContentCount('kepuCustom'), 118);
  const original = device.sandbox.fetch; let dropped = false;
  device.sandbox.fetch = async (url, options) => {
    const result = await original(url, options);
    if (!dropped && options?.body && JSON.parse(options.body).action === 'update_content') { dropped = true; throw new TypeError('synthetic lost response'); }
    return result;
  };
  device.store.addHeritageCard({ name: '回执丢失测试', detail: '不能重复新增' });
  assert.equal(await device.store.flushPending(), true);
  await device.store.syncWithCloud();
  const state = await loadContentState(backend.db);
  assert.equal(state.value.kepuCustom.length, 119);
  assert.equal(state.value.kepuCustom.filter(row => row.name === '回执丢失测试').length, 1);
  assert.equal(state.value.kepuCustom.find(row => row.id === 'paged-000').detail, '修改后全文');
  assert.equal(device.store.getContentCount('kepuCustom'), 119);
});

test('ten thousand long records paginate and a new row writes without a whole-snapshot size cap', async t => {
  const backend = setup(t), bearer = await login(backend);
  const content = structuredClone(schema.defaults);
  content.auditLogs = [];
  content.kepuCustom = Array.from({ length: 10000 }, (_, index) => ({ id: 'scale-' + String(index).padStart(5, '0'), name: '规模资料 ' + index, detail: '长正文。'.repeat(160), imageUrl: '/api/media/' + index.toString(16).padStart(64, '0') }));
  const migrated = await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  assert.ok(migrated.bytes > 16 * 1024 * 1024);
  const initial = await read(backend, 'format=pages', bearer);
  assert.equal(initial.status, 200); assert.equal(initial.data.kepuCustom.length, 50); assert.equal(initial.data.counts.kepuCustom, 10000);
  assert.equal(initial.data.kepuCustom[0].detail, undefined);
  let cursor = '', count = 0;
  do {
    const page = await read(backend, 'format=records&field=kepuCustom&summary=1&cursor=' + encodeURIComponent(cursor));
    assert.equal(page.status, 200); assert.ok(page.data.rows.length <= 50);
    count += page.data.rows.length; cursor = page.data.cursor;
  } while (cursor);
  assert.equal(count, 10000);
  const added = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/after-ten-thousand', baseHash: await schema.cellHash(null), value: { id: 'after-ten-thousand', name: '继续新增', detail: '容量不能停在10000条' } }] }, bearer);
  assert.equal(added.status, 200); assert.equal(added.data.accepted.length, 1);
  const manifest = await recordsManifest(backend.db);
  const saved = await readRecordState(backend.db, manifest, ['kepuCustom/after-ten-thousand']);
  assert.equal(saved.value.kepuCustom[0].name, '继续新增');
  const invalidCursor = await read(backend, 'format=records&field=kepuCustom&cursor=' + encodeURIComponent(initial.data.pages.kepuCustom));
  assert.equal(invalidCursor.status, 409); assert.equal(invalidCursor.data.code, 'PAGE_CHANGED');
});

test('Chinese query cursors, byte-bounded detail pages and ranked knowledge outside the first page stay complete', async t => {
  const backend = setup(t), content = structuredClone(schema.defaults); content.auditLogs = [];
  content.kbCustom = Array.from({ length: 120 }, (_, index) => ({ id: 'kb-page-' + String(index).padStart(3, '0'), title: '普通内容' + index, keywords: ['青石围'], answer: '正文记录' + index }));
  content.kbCustom.push({ id: 'zz-target', title: '青石围说明', keywords: ['青石围'], answer: '这是指定的完整原文。' });
  content.kepuCustom = Array.from({ length: 3 }, (_, index) => ({ id: 'large-' + index, name: '长正文' + index, detail: 'a'.repeat(900000) }));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const first = await read(backend, 'format=records&field=kbCustom&q=' + encodeURIComponent('正文') + '&summary=1');
  assert.equal(first.status, 200); assert.equal(first.data.rows.length, 50); assert.ok(first.data.cursor);
  const second = await read(backend, 'format=records&field=kbCustom&q=' + encodeURIComponent('正文') + '&summary=1&cursor=' + encodeURIComponent(first.data.cursor));
  assert.equal(second.status, 200); assert.equal(second.data.rows.length, 50); assert.notEqual(first.data.rows[0].key, second.data.rows[0].key);
  const large = await read(backend, 'format=records&field=kepuCustom');
  assert.equal(large.status, 200); assert.equal(large.data.rows.length, 1); assert.ok(large.data.cursor);
  const largeRows = [...large.data.rows]; let largeCursor = large.data.cursor;
  while (largeCursor) {
    assert.ok(largeRows.length < 3, 'byte-bounded paging must make progress');
    const next = await read(backend, 'format=records&field=kepuCustom&cursor=' + encodeURIComponent(largeCursor));
    assert.equal(next.status, 200); largeRows.push(...next.data.rows); largeCursor = next.data.cursor;
  }
  assert.deepEqual(largeRows.map(row => row.value.id), ['large-0', 'large-1', 'large-2']);
  assert.ok(largeRows.every(row => row.value.detail.length === 900000));
  const search = await read(backend, 'format=search&q=' + encodeURIComponent('请讲讲青石围说明'));
  assert.equal(search.status, 200); assert.equal(search.data.rows[0].value.id, 'zz-target'); assert.ok(search.data.rows.length <= 20);
  const device = setupEnvironment(backend); await device.store.syncWithCloud();
  assert.equal(device.store.getEntries().some(entry => entry.id === 'zz-target'), false);
  await device.store.searchKnowledge('请讲讲青石围说明');
  assert.equal(device.store.getEntries().find(entry => entry.id === 'zz-target').answer, '这是指定的完整原文。');
});

test('chunked moderation preserves unrelated rows, raw history and later edits, and replays lost acknowledgements', async t => {
  const backend = setup(t), root = await login(backend);
  const invited = await backend.call({ action: 'create_token', name: 'synthetic-author', days: 1 }, root);
  const token = invited.data.token;
  const editor = (await backend.call({ action: 'login', credential: token.token, clientId: 'synthetic-author' })).data.bearer;
  await migrateRecordStorage(backend.db, await loadContentState(backend.db));
  async function save(id, name, bearer) {
    const current = await loadContentState(backend.db), old = current.value.kepuCustom.find(row => row.id === id) || null;
    const result = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/' + id, baseHash: await schema.cellHash(old), value: { ...(old || { id }), name } }] }, bearer);
    assert.equal(result.status, 200); assert.equal(result.data.accepted.length, 1);
  }
  await save('unrelated', '其他管理员的内容', root);
  for (let i = 0; i < 9; i++) await save('repeat', '作者版本' + i, editor);
  for (let i = 0; i < 10; i++) await save('other-' + i, '作者新增' + i, editor);
  await save('protected', '作者初稿', editor); await save('protected', '他人后续校正', root);
  const oldClient = await backend.call({ action: 'rollback_token', tokenId: token.id }, root);
  assert.equal(oldClient.status, 409); assert.equal(oldClient.data.code, 'CLIENT_UPGRADE_REQUIRED');
  const request = { action: 'rollback_token', tokenId: token.id, chunked: true, cutoff: Date.now(), cursor: '', requestId: 'a'.repeat(64) };
  const first = await backend.call(request, root); assert.equal(first.status, 200); assert.equal(first.data.more, true);
  const once = await loadContentState(backend.db);
  const replay = await backend.call(request, root); assert.equal(replay.data.replayed, true);
  assert.deepEqual((await loadContentState(backend.db)).value, once.value);
  assert.ok(once.value._history.every(op => !op.before?.$operation));
  const device = setupEnvironment(backend); device.store.saveSession({ bearer: root, role: 'super_admin', expiresAt: Date.now() + 3600000 });
  await device.store.syncWithCloud();
  let lost = false; const original = device.sandbox.fetch;
  device.sandbox.fetch = async (url, options) => {
    const response = await original(url, options);
    if (!lost && options?.body && JSON.parse(options.body).action === 'rollback_token') { lost = true; throw new TypeError('synthetic lost moderation receipt'); }
    return response;
  };
  const result = await device.store.rollbackTokenChanges(token.id);
  assert.ok(result.totalRemoved > 0); assert.equal(result.skipped, 1); assert.equal(lost, true);
  let final = await loadContentState(backend.db);
  assert.deepEqual(final.value.kepuCustom.map(row => row.name).sort(), ['他人后续校正', '其他管理员的内容'].sort());
  assert.ok(final.value._history.every(op => !op.before?.$operation));
  assert.equal((await backend.call({ action: 'clear_audit_logs' }, root)).status, 200);
  final = await loadContentState(backend.db); assert.equal(final.value.kepuCustom.length, 2); assert.ok(final.value._history.length > 20);
  assert.equal(final.value.auditLogs.length, 1);
  const notice = (await backend.call(null, editor)).data.notifications;
  assert.ok(notice.length > 0);
  assert.equal((await backend.call({ action: 'read_notifications' }, editor)).status, 200);
  assert.ok((await backend.call(null, editor)).data.notifications.every(n => n.read));
  assert.equal((await loadContentState(backend.db)).value.kepuCustom.length, 2);
});

test('large review lists are paged with complete per-person counts and exports reject partially loaded content', async t => {
  const backend = setup(t), root = await login(backend), issued = await backend.call({ action: 'create_token', name: 'synthetic-reviewer', days: 1 }, root);
  const token = issued.data.token;
  const editor = (await backend.call({ action: 'login', credential: token.token, clientId: 'paged-reviewer' })).data.bearer;
  const content = structuredClone(schema.defaults); content.auditLogs = [];
  content.kepuCustom = Array.from({ length: 121 }, (_, i) => ({ id: 'review-' + String(i).padStart(3, '0'), name: '待审' + i, detail: '完整原文' + i, creatorTokenId: token.id, creatorName: token.name }));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const initial = await read(backend, 'format=pages', root);
  assert.equal(initial.data.contributions.length, 50);
  assert.equal(initial.data.contributionCounts.find(row => row.tokenId === token.id && row.type === 'kepu').count, 121);
  assert.equal((await read(backend, 'format=contributions')).status, 403);
  assert.equal((await read(backend, 'format=contributions', editor)).status, 403);
  let cursor = '', ids = [];
  do {
    const page = await read(backend, 'format=contributions&tokenId=' + token.id + '&cursor=' + encodeURIComponent(cursor), root);
    assert.equal(page.status, 200); assert.ok(page.data.rows.length <= 50);
    ids.push(...page.data.rows.map(row => row.id)); cursor = page.data.cursor;
  } while (cursor);
  assert.equal(ids.length, 121); assert.equal(new Set(ids).size, 121);
  const device = setupEnvironment(backend); device.store.saveSession({ bearer: root, role: 'super_admin', expiresAt: Date.now() + 3600000 });
  await device.store.syncWithCloud();
  assert.equal(device.store.getInviteTokens().find(row => row.id === token.id).kepuCount, 121);
  assert.equal((await device.store.loadTokenContributions(token.id)).items.length, 50);
  assert.throws(() => device.store.exportFullBundle(), /完整读取/);
  await device.store.prepareExport();
  const exported = JSON.parse(device.store.exportFullBundle());
  assert.equal(exported.version, 'v4-records'); assert.equal(exported.cloudDraft.kepuCustom.length, 121);
  assert.equal(exported.cloudDraft.kepuCustom[120].detail, '完整原文120');
  assert.equal(exported.knowledgeBase, undefined); assert.equal(exported.auditLogs, undefined);
});

test('legacy history restore followed by deleting multiple records cannot reuse a stale record-mode digest or loop', async t => {
  const backend = setup(t), bearer = await login(backend), device = setupEnvironment(backend);
  device.store.saveSession({ bearer, role: 'super_admin', expiresAt: Date.now() + 3600000 }); await device.store.syncWithCloud();
  for (const id of ['restore-delete-first', 'restore-delete-second']) device.store.addHeritageCard({ id, name: id });
  assert.equal(await device.store.flushPending(), true);
  device.store.deleteHeritageCard('restore-delete-first'); assert.equal(await device.store.flushPending(), true);
  await device.store.restoreOperation(device.store.getRecoveryHistory().find(op => op.kind === '删除内容').id);
  assert.equal(device.store.getHeritageCards([]).length, 2);
  const original = device.sandbox.fetch; let writes = 0;
  device.sandbox.fetch = (url, options) => {
    if (options?.body && JSON.parse(options.body).action === 'update_content' && ++writes > 4) throw new Error('Repeated unchanged delete request');
    return original(url, options);
  };
  for (const card of device.store.getHeritageCards([])) device.store.deleteHeritageCard(card.id);
  assert.equal(await device.store.flushPending(), true, JSON.stringify(device.store.getSyncStatus()));
  assert.equal((await loadContentState(backend.db)).value.kepuCustom.length, 0); assert.ok(writes <= 2);
});

test('an explicit server conflict stays visible even when a local three-way merge sees equal base content', async t => {
  const backend = setup(t), bearer = await login(backend);
  await migrateRecordStorage(backend.db, await loadContentState(backend.db));
  const device = setupEnvironment(backend); device.store.saveSession({ bearer, role: 'super_admin', expiresAt: Date.now() + 3600000 }); await device.store.syncWithCloud();
  device.store.addHeritageCard({ id: 'explicit-conflict', name: '原稿' }); assert.equal(await device.store.flushPending(), true);
  const current = (await loadContentState(backend.db)).value.kepuCustom[0], revision = (await recordsManifest(backend.db)).revision;
  const original = device.sandbox.fetch; let writes = 0;
  device.sandbox.fetch = (url, options) => {
    if (options?.body && JSON.parse(options.body).action === 'update_content') {
      if (++writes > 1) throw new Error('Server conflict was retried without user review');
      return Promise.resolve(new Response(JSON.stringify({ ok: true, revision, baseRevision: revision, accepted: [], conflicts: ['kepuCustom/explicit-conflict'], receipts: [], updates: [{ key: 'kepuCustom/explicit-conflict', value: current }] }), { headers: { 'Content-Type': 'application/json' } }));
    }
    return original(url, options);
  };
  device.store.updateHeritageCard('explicit-conflict', { ...current, name: '待核对稿' });
  assert.equal(await device.store.flushPending(), false); assert.equal(writes, 1);
  assert.equal(device.store.getSyncStatus().conflictCount, 1); assert.equal(device.store.getHeritageCards([])[0].name, '待核对稿');
  assert.equal((await loadContentState(backend.db)).value.kepuCustom[0].name, '原稿');
});

test('a legacy cached device adopts the complete new catalog without resurrecting old deletions or losing an offline draft', async t => {
  const backend = setup(t), bearer = await login(backend), old = structuredClone(schema.defaults);
  old.kepuCustom = [{ id: 'old-deleted', name: '旧缓存里已经删除的条目', detail: '不应重新出现' }, { id: 'kept-offline', name: '离线改稿', detail: '旧正文' }];
  assert.equal((await backend.call({ action: 'update_custom_bundle', ...old, revision: 0 }, bearer)).status, 200);
  const device = setupEnvironment(backend); device.store.saveSession({ bearer, role: 'super_admin', expiresAt: Date.now() + 3600000 }); await device.store.syncWithCloud();
  const fetch = device.sandbox.fetch; device.sandbox.fetch = async () => { throw new Error('offline'); };
  device.store.updateHeritageCard('kept-offline', { id: 'kept-offline', name: '离线改稿', detail: '本机新正文' }); assert.equal(await device.store.flushPending(), false);
  const current = await loadContentState(backend.db);
  const changed = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/old-deleted', baseHash: await schema.cellHash(current.value.kepuCustom.find(row => row.id === 'old-deleted')), value: null }] }, bearer);
  assert.equal(changed.status, 200);
  const beforeMigration = await loadContentState(backend.db);
  beforeMigration.value.kepuCustom.push(...Array.from({ length: 75 }, (_, i) => ({ id: 'new-catalog-' + i, name: '另一台设备的资料' + i, detail: '云端正文' + i })));
  await migrateRecordStorage(backend.db, beforeMigration);
  device.sandbox.fetch = fetch; await device.store.syncWithCloud();
  assert.equal(device.store.getCatalog().model, 'records-v1'); assert.equal(device.store.getContentCount('kepuCustom'), 76);
  assert.equal(device.store.getHeritageCards([]).some(row => row.id === 'old-deleted'), false);
  assert.equal(device.store.getHeritageCards([]).filter(row => row.id.startsWith('new-catalog-')).length, 75);
  assert.equal(device.store.getHeritageCards([]).find(row => row.id === 'kept-offline').detail, '本机新正文');
  assert.equal((await loadContentState(backend.db)).value.kepuCustom.find(row => row.id === 'kept-offline').detail, '本机新正文');
});

test('edited builtin summaries do not expose the superseded original answer or detail before hydration', async t => {
  const backend = setup(t), content = structuredClone(schema.defaults), kbId = schema.reserved.kb[0], cardId = schema.reserved.kepu[0];
  content.auditLogs = []; content.kbEdited[kbId] = { id: kbId, title: '校正后的知识', answer: '老师校正的答案' };
  content.kepuEdited[cardId] = { id: cardId, name: '校正后的科普', detail: '老师校正的正文' };
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const device = setupEnvironment(backend);
  device.window.KNOWLEDGE_BASE = [{ id: kbId, title: '内置知识', answer: '已被替代的旧答案' }];
  const base = [{ id: cardId, name: '内置科普', detail: '已被替代的旧正文' }];
  await device.store.syncWithCloud();
  assert.equal(device.store.getEntries().find(row => row.id === kbId).answer, undefined);
  assert.equal(device.store.getHeritageCards(base)[0].detail, undefined);
  await device.store.loadRecord('kb', kbId); await device.store.loadRecord('kepu', cardId);
  assert.equal(device.store.getEntries().find(row => row.id === kbId).answer, '老师校正的答案');
  assert.equal(device.store.getHeritageCards(base)[0].detail, '老师校正的正文');
});
