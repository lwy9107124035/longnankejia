import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';

const sampleBytes = fs.readFileSync(new URL('../assets/model-references/hutoumao-211.jpg', import.meta.url));
const image = 'data:image/jpeg;base64,' + sampleBytes.toString('base64');
function setup(t) { const backend = createAdminBackend(); t.after(() => backend.close()); return backend; }
async function login(device, credential = 'admin123') {
  const user = await device.store.verifyLogin(credential); assert.equal(user.ok, true, user.error);
  device.store.saveSession(user); await device.store.syncWithCloud(); return user;
}
const bundle = data => Object.fromEntries(Object.keys(globalThis.HeritageContent.defaults).map(key => [key, data[key]]));

test('authenticated media is immutable, deduplicated, binary-correct and served as an image', async t => {
  const backend = setup(t), device = setupEnvironment(backend), user = await login(device);
  assert.equal((await backend.call({ action: 'store_media', dataUrl: 'data:image/png;base64,AAAA' })).status, 401);
  assert.equal((await backend.call({ action: 'store_media', dataUrl: image })).status, 413);
  const first = await backend.call({ action: 'store_media', dataUrl: image }, user.bearer);
  assert.equal(first.status, 200);
  const count = backend.sqlite.prepare("SELECT count(*) AS n FROM admin_state WHERE key LIKE 'media:%'").get().n;
  assert.equal((await backend.call({ action: 'store_media', dataUrl: image }, user.bearer)).data.url, first.data.url);
  assert.equal(backend.sqlite.prepare("SELECT count(*) AS n FROM admin_state WHERE key LIKE 'media:%'").get().n, count);
  const response = await backend.fetchApi(first.data.url);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.match(response.headers.get('Cache-Control'), /immutable/); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), sampleBytes);
  const head = await backend.fetchApi(first.data.url, { method: 'HEAD' });
  assert.equal(head.headers.get('Content-Length'), String(sampleBytes.length)); assert.equal((await head.text()).length, 0);
  assert.equal((await backend.fetchApi('/api/media/' + '0'.repeat(64))).status, 404);
  for (const dataUrl of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA=A', 'data:image/png;base64,' + 'A'.repeat(5000000)]) {
    assert.equal((await backend.call({ action: 'store_media', dataUrl }, user.bearer)).status, 400);
  }
});

test('a library exceeding 16 MiB in pictures saves, reloads and imports without a whole-library upload', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await login(device);
  for (let i = 0; i < 5; i++) {
    device.store.addHeritageCard({ id: 'large-' + i, name: '大图资料 ' + i, imageUrl: 'data:image/png;base64,' + String.fromCharCode(65 + i).repeat(3900000) });
    assert.equal(await device.store.flushPending(), true);
  }
  const total = backend.sqlite.prepare("SELECT SUM(length(value)) AS bytes FROM admin_state WHERE key LIKE 'media:%'").get().bytes;
  assert.ok(total > 16 * 1024 * 1024);
  const published = (await backend.call()).data;
  assert.equal(published.kepuCustom.length, 5);
  assert.ok(Buffer.byteLength(JSON.stringify(published)) < 5000);
  const phone = setupEnvironment(backend); await phone.store.syncWithCloud();
  assert.equal(phone.store.getHeritageCards([]).length, 5);
  for (const card of published.kepuCustom) assert.equal((await backend.fetchApi(card.imageUrl)).status, 200);
});

test('portable backups embed independent picture bytes and restore into an empty database', async t => {
  const a = setup(t), device = setupEnvironment(a); await login(device);
  device.store.addHeritageCard({ id: 'portable', name: '带图备份', imageUrl: image }); assert.equal(await device.store.flushPending(), true);
  const exported = JSON.parse(await device.store.exportFullBundleWithMedia());
  assert.equal(exported.cloudDraft.kepuCustom[0].imageUrl, image);
  const b = setup(t), imported = setupEnvironment(b); await login(imported);
  assert.equal(imported.store.importFullBundle(JSON.stringify(exported)), true); assert.equal(await imported.store.flushPending(), true);
  const record = (await b.call()).data.kepuCustom[0];
  assert.deepEqual(Buffer.from(await (await b.fetchApi(record.imageUrl)).arrayBuffer()), sampleBytes);
});

test('one deleted item can be recovered with its image without rolling back a colleague’s other work', async t => {
  const backend = setup(t), root = setupEnvironment(backend), rootUser = await login(root);
  const invite = await root.store.generateInviteToken('老师', 1), editor = setupEnvironment(backend); await login(editor, invite.token);
  editor.store.addHeritageCard({ id: 'deleted', name: '误删资料', imageUrl: image }); await editor.store.flushPending();
  editor.store.addHeritageCard({ id: 'untouched', name: '同事正常资料' }); await editor.store.flushPending();
  editor.store.deleteHeritageCard('deleted'); await editor.store.flushPending();
  await root.store.syncWithCloud();
  const operation = root.store.getRecoveryHistory().find(op => op.kind === '删除内容'); assert.ok(operation);
  assert.equal((await backend.call({ action: 'restore_operation', operationId: operation.id }, editor.store.getSession().bearer)).status, 403);
  await root.store.restoreOperation(operation.id);
  const cards = (await backend.call()).data.kepuCustom;
  assert.equal(cards.length, 2); assert.ok(cards.some(card => card.id === 'untouched'));
  const restored = cards.find(card => card.id === 'deleted'); assert.equal(restored.creatorTokenId, invite.id);
  assert.deepEqual(Buffer.from(await (await backend.fetchApi(restored.imageUrl)).arrayBuffer()), sampleBytes);
  assert.equal((await backend.call({ action: 'restore_operation', operationId: operation.id }, rootUser.bearer)).status, 409);
});

test('legacy image history is archived outside metadata and restores byte-for-byte', async t => {
  const backend = setup(t), root = setupEnvironment(backend), user = await login(root);
  const before = (await backend.call()).data;
  await backend.call({ action: 'update_custom_bundle', revision: before.revision, ...bundle(before), kepuCustom: [{ id: 'legacy-picture', name: '旧资料', imageUrl: image, detail: '原文' }] }, user.bearer);
  await root.store.syncWithCloud(); root.store.updateHeritageCard('legacy-picture', { detail: '修订正文' }); await root.store.flushPending();
  await root.store.syncWithCloud();
  const rows = backend.sqlite.prepare("SELECT key,value FROM admin_state WHERE key='content' OR key GLOB 'content:chunk:*'").all();
  const manifest = JSON.parse(rows.find(row => row.key === 'content').value);
  const data = JSON.parse(Array.from({ length: manifest.count }, (_, i) => rows.find(row => row.key === 'content:chunk:' + i).value).join(''));
  assert.match(JSON.stringify(data._history), /\$image/);
  const operation = root.store.getRecoveryHistory().find(op => op.kind === '编辑内容');
  await root.store.restoreOperation(operation.id);
  const restored = (await backend.call()).data.kepuCustom[0];
  assert.deepEqual(Buffer.from(await (await backend.fetchApi(restored.imageUrl)).arrayBuffer()), sampleBytes); assert.equal(restored.detail, '原文');
});

test('restoring an older edit refuses to overwrite a later edit', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await login(device);
  device.store.addHeritageCard({ id: 'later', name: '不覆盖后续修改', detail: '第一版' }); await device.store.flushPending();
  device.store.updateHeritageCard('later', { detail: '第二版' }); await device.store.flushPending(); await device.store.syncWithCloud();
  const operation = device.store.getRecoveryHistory()[0];
  device.store.updateHeritageCard('later', { detail: '第三版' }); await device.store.flushPending();
  await assert.rejects(device.store.restoreOperation(operation.id), /后续修改/);
  assert.equal((await backend.call()).data.kepuCustom[0].detail, '第三版');
});

test('the previous browser hash remains valid after an image is compacted into media storage', async t => {
  const backend = setup(t), device = setupEnvironment(backend), user = await login(device);
  const before = (await backend.call()).data;
  await backend.call({ action: 'update_custom_bundle', revision: before.revision, ...bundle(before), kepuCustom: [{ id: 'old-browser', name: '旧页面兼容', imageUrl: image, detail: '原文' }] }, user.bearer);
  const original = (await backend.call()).data.kepuCustom[0], schema = globalThis.HeritageContent;
  const oldHash = await schema.cellHash(original, true);
  const asset = (await backend.call({ action: 'store_media', dataUrl: image }, user.bearer)).data;
  const compact = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/old-browser', baseHash: await schema.cellHash(original), value: { ...original, imageUrl: asset.url } }] }, user.bearer);
  assert.equal(compact.status, 200);
  assert.equal((await backend.call()).data.kepuCustom[0].imageUrl, asset.url);
  const oldWrite = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/old-browser', baseHash: oldHash, value: { ...original, detail: '旧页面仍能保存' } }] }, user.bearer);
  assert.equal(oldWrite.data.conflicts.length, 0);
  assert.equal((await backend.call()).data.kepuCustom[0].detail, '旧页面仍能保存');
});

test('compacting old pictures reduces metadata without changing text or original authorship', async t => {
  const backend = setup(t), device = setupEnvironment(backend), root = await login(device);
  const invite = await device.store.generateInviteToken('原录入者', 1), editor = setupEnvironment(backend); await login(editor, invite.token);
  assert.equal((await backend.call({ action: 'storage_info' }, editor.store.getSession().bearer)).status, 403);
  const before = (await backend.call()).data;
  await backend.call({ action: 'update_custom_bundle', revision: before.revision, ...bundle(before), kepuCustom: [{ id: 'compact', name: '整理旧图', detail: '原始正文', imageUrl: image }] }, editor.store.getSession().bearer);
  const original = (await backend.call()).data.kepuCustom[0], size = (await device.store.getStorageInfo()).metadataBytes;
  assert.equal((await device.store.optimizeImageStorage()).completed, 1);
  const actual = (await backend.call()).data.kepuCustom[0], info = await device.store.getStorageInfo();
  assert.equal(actual.detail, original.detail); assert.equal(actual.creatorTokenId, invite.id); assert.equal(actual.createdAt, original.createdAt);
  assert.match(actual.imageUrl, /^\/api\/media\//); assert.ok(info.metadataBytes < size / 2); assert.ok(info.mediaBytes > 0);
  assert.equal((await device.store.optimizeImageStorage()).completed, 0);
  assert.equal((await backend.call({ action: 'storage_info' }, root.bearer)).data.metadataLimit, 16 * 1024 * 1024);
});

test('a new edit during asynchronous media hashing cannot be overwritten by a cloud read', async t => {
  const backend = setup(t), device = setupEnvironment(backend), user = await login(device);
  const before = (await backend.call()).data;
  await backend.call({ action: 'update_custom_bundle', revision: before.revision, ...bundle(before), kepuCustom: [{ id: 'remote-image', name: '远端配图', imageUrl: image }] }, user.bearer);
  let entered, release, first = true;
  const started = new Promise(resolve => { entered = resolve; });
  device.sandbox.crypto = { subtle: { async digest(...args) {
    if (first) { first = false; await new Promise(resolve => { release = resolve; entered(); }); }
    return crypto.subtle.digest(...args);
  } } };
  const reading = device.store.syncWithCloud(); await started;
  device.sandbox.fetch = async () => { throw new Error('offline'); };
  device.store.addHeritageCard({ id: 'new-during-hash', name: '读取期间新增' });
  release(); await reading; await device.store.flushPending();
  assert.ok(device.store.getHeritageCards([]).some(card => card.id === 'new-during-hash'));
  assert.equal(device.store.getSyncStatus().pending, true);
  assert.ok(JSON.parse(device.store.exportFullBundle()).cloudDraft.kepuCustom.some(card => card.id === 'new-during-hash'));
});

test('moderation restores an archived picture without putting it back in metadata', async t => {
  const backend = setup(t), root = setupEnvironment(backend), rootUser = await login(root);
  root.store.addHeritageCard({ id: 'moderation-image', name: '原资料', imageUrl: image, detail: '原正文' }); await root.store.flushPending();
  const invite = await root.store.generateInviteToken('编辑者', 1), editor = setupEnvironment(backend); await login(editor, invite.token);
  editor.store.updateHeritageCard('moderation-image', { detail: '改后正文', imageUrl: '' }); await editor.store.flushPending();
  const result = await backend.call({ action: 'rollback_token', tokenId: invite.id }, rootUser.bearer);
  assert.equal(result.status, 200); assert.equal(result.data.totalRemoved, 1);
  const actual = (await backend.call()).data.kepuCustom[0]; assert.equal(actual.detail, '原正文'); assert.match(actual.imageUrl, /^\/api\/media\//);
  assert.deepEqual(Buffer.from(await (await backend.fetchApi(actual.imageUrl)).arrayBuffer()), sampleBytes);
});

test('a confirmed deletion immediately appears in the administrator recovery history', async t => {
  const backend = setup(t), root = setupEnvironment(backend); await login(root);
  root.store.addHeritageCard({ id: 'immediate-history', name: '刚刚误删' }); await root.store.flushPending();
  root.store.deleteHeritageCard('immediate-history'); assert.equal(await root.store.flushPending(), true);
  assert.ok(root.store.getRecoveryHistory().some(op => op.title === '刚刚误删' && op.kind === '删除内容'));
});
