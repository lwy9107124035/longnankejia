import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { storeMedia } from '../functions/_lib/admin-media.js';
import { loadContentState } from '../functions/api/admin/sync.js';
import { parseArgs, openLocalDatabase, createRestDatabase, migrateDatabase, curlConfiguration, TARGETS } from '../scripts/migrate-content-records.mjs';

async function setup(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'content-record-migration-')), filename = path.join(folder, 'local.sqlite');
  const closers = [];
  const backend = createAdminBackend({ filename });
  const image = await storeMedia(backend.db, 'data:image/png;base64,AQIDBAU=');
  const content = { ...structuredClone(globalThis.HeritageContent.defaults),
    kepuCustom: [{ id: 'migrate-one', name: '原资料', detail: '原文第一行\n第二行', imageUrl: image.url, creatorTokenId: 'editor-one', creatorName: '合成录入者', createdAt: 123 },
      { id: 'migrate-two', name: '同事资料', detail: '同事正文' }],
    auditLogs: [{ id: 'audit-one', time: 20, action: '保存内容', detail: '合成记录', tokenId: 'editor-one' }],
    _history: [{ id: 'history-one', key: 'kepuCustom/migrate-one', time: 10, before: { detail: '更早原文' }, afterHash: '0'.repeat(64), remove: [], undoPatch: true, kind: '编辑内容', title: '原资料' }],
    _notifications: [{ id: 'notification-one', tokenId: 'editor-one', time: 21, read: false, message: '合成通知' }] };
  const text = JSON.stringify(content), chunks = text.match(/[\s\S]{1,130}/g);
  for (const [index, chunk] of chunks.entries()) backend.sqlite.prepare('INSERT INTO admin_state(key,value,revision) VALUES(?,?,7)').run('content:chunk:' + index, chunk);
  backend.sqlite.prepare("UPDATE admin_state SET value=?,revision=7 WHERE key='content'").run(JSON.stringify({ storage: 'chunks-v1', count: chunks.length }));
  backend.sqlite.prepare("INSERT INTO admin_state(key,value,revision) VALUES('password',?,3)").run('{"hash":"synthetic-password-fingerprint-input","salt":"synthetic"}');
  backend.sqlite.prepare("UPDATE admin_state SET value=?,revision=2 WHERE key='tokens'").run('[{"id":"editor-one","token":"SYNTHETIC-INVITE-NOT-REAL","name":"合成录入者"}]');
  t.after(() => {
    closers.forEach(close => close()); backend.close();
    if (path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('content-record-migration-')) throw new Error('Unexpected cleanup path');
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { ...backend, filename, folder, content, backupDir: path.join(folder, 'backups'), open(options) {
    const local = openLocalDatabase(filename, options); let closed = false;
    const close = () => { if (!closed) { local.close(); closed = true; } }; closers.push(close);
    return { db: local.db, close };
  } };
}
const dbRows = sqlite => sqlite.prepare('SELECT key,value,revision FROM admin_state ORDER BY key').all();

test('default dry run opens read-only SQLite, makes a complete non-overwriting backup and leaves all database bytes unchanged', async t => {
  const fixture = await setup(t), beforeBytes = fs.readFileSync(fixture.filename), before = dbRows(fixture.sqlite);
  const local = fixture.open();
  const first = await migrateDatabase(local.db, { backupDir: fixture.backupDir });
  const second = await migrateDatabase(local.db, { backupDir: fixture.backupDir }); local.close();
  assert.equal(first.mode, 'dry-run'); assert.equal(first.revision, 7); assert.notEqual(first.backupPath, second.backupPath);
  assert.deepEqual(fs.readFileSync(fixture.filename), beforeBytes); assert.deepEqual(dbRows(fixture.sqlite), before);
  assert.equal(fixture.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='admin_content_items'").get(), undefined);
  const raw = fs.readFileSync(first.backupPath, 'utf8'), backup = JSON.parse(raw);
  assert.deepEqual(backup.content, fixture.content); assert.ok(backup.stateRows.some(row => row.key === 'content:chunk:0'));
  assert.ok(backup.credentials.password.sha256); assert.ok(backup.credentials.tokens.sha256);
  assert.equal(raw.includes('synthetic-password-fingerprint-input'), false); assert.equal(raw.includes('SYNTHETIC-INVITE-NOT-REAL'), false);
  assert.throws(() => fs.writeFileSync(first.backupPath, 'replace', { flag: 'wx' }), { code: 'EEXIST' });
});

test('apply preserves content, history, authorship, raw credentials, old chunks and media; repeating it is a no-op', async t => {
  const fixture = await setup(t), original = dbRows(fixture.sqlite), local = fixture.open({ apply: true });
  t.after(() => local.close());
  const result = await migrateDatabase(local.db, { apply: true, expectedRevision: 7, backupDir: fixture.backupDir });
  assert.equal(result.verified, true); assert.equal(result.revision, 8);
  assert.deepEqual((await loadContentState(local.db)).value, fixture.content);
  for (const row of original.filter(row => row.key !== 'content')) assert.deepEqual(fixture.sqlite.prepare('SELECT key,value,revision FROM admin_state WHERE key=?').get(row.key), row);
  assert.ok(fixture.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='admin_media_uploads'").get());
  const itemsBefore = fixture.sqlite.prepare('SELECT * FROM admin_content_items ORDER BY key').all();
  const repeated = await migrateDatabase(local.db, { apply: true, expectedRevision: 8, backupDir: fixture.backupDir });
  assert.equal(repeated.alreadyMigrated, true); assert.equal(repeated.revision, 8);
  assert.deepEqual(fixture.sqlite.prepare('SELECT * FROM admin_content_items ORDER BY key').all(), itemsBefore);
  await assert.rejects(migrateDatabase(local.db, { apply: true, expectedRevision: 7, backupDir: fixture.backupDir }), /Revision differs/);
});

test('a staging SQL failure leaves the legacy manifest and every original chunk intact', async t => {
  const fixture = await setup(t), original = dbRows(fixture.sqlite), local = fixture.open({ apply: true });
  t.after(() => local.close());
  fixture.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  fixture.sqlite.exec("CREATE TRIGGER fail_record_staging BEFORE INSERT ON admin_content_items BEGIN SELECT RAISE(ABORT,'synthetic staging failure'); END");
  await assert.rejects(migrateDatabase(local.db, { apply: true, expectedRevision: 7, backupDir: fixture.backupDir }), /synthetic staging failure/);
  assert.deepEqual(dbRows(fixture.sqlite), original);
  assert.ok(fs.readdirSync(fixture.backupDir).some(file => file.endsWith('.result.json')));
});

test('concurrent content or credential changes reject the final manifest switch without overwriting the newer state', async t => {
  for (const credential of [false, true]) {
    const fixture = await setup(t), local = fixture.open({ apply: true });
    t.after(() => local.close());
    let changed = false;
    const racing = { ...local.db, async batch(statements) {
      if (!changed && statements.some(statement => statement.sql.startsWith('UPDATE admin_state SET value=?,revision=revision+1'))) {
        changed = true;
        if (credential) fixture.sqlite.prepare("UPDATE admin_state SET value=?,revision=revision+1 WHERE key='tokens'").run('[{"id":"new-editor","token":"SYNTHETIC-NEW-TOKEN"}]');
        else fixture.sqlite.prepare("UPDATE admin_state SET revision=revision+1 WHERE key='content'").run();
      }
      return local.db.batch(statements);
    } };
    await assert.rejects(migrateDatabase(racing, { apply: true, expectedRevision: 7, backupDir: fixture.backupDir }), { code: 'SYNC_CONFLICT' });
    assert.equal(JSON.parse(fixture.sqlite.prepare("SELECT value FROM admin_state WHERE key='content'").get().value).storage, 'chunks-v1');
    assert.deepEqual((await loadContentState(local.db)).value, fixture.content);
    if (credential) assert.match(fixture.sqlite.prepare("SELECT value FROM admin_state WHERE key='tokens'").get().value, /new-editor/);
    else assert.equal(fixture.sqlite.prepare("SELECT revision FROM admin_state WHERE key='content'").get().revision, 8);
  }
});

test('documented REST batch and string parameters execute real SQLite migration and a lost commit acknowledgement is not reported as success', async t => {
  const fixture = await setup(t), local = fixture.open({ apply: true }), requests = [];
  t.after(() => local.close());
  let loseConfirmation = true;
  const rest = createRestDatabase(async body => {
    requests.push(body);
    const queries = body.batch || [body];
    const results = await local.db.batch(queries.map(query => local.db.prepare(query.sql).bind(...query.params)));
    if (loseConfirmation && queries.some(query => query.sql.startsWith('UPDATE admin_state SET value=?,revision=revision+1'))) {
      loseConfirmation = false; throw new Error('synthetic lost commit acknowledgement');
    }
    return { success: true, result: results };
  }, { apply: true });
  await assert.rejects(migrateDatabase(rest, { apply: true, expectedRevision: 7, backupDir: fixture.backupDir }), /lost commit acknowledgement/);
  const dry = await migrateDatabase(rest, { backupDir: fixture.backupDir });
  assert.equal(dry.alreadyMigrated, true); assert.equal(dry.revision, 8);
  const repeated = await migrateDatabase(rest, { apply: true, expectedRevision: 8, backupDir: fixture.backupDir });
  assert.equal(repeated.alreadyMigrated, true); assert.deepEqual((await loadContentState(rest)).value, fixture.content);
  assert.ok(requests.some(body => body.batch?.length > 1));
  assert.ok(requests.every(body => (body.batch || [body]).every(query => query.params.every(value => typeof value === 'string'))));
});

test('CLI target whitelist, revision/main markers, dry-run write guard and REST rejection fail closed', async () => {
  const account = 'a'.repeat(32);
  assert.equal(parseArgs(['--local=local.sqlite']).apply, false);
  assert.equal(parseArgs(['--target=codex', '--account-id=' + account]).target, 'codex');
  assert.equal(TARGETS.main.id, '31744e43-aed6-4440-a551-21c35054b89d');
  for (const args of [[], ['--target=preview', '--account-id=' + account], ['--local=x', '--database=arbitrary'], ['--local=x', '--target=codex'], ['--local=x', '--apply'],
    ['--target=main', '--account-id=' + account], ['--local=x', '--expect-revision=01'], ['--local=x', '--local=y'], ['--target=codex', '--account-id=invalid']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['--target=main', '--account-id=' + account, '--confirm-main=longnankejia-admin-main', '--apply', '--expect-revision=245']).apply, true);
  let calls = 0;
  const db = createRestDatabase(async () => { calls++; return { success: false, errors: [{ code: 10000 }] }; });
  await assert.rejects(db.prepare('DELETE FROM admin_state').run(), /Dry run/); assert.equal(calls, 0);
  await assert.rejects(db.prepare('SELECT 1').all(), /10000/);
  const configuration = curlConfiguration('https://api.cloudflare.com/client/v4/test', 'test-token-only-in-stdin', { sql: 'SELECT ?', params: ['test'] });
  assert.match(configuration, /Authorization: Bearer test-token-only-in-stdin/); assert.equal(configuration.includes('retry'), false);
});
