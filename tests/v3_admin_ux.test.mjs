import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createAdminBackend } from './helpers/admin-harness.mjs';

export function setupEnvironment(backend, { local = new Map(), tab = new Map(), blocked = false } = {}) {
  const storage = map => ({
    getItem(key) { if (blocked) throw new Error('Storage denied'); return map.get(key) || null; },
    setItem(key, value) { if (blocked) throw new Error('Storage denied'); map.set(key, String(value)); },
    removeItem(key) { if (blocked) throw new Error('Storage denied'); map.delete(key); }
  });
  const window = { location: new URL('http://127.0.0.1:8931'), KNOWLEDGE_BASE: [{ id: 'base', title: '客家蓝染', answer: '传统工艺' }] };
  const sandbox = { window, localStorage: storage(local), sessionStorage: storage(tab), navigator: { userAgent: 'iPhone Safari' },
    fetch: (...args) => backend.fetchApi(...args), AbortController, setTimeout, clearTimeout, console, Date, Math, JSON, Promise };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'), sandbox);
  return { window, store: window.Store, sandbox, local, tab };
}
function setup(t) { const backend = createAdminBackend(); t.after(() => backend.close()); return backend; }
async function login(device, password = 'admin123') {
  const result = await device.store.verifyLogin(password);
  assert.equal(result.ok, true, result.error);
  device.store.saveSession(result);
  await device.store.syncWithCloud();
  return result;
}

test('fresh phone uses the server despite stale local password/hash/lock; full-width input works', async t => {
  const backend = setup(t);
  const desktop = setupEnvironment(backend);
  await login(desktop);
  await desktop.store.setAdminPassword('Changed2026!');
  const local = new Map([['nfyj_admin_pw', 'obsolete'], ['nfyj_admin_pw_hash', 'invalid'], ['nfyj_login_lock_state', '{"count":5}']]);
  const phone = setupEnvironment(backend, { local });
  assert.equal((await phone.store.verifyLogin('admin123')).ok, false);
  assert.equal((await phone.store.verifyLogin('ｃｈａｎｇｅｄ２０２６！')).ok, false, 'password case must be preserved');
  await login(phone, '\u200BＣｈａｎｇｅｄ２０２６！\u3000');
  assert.equal(local.has('nfyj_admin_pw'), false);
  assert.equal(phone.store.getSession().role, 'super_admin');
});

test('independent tab sessions survive refresh, and restricted mobile storage still permits login', async t => {
  const backend = setup(t);
  const local = new Map(); const a = setupEnvironment(backend, { local });
  await login(a);
  const invite = await a.store.generateInviteToken('文化站', 7);
  const b = setupEnvironment(backend, { local });
  await login(b, invite.token);
  assert.equal(setupEnvironment(backend, { local, tab: a.tab }).store.getSession().role, 'super_admin');
  assert.equal(setupEnvironment(backend, { local, tab: b.tab }).store.getSession().role, 'editor');
  assert.equal(setupEnvironment(backend, { local }).store.getSession(), null);
  const restricted = setupEnvironment(backend, { blocked: true });
  await login(restricted);
  restricted.store.addEntry({ title: '受限浏览器编辑', answer: '仍可同步' });
  assert.equal(await restricted.store.syncWithCloud() !== null, true);
  assert.equal(restricted.store.getEntries().length, 2);
  await a.store.logout();
  assert.equal(a.store.getSession(), null);
  assert.equal((await b.store.syncWithCloud()).session.role, 'editor');
});

test('desktop changes propagate to a fresh phone, including edits and deletion', async t => {
  const backend = setup(t);
  const desktop = setupEnvironment(backend); await login(desktop);
  const entry = desktop.store.addEntry({ title: '关西新围新资料', answer: '核实后的资料' });
  desktop.store.addHeritageCard({ name: '竹编', detail: '地方工艺' });
  desktop.store.addDialectTrack({ item: { name: '方言录音' } });
  assert.ok(await desktop.store.syncWithCloud());
  const phone = setupEnvironment(backend); await login(phone);
  assert.equal(phone.store.getEntries().length, 2);
  assert.equal(phone.store.getHeritageCards([]).length, 1);
  assert.equal(phone.store.getCustomDialectTracks().length, 1);
  desktop.store.updateEntry(entry.id, { answer: '修订后的资料' });
  assert.ok(await desktop.store.syncWithCloud()); await phone.store.syncWithCloud();
  assert.equal(phone.store.getEntries().find(e => e.id === entry.id).answer, '修订后的资料');
  desktop.store.deleteEntry(entry.id); assert.ok(await desktop.store.syncWithCloud());
  await phone.store.syncWithCloud(); assert.equal(phone.store.getEntries().length, 1);
});

test('offline editing stays local with an error and uploads on reconnection', async t => {
  const backend = setup(t);
  const device = setupEnvironment(backend); await login(device);
  device.sandbox.fetch = async () => { throw new Error('offline'); };
  device.store.addEntry({ title: '离线编辑', answer: '保留' });
  assert.equal(await device.store.syncWithCloud(), null);
  assert.equal(device.store.getSyncStatus().status, 'error');
  assert.equal(device.store.getEntries().length, 2);
  device.sandbox.fetch = (...args) => backend.fetchApi(...args);
  assert.ok(await device.store.syncWithCloud());
  assert.equal((await backend.call()).data.kbCustom[0].title, '离线编辑');
});

test('simultaneous edits to the same record preserve the cloud winner and the losing draft', async t => {
  const backend = setup(t);
  const a = setupEnvironment(backend); const b = setupEnvironment(backend);
  await login(a); await login(b);
  const record = a.store.addEntry({ title: '共同条目', answer: '原稿' }); await a.store.syncWithCloud();
  await b.store.syncWithCloud();
  a.store.updateEntry(record.id, { answer: 'A' }); await a.store.syncWithCloud();
  b.store.updateEntry(record.id, { answer: 'B' }); await b.store.syncWithCloud();
  assert.equal(b.store.getSyncStatus().status, 'conflict');
  assert.equal(b.store.getEntries()[1].answer, 'B');
  assert.equal((await backend.call()).data.kbCustom[0].answer, 'A');
  const backup = JSON.parse(b.store.exportFullBundle());
  assert.equal(backup.cloudDraft.kbCustom[0].answer, 'B');
  await b.store.reloadCloudContent(); assert.equal(b.store.getEntries()[1].answer, 'A');
});

test('old local drafts do not prevent visitors reading all published cards and remain recoverable', async t => {
  const backend = setup(t); const editor = setupEnvironment(backend); await login(editor);
  editor.store.addHeritageCard({ id: 'published', name: '云端已发布' }); await editor.store.syncWithCloud();
  const local = new Map([['nfyj_kepu_custom', JSON.stringify([{ id: 'unsent', name: '旧设备未上传' }])]]);
  const visitor = setupEnvironment(backend, { local });
  assert.ok(await visitor.store.syncWithCloud());
  assert.equal(visitor.store.getHeritageCards([]).map(c => c.id).join(','), 'published');
  assert.equal(JSON.parse(visitor.store.exportFullBundle()).cloudDraft.kepuCustom[0].id, 'unsent');
  await login(visitor);
  assert.equal((await backend.call()).data.kepuCustom.map(c => c.id).sort().join(','), 'published,unsent');
});

test('different devices adding different cards merge without losing either upload', async t => {
  const backend = setup(t); const a = setupEnvironment(backend); const b = setupEnvironment(backend);
  await login(a); await login(b);
  a.store.addHeritageCard({ id: 'desktop-card', name: '电脑新增' }); await a.store.syncWithCloud();
  b.store.addHeritageCard({ id: 'phone-card', name: '手机新增' });
  assert.ok(await b.store.syncWithCloud());
  await a.store.syncWithCloud();
  assert.equal(a.store.getHeritageCards([]).map(c => c.id).sort().join(','), 'desktop-card,phone-card');
});

test('a delayed old read cannot replace a newer successful upload', async t => {
  const backend = setup(t); const device = setupEnvironment(backend); await login(device);
  const old = await backend.fetchApi('/api/admin/sync');
  let release;
  device.sandbox.fetch = (url, options = {}) => options.method === 'GET'
    ? new Promise(resolve => { release = () => resolve(old); }) : backend.fetchApi(url, options);
  const pull = device.store.syncWithCloud();
  device.store.addHeritageCard({ id: 'newest', name: '最新保存' });
  assert.equal(await device.store.syncCustomToCloud(), true);
  release(); await pull;
  assert.equal(device.store.getHeritageCards([])[0]?.id, 'newest');
});

test('quota exhaustion does not silently read stale content back over the latest edit', async t => {
  const backend = setup(t); const device = setupEnvironment(backend); await login(device);
  device.sandbox.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  device.store.addHeritageCard({ id: 'quota-card', name: '缓存已满时新增' });
  assert.ok(await device.store.syncWithCloud());
  assert.equal((await backend.call()).data.kepuCustom[0]?.id, 'quota-card');
});

test('HTML endpoint and unavailable storage give service errors without claiming bad credentials', async t => {
  const backend = setup(t); const device = setupEnvironment(backend);
  device.sandbox.fetch = async () => new Response('<html>static fallback</html>', { headers: { 'Content-Type': 'text/html' } });
  assert.equal((await device.store.verifyLogin('admin123')).code, 'ENDPOINT_UNAVAILABLE');
  device.sandbox.fetch = async () => Response.json({ ok: false, code: 'STORAGE_UNAVAILABLE', error: '数据库不可用' }, { status: 503 });
  assert.equal((await device.store.verifyLogin('admin123')).code, 'STORAGE_UNAVAILABLE');
});

test('an expired or revoked invitation clears the local session rather than restoring a signed token locally', async t => {
  const backend = setup(t); const admin = setupEnvironment(backend); await login(admin);
  const token = await admin.store.generateInviteToken('馆员', 1);
  const editor = setupEnvironment(backend); await login(editor, token.token);
  await admin.store.revokeInviteToken(token.id);
  assert.equal(await editor.store.syncWithCloud(), null);
  assert.equal(editor.store.getSession(), null);
});
