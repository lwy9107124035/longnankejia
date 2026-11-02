import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { getProjectAccount } from '../scripts/_lib/cloudflare-read.mjs';
import { readD1Usage } from '../scripts/d1-usage.mjs';
import { createRestDatabase, remoteRequest, TARGETS } from '../scripts/migrate-content-records.mjs';
import { checkHealth,readDatabaseCapacity } from '../scripts/maintenance-health.mjs';
import '../js/content-schema.js';
import { createLoadPermit, assertLoadPermit, assertProductionReady } from './helpers/load-budget.mjs';
import { aggregateReadLoads, confirmPeakWrites, confirmAfterAckReads, parseControlResponse } from './helpers/read-load-reports.mjs';
import {controlRequest,warmControlConnections} from './helpers/load-control-client.mjs';
import {calibrateLoadClock} from './helpers/load-clock.mjs';
import {githubLoadControl as gh} from './helpers/github-load-control.mjs';
import {retainedRowsFingerprint,verifyRecordAccounting,cleanupSessionIds} from './helpers/load-integrity.mjs';
import {ensureCodexReadReplication} from './helpers/codex-read-replication.mjs';
if (process.argv.length === 2 || process.argv.includes('--help')) { console.log('Usage: node tests/live-codex-load.mjs --run | --probe-saves\n--probe-saves uses four records and no public load; it only diagnoses five parallel saves.\nCodex only. Requires Wrangler OAuth, gh login, a fresh account-wide D1 budget and recovered production with complete backups. Set NODE_USE_ENV_PROXY=1 if required by the network. Persistent fetch is the default; LOAD_CONTROL_TRANSPORT=curl selects cold-connection diagnostics. Uses 188 synthetic records and three temporary sessions; always attempts precise cleanup. Optional CLEANUP_LOAD_PREFIX restricts recovery cleanup to one known test prefix.'); process.exit(0); }
assert.ok(process.argv.length === 3 && ['--run','--probe-saves'].includes(process.argv[2]), 'Only --run, --probe-saves or --help is supported');
const saveProbe = process.argv[2] === '--probe-saves';
const articles=Number(process.env.LOAD_ARTICLES||1);assert.ok([1,3].includes(articles),'LOAD_ARTICLES must be 1 or 3');
const controlTransport = process.env.LOAD_CONTROL_TRANSPORT || 'fetch';
assert.ok(['fetch','curl'].includes(controlTransport), 'Unknown control transport');
const account = await getProjectAccount();
const origin = 'https://codex.longnankejia-dev.pages.dev', schema = globalThis.HeritageContent;
const cleanupOnly = process.env.CLEANUP_LOAD_PREFIX;
if (cleanupOnly) assert.match(cleanupOnly, /^load-fixture-[a-f0-9]{24}$/);
const clock = cleanupOnly ? null : await calibrateLoadClock(origin);
let loadPermit,productionBefore,readReplication;
if (!cleanupOnly) {
  const usage = await readD1Usage(account); fs.mkdirSync('.cache', { recursive: true });
  fs.writeFileSync('.cache/load-budget-check-' + Date.now() + '.json', JSON.stringify(usage, null, 2), { flag: 'wx' });
  loadPermit = createLoadPermit(usage);
  fs.mkdirSync('.cache/maintenance', {recursive:true});
  const production = await checkHealth({ origin:'https://longnankejia.pages.dev', baseline:JSON.parse(fs.readFileSync('docs/production-baseline.json','utf8')),
    snapshotDir:'.cache/maintenance/backups', databaseName:TARGETS.main.id });
  fs.writeFileSync('.cache/maintenance/pre-load-' + Date.now() + '.json', JSON.stringify(production,null,2), {flag:'wx'});
  const notification = fs.existsSync('.cache/maintenance/notification-state.json') ? JSON.parse(fs.readFileSync('.cache/maintenance/notification-state.json','utf8')) : {};
  assertProductionReady(production, notification.pendingDeletionConfirmation || []);
  productionBefore=production;
  assertLoadPermit(loadPermit, 15000);
  if(controlTransport === 'fetch') await warmControlConnections(origin);
  if(!saveProbe)readReplication=await ensureCodexReadReplication(account,loadPermit);
}
const prefix = cleanupOnly || 'load-fixture-' + randomBytes(12).toString('hex');
const actorBearers = Array.from({ length: cleanupOnly ? 1 : 3 }, () => randomBytes(32).toString('hex')), bearer = actorBearers[0];
const sessionIds = actorBearers.map(value => createHash('sha256').update(value).digest('hex')), sessionId = sessionIds[0];
const cleanupLedgers=cleanupOnly?fs.readdirSync('.cache').filter(file=>file==='load-control-'+prefix+'.json'||file.startsWith('load-cleanup-')&&file.endsWith('-'+prefix+'.json'))
  .map(file=>JSON.parse(fs.readFileSync('.cache/'+file,'utf8'))):[];
const sessionsToRemove=cleanupSessionIds(prefix,sessionIds,cleanupLedgers);
const transport = remoteRequest({ target: 'codex', accountId: account });
let authorizationRefreshed=false;
const db = createRestDatabase(async body => {
  const readOnly = (body.batch || [body]).every(statement => /^SELECT\b/i.test(statement.sql));
  for (let attempt = 0; ; attempt++) {
    try { return await transport(body); }
    catch (error) {
      if(!readOnly)throw error;
      if(/codes (?:\d+,)*9109(?:,\d+)*/.test(error.message)) {
        if(authorizationRefreshed)throw error;
        authorizationRefreshed=true;await readDatabaseCapacity(TARGETS.codex.id);continue;
      }
      if(attempt>=2)throw error;await sleep(1000);
    }
  }
}, { apply: true });
const result = { startedAt: new Date().toISOString(), prefix, mainWritten: false, controlTransport, articles, mode: saveProbe ? 'isolated-save-probe' : 'distributed-load', cleanup: false, phases: [], sessionHashes: sessionsToRemove };
if(readReplication)result.readReplication=readReplication;
if(clock) result.clockCalibration = clock.report;
const stateFile = '.cache/' + (cleanupOnly ? 'load-cleanup-' + Date.now() + '-' : 'load-control-') + prefix + '.json';
const ids = Array.from({ length: saveProbe ? 4 : 188 }, (_, i) => prefix + '-' + String(i).padStart(3, '0'));
const value = (id, i) => ({ id, name: '合成并发验收' + i + ' ' + prefix, category: 'craft', detail: ('这是独立测试资料，不能作为文化资料引用。' + i + '\n').repeat(130),
  imageUrl: i % 2 ? '/api/media/a5de70330e575fa03c530091f07430a2d959b70aa3df14b8804e7a3c4e2c5a6a' : '/api/media/a80e375c338e604e10af745832bcd141b155c762adf56fefe58799175a372825' });
fs.mkdirSync('.cache', { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify({ prefix, ids, sessionHash: sessionId, sessionHashes: sessionsToRemove, createdAt: result.startedAt }, null, 2), { flag: 'wx' });
async function app(body, query = 'format=pages', auth = true, attempt = 0) {
  try {
  const url = origin + '/api/admin/sync' + (body ? '' : '?' + query);
  let parsed;
  if (controlTransport === 'fetch') {
    parsed = await controlRequest(url,{body,headers:{'Cache-Control':'no-cache',...(auth && {Authorization:'Bearer '+(typeof auth==='string'?auth:bearer)})}});
  } else {
  let input = 'silent\nshow-error\nmax-time = 30\nurl = ' + JSON.stringify(url) + '\nwrite-out = "\\n%{http_code}\\n%{time_total}\\n%header{server-timing}"\nheader = "Cache-Control: no-cache"\n';
  if (auth) input += 'header = ' + JSON.stringify('Authorization: Bearer ' + (typeof auth === 'string' ? auth : bearer)) + '\n';
  if (body) input += 'request = "POST"\nheader = "Content-Type: application/json"\ndata = ' + JSON.stringify(JSON.stringify(body)) + '\n';
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); let output = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk; }); child.stderr.resume();
    child.on('error', () => reject(Error('Control transport could not start')));
    child.on('close', code => code === 0 ? resolve(output) : reject(Error('Control transport did not confirm request: ' + code)));
    child.stdin.end(input);
  });
  parsed = parseControlResponse(raw);
  }
  assert.equal(parsed.status, 200, parsed.data.code);
  return { ...parsed.data, ...(body && { testTiming:parsed.timing }) };
  } catch (error) {
    if (body || attempt >= 2) throw error;
    await sleep(1000); return app(body, query, auth, attempt + 1);
  }
}
async function write(changes, actor = bearer) {
  const body = { action: 'update_content', ackFormat: 'compact-v1', hashFormat: 'media-identity-v1', operationId: randomBytes(32).toString('hex'), changes };
  for (let attempt = 0; ; attempt++) {
    try { return { ...await app(body, 'format=pages', actor), testOperationId: body.operationId }; }
    catch (error) {
      const receipt = await db.prepare('SELECT owner,request_hash,value FROM admin_content_receipts WHERE id=?').bind(body.operationId).first();
      if (receipt) {
        assert.equal(receipt.owner, 'super_admin'); assert.equal(receipt.request_hash, createHash('sha256').update(JSON.stringify(changes)).digest('hex'));
        result.recoveredAcknowledgements = (result.recoveredAcknowledgements || 0) + 1;
        return { ...JSON.parse(receipt.value), testOperationId: body.operationId };
      }
      if (!/Control transport did not confirm request/.test(error.message) || attempt >= 2) throw error;
      const marker = await db.prepare("SELECT value FROM admin_state WHERE key='content'").first();
      const generation = JSON.parse(marker.value).generation;
      const current = await db.prepare('SELECT key,digest FROM admin_content_items WHERE generation=? AND key IN (' + changes.map(() => '?').join(',') + ')').bind(generation, ...changes.map(change => change.key)).all();
      const hashes = new Map(current.results.map(row => [row.key, row.digest])), emptyHash = await schema.cellHash(null);
      assert.ok(changes.every(change => (hashes.get(change.key) || emptyHash) === change.baseHash), 'Transport failed and record state changed; do not replay blindly');
      await sleep(1000);
      // The receipt is absent and the base state is unchanged; replay the same durable operation ID.
    }
  }
}
async function rows() {
  let cursor = ''; const rows = [];
  do { const page = await app(null, 'format=records&field=kepuCustom&cursor=' + encodeURIComponent(cursor)); rows.push(...page.rows); cursor = page.cursor; } while (cursor);
  return rows;
}
const credentialsHash = async () => createHash('sha256').update(JSON.stringify((await db.prepare("SELECT key,value,revision FROM admin_state WHERE key IN ('password','tokens') ORDER BY key").all()).results)).digest('hex');
async function saveThreeSessions(initial) {
  const window = { startedAt: new Date(clock.earliest()).toISOString(), nominalStartedAt:new Date(clock.now()).toISOString() };
  const outcomes = await Promise.allSettled(ids.slice(0, 3).map((id, i) => {
    const row = initial.get('kepuCustom/' + id);
    return write([{ key: row.key, baseHash: row.hash, value: { ...row.value, tag: '三会话峰值写入' } }], actorBearers[i]);
  }).concat(['甲', '乙'].map((tag, i) => {
    const row = initial.get('kepuCustom/' + ids[3]);
    return write([{ key: row.key, baseHash: row.hash, value: { ...row.value, tag } }], actorBearers[i + 1]);
  })));
  for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  const saved = outcomes.map(outcome => outcome.value);
  assert.ok(saved.slice(0, 3).every(reply => reply.accepted.length === 1));
  assert.equal(saved.slice(3).reduce((sum, reply) => sum + reply.accepted.length, 0), 1);
  assert.equal(saved.slice(3).reduce((sum, reply) => sum + reply.conflicts.length, 0), 1);
  window.finishedAt = new Date(clock.latest()).toISOString(); window.nominalFinishedAt=new Date(clock.now()).toISOString(); Object.assign(window, { timings:saved.map(reply=>reply.testTiming || {recovered:true}), revisions:saved.map(reply=>reply.revision),accepted: 3, actors: 3, operationIds: saved.slice(0, 3).map(reply => reply.testOperationId), sameRecordAccepted: 1, sameRecordConflict: 1 });
  return window;
}
async function remoteLoad(revision, initial) {
  const scheduled = clock.now() + 120000, startAt = new Date(scheduled).toISOString();
  let dispatched = '', dispatchError;
  try { dispatched = await gh(['workflow', 'run', 'cf-pages.yml', '--repo', 'lwy9107124035/longnankejia', '--ref', 'codex', '-f', 'mode=read-distributed', '-f', 'load_prefix=' + prefix, '-f', 'load_revision=' + revision, '-f', 'load_start=' + startAt, '-f', 'load_articles='+articles,'-f', 'load_budget=' + JSON.stringify(loadPermit)]); }
  catch (error) { dispatchError = error.message; }
  const foundId = dispatched.match(/actions\/runs\/(\d+)/)?.[1];
  let run = foundId ? { databaseId: Number(foundId), url: 'https://github.com/lwy9107124035/longnankejia/actions/runs/' + foundId } : null;
  for (let i = 0; i < 5 && !run; i++) {
    await sleep(3000);
    run = JSON.parse(await gh(['run', 'list', '--repo', 'lwy9107124035/longnankejia', '--workflow', 'cf-pages.yml', '--branch', 'codex', '--event', 'workflow_dispatch', '--limit', '5', '--json', 'databaseId,displayTitle,status,url'])).find(item => item.displayTitle.includes(prefix));
  }
  assert.ok(run, dispatchError || 'dispatched read-load workflow not found'); result.remoteRunId = run.databaseId; result.remoteRunUrl = run.url;
  result.coordinatedStart = startAt;
  console.log('Four-generator load started: ' + run.databaseId + '; peak ' + startAt); const writes = []; let lastStatus = 0, warmed = false;
  while (clock.now() < scheduled + 6 * 60000) {
    const now = clock.now(), remaining = scheduled + 400 - now;
    if (controlTransport === 'fetch' && !warmed && remaining > 0 && remaining <= 3500) {
      const startedAt = new Date().toISOString(); await warmControlConnections(origin); warmed = true;
      result.controlWarmup = {startedAt,finishedAt:new Date().toISOString(),staticRequests:5}; continue;
    }
    if (!writes.length && remaining <= 0) {
      assert.ok(controlTransport !== 'fetch' || warmed, 'Control client missed the connection calibration window');
      writes.push(await saveThreeSessions(initial));
      console.log('Three independent sessions confirmed; full-peak timing awaits the reports');
    }
    // A control request can occupy 30 seconds; keep it outside the write barrier.
    if ((writes.length || remaining > 35000) && now - lastStatus >= 15000) {
      lastStatus = now;
      const state = JSON.parse(await gh(['run', 'view', String(run.databaseId), '--repo', 'lwy9107124035/longnankejia', '--json', 'status,conclusion']));
      if (state.status === 'completed') { result.remoteConclusion = state.conclusion; break; }
    }
    await sleep(!writes.length && remaining <= 5000 ? Math.max(50, Math.min(200, remaining)) : 1000);
  }
  assert.ok(result.remoteConclusion, 'Remote load did not finish within the control window');
  const destination = '.cache/remote-read-load-' + prefix;
  fs.mkdirSync(destination, { recursive: true });
  await gh(['run', 'download', String(run.databaseId), '--repo', 'lwy9107124035/longnankejia', '--dir', destination]);
  const reports = [0, 1, 2, 3].map(shard => JSON.parse(fs.readFileSync(destination + '/codex-read-load-report-' + shard + '/online-read-load-report.json', 'utf8')));
  const report = aggregateReadLoads(reports,{requireClockBounds:true});
  result.concurrentWrites = { windows: writes, peakOverlaps: writes.filter(window => window.startedAt <= report.allUsersActiveUntil && window.finishedAt >= report.allUsersActiveFrom).length, sameRecordAccepted: 1, sameRecordConflict: 1 };
  const operations = writes.flatMap(window => window.operationIds);
  assert.equal(operations.length, 3);
  const confirmations = await db.prepare("SELECT created_at FROM admin_content_receipts WHERE generation=(SELECT json_extract(value,'$.generation') FROM admin_state WHERE key='content') AND id IN (?,?,?)").bind(...operations).all();
  result.concurrentWrites.serverWriteTimes = confirmations.results.map(row => new Date(row.created_at).toISOString());
  assert.equal(result.concurrentWrites.serverWriteTimes.length, 3);
  result.concurrentWrites.confirmedDuringFullPeak = confirmPeakWrites(report, writes, result.concurrentWrites.serverWriteTimes);
  if(articles===3) {
    result.concurrentWrites.afterAckReads=confirmAfterAckReads(reports,writes[0]);
    report.pass&&=result.concurrentWrites.afterAckReads.allCurrent;
  }
  const persisted = new Map((await rows()).map(row => [row.key, row]));
  assert.ok(ids.slice(0, 3).every(id => persisted.get('kepuCustom/' + id)?.value.tag === '三会话峰值写入'));
  report.pass &&= result.concurrentWrites.confirmedDuringFullPeak;
  report.requests = reports.reduce((total, r) => total + r.requests, 0);
  report.phases = [{ users: 1000, requests: report.peakRequests, failures: report.failures, p95Ms: report.p95Ms, pass: report.pass }];
  report.concurrentWrites = result.concurrentWrites;
  result.loadReport = destination + '/aggregate.json'; fs.writeFileSync(result.loadReport, JSON.stringify(report, null, 2)); return report;
}
const before = await app(null, 'format=pages', false), credentialBefore = await credentialsHash();
const retainedKeys=JSON.parse(fs.readFileSync('tests/fixtures/codex-retained-row-keys.json','utf8'));
const retainedBefore=await retainedRowsFingerprint(db,retainedKeys);
assert.equal(before.model, 'records-v1'); result.beforeRevision = before.revision; result.beforeCount = before.counts.kepuCustom ?? 0;
try {
  for (const sessionId of sessionIds) {
  for (let attempt = 0; ; attempt++) {
    try { await db.prepare('INSERT INTO admin_sessions(id,role,name,token_id,expires_at) VALUES(?,?,?,?,?)').bind(sessionId, 'super_admin', '合成并发维护验收', '', Date.now() + 25 * 60000).run(); break; }
    catch (error) {
      const confirmed = await db.prepare('SELECT role,name FROM admin_sessions WHERE id=?').bind(sessionId).first();
      if (confirmed) { assert.equal(confirmed.role, 'super_admin'); assert.equal(confirmed.name, '合成并发维护验收'); result.sessionInsertRecovered = true; break; }
      if (attempt >= 2) throw error;
      await sleep(1000);
    }
  }
  }
  result.actorSessions = sessionIds.length;
  if (!cleanupOnly) {
  const indexSql = fs.readFileSync('migrations/admin/0002_content_records.sql', 'utf8').split(';').map(sql => sql.trim())
    .filter(sql => /^CREATE INDEX IF NOT EXISTS admin_content_(?:sequence|recovery)\b/.test(sql));
  assert.equal(indexSql.length, 2); await db.batch(indexSql.map(sql => db.prepare(sql))); result.metadataIndexesReady = true;
  const nullHash = await schema.cellHash(null);
  for (let offset = 0; offset < ids.length; offset += 8) {
    const changes = ids.slice(offset, offset + 8).map((id, i) => ({ key: 'kepuCustom/' + id, baseHash: nullHash, value: value(id, offset + i) }));
    const saved = await write(changes); assert.equal(saved.accepted.length, changes.length);
  }
  const manifest = await app(); result.seedRevision = manifest.revision; assert.ok(manifest.counts.kepuCustom >= ids.length);
  console.log(ids.length + ' synthetic records prepared; original content and credentials retained');
  const initial = new Map((await rows()).filter(row => row.key.startsWith('kepuCustom/' + prefix)).map(row => [row.key, row]));
  if (saveProbe) {
    if (controlTransport === 'fetch') { await warmControlConnections(origin); result.controlWarmup = {staticRequests:5}; }
    result.saveProbe = await saveThreeSessions(initial);
    const persisted = new Map((await rows()).map(row=>[row.key,row]));
    assert.ok(ids.slice(0,3).every(id=>persisted.get('kepuCustom/'+id)?.value.tag==='三会话峰值写入'));
    result.probeCorrectnessPass = true;
  } else {
    const load = await remoteLoad(manifest.revision, initial);
    result.loadPass = load.pass; result.phases = load.phases; result.requests = load.requests;
  }
  } else result.loadSkipped = true;
} catch (error) { result.error = error.message; }
finally {
  try {
    if (result.remoteRunId && !result.remoteConclusion) {
      const args = ['run', 'view', String(result.remoteRunId), '--repo', 'lwy9107124035/longnankejia', '--json', 'status,conclusion'];
      let state = JSON.parse(await gh(args));
      if (state.status !== 'completed') {
        try {await gh(['run', 'cancel', String(result.remoteRunId), '--repo', 'lwy9107124035/longnankejia']);}
        catch {result.remoteCancellationUnconfirmed=true;}
        for (let i = 0; i < 12 && state.status !== 'completed'; i++) { await sleep(5000); state = JSON.parse(await gh(args)); }
      }
      assert.equal(state.status, 'completed', 'Remote job is still reading; fixture cleanup deferred');
      result.remoteConclusion = state.conclusion;
    }
    let current = (await rows()).filter(row => row.key.startsWith('kepuCustom/' + prefix + '-'));
    for (let offset = 0; offset < current.length; offset += 8) {
      const saved = await write(current.slice(offset, offset + 8).map(row => ({ key: row.key, baseHash: row.hash, value: null })));
      assert.equal(saved.accepted.length, Math.min(8, current.length - offset));
    }
    assert.equal((await rows()).filter(row => row.key.startsWith('kepuCustom/' + prefix + '-')).length, 0);
    assert.equal(await credentialsHash(), credentialBefore); result.credentialsUnchanged = true;
    const retainedAfter=await retainedRowsFingerprint(db,retainedKeys);
    assert.deepEqual(retainedAfter,retainedBefore,'Retained codex rows changed');
    result.retainedRows={count:retainedBefore.count,unchanged:true};
    result.recordAccounting=await verifyRecordAccounting(db);
    const final = await app(); result.afterRevision = final.revision; result.afterCount = final.counts.kepuCustom ?? 0; result.cleanup = true;
  } catch (error) { result.cleanupError = error.message; }
  let removedSessions = 0;
  for (const sessionId of sessionsToRemove) try {
    for (let attempt = 0; ; attempt++) {
      let failure;
      try { await db.prepare("DELETE FROM admin_sessions WHERE id=? AND name='合成并发维护验收'").bind(sessionId).run(); } catch (error) { failure = error; }
      if (!await db.prepare('SELECT id FROM admin_sessions WHERE id=?').bind(sessionId).first()) { removedSessions++; break; }
      if (attempt >= 2) throw failure || Error('Temporary session deletion was not confirmed');
      await sleep(1000);
    }
  }
  catch (error) { result.sessionCleanupError = error.message; }
  result.sessionRemoved = removedSessions === sessionsToRemove.length;
  if(productionBefore) try {
    const after=await checkHealth({origin:'https://longnankejia.pages.dev',baseline:JSON.parse(fs.readFileSync('docs/production-baseline.json','utf8')),
      snapshotDir:'.cache/maintenance/backups',databaseName:TARGETS.main.id});
    fs.writeFileSync('.cache/maintenance/post-load-'+Date.now()+'.json',JSON.stringify(after,null,2),{flag:'wx'});
    result.productionAfter={httpStatus:after.httpStatus,revision:after.revision,count:after.count,snapshotComplete:after.snapshotComplete,unchanged:after.revision===productionBefore.revision&&after.contentHash===productionBefore.contentHash};
    assert.ok(result.productionAfter.unchanged&&after.snapshotComplete&&after.databaseStorage&&!after.warnings.length,'Production post-check incomplete or changed; review evidence');
  } catch(error) {result.productionCheckError=error.message;}
}
console.log(JSON.stringify({ ...result, sessionHashes: undefined, phases: result.phases.map(phase => ({ users: phase.users, requests: phase.requests, failures: phase.failures, p95Ms: phase.p95Ms, pass: phase.pass })) }, null, 2));
fs.writeFileSync(stateFile, JSON.stringify(result, null, 2));
if (result.error || result.productionCheckError || !result.cleanup || !cleanupOnly && !(saveProbe ? result.probeCorrectnessPass : result.loadPass) || !result.sessionRemoved) process.exitCode = 1;
