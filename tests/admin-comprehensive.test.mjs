import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';

test('AI model changes after a cloud read and offline retry persist both configuration cells', async t => {
  const backend = setup(t), device = setupEnvironment(backend), user = await login(backend);
  device.store.saveSession(user); await device.store.syncWithCloud();
  device.store.setApiOverrides({ model: 'Qwen/Qwen2.5-7B-Instruct', temperature: 0.35, maxTokens: 700 });
  device.store.setWorkflowConfig({ systemPrompt: 'Synthetic workflow' });
  assert.equal(await device.store.flushPending(), true);
  let published = (await backend.call()).data;
  assert.equal(published.apiConfig.model, 'Qwen/Qwen2.5-7B-Instruct'); assert.equal(published.apiConfig.maxTokens, 700);
  assert.equal(published.workflowConfig.systemPrompt, 'Synthetic workflow');
  const request = device.sandbox.fetch; device.sandbox.fetch = async () => { throw new Error('offline'); };
  device.store.setApiOverrides({ temperature: 0.65, maxTokens: 1000 });
  assert.equal(await device.store.flushPending(), false);
  assert.equal((await backend.call()).data.apiConfig.temperature, 0.35);
  device.sandbox.fetch = request; assert.equal(await device.store.flushPending(), true);
  published = (await backend.call()).data;
  assert.equal(published.apiConfig.temperature, 0.65); assert.equal(published.apiConfig.maxTokens, 1000);
  assert.equal(published.workflowConfig.systemPrompt, 'Synthetic workflow');
});

function setup(t) {
  const backend = createAdminBackend({ password: 'SyntheticAdmin2026!' });
  t.after(() => backend.close());
  return backend;
}

async function login(backend, credential = 'SyntheticAdmin2026!', clientId = 'comprehensive-test') {
  const result = await backend.call({ action: 'login', credential, clientId });
  assert.equal(result.status, 200, result.data.error);
  return result.data;
}

async function save(backend, user, patch) {
  const current = (await backend.call(null, user.bearer)).data;
  const { ok, ...bundle } = current;
  return backend.call({ action: 'update_custom_bundle', ...bundle, ...patch, revision: current.revision }, user.bearer);
}

async function invite(backend, root, name) {
  const result = await backend.call({ action: 'create_token', name, days: 30 }, root.bearer);
  assert.equal(result.status, 200);
  return { ...result.data.token, bearer: (await login(backend, result.data.token.token, `editor-${name}`)).bearer };
}

async function device(backend, credential) {
  const value = setupEnvironment(backend);
  const session = await value.store.verifyLogin(credential);
  assert.equal(session.ok, true, session.error);
  value.store.saveSession(session);
  assert.ok(await value.store.syncWithCloud());
  return value;
}

test('invite expiry invalidates both new logins and existing editor sessions', async t => {
  const backend = setup(t), root = await login(backend);
  const unknownAction = await backend.call({ action: 'unknown_synthetic_action' }, root.bearer);
  assert.equal(unknownAction.status, 400);
  assert.equal(unknownAction.data.code, 'UNKNOWN_ACTION');
  const originalNow = Date.now;
  let clock = originalNow();
  try {
    Date.now = () => clock;
    const issued = await backend.call({ action: 'create_token', name: 'expiry-fixture', days: 1 }, root.bearer);
    assert.equal(issued.status, 200);
    const expiration = issued.data.token.expiresAt;
    const extend = await backend.call({ action: 'change_token', id: issued.data.token.id, operation: 'extend', days: 30 }, root.bearer);
    assert.equal(extend.status, 400);
    assert.equal((await backend.call(null, root.bearer)).data.tokens.find(token => token.id === issued.data.token.id).expiresAt, expiration);
    const editor = await login(backend, issued.data.token.token, 'expiry-editor');
    clock += 2 * 24 * 60 * 60 * 1000;
    assert.equal((await backend.call(null, editor.bearer)).status, 401);
    assert.equal((await backend.call({ action: 'login', credential: issued.data.token.token, clientId: 'expired-fresh-device' })).status, 401);
  } finally {
    Date.now = originalNow;
  }
});

test('approval removes custom knowledge, science and dialect entries', async t => {
  const backend = setup(t), root = await login(backend);
  const alice = await invite(backend, root, 'review-alice');
  const bob = await invite(backend, root, 'review-bob');
  const aliceDevice = await device(backend, alice.token);
  const bobDevice = await device(backend, bob.token);
  aliceDevice.store.addEntry({ id: 'review-kb', title: '知识待审', answer: '正文' });
  assert.equal(await aliceDevice.store.flushPending(), true);
  aliceDevice.store.addHeritageCard({ id: 'review-kepu', name: '科普待审' });
  assert.equal(await aliceDevice.store.flushPending(), true);
  aliceDevice.store.addDialectTrack({ id: 'review-dialect', item: { name: '方言待审' } });
  assert.equal(await aliceDevice.store.flushPending(), true);
  bobDevice.store.addHeritageCard({ id: 'bob-review', name: '乙待审' });
  assert.equal(await bobDevice.store.flushPending(), true);
  const rows = (await backend.call(null, root.bearer)).data.contributions;
  assert.deepEqual(rows.filter(item => item.tokenId === alice.id).map(item => `${item.type}/${item.id}`).sort(), ['dialect/review-dialect', 'kb/review-kb', 'kepu/review-kepu']);
  const removed = [];
  for (const [itemType, itemId] of [['kb', 'review-kb'], ['kepu', 'review-kepu'], ['dialect', 'review-dialect']]) {
    const response = await backend.call({ action: 'reject_item', tokenId: alice.id, itemType, itemId, reason: `review-${itemType}` }, root.bearer);
    removed.push({ type: itemType, status: response.status, count: response.data.totalRemoved ?? null });
  }
  assert.deepEqual(removed, [
    { type: 'kb', status: 200, count: 1 },
    { type: 'kepu', status: 200, count: 1 },
    { type: 'dialect', status: 200, count: 1 }
  ]);
  const invalidType = await backend.call({ action: 'reject_item', tokenId: alice.id, itemType: 'unknown', itemId: 'review-kb' }, root.bearer);
  assert.equal(invalidType.status, 400);
  const missingItem = await backend.call({ action: 'reject_item', tokenId: alice.id, itemType: 'kb', itemId: 'not-owned' }, root.bearer);
  assert.equal(missingItem.status, 404);
});

test('read-all notifications marks only the caller’s notices, while super admin can mark all', async t => {
  const backend = setup(t), root = await login(backend);
  const alice = await invite(backend, root, 'notice-alice'), bob = await invite(backend, root, 'notice-bob');
  const aliceDevice = await device(backend, alice.token);
  const bobDevice = await device(backend, bob.token);
  aliceDevice.store.addEntry({ id: 'alice-notice', title: '甲待审', answer: '内容' });
  assert.equal(await aliceDevice.store.flushPending(), true);
  bobDevice.store.addEntry({ id: 'bob-notice', title: '乙待审', answer: '内容' });
  assert.equal(await bobDevice.store.flushPending(), true);
  assert.equal((await backend.call({ action: 'reject_item', tokenId: alice.id, itemType: 'kb', itemId: 'alice-notice' }, root.bearer)).data.totalRemoved, 1);
  assert.equal((await backend.call({ action: 'reject_item', tokenId: bob.id, itemType: 'kb', itemId: 'bob-notice' }, root.bearer)).data.totalRemoved, 1);
  assert.ok((await backend.call(null, alice.bearer)).data.notifications.every(notification => !notification.read));
  assert.ok((await backend.call(null, bob.bearer)).data.notifications.every(notification => !notification.read));
  assert.equal((await backend.call({ action: 'read_notifications' }, alice.bearer)).status, 200);
  assert.ok((await backend.call(null, alice.bearer)).data.notifications.every(notification => notification.read));
  assert.ok((await backend.call(null, bob.bearer)).data.notifications.every(notification => !notification.read));
  assert.equal((await backend.call({ action: 'read_notifications' }, root.bearer)).status, 200);
  assert.ok((await backend.call(null, root.bearer)).data.notifications.every(notification => notification.read));
  assert.ok((await backend.call(null, bob.bearer)).data.notifications.every(notification => notification.read));
});

test('history restore refuses an intervening edit and audit archive leaves recovery history intact', async t => {
  const backend = setup(t), root = await login(backend), editor = await invite(backend, root, 'history-editor');
  assert.equal((await save(backend, editor, { kepuCustom: [{ id: 'history-item', name: '版本 A' }] })).status, 200);
  assert.equal((await save(backend, editor, { kepuCustom: [{ id: 'history-item', name: '版本 B' }] })).status, 200);
  assert.equal((await save(backend, editor, { kepuCustom: [{ id: 'history-item', name: '版本 C' }] })).status, 200);
  let published = (await backend.call(null, root.bearer)).data;
  const latestEdit = published.recovery.find(operation => operation.kind === '编辑内容');
  assert.ok(latestEdit);
  const restored = await backend.call({ action: 'restore_operation', operationId: latestEdit.id }, root.bearer);
  assert.equal(restored.status, 200);
  assert.equal((await backend.call()).data.kepuCustom[0].name, '版本 B');

  const remainingEdit = (await backend.call(null, root.bearer)).data.recovery.find(operation => operation.kind === '编辑内容');
  assert.ok(remainingEdit);
  assert.equal((await save(backend, editor, { kepuCustom: [{ id: 'history-item', name: '后续版本 D' }] })).status, 200);
  const beforeConflict = (await backend.call()).data;
  const conflict = await backend.call({ action: 'restore_operation', operationId: remainingEdit.id }, root.bearer);
  assert.equal(conflict.status, 409);
  const afterConflict = (await backend.call()).data;
  assert.equal(afterConflict.revision, beforeConflict.revision);
  assert.equal(afterConflict.kepuCustom[0].name, '后续版本 D');

  const recoveryBeforeArchive = (await backend.call(null, root.bearer)).data.recovery.map(operation => operation.id).sort();
  assert.ok(recoveryBeforeArchive.length > 0);
  assert.equal((await backend.call({ action: 'clear_audit_logs' }, root.bearer)).status, 200);
  published = (await backend.call(null, root.bearer)).data;
  assert.deepEqual(published.auditLogs.map(log => log.action), ['归档日志']);
  assert.deepEqual(published.recovery.map(operation => operation.id).sort(), recoveryBeforeArchive);
});

test('AI config updates require super admin and Store.resetApi clears both remote settings', async t => {
  const backend = setup(t), root = await login(backend), editor = await invite(backend, root, 'ai-editor');
  assert.equal((await backend.call({ action: 'update_content', changes: [{ key: 'apiConfig', value: { model: 'synthetic/model' } }] }, editor.bearer)).status, 403);
  assert.equal((await save(backend, editor, { workflowConfig: { systemPrompt: 'forbidden synthetic prompt' } })).status, 403);
  assert.equal((await save(backend, root, {
    apiConfig: { model: 'synthetic/model', temperature: 0.65, maxTokens: 500 },
    workflowConfig: { systemPrompt: 'synthetic prompt', strictMode: true, minScore: 0.7, enableThinking: false }
  })).status, 200);
  const device = setupEnvironment(backend);
  const session = await device.store.verifyLogin('SyntheticAdmin2026!');
  assert.equal(session.ok, true);
  device.store.saveSession(session);
  await device.store.syncWithCloud();
  device.store.resetApi();
  assert.equal(await device.store.flushPending(), true);
  const after = (await backend.call(null, root.bearer)).data;
  assert.deepEqual(after.apiConfig, {});
  assert.deepEqual(after.workflowConfig, {});
});

test('unlock_all restores every locked client and a failed invite write is atomic', async t => {
  const backend = setup(t), root = await login(backend);
  const inviteToken = (await backend.call({ action: 'create_token', name: 'atomic-invite', days: 30 }, root.bearer)).data.token;
  const beforeTokens = (await backend.call(null, root.bearer)).data;
  backend.sqlite.exec("CREATE TRIGGER fail_invite_write BEFORE UPDATE ON admin_state WHEN OLD.key = 'tokens' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;");
  const failed = await backend.call({ action: 'change_token', id: inviteToken.id, operation: 'pause' }, root.bearer);
  assert.equal(failed.status, 503);
  const afterTokens = (await backend.call(null, root.bearer)).data;
  assert.equal(afterTokens.tokenRevision, beforeTokens.tokenRevision);
  assert.equal(afterTokens.tokens.find(token => token.id === inviteToken.id).paused, false);
  backend.sqlite.exec('DROP TRIGGER fail_invite_write');

  for (const clientId of ['locked-phone-a', 'locked-phone-b']) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await backend.call({ action: 'login', credential: 'wrong synthetic credential', clientId });
      assert.equal(response.status, attempt === 4 ? 429 : 401);
    }
  }
  const locked = (await backend.call(null, root.bearer)).data.lockouts.filter(item => item.status === 'locked');
  assert.equal(locked.length, 2);
  assert.equal((await backend.call({ action: 'unlock_all' }, root.bearer)).status, 200);
  assert.equal((await backend.call(null, root.bearer)).data.lockouts.filter(item => item.status === 'locked').length, 0);
  assert.equal((await backend.call({ action: 'login', credential: 'SyntheticAdmin2026!', clientId: 'locked-phone-a' })).status, 200);
});
