import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { createMediaBucket } from './helpers/media-r2.mjs';
import { DEFAULTS, updatedContent, restoreOperation } from '../functions/_lib/admin-content.js';
import { migrateRecordStorage, recordsManifest, readRecordState, writeRecordState } from '../functions/_lib/admin-records.js';
import { archiveHistoryBefore, expandArchivedHistory } from '../functions/_lib/admin-history-archive.js';
import { archiveHistoryMedia, expandHistoryMedia, storeRecordMedia, readMedia, mediaResponse } from '../functions/_lib/admin-media.js';

const root = { role: 'super_admin', name: '合成管理员', tokenId: '' }, oldTime = Date.now() - 31 * 86400000;
const operation = i => ({ id: 'archive-op-' + i, key: 'kepuCustom/item-' + i, time: oldTime, before: { detail: '旧正文。'.repeat(1000) },
  afterHash: '0'.repeat(64), remove: ['extra'], undoPatch: true, title: '合成历史 ' + i, kind: '编辑内容', tokenId: 'synthetic-editor', actor: '合成编辑者', ...(i === 1 && { undone: oldTime + 1 }) });
async function setup(t, history = [operation(0)]) {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const bucket = await createMediaBucket(t);
  const content = { ...structuredClone(DEFAULTS), _history: history, _notifications: [] };
  const manifest = await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  return { ...backend, bucket, manifest, content };
}

test('history archives at most sixteen old before-values, preserves every other field, and repeats idempotently', async t => {
  const history = Array.from({ length: 19 }, (_, i) => operation(i));
  history.push({ ...operation(20), time: Date.now() }, { ...operation(21), before: null });
  const { db, bucket, manifest, content } = await setup(t, history);
  await assert.rejects(archiveHistoryBefore(db, manifest, bucket, root, { limit: 17 }), { status: 400 });
  const first = await archiveHistoryBefore(db, manifest, bucket, root);
  assert.equal(first.archived, 16);
  let current = await readRecordState(db, await recordsManifest(db));
  assert.equal(current.value._history.length, history.length); assert.ok(current.bytes < manifest.bytes);
  for (const op of current.value._history) {
    const before = content._history.find(item => item.id === op.id);
    assert.deepEqual({ ...op, before: before.before }, before);
    assert.deepEqual(await expandArchivedHistory(op.before, bucket), before.before);
  }
  const second = await archiveHistoryBefore(db, await recordsManifest(db), bucket, root);
  assert.equal(second.archived, 3);
  const finalManifest = await recordsManifest(db);
  assert.equal((await archiveHistoryBefore(db, finalManifest, bucket, root)).archived, 0);
  assert.deepEqual(await recordsManifest(db), finalManifest);
  assert.equal((await bucket.list({ prefix: 'history/' })).objects.length, 19);
  current = await readRecordState(db, finalManifest);
  assert.deepEqual(current.value._history.find(op => op.id === 'archive-op-20'), history[19]);
  assert.equal(current.value._history.find(op => op.id === 'archive-op-21').before, null);
});

test('a corrupted archive or readback cannot replace any database history', async t => {
  const { db, bucket, manifest } = await setup(t);
  const previous = await readRecordState(db, manifest);
  const corrupt = new Proxy(bucket, { get(target, name) {
    if (name === 'put') return async (key, bytes, options) => {
      await target.put(key, bytes, options);
      return target.put(key, '{"detail":"tampered"}');
    };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(archiveHistoryBefore(db, manifest, corrupt, root), { code: 'HISTORY_ARCHIVE_UNAVAILABLE' });
  assert.deepEqual(await readRecordState(db, await recordsManifest(db)), previous);
  const object = (await bucket.list({ prefix: 'history/' })).objects[0];
  await assert.rejects(expandArchivedHistory({ $history: object.key, sha256: object.key.split('/').at(-1).slice(0, 64) }, bucket), { status: 503 });
});

test('R2 failures, missing configuration and non-super-admin subjects cannot acknowledge archival', async t => {
  const { db, bucket, manifest } = await setup(t);
  await assert.rejects(archiveHistoryBefore(db, manifest, bucket, { role: 'editor' }), { status: 403 });
  await assert.rejects(archiveHistoryBefore(db, manifest, undefined, root), { status: 503 });
  const offline = { async put() { throw new Error('synthetic R2 unavailable'); } };
  await assert.rejects(archiveHistoryBefore(db, manifest, offline, root), /synthetic R2 unavailable/);
  const { rows, ...expectedManifest } = manifest;
  assert.deepEqual(await recordsManifest(db), expectedManifest);
  const ordinary = { detail: '未归档正文' };
  assert.equal(await expandArchivedHistory(ordinary, undefined), ordinary);
  await assert.rejects(expandArchivedHistory({ $history: 'history/missing.json', sha256: '0'.repeat(64) }, undefined), { status: 503 });
});

test('a concurrent record save rejects the archive CAS and preserves both its original history and the colleague save', async t => {
  const { db, bucket, manifest, content } = await setup(t);
  let compete = true;
  const concurrent = new Proxy(bucket, { get(target, name) {
    if (name === 'get') return async (...args) => {
      if (compete) {
        compete = false;
        const previous = await readRecordState(db, manifest, ['kepuCustom/colleague']);
        const next = structuredClone(previous.value); next.kepuCustom.push({ id: 'colleague', name: '同事新内容' });
        await writeRecordState(db, manifest, previous.value, next);
      }
      return target.get(...args);
    };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(archiveHistoryBefore(db, manifest, concurrent, root), { code: 'SYNC_CONFLICT' });
  const current = await readRecordState(db, await recordsManifest(db));
  assert.deepEqual(current.value._history, content._history);
  assert.equal(current.value.kepuCustom[0].name, '同事新内容');
});

test('a failure later in a batch cannot partially archive earlier rows', async t => {
  const { db, bucket, manifest, content } = await setup(t, [operation(0), operation(1)]);
  let writes = 0;
  const interrupted = new Proxy(bucket, { get(target, name) {
    if (name === 'put') return async (...args) => { if (++writes === 2) throw new Error('second object failed'); return target.put(...args); };
    const value = target[name]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(archiveHistoryBefore(db, manifest, interrupted, root), /second object failed/);
  assert.deepEqual((await readRecordState(db, await recordsManifest(db))).value._history, content._history);
});

test('restoring an archived undo patch recovers the original text and image through both archive layers', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const bucket = await createMediaBucket(t), imageBytes = Buffer.from([1, 2, 3, 4, 5]);
  const original = { id: 'restore-archive', name: '保留原文', detail: '原正文\n第二行', imageUrl: 'data:image/png;base64,' + imageBytes.toString('base64') };
  const before = { ...structuredClone(DEFAULTS), kepuCustom: [original] };
  const edited = await updatedContent(before, { ...before, kepuCustom: [{ ...original, detail: '改后正文', imageUrl: '' }] }, root, []);
  const packed = await archiveHistoryMedia(backend.db, edited, 0, bucket);
  packed._history[0].time = oldTime;
  const manifest = await migrateRecordStorage(backend.db, { value: packed, revision: 0 });
  await archiveHistoryBefore(backend.db, manifest, bucket, root);
  const currentManifest = await recordsManifest(backend.db), current = await readRecordState(backend.db, currentManifest);
  const restored = await restoreOperation(current.value, packed._history[0].id, root, [],
    async value => expandHistoryMedia(backend.db, await expandArchivedHistory(value, bucket), bucket),
    value => storeRecordMedia(backend.db, value, new Map(), bucket));
  await writeRecordState(backend.db, currentManifest, current.value, restored.next);
  const saved = (await readRecordState(backend.db, await recordsManifest(backend.db))).value;
  assert.equal(saved.kepuCustom[0].detail, original.detail);
  assert.equal(saved.kepuCustom[0].name, original.name);
  const id = saved.kepuCustom[0].imageUrl.split('/').at(-1);
  const media = await readMedia(backend.db, id, bucket);
  assert.deepEqual(Buffer.from(await mediaResponse(media, new Request('http://localhost')).arrayBuffer()), imageBytes);
  assert.ok(saved._history[0].undone);
});
