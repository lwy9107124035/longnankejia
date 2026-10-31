import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadPermit, assertLoadPermit, assertProductionReady } from './helpers/load-budget.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('remote D1 tests fail closed for high, stale, unknown, or single-database usage and preserve a normal-use reserve', () => {
  const now = Date.parse('2026-10-31T08:00:00Z');
  const usage = { at: new Date(now).toISOString(), periodStart: '2026-10-31T00:00:00Z', scope: 'all account databases, hourly analytics, may lag', rowsRead: 3000000, rowsWritten: 60000 };
  const permit = createLoadPermit(usage, undefined, now); assert.deepEqual(assertLoadPermit(JSON.stringify(permit), 15000, now), permit);
  for (const change of [{ rowsRead: 3000001 }, { rowsRead: 4986544 }, { rowsWritten: 60001 }, { rowsRead: null }, { scope: 'one database 24h' }, { at: '2026-10-31T07:40:00Z' }, { periodStart: '2026-10-30T00:00:00Z' }]) assert.throws(() => createLoadPermit({ ...usage, ...change }, undefined, now));
  assert.throws(() => assertLoadPermit(permit, 15001, now));
  assert.throws(() => assertLoadPermit(permit, 15000, now + 16 * 60000));
  assert.throws(() => assertLoadPermit(permit, 1, Date.parse('2026-11-01T00:00:00Z')));
  assert.throws(() => assertLoadPermit(undefined, 1, now));
});

test('the live codex verifier shows help without requiring credentials or starting a test', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./live-codex-load.mjs', import.meta.url)), '--help'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0); assert.match(result.stdout, /Usage:/); assert.doesNotMatch(result.stdout + result.stderr, /Bearer /);
});

test('shared-account load also requires recovered production and complete backups, preserving previously reported deletion warnings', () => {
  const now = Date.parse('2026-11-01T00:10:00Z');
  const healthy = { checkedAt:new Date(now).toISOString(), httpStatus:200, snapshotComplete:true, databaseStorage:{sizeBytes:34340864}, warnings:[], problems:[], missingIds:[] };
  assert.doesNotThrow(() => assertProductionReady(healthy, [], now));
  const previous = { ...healthy, problems:['baseline IDs are missing'], missingIds:['known-deletion'] };
  assert.doesNotThrow(() => assertProductionReady(previous, ['known-deletion'], now));
  assert.deepEqual(previous.problems, ['baseline IDs are missing']);
  assert.throws(() => assertProductionReady(previous, [], now), /unreviewed/);
  for (const change of [{httpStatus:503}, {snapshotComplete:false}, {databaseStorage:null}, {warnings:['capacity unknown']}, {checkedAt:'2026-10-31T23:50:00Z'}, {problems:['duplicate IDs']}]) {
    assert.throws(() => assertProductionReady({...healthy,...change}, [], now), /must not start/);
  }
});
