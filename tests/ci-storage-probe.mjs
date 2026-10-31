import fs from 'node:fs';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

const origin = 'https://codex.longnankejia-dev.pages.dev';
const report = { at: new Date().toISOString(), origin, purpose: 'anonymous catalog fault diagnosis; no fixtures or writes',
  requestBudget: 1601, realDevices: false, aiCalls: 0, phases: [] };
for (const users of [1, 100, 500, 1000]) {
  const samples = await Promise.all(Array.from({ length: users }, async () => {
    const started = performance.now();
    try {
      const response = await fetch(origin + '/api/admin/sync?format=pages', { redirect: 'error', signal: AbortSignal.timeout(15000) });
      const body = await response.text();
      if (response.status === 200) {
        const value = JSON.parse(body); assert.equal(value.ok, true); assert.equal(value.model, 'records-v1');
      }
      return { status: response.status, ms: Math.round(performance.now() - started),
        ...(response.status !== 200 && { body: body.slice(0, 600), type: response.headers.get('content-type'), ray: response.headers.get('cf-ray') }) };
    } catch (error) { return { status: 0, ms: Math.round(performance.now() - started), error: error.name }; }
  }));
  const times = samples.map(s => s.ms).sort((a, b) => a - b);
  const phase = { users, failures: samples.filter(s => s.status !== 200).length, p95Ms: times[Math.ceil(times.length * 0.95) - 1], samples };
  report.phases.push(phase); console.log(JSON.stringify({ users, failures: phase.failures, p95Ms: phase.p95Ms }));
  if (phase.failures) break;
  await sleep(1000);
}
report.pass = report.phases.length === 4 && report.phases.every(p => p.failures === 0);
fs.mkdirSync('.cache', { recursive: true }); fs.writeFileSync('.cache/storage-read-probe.json', JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
