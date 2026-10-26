import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { safeContent, applyChanges } from '../functions/_lib/admin-content.js';

async function login(device, credential = 'admin123') {
  const result = await device.store.verifyLogin(credential);
  assert.equal(result.ok, true, result.error);
  device.store.saveSession(result);
  await device.store.syncWithCloud();
}
function setup(t) { const backend = createAdminBackend(); t.after(() => backend.close()); return backend; }

test('one conflicting old draft does not block a new card or hide a colleague’s new records', async t => {
  const backend = setup(t), a = setupEnvironment(backend), b = setupEnvironment(backend);
  await login(a); await login(b);
  const card = a.store.addHeritageCard({ id: 'shared', name: '旧资料', detail: '原文' });
  await a.store.flushPending(); await b.store.syncWithCloud();
  a.store.updateHeritageCard(card.id, { detail: '同事修改' }); await a.store.flushPending();
  b.store.updateHeritageCard(card.id, { detail: '本机未上传' });
  assert.equal(await b.store.flushPending(), false);
  b.store.addHeritageCard({ id: 'new-card', name: '新建矮守围' }); await b.store.flushPending();
  a.store.addHeritageCard({ id: 'colleague', name: '同事新增' }); await a.store.flushPending();
  await b.store.syncWithCloud();
  const server = (await backend.call()).data;
  assert.ok(server.kepuCustom.some(c => c.id === 'new-card'), 'an unrelated conflict must not block a new upload');
  assert.ok(b.store.getHeritageCards([]).some(c => c.id === 'colleague'), 'pending drafts must not block reading colleagues’ content');
  assert.equal(server.kepuCustom.find(c => c.id === 'shared').detail, '同事修改');
  assert.equal(b.store.getHeritageCards([]).find(c => c.id === 'shared').detail, '本机未上传');
  await b.store.syncWithCloud();
  assert.equal((await backend.call()).data.kepuCustom.find(c => c.id === 'shared').detail, '同事修改', 'background retry must not silently overwrite a conflict');
});

test('three devices sharing one invitation can upload independently without whole-library requests', async t => {
  const backend = setup(t), admin = setupEnvironment(backend); await login(admin);
  const invitation = await admin.store.generateInviteToken('老师', 1);
  const devices = [setupEnvironment(backend), setupEnvironment(backend), setupEnvironment(backend)];
  for (const device of devices) await login(device, invitation.token);
  const requests = [];
  for (const device of devices) device.sandbox.fetch = (url, options) => {
    if (options.method === 'POST') requests.push(JSON.parse(options.body));
    return backend.fetchApi(url, options);
  };
  for (let round = 0; round < 5; round++) {
    for (const [i, device] of devices.entries()) device.store.addHeritageCard({ id: `teacher-${i}-${round}`, name: `录入 ${i}-${round}`, detail: '实际正文'.repeat(1000) });
    await Promise.all(devices.map(d => d.store.flushPending()));
  }
  const server = (await backend.call()).data;
  assert.equal(server.kepuCustom.length, 15);
  for (const device of devices) { await device.store.syncWithCloud(); assert.equal(device.store.getHeritageCards([]).length, 15); }
  assert.ok(requests.every(body => body.action !== 'update_custom_bundle'), 'ordinary saving should only send the changed records');
});

test('a temporary HTML gateway response is retried and never described as an undeployed API', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await login(device);
  let failures = 0;
  device.sandbox.fetch = (url, options) => {
    if (failures++ === 0) return Promise.resolve(new Response('<html>temporary gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    return backend.fetchApi(url, options);
  };
  assert.ok(await device.store.syncWithCloud());
  assert.doesNotMatch(device.store.getSyncStatus().message, /未部署/);
});

test('an open form cannot overwrite a colleague’s edit after a background refresh', async t => {
  const backend = setup(t), a = setupEnvironment(backend), b = setupEnvironment(backend);
  await login(a); await login(b);
  a.store.addHeritageCard({ id: 'form-edit', name: '编辑资料', detail: '原文' }); await a.store.flushPending();
  await b.store.syncWithCloud();
  const version = b.store.getEditVersion('kepu', 'form-edit');
  a.store.updateHeritageCard('form-edit', { detail: '同事的新内容' }); await a.store.flushPending();
  await b.store.syncWithCloud();
  b.store.updateHeritageCard('form-edit', { detail: '打开表单时的旧稿' }, version); await b.store.flushPending();
  assert.equal((await backend.call()).data.kepuCustom[0].detail, '同事的新内容');
  assert.equal(b.store.getSyncStatus().conflictCount, 1);
});

test('conflicts survive refresh, can be copied for review, and cannot overwrite the server by retrying', async t => {
  const backend = setup(t), a = setupEnvironment(backend), b = setupEnvironment(backend);
  await login(a); await login(b);
  a.store.addHeritageCard({ id: 'review', name: '需核对', detail: '原文' }); await a.store.flushPending(); await b.store.syncWithCloud();
  a.store.updateHeritageCard('review', { detail: '已发布' }); await a.store.flushPending();
  b.store.updateHeritageCard('review', { detail: '未发布' }); await b.store.flushPending();
  const restored = setupEnvironment(backend, { local: b.local, tab: b.tab }); await restored.store.ready;
  await restored.store.syncWithCloud();
  assert.equal(restored.store.getSyncStatus().conflictCount, 1);
  assert.equal((await backend.call()).data.kepuCustom[0].detail, '已发布');
  await restored.store.resolveConflict('kepuCustom/review', 'copy');
  const cards = (await backend.call()).data.kepuCustom;
  assert.equal(cards.length, 2);
  assert.equal(cards.find(c => c.id === 'review').detail, '已发布');
  assert.equal(cards.find(c => c.id !== 'review').detail, '未发布');
  assert.equal(restored.store.getSyncStatus().pending, false);
});

test('a second edit while the first save is awaiting its response is uploaded without a false conflict', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await login(device);
  device.store.addHeritageCard({ id: 'fast-edit', name: '连续编辑', detail: '原文' }); await device.store.flushPending();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  let first = true;
  device.sandbox.fetch = async (url, options) => {
    const result = await backend.fetchApi(url, options);
    if (options.method === 'POST' && first) { first = false; await new Promise(resolve => { release = resolve; entered(); }); }
    return result;
  };
  device.store.updateHeritageCard('fast-edit', { detail: '第一次修改' }); await started;
  device.store.updateHeritageCard('fast-edit', { detail: '第二次修改' }); release();
  assert.equal(await device.store.flushPending(), true);
  assert.equal((await backend.call()).data.kepuCustom[0].detail, '第二次修改');
});

test('an ambiguous response after commit can be retried without duplicating a new record', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await login(device);
  let first = true;
  device.sandbox.fetch = async (url, options) => {
    const result = await backend.fetchApi(url, options);
    if (options.method === 'POST' && first) { first = false; throw new TypeError('connection closed after commit'); }
    return result;
  };
  device.store.addHeritageCard({ id: 'retry-once', name: '只保存一次' });
  assert.equal(await device.store.flushPending(), true);
  assert.equal((await backend.call()).data.kepuCustom.length, 1);
  assert.equal((await backend.call()).data.revision, 1, 'the retry must not commit the same operation twice');
});

test('a confirmed save returns a small receipt and never echoes large images', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await login(device);
  let responseBytes = 0;
  device.sandbox.fetch = async (url, options) => {
    const result = await backend.fetchApi(url, options);
    if (options.method === 'POST') responseBytes = (await result.clone().text()).length;
    return result;
  };
  device.store.addHeritageCard({ id: 'image-record', name: '已有大图', imageUrl: 'data:image/png;base64,' + 'A'.repeat(500000) });
  assert.equal(await device.store.flushPending(), true);
  assert.ok(responseBytes < 5000, 'saving an image must not echo that image in its acknowledgement');
  device.store.addHeritageCard({ id: 'small-record', name: '纯文字新增' });
  assert.equal(await device.store.flushPending(), true);
  assert.ok(responseBytes < 5000, 'saving one record must not download the unrelated library image');
  assert.equal(device.store.getHeritageCards([]).length, 2);
});

test('reading the cloud keeps an offline snapshot recoverable instead of deleting it', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await login(device);
  device.sandbox.fetch = async () => { throw new Error('offline'); };
  device.store.addHeritageCard({ id: 'archived', name: '应找回' }); await device.store.flushPending();
  device.sandbox.fetch = (...args) => backend.fetchApi(...args);
  await device.store.reloadCloudContent();
  assert.equal(device.store.getHeritageCards([]).length, 0);
  const drafts = await device.store.getRecoveryDrafts(); assert.equal(drafts.length, 1);
  await device.store.restoreRecoveryDraft(drafts[0].id); assert.equal(await device.store.flushPending(), true);
  assert.equal((await backend.call()).data.kepuCustom[0].id, 'archived');
});

test('unsaved form text is recoverable after closing a page and source edits are not cleared by another page', async t => {
  const backend = setup(t), a = setupEnvironment(backend); await login(a);
  const editor = { type: 'kepu', recordId: null, version: null, value: { name: '未点保存', detail: '输入中的正文' } };
  await a.store.saveEditorDraft(editor, 'editor:source');
  const b = setupEnvironment(backend, { local: a.local }); await login(b);
  const drafts = await b.store.getRecoveryDrafts(); assert.equal(drafts[0].editor, true);
  const restored = await b.store.restoreRecoveryDraft(drafts[0].id);
  assert.equal(restored.editor.value.detail, '输入中的正文');
  await a.store.saveEditorDraft({ ...editor, value: { ...editor.value, detail: '原页面后来又输入的正文' } }, 'editor:source');
  await b.store.clearEditorDraft(restored.source, 'editor:another-page');
  const latest = await b.store.restoreRecoveryDraft('editor:source');
  assert.equal(latest.editor.value.detail, '原页面后来又输入的正文');
});

test('the patch API validates every change, forbids editor config changes, and conditions deletion on its previous value', async t => {
  const backend = setup(t), admin = setupEnvironment(backend); await login(admin);
  const invitation = await admin.store.generateInviteToken('老师', 1);
  const user = await admin.store.verifyLogin(invitation.token);
  const schema = globalThis.HeritageContent;
  const add = { key: 'kepuCustom/atomic', baseHash: await schema.cellHash(null), value: { id: 'atomic', name: '保留' } };
  let result = await backend.call({ action: 'update_content', changes: [add, { ...add, key: 'kepuCustom/bad', value: null, baseHash: 'bad' }] }, user.bearer);
  assert.equal(result.status, 400); assert.equal((await backend.call()).data.kepuCustom.length, 0);
  result = await backend.call({ action: 'update_content', changes: [{ key: 'apiConfig', baseHash: await schema.cellHash({}), value: { model: 'unauthorized' } }] }, user.bearer);
  assert.equal(result.status, 403);
  result = await backend.call({ action: 'update_content', changes: [add] }, user.bearer); assert.equal(result.status, 200);
  result = await backend.call({ action: 'update_content', changes: [{ ...add, value: null }] }, user.bearer);
  assert.equal(result.data.conflicts.length, 1); assert.equal((await backend.call()).data.kepuCustom.length, 1);
});

test('server updates keep the previous snapshot immutable while sharing unchanged large image strings', async () => {
  const schema = globalThis.HeritageContent;
  const imageUrl = 'data:image/jpeg;base64,' + 'A'.repeat(700000);
  const current = { ...structuredClone(schema.defaults), kepuCustom: [{ id: 'large-old', name: '原始资料', imageUrl }],
    auditLogs: [], _history: [{ id: 'old-op', key: 'kepuCustom/old-delete', before: { id: 'old-delete', name: '旧记录', imageUrl } }] };
  const before = structuredClone(current), user = { name: '老师', tokenId: 'invite-id', role: 'editor' };
  const result = await applyChanges(current, [{ key: 'kepuCustom/large-old', baseHash: await schema.cellHash(current.kepuCustom[0]), value: { ...current.kepuCustom[0], name: '更新标题' } }], user, []);
  assert.deepEqual(current, before);
  assert.equal(result.next.kepuCustom[0].name, '更新标题');
  assert.equal(safeContent(current, []).kepuCustom[0].imageUrl, imageUrl);
  assert.equal(result.next._history[1].before.name, '原始资料');
  assert.equal(Object.hasOwn(result.next._history[1].before, 'imageUrl'), false);
});
