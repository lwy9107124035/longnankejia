import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';

const fields = () => Object.keys(globalThis.HeritageContent.defaults);
const bundle = data => Object.fromEntries(fields().map(key => [key, data[key]]));
function setup(t) { const backend = createAdminBackend(); t.after(() => backend.close()); return backend; }
async function login(device, credential = 'admin123') {
  const user = await device.store.verifyLogin(credential);
  assert.equal(user.ok, true, user.error); device.store.saveSession(user); await device.store.syncWithCloud(); return user;
}

test('legacy full-bundle writes cannot transfer provenance through a metadata-only edit', async t => {
  const backend = setup(t), device = setupEnvironment(backend), root = await login(device);
  device.store.addHeritageCard({ id: 'provenance', name: '原始资料' }); await device.store.flushPending();
  const token = await device.store.generateInviteToken('受邀人员', 1);
  const editor = await device.store.verifyLogin(token.token);
  const before = (await backend.call()).data, original = before.kepuCustom[0];
  const result = await backend.call({ action: 'update_custom_bundle', revision: before.revision, ...bundle(before),
    kepuCustom: [{ ...original, creatorName: '伪造创建者', creatorTokenId: token.id, createdAt: 1 }] }, editor.bearer);
  assert.equal(result.status, 200);
  const actual = (await backend.call()).data.kepuCustom[0];
  assert.equal(actual.creatorName, original.creatorName);
  assert.equal(actual.creatorTokenId, original.creatorTokenId);
  assert.equal(actual.createdAt, original.createdAt);
});

for (const type of ['kepu', 'kb']) test(`${type}: a record deleted by a colleague while its form is open remains a local conflict`, async t => {
  const backend = setup(t), a = setupEnvironment(backend), b = setupEnvironment(backend);
  await login(a); await login(b);
  if (type === 'kepu') a.store.addHeritageCard({ id: 'remote-delete', name: '原卡片', detail: '原文' });
  else a.store.addEntry({ id: 'remote-delete', title: '原知识', answer: '原文' });
  await a.store.flushPending(); await b.store.syncWithCloud();
  const version = b.store.getEditVersion(type, 'remote-delete');
  if (type === 'kepu') a.store.deleteHeritageCard('remote-delete'); else a.store.deleteEntry('remote-delete');
  await a.store.flushPending(); await b.store.syncWithCloud();
  if (type === 'kepu') assert.equal(b.store.updateHeritageCard('remote-delete', { detail: '未上传的修改' }, version), true);
  else assert.equal(b.store.updateEntry('remote-delete', { answer: '未上传的修改' }, null, version), true);
  assert.equal(await b.store.flushPending(), false);
  assert.equal(b.store.getSyncStatus().conflictCount, 1);
  assert.equal((await backend.call()).data[type + 'Custom'].length, 0);
  const local = JSON.parse(b.store.exportFullBundle()).cloudDraft[type + 'Custom'];
  assert.equal(local[0][type === 'kepu' ? 'detail' : 'answer'], '未上传的修改');
});

test('a duplicated tab cannot delete the original page’s newer unuploaded snapshot', async t => {
  const backend = setup(t), a = setupEnvironment(backend); await login(a);
  a.sandbox.fetch = async () => { throw new Error('offline'); };
  a.store.addHeritageCard({ id: 'original-one', name: '原页面第一条' }); await a.store.flushPending();
  const b = setupEnvironment(backend, { local: a.local, tab: new Map(a.tab) }); await b.store.ready;
  b.sandbox.fetch = async () => { throw new Error('offline'); };
  a.store.addHeritageCard({ id: 'original-two', name: '原页面后续独有资料' }); await a.store.flushPending();
  b.store.addHeritageCard({ id: 'duplicate-tab', name: '复制标签页的资料' }); await b.store.flushPending();
  const refreshedA = setupEnvironment(backend, { local: a.local, tab: a.tab }); await refreshedA.store.ready;
  assert.ok(refreshedA.store.getHeritageCards([]).some(c => c.id === 'original-two'));
});

test('a delayed save acknowledgement preserves a colleague’s later edit on the next synchronization', async t => {
  const backend = setup(t), a = setupEnvironment(backend), b = setupEnvironment(backend); await login(a); await login(b);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  let first = true;
  a.sandbox.fetch = async (url, options) => {
    const response = await backend.fetchApi(url, options);
    if (options.method === 'POST' && first) { first = false; await new Promise(resolve => { release = resolve; entered(); }); }
    return response;
  };
  a.store.addHeritageCard({ id: 'ack-old', name: '先保存' }); await started;
  await b.store.syncWithCloud(); b.store.updateHeritageCard('ack-old', { detail: '其他设备后续修改' }); await b.store.flushPending();
  release(); await a.store.flushPending(); await a.store.syncWithCloud();
  assert.equal(a.store.getHeritageCards([]).find(c => c.id === 'ack-old').detail, '其他设备后续修改');
  assert.equal(a.store.getSyncStatus().pending, false);
});

test('a delayed expiry response from the previous session cannot sign out a new successful login', async t => {
  const backend = setup(t), device = setupEnvironment(backend), old = await login(device);
  await backend.call({ action: 'logout' }, old.bearer);
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  let first = true;
  device.sandbox.fetch = async (url, options) => {
    const response = await backend.fetchApi(url, options);
    if (options.method === 'GET' && first) { first = false; await new Promise(resolve => { release = resolve; entered(); }); }
    return response;
  };
  const stale = device.store.syncWithCloud(); await started;
  const fresh = await device.store.verifyLogin('admin123'); assert.equal(fresh.ok, true); device.store.saveSession(fresh);
  release(); await stale;
  assert.equal(device.store.getSession()?.bearer, fresh.bearer);
});

test('reaching the server content budget rejects a large image edit without losing the published or local version', async t => {
  const backend = setup(t), device = setupEnvironment(backend), user = await login(device);
  const before = (await backend.call()).data;
  const cards = Array.from({ length: 4 }, (_, i) => ({ id: 'capacity-' + i, name: '容量核验 ' + i, imageUrl: 'data:image/png;base64,' + 'A'.repeat(3900000) }));
  const seeded = await backend.call({ action: 'update_custom_bundle', ...bundle(before), revision: before.revision, kepuCustom: cards }, user.bearer);
  assert.equal(seeded.status, 200);
  await device.store.syncWithCloud();
  const published = (await backend.call()).data;
  device.store.updateHeritageCard('capacity-0', { imageUrl: 'data:image/png;base64,' + 'B'.repeat(3900000) });
  assert.equal(await device.store.flushPending(), false);
  assert.match(device.store.getSyncStatus().message, /容量上限/);
  const after = (await backend.call()).data;
  assert.equal(after.revision, published.revision); assert.equal(after.kepuCustom[0].imageUrl, published.kepuCustom[0].imageUrl);
  const refresh = setupEnvironment(backend, { local: device.local, tab: device.tab }); await refresh.store.ready;
  assert.equal(refresh.store.getHeritageCards([]).find(c => c.id === 'capacity-0').imageUrl.endsWith('BBBB'), true);
});

test('a delayed logout completion cannot clear a later successful login', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await login(device);
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  device.sandbox.fetch = async (url, options) => {
    const response = await backend.fetchApi(url, options);
    if (options.method === 'POST' && JSON.parse(options.body).action === 'logout') await new Promise(resolve => { release = resolve; entered(); });
    return response;
  };
  const oldLogout = device.store.logout(); await started;
  const fresh = await device.store.verifyLogin('admin123'); device.store.saveSession(fresh);
  release(); await oldLogout;
  assert.equal(device.store.getSession()?.bearer, fresh.bearer);
});

test('reading the cloud cannot discard the only in-memory draft when local backup fails', async t => {
  const backend = setup(t), device = setupEnvironment(backend, { blocked: true }); await login(device);
  device.sandbox.fetch = async () => { throw new Error('offline'); };
  device.store.addHeritageCard({ id: 'memory-only', name: '仅在内存中的资料' }); await device.store.flushPending();
  device.sandbox.fetch = (...args) => backend.fetchApi(...args);
  await assert.rejects(device.store.reloadCloudContent(), /备份|草稿/);
  assert.equal(device.store.getHeritageCards([])[0].id, 'memory-only');
  assert.equal(device.store.getSyncStatus().pending, true);
});
