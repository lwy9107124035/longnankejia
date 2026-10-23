import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { onRequestGet, onRequestPost } from '../functions/api/admin/sync.js';

function setup(t, options) { const backend = createAdminBackend(options); t.after(() => backend.close()); return backend; }
async function login(backend, credential = 'admin123', clientId = 'desktop') {
  return backend.call({ action: 'login', credential, clientId });
}
async function content(backend) {
  const { data } = await backend.call();
  const { ok, ...bundle } = data;
  return { ...bundle, auditLogs: [], action: 'update_custom_bundle' };
}

test('dozens of illustrated cards exceed the former row limit and survive a restart intact', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heritage-batch-'));
  const filename = path.join(dir, 'admin.sqlite');
  const backend = createAdminBackend({ filename });
  const admin = (await login(backend)).data;
  const base = await content(backend);
  const cards = Array.from({ length: 60 }, (_, i) => ({ id: 'batch-' + i, name: '批量科普' + i, detail: '第一段\n第二段😀', imageUrl: 'data:image/jpeg;base64,' + 'a'.repeat(60000) }));
  assert.ok(Buffer.byteLength(JSON.stringify(cards)) > 2000000);
  assert.equal((await backend.call({ ...base, kepuCustom: cards }, admin.bearer)).status, 200);
  const rows = backend.sqlite.prepare("SELECT value FROM admin_state WHERE key GLOB 'content*'").all();
  assert.ok(rows.length > 2);
  assert.ok(rows.every(row => Buffer.byteLength(row.value) < 2000000));
  backend.close();
  const restarted = createAdminBackend({ filename });
  t.after(() => { restarted.close(); fs.rmSync(dir, { recursive: true }); });
  assert.deepEqual((await restarted.call()).data.kepuCustom, cards);
});

test('a failed chunk transaction leaves all previously published content intact', async t => {
  const backend = setup(t); const admin = (await login(backend)).data;
  const base = await content(backend);
  await backend.call({ ...base, kepuCustom: [{ id: 'original', name: '原内容' }] }, admin.bearer);
  const current = await content(backend);
  backend.sqlite.exec("CREATE TRIGGER fail_chunk BEFORE INSERT ON admin_state WHEN NEW.key = 'content:chunk:1' BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  const response = await backend.call({ ...current, kepuCustom: [{ id: 'new', detail: 'a'.repeat(600000) }] }, admin.bearer);
  assert.equal(response.status, 503);
  const after = (await backend.call()).data;
  assert.equal(after.revision, current.revision);
  assert.equal(after.kepuCustom[0].id, 'original');
});

test('unchanged versions use a small response, while a new version returns the complete content', async t => {
  const backend = setup(t); const admin = (await login(backend)).data;
  const current = await content(backend);
  const same = await backend.fetchApi('/api/admin/sync?revision=' + current.revision);
  const data = await same.json();
  assert.equal(data.unchanged, true);
  assert.equal('kepuCustom' in data, false);
  await backend.call({ ...current, kepuCustom: [{ id: 'new', name: '新增' }] }, admin.bearer);
  const changed = await (await backend.fetchApi('/api/admin/sync?revision=' + current.revision)).json();
  assert.equal(changed.unchanged, undefined);
  assert.equal(changed.kepuCustom[0].id, 'new');
});

test('fresh desktop and phone receive independent server sessions; public reads expose no credentials', async t => {
  const backend = setup(t);
  const a = await login(backend);
  const b = await login(backend, 'admin123', 'phone');
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.notEqual(a.data.bearer, b.data.bearer);
  const invite = await backend.call({ action: 'create_token', name: '馆员', days: 7 }, a.data.bearer);
  assert.equal(invite.status, 200);
  const publicData = await backend.call();
  for (const key of ['pwHash', 'password', 'tokens', 'lockouts', 'auditLogs', 'session']) assert.equal(key in publicData.data, false);
  assert.equal(publicData.response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await backend.call(null, a.data.bearer)).data.tokens.length, 1);
});

test('password changes apply to every device and revoke the old default and other admin sessions', async t => {
  const backend = setup(t);
  const a = (await login(backend)).data;
  const b = (await login(backend, 'admin123', 'phone')).data;
  assert.equal((await backend.call({ action: 'update_password', password: 'CaseSensitive2026!' }, a.bearer)).status, 200);
  assert.equal((await login(backend, 'admin123')).status, 401);
  assert.equal((await login(backend, 'casesensitive2026!')).status, 401);
  assert.equal((await login(backend, 'CaseSensitive2026!', 'fresh-phone')).status, 200);
  assert.equal((await backend.call(null, b.bearer)).status, 401);
  assert.equal((await backend.call(null, a.bearer)).status, 200);
  assert.equal((await login(backend, 'admin')).status, 401);
});

test('issued invitations work on a fresh phone; pause, resume, revoke and delete are server enforced', async t => {
  const backend = setup(t);
  const admin = (await login(backend)).data;
  const issued = (await backend.call({ action: 'create_token', name: '张老师', days: 7 }, admin.bearer)).data;
  const token = issued.token;
  const editor = await login(backend, token.token.replace(/-/g, '–').toLowerCase(), 'phone');
  assert.equal(editor.status, 200); assert.equal(editor.data.role, 'editor'); assert.equal(editor.data.name, '张老师');
  assert.equal((await backend.call({ action: 'create_token', name: '伪造', days: 7 }, editor.data.bearer)).status, 403);
  assert.equal((await backend.call({ action: 'update_password', password: 'NotAllowed!' }, editor.data.bearer)).status, 403);
  for (const operation of ['pause', 'resume', 'revoke', 'delete']) {
    assert.equal((await backend.call({ action: 'change_token', operation, id: token.id }, admin.bearer)).status, 200);
    assert.equal((await login(backend, token.token, 'phone-' + operation)).status, operation === 'resume' ? 200 : 401);
    if (operation !== 'resume') assert.equal((await backend.call(null, editor.data.bearer)).status, 401);
  }
  assert.equal((await login(backend, 'NFYJ-INV-ABCDEF')).status, 401);
});

test('unauthenticated writes and foreign origins cannot modify shared state', async t => {
  const backend = setup(t);
  const payload = await content(backend);
  assert.equal((await backend.call(payload)).status, 401);
  assert.equal((await backend.call({ action: 'update_password', pwHash: 'forged' })).status, 401);
  assert.equal((await backend.call({ action: 'login', credential: 'admin123' }, null, { Origin: 'https://evil.example' })).status, 403);
  const response = await backend.fetchApi('/api/admin/sync', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:8931' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8931');
});

test('real SQL compare-and-swap rejects a stale device without overwriting the winner', async t => {
  const backend = setup(t);
  const admin = (await login(backend)).data;
  const base = await content(backend);
  const results = await Promise.all([
    backend.call({ ...base, kbCustom: [{ id: 'a', title: '电脑编辑' }] }, admin.bearer),
    backend.call({ ...base, kbCustom: [{ id: 'b', title: '手机编辑' }] }, admin.bearer)
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = (await backend.call()).data;
  assert.equal(saved.revision, 1); assert.equal(saved.kbCustom.length, 1);
  assert.equal(saved.kbCustom[0].id, results[0].status === 200 ? 'a' : 'b');
});

test('contents, changed password and sessions survive a cold backend restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'longnan-admin-'));
  const filename = path.join(dir, 'admin.sqlite');
  const first = createAdminBackend({ filename });
  const admin = (await login(first)).data;
  await first.call({ action: 'update_password', password: 'Persistent2026!' }, admin.bearer);
  const base = await content(first);
  await first.call({ ...base, dialectCustom: [{ id: 'recording', name: '讲解' }] }, admin.bearer);
  first.close();
  const restarted = createAdminBackend({ filename });
  t.after(() => { restarted.close(); fs.unlinkSync(filename); fs.rmdirSync(dir); });
  assert.equal((await login(restarted, 'Persistent2026!')).status, 200);
  assert.equal((await restarted.call(null, admin.bearer)).status, 200);
  assert.equal((await restarted.call()).data.dialectCustom[0].id, 'recording');
});

test('server lockout persists, affects only the failing client, and can be manually cleared', async t => {
  const backend = setup(t);
  const admin = (await login(backend)).data;
  for (let i = 0; i < 5; i++) assert.equal((await login(backend, 'wrong', 'bad-phone')).status, i === 4 ? 429 : 401);
  assert.equal((await login(backend, 'admin123', 'bad-phone')).status, 429);
  assert.equal((await login(backend, 'admin123', 'good-phone')).status, 200);
  const locks = (await backend.call(null, admin.bearer)).data.lockouts;
  assert.equal(locks.filter(l => l.status === 'locked').length, 1);
  await backend.call({ action: 'unlock', id: locks.find(l => l.status === 'locked').id }, admin.bearer);
  assert.equal((await login(backend, 'admin123', 'bad-phone')).status, 200);
});

test('storage/configuration failures return 503 rather than an empty successful synchronization', async t => {
  const request = () => new Request('https://codex.longnankejia-dev.pages.dev/api/admin/sync');
  const missing = await onRequestGet({ request: request(), env: {} });
  assert.equal(missing.status, 503); assert.equal((await missing.json()).code, 'STORAGE_NOT_CONFIGURED');
  const broken = await onRequestGet({ request: request(), env: { ADMIN_DB: { prepare() { throw new Error('offline'); } } } });
  assert.equal(broken.status, 503); assert.equal((await broken.json()).ok, false);
  const backend = setup(t, { password: '' });
  assert.equal((await login(backend)).data.code, 'ADMIN_NOT_CONFIGURED');
  const invalid = await onRequestPost({ request: new Request(request(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' }), env: backend.env });
  assert.equal(invalid.status, 400);
});

test('logout revokes only that tab session and expired sessions cannot write', async t => {
  const backend = setup(t);
  const a = (await login(backend)).data; const b = (await login(backend, 'admin123', 'phone')).data;
  await backend.call({ action: 'logout' }, a.bearer);
  assert.equal((await backend.call(null, a.bearer)).status, 401);
  assert.equal((await backend.call(null, b.bearer)).status, 200);
  backend.sqlite.prepare('UPDATE admin_sessions SET expires_at = 0').run();
  assert.equal((await backend.call(await content(backend), b.bearer)).status, 401);
});
