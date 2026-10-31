import fs from 'node:fs';
import assert from 'node:assert/strict';
import { runReadLoad } from './online-read-load.mjs';
const prefix = process.env.LOAD_PREFIX, revision = Number(process.env.LOAD_REVISION);
const distributed = process.env.READ_MODE === 'read-distributed', shard = distributed ? Number(process.env.LOAD_SHARD) : 0;
if (distributed) assert.ok(process.env.LOAD_START && Number.isFinite(Date.parse(process.env.LOAD_START)), 'A coordinated start is required');
assert.match(prefix || '', /^load-fixture-[a-f0-9]{24}$/); assert.ok(Number.isSafeInteger(revision) && revision >= 0);
fs.mkdirSync('.cache', { recursive: true });
const report = await runReadLoad({ prefix, detailKey: 'kepuCustom/' + prefix + '-000', revision, fixtureCount: 188,
  generator: 'standard GitHub-hosted Ubuntu runner, direct HTTPS; HTTP virtual users, not physical phones', peakPauseMs: distributed ? 0 : 15000, latencyDiagnostic: !distributed,
  permit: process.env.LOAD_BUDGET, ...(distributed && { shard, shardCount: 4, phaseUsers: [1, 250], startAt: process.env.LOAD_START, requestBudget: 3750 }),
  reportPath: '.cache/online-read-load-report.json' });
if (!report.pass) process.exitCode = 1;
