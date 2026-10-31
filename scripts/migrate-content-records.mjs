import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { loadContentState } from '../functions/api/admin/sync.js';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';

export const TARGETS = Object.freeze({
  codex: Object.freeze({ name: 'longnankejia-admin-codex', id: 'f5a18460-1926-4c5f-846e-fbb11d686bd0' }),
  main: Object.freeze({ name: 'longnankejia-admin-main', id: '31744e43-aed6-4440-a551-21c35054b89d' })
});
const schema = globalThis.HeritageContent;
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
const SNAPSHOT_SQL = "SELECT key,value,revision FROM admin_state WHERE key='content' OR key GLOB 'content:chunk:*' OR key IN ('password','tokens') ORDER BY key";

export function parseArgs(args) {
  const options = { apply: false, backupDir: path.join(root, '.cache/content-record-migrations') };
  const names = { local: 'local', target: 'target', 'account-id': 'accountId', 'backup-dir': 'backupDir', 'expect-revision': 'expectedRevision', 'confirm-main': 'confirmMain', 'wrangler-config': 'configPath' };
  const seen = new Set();
  for (const arg of args) {
    if (arg === '--help') { if (args.length !== 1) throw new Error('--help must be used alone'); return { help: true }; }
    if (arg === '--apply') { if (seen.has('apply')) throw new Error('Duplicate --apply'); seen.add('apply'); options.apply = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/.exec(arg), name = match && names[match[1]];
    if (!name || seen.has(name)) throw new Error('Unknown, empty or duplicate command argument');
    seen.add(name); options[name] = match[2];
  }
  if (!!options.local === !!options.target) throw new Error('Select exactly one --local=FILE or --target=codex|main');
  if (options.local && (options.accountId || options.confirmMain || options.configPath)) throw new Error('Remote options cannot be combined with --local');
  if (options.target && !Object.hasOwn(TARGETS, options.target)) throw new Error('Remote target must be codex or main');
  if (options.target && !/^[a-f0-9]{32}$/i.test(options.accountId || '')) throw new Error('Remote target requires --account-id=32_HEX_DIGITS');
  if (options.target === 'main' && options.confirmMain !== TARGETS.main.name) throw new Error('main requires --confirm-main=longnankejia-admin-main');
  if (options.target !== 'main' && options.confirmMain) throw new Error('--confirm-main applies only to main');
  if (options.expectedRevision !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(options.expectedRevision) || !Number.isSafeInteger(Number(options.expectedRevision))) throw new Error('Invalid --expect-revision');
    options.expectedRevision = Number(options.expectedRevision);
  }
  if (options.apply && options.expectedRevision === undefined) throw new Error('--apply requires --expect-revision=N from the reviewed dry run');
  return options;
}

export function createD1Adapter(execute, { readOnly = false } = {}) {
  async function batch(queries) {
    if (readOnly && queries.some(query => !/^\s*SELECT\b/i.test(query.sql))) throw new Error('Dry run cannot execute database mutations');
    return execute(queries);
  }
  return { batch: statements => batch(statements.map(statement => ({ sql: statement.sql, params: statement.params }))),
    prepare(sql) {
      const statement = { sql, params: [], bind(...params) { this.params = params; return this; },
        async first() { return (await batch([{ sql, params: this.params }]))[0].results[0] || null; },
        async all() { return (await batch([{ sql, params: this.params }]))[0]; },
        async run() { return (await batch([{ sql, params: this.params }]))[0]; }
      };
      return statement;
    }
  };
}

export function openLocalDatabase(filename, { apply = false } = {}) {
  if (!fs.statSync(filename).isFile()) throw new Error('Local SQLite input must already exist');
  const sqlite = new DatabaseSync(filename, { readOnly: !apply });
  const db = createD1Adapter(queries => {
    const transactional = queries.length > 1;
    if (transactional) sqlite.exec('BEGIN');
    try {
      const result = queries.map(({ sql, params }) => {
        const statement = sqlite.prepare(sql);
        if (statement.columns().length) return { success: true, results: statement.all(...params), meta: { changes: 0 } };
        const changed = statement.run(...params);
        return { success: true, results: [], meta: { changes: Number(changed.changes) } };
      });
      if (transactional) sqlite.exec('COMMIT');
      return result;
    } catch (error) { if (transactional) sqlite.exec('ROLLBACK'); throw error; }
  }, { readOnly: !apply });
  return { db, close: () => sqlite.close() };
}

// REST contract: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
export function createRestDatabase(request, { apply = false } = {}) {
  return createD1Adapter(async queries => {
    const batch = queries.map(({ sql, params }) => ({ sql, params: params.map(value => {
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error('Unsupported D1 REST migration parameter');
      return String(value);
    }) }));
    const envelope = await request(batch.length === 1 ? batch[0] : { batch });
    if (!envelope.success || !Array.isArray(envelope.result) || envelope.result.length !== batch.length || envelope.result.some(result => result.success !== true)) {
      const codes = (envelope.errors || []).map(error => error.code).filter(Number.isFinite).join(',');
      throw new Error('D1 REST query was not confirmed' + (codes ? ' (codes ' + codes + ')' : ''));
    }
    return envelope.result.map(result => ({ ...result, results: result.results || [] }));
  }, { readOnly: !apply });
}

export function curlConfiguration(url, token, body, method = 'POST') {
  if (!['GET', 'POST'].includes(method)) throw new Error('Unsupported Cloudflare request method');
  return 'silent\nshow-error\nfail-with-body\nmax-time = 60\nurl = ' + JSON.stringify(url) + '\nrequest = ' + JSON.stringify(method) + '\nheader = ' +
    JSON.stringify('Authorization: Bearer ' + token) + (body === undefined ? '\n' : '\nheader = "Content-Type: application/json"\ndata = ' + JSON.stringify(JSON.stringify(body)) + '\n');
}

export function readWranglerToken(options = {}) {
  const configPath = options.configPath || path.join(process.env.APPDATA ? path.join(process.env.APPDATA, 'xdg.config') : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), '.wrangler/config/default.toml');
  const config = fs.readFileSync(configPath, 'utf8'), token = /^oauth_token\s*=\s*"([^"\r\n]+)"/m.exec(config)?.[1];
  if (!token) throw new Error('Wrangler OAuth authorization is unavailable; authenticate Wrangler first');
  return token;
}
export function remoteRequest(options) {
  const token = readWranglerToken(options);
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + options.accountId + '/d1/database/' + TARGETS[options.target].id + '/query';
  return body => new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', length = 0, oversized = false, inputFailed = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { length += Buffer.byteLength(chunk); if (length > 64 * 1024 * 1024) { oversized = true; child.kill(); } else output += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('D1 transport could not start')));
    child.stdin.on('error', () => { inputFailed = true; });
    child.on('close', code => {
      if (oversized) { reject(new Error('D1 response exceeded the local backup limit')); return; }
      if (inputFailed || code !== 0) { reject(new Error('D1 transport did not confirm the request (exit ' + code + '); inspect with a dry run before retrying writes')); return; }
      try { resolve(JSON.parse(output)); } catch { reject(new Error('D1 returned invalid JSON')); }
    });
    // No retry: a failed transport may have lost the acknowledgement of a committed write.
    child.stdin.end(curlConfiguration(url, token, body));
  });
}

function fingerprintCredentials(rows) {
  return Object.fromEntries(['password', 'tokens'].map(key => {
    const row = rows.find(row => row.key === key);
    return [key, row ? { revision: row.revision, sha256: hash(row.value) } : null];
  }));
}

async function snapshot(db) {
  const { results: rows } = await db.prepare(SNAPSHOT_SQL).all();
  const marker = rows.find(row => row.key === 'content');
  if (!marker) throw new Error('The existing content manifest is missing; this tool never initializes a replacement database');
  const current = await loadContentState(db);
  const check = await db.prepare("SELECT value,revision FROM admin_state WHERE key='content'").first();
  if (marker.revision !== current.revision || marker.revision !== check?.revision || marker.value !== check.value) throw new Error('Content changed during backup; no migration started');
  return { current, rows, credentials: fingerprintCredentials(rows) };
}

async function inventory(value) {
  const normalized = { ...value, _history: value._history || [], _notifications: value._notifications || [], auditLogs: value.auditLogs || [] };
  const rows = [...schema.contentCells(normalized)];
  for (const kind of ['_history', '_notifications', 'auditLogs']) for (const item of normalized[kind]) rows.push([kind + '/' + item.id, item]);
  const digests = await Promise.all(rows.map(async ([key, item]) => ({ key, sha256: await schema.cellHash(item, true) })));
  digests.sort((a, b) => a.key.localeCompare(b.key));
  return { sha256: hash(schema.canonical(normalized)), historySha256: hash(schema.canonical(normalized._history)), rows: digests };
}

function guardedMigrationDatabase(db, credentials) {
  return createD1Adapter(async queries => {
    const switching = queries.some(query => /^UPDATE\s+admin_state\b/i.test(query.sql));
    if (switching && (queries.length !== 2 || !/^UPDATE admin_state SET value=\?,revision=revision\+1 WHERE key='content' AND revision=\?$/.test(queries.at(-1).sql)))
      throw new Error('Migration manifest statement changed; review the credential guard before applying');
    const guarded = queries.map(query => {
      if (!switching) return query;
      const params = [...query.params];
      const clauses = ['password', 'tokens'].map(key => {
        const row = credentials.find(row => row.key === key);
        params.push(key);
        if (!row) return 'NOT EXISTS (SELECT 1 FROM admin_state WHERE key=?)';
        params.push(row.value, row.revision);
        return 'EXISTS (SELECT 1 FROM admin_state WHERE key=? AND value=? AND revision=?)';
      });
      return { sql: query.sql + ' AND ' + clauses.join(' AND '), params };
    });
    return db.batch(guarded.map(query => db.prepare(query.sql).bind(...query.params)));
  });
}

function writeNew(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); }

export async function migrateDatabase(db, { apply = false, expectedRevision, backupDir, label = 'local' }) {
  if (apply && expectedRevision === undefined) throw new Error('Applying a migration requires an expected revision');
  const before = await snapshot(db);
  if (expectedRevision !== undefined && before.current.revision !== expectedRevision) throw new Error('Revision differs from --expect-revision; review a fresh dry run');
  const checks = await inventory(before.current.value);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, 'records-' + label + '-rev' + before.current.revision + '-' + Date.now() + '-' + randomUUID() + '.json');
  const storage = JSON.parse(before.rows.find(row => row.key === 'content').value).storage || 'legacy-json';
  writeNew(backupPath, { format: 'content-record-migration-v1', target: label, createdAt: new Date().toISOString(), storage,
    revision: before.current.revision, content: before.current.value, stateRows: before.rows.filter(row => row.key !== 'password' && row.key !== 'tokens'), credentials: before.credentials, checks });
  const result = { ok: true, mode: apply ? 'apply' : 'dry-run', target: label, previousStorage: storage, revision: before.current.revision,
    backupPath, contentSha256: checks.sha256, historySha256: checks.historySha256, rows: checks.rows.length, credentials: before.credentials,
    media: 'unchanged: existing media URLs and D1 media are retained; no R2 resources or media migration' };
  if (!apply || storage === 'records-v1') { result.alreadyMigrated = storage === 'records-v1'; writeNew(backupPath + '.result.json', result); return result; }
  try {
    const fresh = await snapshot(db);
    if (fresh.current.revision !== before.current.revision || fresh.rows.find(row => row.key === 'content').value !== before.rows.find(row => row.key === 'content').value || schema.canonical(fresh.credentials) !== schema.canonical(before.credentials))
      throw new Error('Content or credentials changed after backup; no migration started');
    const statements = ['0002_content_records.sql', '0003_media_uploads.sql'].flatMap(file => fs.readFileSync(path.join(root, 'migrations/admin', file), 'utf8').split(';').map(sql => sql.trim()).filter(Boolean));
    await db.batch(statements.map(sql => db.prepare(sql)));
    const migrated = await migrateRecordStorage(guardedMigrationDatabase(db, before.rows), before.current);
    const after = await snapshot(db), afterChecks = await inventory(after.current.value);
    if (after.current.revision !== migrated.revision || schema.canonical(afterChecks) !== schema.canonical(checks) || schema.canonical(after.credentials) !== schema.canonical(before.credentials))
      throw new Error('Post-migration verification differs; keep the backup and inspect current state without rolling back colleague edits');
    result.revision = migrated.revision; result.generation = migrated.generation; result.verified = true;
    writeNew(backupPath + '.result.json', result); return result;
  } catch (error) {
    writeNew(backupPath + '.result.json', { ok: false, phase: 'apply-or-verification', backupPath, error: error.code || error.name,
      message: 'Migration not confirmed. Preserve this backup and inspect with a dry run before further writes.' });
    throw Object.assign(error, { backupPath });
  }
}

export async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Default is dry-run. Local: --local=FILE --backup-dir=DIR. Remote: --target=codex|main --account-id=HEX32.\nApply only after review: --apply --expect-revision=N. main additionally requires --confirm-main=longnankejia-admin-main.\nRemote uses existing Wrangler OAuth (optional --wrangler-config=FILE); requires D1 Read for dry-run and D1 Edit for apply. Never creates databases, subscriptions or R2 resources.'); return;
  }
  const local = options.local ? openLocalDatabase(path.resolve(options.local), options) : null;
  try {
    const db = local?.db || createRestDatabase(remoteRequest(options), options);
    console.log(JSON.stringify(await migrateDatabase(db, { ...options, label: options.target || 'local', backupDir: path.resolve(options.backupDir) })));
  } finally { local?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {
  console.error('Content migration failed:', error.message, error.backupPath ? '(backup: ' + error.backupPath + ')' : ''); process.exitCode = 1;
});
