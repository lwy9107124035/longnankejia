import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { assertLoadPermit } from './helpers/load-budget.mjs';

const origin = 'https://codex.longnankejia-dev.pages.dev';
const staticOnly = ['read-static', 'read-distributed-static'].includes(process.env.READ_MODE);
const distributed = process.env.READ_MODE === 'read-distributed-static', phaseUsers = distributed ? [1, 250] : [1, 100, 500, 1000];
if (!staticOnly) assertLoadPermit(process.env.LOAD_BUDGET, 1601);
if (distributed) assert.ok(process.env.LOAD_START && Number.isFinite(Date.parse(process.env.LOAD_START)), 'A coordinated start is required');
const report = { at: new Date().toISOString(), origin, purpose: staticOnly ? 'static HTML load-generator control' : 'anonymous catalog fault diagnosis; no fixtures or writes',
  shard: distributed ? Number(process.env.LOAD_SHARD) : 0, shardCount: distributed ? 4 : 1, coordinatedStart: process.env.LOAD_START,
  requestBudget: phaseUsers.reduce((total, users) => total + users, 0), realDevices: false, aiCalls: 0, phases: [] };
for (const users of phaseUsers) {
  if (distributed && users === 250) {
    const target = Date.parse(process.env.LOAD_START); assert.ok(target - Date.now() < 5 * 60000);
    while (Date.now() < target) await sleep(Math.min(1000, target - Date.now()));
    assert.ok(Date.now() - target < 3000, 'Generator missed the coordinated start');
  }
  if (users === 1000) await sleep(15000);
  if (!staticOnly) assertLoadPermit(process.env.LOAD_BUDGET, 1601);
  const cpu = process.cpuUsage(), started = performance.now(), phaseStartedAt = new Date().toISOString(), loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
  const samples = await Promise.all(Array.from({ length: users }, async (_, user) => {
    const started = performance.now(), startedAt = new Date().toISOString(); let response;
    try {
      response = await fetch(origin + (staticOnly ? '/' : '/api/admin/sync?format=pages'), { redirect: 'error', signal: AbortSignal.timeout(15000) });
      const headerMs = Math.round(performance.now() - started);
      const body = await response.text();
      if (response.status === 200) {
        if (staticOnly) assert.match(body, /龙南客家/);
        else { const value = JSON.parse(body); assert.equal(value.ok, true); assert.equal(value.model, 'records-v1'); }
      }
      return { status: response.status, ok: response.status === 200, ms: Math.round(performance.now() - started), headerMs, user, startedAt, finishedAt: new Date().toISOString(), colo: response.headers.get('cf-ray')?.split('-').at(-1),
        ...(response.status !== 200 && { body: body.slice(0, 600), type: response.headers.get('content-type'), ray: response.headers.get('cf-ray') }) };
    } catch (error) { return { status: response?.status || 0, ok: false, ms: Math.round(performance.now() - started), user, startedAt, finishedAt: new Date().toISOString(), error: error.name }; }
  }));
  const times = samples.map(s => s.ms).sort((a, b) => a - b);
  const phase = { users, startedAt: phaseStartedAt, finishedAt: new Date().toISOString(), failures: samples.filter(s => !s.ok).length, p95Ms: times[Math.ceil(times.length * 0.95) - 1], samples };
  loop.disable(); const used = process.cpuUsage(cpu); phase.generatorCpuMs = Math.round((used.user + used.system) / 1000);
  phase.durationMs = Math.round(performance.now() - started); phase.generatorLoopP95Ms = Math.round(loop.percentile(95) / 1000000);
  report.phases.push(phase); console.log(JSON.stringify({ users, failures: phase.failures, p95Ms: phase.p95Ms }));
  if (phase.failures) break;
  await sleep(1000);
}
report.pass = report.phases.length === phaseUsers.length && report.phases.every(p => p.failures === 0);
fs.mkdirSync('.cache', { recursive: true }); fs.writeFileSync('.cache/storage-read-probe.json', JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
