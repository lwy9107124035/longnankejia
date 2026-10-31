import fs from 'node:fs';
import assert from 'node:assert/strict';
import { runReadLoad } from './online-read-load.mjs';
const prefix = process.env.LOAD_PREFIX, revision = Number(process.env.LOAD_REVISION);
assert.match(prefix || '', /^load-fixture-[a-f0-9]{24}$/); assert.ok(Number.isSafeInteger(revision) && revision >= 0);
fs.mkdirSync('.cache', { recursive: true });
const report = await runReadLoad({ prefix, detailKey: 'kepuCustom/' + prefix + '-000', revision, fixtureCount: 188,
  generator: 'standard GitHub-hosted Ubuntu runner, direct HTTPS; HTTP virtual users, not physical phones', peakPauseMs: 15000, latencyDiagnostic: true,
  reportPath: '.cache/online-read-load-report.json' });
if (!report.pass) process.exitCode = 1;
