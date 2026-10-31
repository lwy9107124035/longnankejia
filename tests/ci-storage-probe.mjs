import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const origin = 'https://codex.longnankejia-dev.pages.dev';
const staticOnly = process.env.READ_MODE === 'read-static';
const report = { at: new Date().toISOString(), origin, purpose: staticOnly ? 'static HTML load-generator control' : 'anonymous catalog fault diagnosis; no fixtures or writes',
  requestBudget: 1601, realDevices: false, aiCalls: 0, phases: [] };
for (const users of [1, 100, 500, 1000]) {
  if (users === 1000) await sleep(15000);
  const cpu = process.cpuUsage(), started = performance.now(), loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
  const samples = await Promise.all(Array.from({ length: users }, async () => {
    const started = performance.now();
    try {
      const response = await fetch(origin + (staticOnly ? '/' : '/api/admin/sync?format=pages'), { redirect: 'error', signal: AbortSignal.timeout(15000) });
      const headerMs = Math.round(performance.now() - started);
      const body = await response.text();
      if (response.status === 200) {
        if (staticOnly) assert.match(body, /龙南客家/);
        else { const value = JSON.parse(body); assert.equal(value.ok, true); assert.equal(value.model, 'records-v1'); }
      }
      return { status: response.status, ms: Math.round(performance.now() - started), headerMs,
        ...(response.status !== 200 && { body: body.slice(0, 600), type: response.headers.get('content-type'), ray: response.headers.get('cf-ray') }) };
    } catch (error) { return { status: 0, ms: Math.round(performance.now() - started), error: error.name }; }
  }));
  const times = samples.map(s => s.ms).sort((a, b) => a - b);
  const phase = { users, failures: samples.filter(s => s.status !== 200).length, p95Ms: times[Math.ceil(times.length * 0.95) - 1], samples };
  loop.disable(); const used = process.cpuUsage(cpu); phase.generatorCpuMs = Math.round((used.user + used.system) / 1000);
  phase.durationMs = Math.round(performance.now() - started); phase.generatorLoopP95Ms = Math.round(loop.percentile(95) / 1000000);
  report.phases.push(phase); console.log(JSON.stringify({ users, failures: phase.failures, p95Ms: phase.p95Ms }));
  if (phase.failures) break;
  await sleep(1000);
}
report.pass = report.phases.length === 4 && report.phases.every(p => p.failures === 0);
fs.mkdirSync('.cache', { recursive: true }); fs.writeFileSync('.cache/storage-read-probe.json', JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
