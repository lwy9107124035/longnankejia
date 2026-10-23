import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { onRequestPost } from '../functions/api/admin/sync.js';

const content = data => Object.fromEntries(Object.keys(globalThis.HeritageContent.defaults).map(key => [key, data[key]]));
function setup(t) { const backend = createAdminBackend(); t.after(() => backend.close()); return backend; }
async function login(backend, credential = 'admin123') {
  const result = await backend.call({ action: 'login', credential, clientId: 'security-test' });
  assert.equal(result.status, 200); return result.data;
}
async function deviceLogin(device, credential = 'admin123') {
  const result = await device.store.verifyLogin(credential); assert.equal(result.ok, true, result.error);
  device.store.saveSession(result); assert.ok(await device.store.syncWithCloud()); return result;
}
async function save(backend, user, patch, extra = {}) {
  const base = (await backend.call(null, user.bearer)).data;
  return backend.call({ action: 'update_custom_bundle', ...content(base), revision: base.revision, ...patch, ...extra }, user.bearer);
}
async function invite(backend, root, name) {
  const { data } = await backend.call({ action: 'create_token', name, days: 1 }, root.bearer);
  return { token: data.token, user: await login(backend, data.token.token) };
}

test('F04/F06 malformed records and duplicate/reserved IDs are rejected without changing the snapshot', async t => {
  const backend = setup(t), root = await login(backend);
  assert.equal((await save(backend, root, { kepuCustom: [{ id: 'good', name: '原稿' }] })).status, 200);
  const before = (await backend.call()).data;
  const cases = [
    { kepuCustom: [null] }, { kepuCustom: [1] }, { kepuCustom: [[]] }, { kepuCustom: [{ name: '无 ID' }] },
    { kepuCustom: [{ id: 'bad', name: {} }] }, { kepuCustom: [{ id: 'bad', name: '错误', detail: {} }] },
    { kbCustom: [{ id: 'bad', title: '错误', keywords: [null] }] },
    { kbEdited: { base: null } }, { kepuEdited: { a: { id: 'b', name: '映射错位' } } },
    { kepuCustom: [{ id: 'dup', name: '甲' }, { id: 'dup', name: '乙' }] },
    { kepuCustom: [{ id: 'landye', name: '冒充内置' }] },
    { kbCustom: [{ id: 'about-project', title: '冒充内置' }] },
    { kepuCustom: [{ id: 'bad', name: '非法链接', imageUrl: 'javascript:alert(1)' }] },
    { dialectCustom: [{ id: 'bad', item: { name: '非法链接', videoUrl: 'data:text/html,test' } }] },
    { workflowConfig: { systemPrompt: {} } },
    { kepuCustom: [{ id: 'a', name: '甲' }], kepuEdited: { a: { id: 'a', name: '乙' } } },
    { kepuDeleted: ['landye', 'landye'] },
    { kepuCustom: [{ id: 'bad/id', name: '非法 ID' }] },
    { kepuCustom: [{ id: 'style', name: '样本', accent: 'red;position:fixed;inset:0' }] },
    { dialectCustom: [{ id: 'missing-item', name: '缺少播放条目' }] },
    JSON.parse('{"kbEdited":{"__proto__":{"id":"__proto__","title":"非法"}}}')
  ];
  for (const patch of cases) {
    const rejected = await save(backend, root, patch);
    assert.equal(rejected.status, 400, JSON.stringify(patch));
    assert.deepEqual((await backend.call()).data, before);
  }
});

test('F04 historical invalid entries are quarantined for display and retained in export with a visible error', async t => {
  const backend = setup(t);
  const malformed = { ...structuredClone(globalThis.HeritageContent.defaults), kepuCustom: [null, { id: 'valid', name: '正常资料' }] };
  backend.sqlite.prepare("UPDATE admin_state SET value = ? WHERE key = 'content'").run(JSON.stringify(malformed));
  const device = setupEnvironment(backend);
  await device.store.syncWithCloud();
  assert.equal(device.store.getHeritageCards([]).length, 1);
  assert.match(device.store.getSyncStatus().message, /历史数据/);
  assert.equal(JSON.parse(device.store.exportFullBundle()).cloudDraft.kepuCustom[0], null);
});

test('F04/F06 invalid full imports are atomic and builtin KB exports restore without ID collision', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await deviceLogin(device);
  device.store.addHeritageCard({ id: 'original', name: '保留资料' }); await device.store.flushPending();
  const backup = JSON.parse(device.store.exportFullBundle());
  for (const cards of [[null], [{ id: 'dup', name: '甲' }, { id: 'dup', name: '乙' }]]) {
    assert.equal(device.store.importFullBundle(JSON.stringify({ cloudDraft: { ...backup.cloudDraft, kepuCustom: cards } })), false);
    assert.equal(device.store.getHeritageCards([])[0].name, '保留资料');
  }
  assert.equal(device.store.importKB(device.store.exportKB()), true);
  assert.equal(await device.store.flushPending(), true);
  assert.equal((await backend.call()).data.kbCustom.length, 0);
  assert.throws(() => device.store.addHeritageCard({ id: 'original', name: '重复' }), /ID 已存在/);
  assert.equal(device.store.getHeritageCards([]).length, 1);
});

test('F07 server owns provenance and append-only audit; editor cannot rewrite history or config', async t => {
  const backend = setup(t), root = await login(backend), alice = await invite(backend, root, '录入甲');
  const result = await save(backend, alice.user, { kepuCustom: [{ id: 'forged', name: '样本', creatorTokenId: 'someone-else', creatorName: '超级管理员', createdAt: 1 }] }, { auditLogs: [{ id: 'forged-log', actor: '超级管理员' }], _history: [] });
  assert.equal(result.status, 200);
  let actual = (await backend.call(null, root.bearer)).data;
  assert.equal(actual.kepuCustom[0].creatorTokenId, alice.token.id);
  assert.equal(actual.kepuCustom[0].creatorName, '录入甲');
  assert.ok(actual.kepuCustom[0].createdAt > 1);
  assert.ok(actual.auditLogs.every(log => log.id !== 'forged-log'));
  assert.equal(actual.auditLogs[0].actor, '录入甲');
  const logId = actual.auditLogs[0].id;
  assert.equal((await save(backend, alice.user, { kepuCustom: [{ ...actual.kepuCustom[0], name: '更新', creatorTokenId: 'other' }] }, { auditLogs: [] })).status, 200);
  actual = (await backend.call(null, root.bearer)).data;
  assert.equal(actual.kepuCustom[0].creatorTokenId, alice.token.id);
  assert.ok(actual.auditLogs.some(log => log.id === logId));
  assert.deepEqual((await backend.call(null, alice.user.bearer)).data.auditLogs, []);
  assert.equal((await save(backend, alice.user, { workflowConfig: { systemPrompt: '越权' } })).status, 403);
  for (const action of ['rollback_token', 'reject_item', 'clear_audit_logs']) assert.equal((await backend.call({ action, tokenId: alice.token.id }, alice.user.bearer)).status, 403);
  const rolled = await backend.call({ action: 'rollback_token', tokenId: alice.token.id }, root.bearer);
  assert.equal(rolled.data.totalRemoved, 1);
  assert.equal((await backend.call()).data.kepuCustom.length, 0);
  for (const user of [null, root.bearer, alice.user.bearer]) assert.equal('_history' in (await backend.call(null, user)).data, false);
});

test('F05/F10 rejection notifies only its recipient across devices and persists read state without credential leaks', async t => {
  const backend = setup(t), root = await login(backend), alice = await invite(backend, root, '甲'), bob = await invite(backend, root, '乙');
  assert.equal((await save(backend, alice.user, { kbCustom: [{ id: 'notice', title: '待审资料', answer: '正文' }] })).status, 200);
  assert.equal((await backend.call({ action: 'reject_item', tokenId: alice.token.id, itemType: 'kb', itemId: 'notice', reason: '请补充文献来源' }, root.bearer)).data.totalRemoved, 1);
  const unrelated = (await backend.call(null, bob.user.bearer)).data;
  assert.deepEqual(unrelated.notifications, []);
  assert.ok(!JSON.stringify(unrelated).includes(alice.token.token));
  const recipient = setupEnvironment(backend); await deviceLogin(recipient, alice.token.token);
  const notice = recipient.store.getTokenNotifications(alice.token.id)[0];
  assert.equal(notice.reason, '请补充文献来源');
  assert.ok(!JSON.stringify(notice).includes(alice.token.token));
  assert.equal((await backend.call({ action: 'read_notifications', id: notice.id }, bob.user.bearer)).status, 200);
  assert.equal((await backend.call(null, alice.user.bearer)).data.notifications[0].read, false);
  await recipient.store.markTokenNotificationRead(notice.id);
  const secondDevice = setupEnvironment(backend); await deviceLogin(secondDevice, alice.token.token);
  assert.equal(secondDevice.store.getTokenNotifications(alice.token.id).length, 0);
  assert.ok(!JSON.stringify((await backend.call(null, root.bearer)).data.auditLogs).includes(alice.token.token));
});

test('F05 legacy credential-bearing logs are redacted before the next write', async t => {
  const backend = setup(t), root = await login(backend), alice = await invite(backend, root, '历史甲');
  const legacy = { ...structuredClone(globalThis.HeritageContent.defaults), auditLogs: [{ id: 'legacy', actor: '管理员', action: '剔除', time: 1, detail: '凭据 ' + alice.token.token }], kepuCustom: [{ id: 'legacy', name: '历史', creatorTokenId: alice.token.token }] };
  backend.sqlite.prepare("UPDATE admin_state SET value = ? WHERE key = 'content'").run(JSON.stringify(legacy));
  assert.ok(!JSON.stringify((await backend.call()).data).includes(alice.token.token));
  assert.ok(!(await backend.call(null, root.bearer)).data.auditLogs[0].detail.includes(alice.token.token));
});

test('F08 rollback restores builtin edits and deletions in both modules and custom dialect entries', async t => {
  const backend = setup(t), root = setupEnvironment(backend); await deviceLogin(root);
  const token = await root.store.generateInviteToken('回滚测试', 1), editor = setupEnvironment(backend); await deviceLogin(editor, token.token);
  editor.window.KNOWLEDGE_BASE = [{ id: 'base-a', title: '甲', answer: '原稿' }, { id: 'base-b', title: '乙', answer: '原稿' }];
  root.window.KNOWLEDGE_BASE = editor.window.KNOWLEDGE_BASE;
  editor.store.updateEntry('base-a', { answer: '改稿' }); editor.store.deleteEntry('base-b');
  editor.store.updateHeritageCard('landye', { name: '改名', detail: '改稿' }); editor.store.deleteHeritageCard('zhubian');
  editor.store.addDialectTrack({ id: 'dialect-test', item: { name: '新录音' } });
  assert.equal(await editor.store.flushPending(), true); await root.store.syncWithCloud();
  assert.ok(root.store.getTokenDetailedContributions(token.id).items.some(item => item.preview === '删除内置内容'));
  const rolled = await root.store.rollbackTokenChanges(token.id); assert.ok(rolled.totalRemoved >= 5);
  assert.equal(root.store.getEntries().find(e => e.id === 'base-a').answer, '原稿');
  assert.ok(root.store.getEntries().some(e => e.id === 'base-b'));
  const cloud = (await backend.call()).data;
  assert.deepEqual(cloud.kepuEdited, {}); assert.deepEqual(cloud.kepuDeleted, []); assert.deepEqual(cloud.dialectCustom, []);
  assert.equal((await root.store.rollbackTokenChanges(token.id)).totalRemoved, 0);
});

test('F08 rollback preserves later changes from another editor and reports them as skipped', async t => {
  const backend = setup(t), root = await login(backend), alice = await invite(backend, root, '甲'), bob = await invite(backend, root, '乙');
  await save(backend, alice.user, { kepuEdited: { landye: { id: 'landye', name: '甲版本' } } });
  await save(backend, bob.user, { kepuEdited: { landye: { id: 'landye', name: '乙后续版本' } } });
  const result = await backend.call({ action: 'rollback_token', tokenId: alice.token.id }, root.bearer);
  assert.equal(result.data.totalRemoved, 0); assert.equal(result.data.skipped, 1);
  assert.equal((await backend.call()).data.kepuEdited.landye.name, '乙后续版本');
});

test('F03 reload refuses to discard edits made after the request starts', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await deviceLogin(device);
  let entered, release;
  const started = new Promise(resolve => entered = resolve);
  device.sandbox.fetch = async (url, options) => {
    const response = await backend.fetchApi(url, options);
    if (options.method === 'GET') await new Promise(resolve => { release = resolve; entered(); });
    return response;
  };
  const reloading = device.store.reloadCloudContent(); await started;
  device.sandbox.fetch = async () => { throw new Error('offline'); };
  device.store.addHeritageCard({ id: 'after-reload', name: '请求发出后新增' }); await device.store.flushPending();
  release(); await assert.rejects(reloading, /有新的编辑/);
  assert.equal(device.store.getHeritageCards([])[0].id, 'after-reload');
  assert.equal(device.store.getSyncStatus().pending, true);
  assert.equal(JSON.parse(device.store.exportFullBundle()).cloudDraft.kepuCustom[0].id, 'after-reload');
});

test('F03 reload also preserves new edits while waiting for a failing in-flight upload', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await deviceLogin(device);
  let entered, failUpload;
  const started = new Promise(resolve => entered = resolve);
  device.sandbox.fetch = (url, options) => {
    if (options.method === 'POST') return new Promise((resolve, reject) => { failUpload = () => reject(new Error('offline')); entered(); });
    return backend.fetchApi(url, options);
  };
  device.store.addHeritageCard({ id: 'before-reload', name: '原草稿' }); await started;
  const reloading = device.store.reloadCloudContent();
  device.store.addHeritageCard({ id: 'during-wait', name: '等上传时的新草稿' });
  failUpload();
  await assert.rejects(reloading, /有新的编辑/);
  assert.equal(device.store.getHeritageCards([]).length, 2);
  assert.equal(device.store.getSyncStatus().pending, true);
});

test('F09 write-only sessionStorage failure uses the fresh session and logout cannot resurrect old storage', async t => {
  const backend = setup(t), device = setupEnvironment(backend), old = await deviceLogin(device);
  await backend.call({ action: 'logout' }, old.bearer);
  device.sandbox.sessionStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  device.sandbox.sessionStorage.removeItem = () => { throw new Error('QuotaExceededError'); };
  const fresh = await device.store.verifyLogin('admin123'); device.store.saveSession(fresh);
  assert.equal(device.store.getSession().bearer, fresh.bearer);
  assert.ok(await device.store.syncWithCloud());
  device.store.clearSession(); assert.equal(device.store.getSession(), null);
});

test('F11 anonymous chunked body is cancelled early, including dishonest Content-Length', async t => {
  const backend = setup(t);
  for (const headers of [{}, { 'Content-Length': '1' }]) {
    let supplied = 0, cancelled = false;
    const chunk = new Uint8Array(1024);
    const stream = new ReadableStream({ pull(controller) { supplied++; controller.enqueue(chunk); }, cancel() { cancelled = true; } });
    const request = new Request('http://127.0.0.1:8931/api/admin/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: stream, duplex: 'half' });
    const response = await onRequestPost({ request, env: backend.env });
    assert.equal(response.status, 413); assert.equal(cancelled, true); assert.ok(supplied <= 10);
  }
  const root = await login(backend); await backend.call({ action: 'logout' }, root.bearer);
  assert.equal((await backend.call({ action: 'login', credential: 'admin123' }, root.bearer)).status, 200);
});

test('F02 fallback storage keeps same-origin tab drafts independent across refresh and permits recovery', async t => {
  const backend = setup(t), local = new Map(), a = setupEnvironment(backend, { local }), b = setupEnvironment(backend, { local });
  await deviceLogin(a); await deviceLogin(b);
  for (const device of [a, b]) device.sandbox.fetch = async () => { throw new Error('offline'); };
  a.store.addHeritageCard({ id: 'draft-a', name: '甲草稿' }); await a.store.flushPending();
  b.store.addHeritageCard({ id: 'draft-b', name: '乙草稿' }); await b.store.flushPending();
  const refreshed = setupEnvironment(backend, { local, tab: a.tab }); await refreshed.store.ready;
  assert.equal(JSON.parse(refreshed.store.exportFullBundle()).cloudDraft.kepuCustom[0].id, 'draft-a');
  const recovery = await refreshed.store.getRecoveryDrafts(); assert.equal(recovery.length, 1);
  await refreshed.store.restoreRecoveryDraft(recovery[0].id);
  assert.equal(JSON.parse(refreshed.store.exportFullBundle()).cloudDraft.kepuCustom[0].id, 'draft-b');
  assert.ok((await refreshed.store.getRecoveryDrafts()).length >= 1);
});

test('F06 historical duplicate records cannot be silently deleted together', async t => {
  const backend = setup(t);
  const legacy = { ...structuredClone(globalThis.HeritageContent.defaults), kepuCustom: [{ id: 'dup', name: '甲' }, { id: 'dup', name: '乙' }] };
  backend.sqlite.prepare("UPDATE admin_state SET value = ? WHERE key = 'content'").run(JSON.stringify(legacy));
  const device = setupEnvironment(backend); await device.store.syncWithCloud();
  assert.equal(device.store.deleteHeritageCard('dup'), false);
  assert.equal(device.store.updateHeritageCard('dup', { name: '误编辑' }), false);
  assert.match(device.store.getSyncStatus().message, /已停止修改和删除/);
  assert.equal(JSON.parse(device.store.exportFullBundle()).cloudDraft.kepuCustom.length, 2);
  assert.equal((await backend.call()).data.kepuCustom.length, 2);
});

test('F02 changing accounts after a successful upload does not misattribute or block the next draft', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await deviceLogin(device);
  const token = await device.store.generateInviteToken('另一个账号', 1);
  device.store.addHeritageCard({ id: 'root-record', name: '超管录入' }); assert.equal(await device.store.flushPending(), true);
  await deviceLogin(device, token.token);
  device.store.addHeritageCard({ id: 'editor-record', name: '协管录入' }); assert.equal(await device.store.flushPending(), true);
  assert.equal((await backend.call()).data.kepuCustom.find(c => c.id === 'editor-record').creatorTokenId, token.id);
});

test('F08 version history stores only changed fields without copying an unchanged large image', async t => {
  const backend = setup(t), root = await login(backend), alice = await invite(backend, root, '版本测试');
  const imageUrl = 'data:image/jpeg;base64,' + 'a'.repeat(200000);
  await save(backend, alice.user, { kepuCustom: [{ id: 'versioned', name: '版本 0', imageUrl }] });
  for (let i = 1; i <= 5; i++) {
    const record = (await backend.call()).data.kepuCustom[0];
    assert.equal((await save(backend, alice.user, { kepuCustom: [{ ...record, name: '版本 ' + i }] })).status, 200);
  }
  const { results } = await backend.db.prepare("SELECT key, value FROM admin_state WHERE key GLOB 'content:chunk:*' ORDER BY key").all();
  const stored = JSON.parse(results.map(row => row.value).join(''));
  assert.ok(JSON.stringify(stored._history).length < 10000);
  const result = await backend.call({ action: 'rollback_token', tokenId: alice.token.id }, root.bearer);
  assert.equal(result.data.totalRemoved, 1);
  assert.equal((await backend.call()).data.kepuCustom.length, 0);
});

test('F06 reserved IDs match the actual shipped builtin records', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../js/knowledge-base.js', import.meta.url), 'utf8'), { window });
  assert.deepEqual(globalThis.HeritageContent.reserved.kb.slice().sort(), Array.from(window.KNOWLEDGE_BASE, entry => entry.id).sort());
  const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  const cards = ui.slice(ui.indexOf('var CARDS ='), ui.indexOf('function isCustomCard'));
  assert.deepEqual(globalThis.HeritageContent.reserved.kepu.slice().sort(), [...cards.matchAll(/\bid:\s*'([^']+)'/g)].map(match => match[1]).sort());
});

test('early storage restoration can refresh dialect data before its DOM initialization', () => {
  const window = { Diancang: { videoExhibits: () => [] } };
  vm.runInNewContext(fs.readFileSync(new URL('../js/dialect.js', import.meta.url), 'utf8'), { window });
  assert.doesNotThrow(() => window.Dialect.refresh());
});

test('server-authored provenance does not create a false conflict during an in-flight edit and rebase', async t => {
  const backend = setup(t), device = setupEnvironment(backend); await deviceLogin(device);
  let release, entered;
  const started = new Promise(resolve => entered = resolve);
  let first = true;
  device.sandbox.fetch = async (url, options) => {
    const response = await backend.fetchApi(url, options);
    if (options.method === 'POST' && first) {
      first = false;
      await new Promise(resolve => { release = resolve; entered(); });
    }
    return response;
  };
  device.store.addHeritageCard({ id: 'first-record', name: '先上传' }); await started;
  device.store.addHeritageCard({ id: 'second-record', name: '上传时新增' });
  const other = await login(backend);
  const cloud = (await backend.call()).data;
  await save(backend, other, { kepuCustom: [{ ...cloud.kepuCustom[0], name: '另一设备更新先上传的资料' }] });
  release();
  assert.equal(await device.store.flushPending(), true);
  assert.equal(device.store.getSyncStatus().status, 'saved');
  const records = (await backend.call()).data.kepuCustom;
  assert.equal(records.find(c => c.id === 'first-record').name, '另一设备更新先上传的资料');
  assert.ok(records.some(c => c.id === 'second-record'));
});
