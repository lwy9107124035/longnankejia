import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';

async function setup(t) {
  const backend = createAdminBackend(); t.after(() => backend.close());
  let now = Date.now(), interval, requests = 0;
  const events = new Map(), document = { visibilityState: 'visible', addEventListener(name, fn) { events.set(name, fn); } };
  class Clock extends Date { static now() { return now; } }
  const device = setupEnvironment(backend, {
    windowProperties: { addEventListener(name, fn) { events.set(name, fn); } },
    globals: { Date: Clock, document, setInterval(fn, ms) { assert.equal(ms, 15000); interval = fn; return 1; },
      fetch(...args) { requests++; return backend.fetchApi(...args); } }
  });
  await device.store.syncWithCloud();
  async function tick(ms = 15000) { now += ms; interval(); await new Promise(resolve => setTimeout(resolve, 10)); }
  return { backend, device, tick, events, document, requests: () => requests };
}

test('anonymous visitors do not poll while idle, while focus and reconnect still refresh immediately', async t => {
  const env = await setup(t), before = env.requests();
  for (let i = 0; i < 7; i++) await env.tick();
  assert.equal(env.requests(), before, 'ordinary visitors must not poll every fifteen seconds');
  await env.tick(24 * 60 * 60000); assert.equal(env.requests(), before);
  env.events.get('focus')(); await env.device.store.syncWithCloud(); assert.equal(env.requests(), before + 1);
  env.events.get('online')(); await env.device.store.syncWithCloud(); assert.equal(env.requests(), before + 2);
});

test('administrator polling remains fifteen seconds, hidden tabs pause, and logged-out sessions use the visitor cadence', async t => {
  const env = await setup(t), user = (await env.backend.call({ action: 'login', credential: 'admin123', clientId: 'polling-test' })).data;
  env.device.store.saveSession(user); await env.device.store.syncWithCloud();
  const before = env.requests();
  for (let i = 0; i < 4; i++) await env.tick();
  assert.equal(env.requests(), before + 4);
  env.document.visibilityState = 'hidden'; await env.tick(120000); assert.equal(env.requests(), before + 4);
  env.document.visibilityState = 'visible'; env.events.get('visibilitychange')(); await env.device.store.syncWithCloud();
  assert.equal(env.requests(), before + 5);
  env.device.store.clearSession(); const afterLogout = env.requests();
  await env.tick(); assert.equal(env.requests(), afterLogout);
});

test('a first public catalog read retries a transient version change instead of waiting for the next poll', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  let calls = 0;
  const device = setupEnvironment(backend, { globals: { fetch: async (...args) => {
    if (++calls === 1) return Response.json({ ok: false, code: 'PAGE_CHANGED', error: '内容已更新，请刷新列表' }, { status: 409 });
    return backend.fetchApi(...args);
  } } });
  const result = await device.store.syncWithCloud();
  assert.ok(result); assert.equal(device.store.getSyncStatus().cloudLoaded, true); assert.equal(calls, 2);
});

test('catalog conflict retries are bounded and leave an unavailable first load explicitly unconfirmed', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close()); let calls = 0;
  const device = setupEnvironment(backend, { globals: { fetch: async () => {
    calls++; return Response.json({ ok: false, code: 'PAGE_CHANGED', error: '内容已更新，请刷新列表' }, { status: 409 });
  } } });
  assert.equal(await device.store.syncWithCloud(), null); assert.equal(calls, 3);
  assert.equal(device.store.getSyncStatus().cloudLoaded, false);
});

test('a revision-bound page cursor is rejected once instead of repeatedly requesting an obsolete page', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  await migrateRecordStorage(backend.db, { value: structuredClone(globalThis.HeritageContent.defaults), revision: 0 });
  const device = setupEnvironment(backend); await device.store.syncWithCloud(); let calls = 0;
  device.sandbox.fetch = async () => { calls++; return Response.json({ ok: false, code: 'PAGE_CHANGED', error: '分页已更新' }, { status: 409 }); };
  await assert.rejects(device.store.loadContentPage('kepuCustom', { cursor: 'old-revision-cursor' }), /分页已更新/);
  assert.equal(calls, 1);
});
