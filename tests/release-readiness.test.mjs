import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend, recoveryFixture } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';
import { loadContentState } from '../functions/api/admin/sync.js';

async function setup(t, content = structuredClone(globalThis.HeritageContent.defaults)) {
  const backend = createAdminBackend(), images = createAdminBackend({ schema: 'media' });
  t.after(() => { backend.close(); images.close(); });
  backend.env.ADMIN_MEDIA_DB = images.db;
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'release-check' })).data;
  return { backend, images, root };
}

test('malformed record batches return input errors before SQL and leave content, revision and image storage untouched', async t => {
  const { backend, images, root } = await setup(t);
  const before = await loadContentState(backend.db), hash = await globalThis.HeritageContent.cellHash(null);
  for (const changes of [[null], [1], [{}], [{ key: {} }], [{ key: '_history/private', value: null, baseHash: hash }],
    [{ key: 'kepuCustom/array-hash', value: null, baseHash: [hash] }],
    [{ key: 'kepuCustom/bad', value: { id: 'bad', name: '无摘要' } }],
    [{ key: 'kepuCustom/repeat', value: null, baseHash: hash }, { key: 'kepuCustom/repeat', value: null, baseHash: hash }]]) {
    const response = await backend.call({ action: 'update_content', changes }, root.bearer);
    assert.equal(response.status, 400, JSON.stringify(changes));
    assert.deepEqual(await loadContentState(backend.db), before);
    assert.equal(images.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_state').get().n, 0);
  }
});

test('content database quota after image upload preserves a retryable draft without duplicating image data', async t => {
  const { backend, images, root } = await setup(t), device = setupEnvironment(backend);
  device.store.saveSession(root); await device.store.syncWithCloud();
  const image = 'data:image/jpeg;base64,' + fs.readFileSync(new URL('../assets/model-references/hutoumao-211.jpg', import.meta.url)).toString('base64');
  const before = await loadContentState(backend.db);
  backend.sqlite.exec("CREATE TRIGGER content_quota BEFORE INSERT ON admin_content_items BEGIN SELECT RAISE(ABORT,'synthetic content quota'); END");
  device.store.addHeritageCard({ id: 'primary-quota', name: '正文库失败保留草稿', detail: '不能丢的正文', imageUrl: image });
  assert.equal(await device.store.flushPending(), false);
  assert.deepEqual(await loadContentState(backend.db), before);
  assert.equal(device.store.getHeritageCards([])[0].detail, '不能丢的正文');
  assert.equal(device.store.getHeritageCards([])[0].imageUrl, image);
  const imageRows = images.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_state').get().n; assert.ok(imageRows > 0);
  backend.sqlite.exec('DROP TRIGGER content_quota'); assert.equal(await device.store.flushPending(), true);
  assert.equal(images.sqlite.prepare('SELECT COUNT(*) AS n FROM admin_state').get().n, imageRows);
  const saved = (await loadContentState(backend.db)).value.kepuCustom;
  assert.equal(saved.length, 1); assert.equal(saved[0].detail, '不能丢的正文');
});

test('a restored stale new-record form cannot borrow a newer catalog hash to overwrite a colleague', async t => {
  const { backend, root } = await setup(t);
  const fields = [
    ['kb', { id: 'stale-kb', title: '知识旧表单', answer: '旧回答' }, 'kbCustom', 'addEntry', 'updateEntry'],
    ['kepu', { id: 'stale-card', name: '科普旧表单', detail: '旧正文' }, 'kepuCustom', 'addHeritageCard', 'updateHeritageCard'],
    ['dialect', { id: 'stale-dialect', item: { name: '方言旧表单', audioUrl: 'https://example.invalid/old.mp3' } }, 'dialectCustom', 'addDialectTrack', 'updateDialectTrack']
  ];
  for (const [kind, original, field, add, update] of fields) {
    const first = setupEnvironment(backend); first.store.saveSession(root); await first.store.syncWithCloud();
    first.store[add](original); assert.equal(await first.store.flushPending(), true);
    const oldFormVersion = { key: field + '/' + original.id, value: null };
    const saved = (await loadContentState(backend.db)).value[field].find(row => row.id === original.id);
    const peer = { ...saved, ...(kind === 'kb' ? { answer: '同事的新回答' } : kind === 'kepu' ? { detail: '同事的新正文' } : { item: { ...saved.item, audioUrl: 'https://example.invalid/peer.mp3' } }) };
    const written = await backend.call({ action: 'update_content', changes: [{ key: oldFormVersion.key, baseHash: await globalThis.HeritageContent.cellHash(saved), value: peer }] }, root.bearer);
    assert.equal(written.data.accepted.length, 1);
    const restored = setupEnvironment(backend); restored.store.saveSession(root); await restored.store.syncWithCloud();
    if (kind === 'kb') restored.store[update](original.id, original, root, oldFormVersion);
    else restored.store[update](original.id, original, oldFormVersion);
    assert.equal(await restored.store.flushPending(), false, kind + ' must report a conflict');
    assert.equal(restored.store.getSyncStatus().conflictCount, 1);
    const actual = (await loadContentState(backend.db)).value[field].find(row => row.id === original.id);
    assert.equal(kind === 'kb' ? actual.answer : kind === 'kepu' ? actual.detail : actual.item.audioUrl,
      kind === 'kb' ? peer.answer : kind === 'kepu' ? peer.detail : peer.item.audioUrl);
  }
});

test('all recoverable history can be paged safely beyond the latest fifty and old operations still restore', async t => {
  const { backend, root } = await setup(t, await recoveryFixture());
  const read = async (cursor = '', bearer = root.bearer) => {
    const response = await backend.fetchApi('/api/admin/sync?format=history&cursor=' + encodeURIComponent(cursor), { headers: bearer ? { Authorization: 'Bearer ' + bearer } : {} });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await read('', '')).status, 403);
  const invite = (await backend.call({ action: 'create_token', name: '历史权限测试', days: 1 }, root.bearer)).data.token;
  const editor = (await backend.call({ action: 'login', credential: invite.token })).data;
  assert.equal((await read('', editor.bearer)).status, 403);
  const first = await read(); assert.equal(first.status, 200); assert.equal(first.data.rows.length, 50); assert.ok(first.data.cursor);
  const second = await read(first.data.cursor); assert.equal(second.data.rows.length, 20); assert.equal(second.data.cursor, '');
  const rows = first.data.rows.concat(second.data.rows); assert.equal(new Set(rows.map(row => row.id)).size, 70);
  assert.ok(rows.every(row => Object.keys(row).sort().join(',') === 'id,kind,time,title'));
  const oldest = rows.at(-1); assert.equal(oldest.id, 'history-op-0');
  assert.equal((await backend.call({ action: 'restore_operation', operationId: oldest.id }, root.bearer)).status, 200);
  assert.equal((await loadContentState(backend.db)).value.kepuCustom.find(row => row.id === 'history-fixture-0').detail, '旧正文');
  assert.equal((await read(first.data.cursor)).status, 409); assert.equal((await read('malformed')).status, 400);
});

for (const action of ['record', 'export']) test('a delayed ' + action + ' read cannot replace an edit already saved during the request', async t => {
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = [{ id: 'read-race', name: '慢速读取', detail: '旧正文' }];
  const { backend, root } = await setup(t, content), device = setupEnvironment(backend);
  device.store.saveSession(root); await device.store.syncWithCloud();
  const originalFetch = device.sandbox.fetch;
  let release, started, held = false;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { started = resolve; });
  device.sandbox.fetch = async (url, options) => {
    const response = await originalFetch(url, options), params = new URL(url, 'http://localhost').searchParams;
    if (!held && (action === 'record' ? params.get('format') === 'record' : params.get('format') === 'records' && params.get('field') === 'kepuCustom')) {
      held = true; started(); await gate;
    }
    return response;
  };
  const reading = (action === 'record' ? device.store.loadRecord('kepu', 'read-race') : device.store.prepareExport(['kepuCustom']))
    .then(value => ({ value }), error => ({ error }));
  await ready;
  device.store.updateHeritageCard('read-race', { detail: '读取期间已保存的新正文' }, device.store.getEditVersion('kepu', 'read-race'));
  assert.equal(await device.store.flushPending(), true); release();
  const outcome = await reading;
  assert.equal(device.store.getHeritageCards([]).find(row => row.id === 'read-race').detail, '读取期间已保存的新正文');
  assert.ok(outcome.error, 'stale read must be rejected');
  assert.equal((await loadContentState(backend.db)).value.kepuCustom[0].detail, '读取期间已保存的新正文');
});

test('an older merge paused during media hashing cannot move the acknowledged revision backwards', async t => {
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = [{ id: 'merge-race', name: '合并时序', detail: '旧正文' }];
  const { backend, root } = await setup(t, content), device = setupEnvironment(backend);
  device.store.saveSession(root); await device.store.syncWithCloud();
  const schema = device.sandbox.HeritageContent, prepare = schema.prepareMediaBundle;
  let release, started, held = false;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { started = resolve; });
  schema.prepareMediaBundle = async value => {
    await prepare(value);
    if (!held) { held = true; started(); await gate; }
  };
  const reading = device.store.loadRecord('kepu', 'merge-race').then(value => ({ value }), error => ({ error }));
  await ready;
  device.store.updateHeritageCard('merge-race', { detail: '异步合并期间保存的新正文' }, device.store.getEditVersion('kepu', 'merge-race'));
  assert.equal(await device.store.flushPending(), true); const revision = device.store.getSyncStatus().revision;
  release(); const outcome = await reading;
  assert.equal(device.store.getSyncStatus().revision, revision); assert.ok(outcome.error);
  assert.equal(device.store.getHeritageCards([])[0].detail, '异步合并期间保存的新正文');
});
