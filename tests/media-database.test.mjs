import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { loadContentState } from '../functions/api/admin/sync.js';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';
import { expandHistoryMedia } from '../functions/_lib/admin-media.js';

const schema = globalThis.HeritageContent;
const jpeg = fs.readFileSync(new URL('../assets/model-references/hutoumao-211.jpg', import.meta.url));
function picture(note) {
  const data = Buffer.from('synthetic split database ' + note), header = Buffer.from([255,254,0,0]); header.writeUInt16BE(data.length + 2, 2);
  const bytes = Buffer.concat([jpeg.subarray(0,2),header,data,jpeg.subarray(2)]);
  return { bytes, url: 'data:image/jpeg;base64,' + bytes.toString('base64') };
}
async function setup(t) {
  const primary = createAdminBackend(), images = createAdminBackend({ schema: 'media' });
  t.after(() => { primary.close(); images.close(); });
  primary.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const root = (await primary.call({ action: 'login', credential: 'admin123', clientId: 'split-media-root' })).data;
  await migrateRecordStorage(primary.db, await loadContentState(primary.db));
  return { primary, images, root };
}
const mediaRows = db => db.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_state WHERE key LIKE 'media:%'").get().n;

test('new images use the dedicated database while old URLs, binary bodies, HEAD and Range keep working', async t => {
  const { primary, images, root } = await setup(t), old = picture('old'), fresh = picture('fresh');
  const legacy = await primary.call({ action: 'store_media', dataUrl: old.url }, root.bearer);
  assert.equal(legacy.status, 200); const originalRows = mediaRows(primary);
  primary.env.ADMIN_MEDIA_DB = images.db;
  assert.equal((await primary.call({ action: 'store_media', dataUrl: 'data:image/png;base64,AAAA' })).status, 401);
  assert.equal((await primary.call({ action: 'store_media', dataUrl: fresh.url })).status, 413);
  const uploaded = await primary.call({ action: 'store_media', dataUrl: fresh.url }, root.bearer);
  assert.equal(uploaded.status, 200); assert.equal(mediaRows(primary), originalRows); assert.ok(mediaRows(images) > 0);
  for (const [url, expected] of [[legacy.data.url, old.bytes], [uploaded.data.url, fresh.bytes]]) {
    const response = await primary.fetchApi(url); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /immutable/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    const head = await primary.fetchApi(url, { method: 'HEAD' }); assert.equal(Number(head.headers.get('content-length')), expected.length); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const range = await primary.fetchApi(url, { headers: { Range: 'bytes=5-25' } }); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), expected.subarray(5,26));
  }
  const count = mediaRows(images);
  assert.equal((await primary.call({ action: 'store_media', dataUrl: fresh.url }, root.bearer)).data.url, uploaded.data.url);
  assert.equal(mediaRows(images), count);
  assert.equal((await primary.call()).data.capabilities.separateImageDatabase, true);
  assert.equal((await primary.call()).data.capabilities.mediaUploads, false);
  const info = (await primary.call({ action: 'storage_info' }, root.bearer)).data;
  assert.equal(info.separateImageDatabase, true); assert.ok(info.imageDatabaseBytes > 0); assert.ok(info.legacyImageBytes > 0);
  assert.equal(info.mediaBytes, info.imageDatabaseBytes + info.legacyImageBytes);
  assert.deepEqual(images.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name), ['admin_state']);
});

test('record edits, private legacy image expansion and history restoration work across both databases', async t => {
  const { primary, images, root } = await setup(t), old = picture('history-old'), fresh = picture('history-new');
  const legacy = (await primary.call({ action: 'store_media', dataUrl: old.url }, root.bearer)).data;
  primary.env.ADMIN_MEDIA_DB = images.db;
  assert.equal(await expandHistoryMedia(images.db, { $image: legacy.id }, undefined, primary.db), old.url);
  let state = await loadContentState(primary.db);
  const id = 'split-history', key = 'kepuCustom/' + id;
  let saved = await primary.call({ action: 'update_content', changes: [{ key, baseHash: await schema.cellHash(null), value: { id, name: '旧图版本', imageUrl: legacy.url } }] }, root.bearer);
  assert.equal(saved.status, 200);
  state = await loadContentState(primary.db);
  saved = await primary.call({ action: 'update_content', changes: [{ key, baseHash: await schema.cellHash(state.value.kepuCustom[0]), value: { ...state.value.kepuCustom[0], name: '新图版本', imageUrl: fresh.url } }] }, root.bearer);
  assert.equal(saved.status, 200); assert.equal(saved.data.accepted.length, 1);
  state = await loadContentState(primary.db); const changedUrl = state.value.kepuCustom[0].imageUrl;
  assert.deepEqual(Buffer.from(await (await primary.fetchApi(changedUrl)).arrayBuffer()), fresh.bytes);
  const operation = state.value._history.at(-1);
  assert.equal((await primary.call({ action: 'restore_operation', operationId: operation.id }, root.bearer)).status, 200);
  state = await loadContentState(primary.db); assert.equal(state.value.kepuCustom[0].name, '旧图版本'); assert.equal(state.value.kepuCustom[0].imageUrl, legacy.url);
  assert.deepEqual(Buffer.from(await (await primary.fetchApi(legacy.url)).arrayBuffer()), old.bytes);
});

test('a full or unavailable image database keeps the draft, never writes into the content database, and retries safely', async t => {
  const { primary, images, root } = await setup(t), image = picture('quota');
  primary.env.ADMIN_MEDIA_DB = images.db;
  const device = setupEnvironment(primary); device.store.saveSession(root); await device.store.syncWithCloud();
  images.sqlite.exec("CREATE TRIGGER image_quota BEFORE INSERT ON admin_state BEGIN SELECT RAISE(ABORT,'synthetic media quota'); END");
  device.store.addHeritageCard({ id: 'quota-draft', name: '应保留的草稿', imageUrl: image.url });
  assert.equal(await device.store.flushPending(), false); assert.equal(device.store.getHeritageCards([])[0].imageUrl, image.url);
  assert.equal((await loadContentState(primary.db)).value.kepuCustom.length, 0); assert.equal(mediaRows(primary), 0); assert.equal(mediaRows(images), 0);
  images.sqlite.exec('DROP TRIGGER image_quota'); assert.equal(await device.store.flushPending(), true);
  const state = await loadContentState(primary.db); assert.equal(state.value.kepuCustom.length, 1); assert.equal(mediaRows(primary), 0);
  const url = state.value.kepuCustom[0].imageUrl;
  primary.env.ADMIN_MEDIA_DB = { prepare() { throw Error('synthetic image database unavailable'); } };
  assert.equal((await primary.fetchApi(url)).status, 503);
  assert.equal((await primary.call({ action: 'store_media', dataUrl: picture('failed').url }, root.bearer)).status, 503);
  assert.equal(mediaRows(primary), 0);
  primary.env.ADMIN_MEDIA_DB = images.db; assert.deepEqual(Buffer.from(await (await primary.fetchApi(url)).arrayBuffer()), image.bytes);
});
