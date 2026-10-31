import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadPermit, assertLoadPermit } from './helpers/load-budget.mjs';
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
