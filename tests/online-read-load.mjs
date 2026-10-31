import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const origin = 'https://codex.longnankejia-dev.pages.dev';
const phases = [1, 10, 25, 50, 100, 250, 500, 1000].map(users => ({ users, iterations: 1 }));
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function runReadLoad({ prefix, detailKey, revision, fixtureCount, reportPath, duringPeak,
  generator = 'single Windows host via configured proxy; HTTP virtual users, not physical phones', peakPauseMs = 0, latencyDiagnostic = false }) {
  assert.match(prefix, /^load-fixture-[a-f0-9]{24}$/); assert.ok(detailKey.startsWith('kepuCustom/' + prefix + '-'));
  const targets = [
    { name: 'html', path: '/', type: 'text/html' },
    { name: 'catalog', path: '/api/admin/sync?format=pages', type: 'application/json' },
    { name: 'page', path: '/api/admin/sync?format=records&field=kepuCustom&summary=1', type: 'application/json' },
    { name: 'detail', path: '/api/admin/sync?format=record&key=' + encodeURIComponent(detailKey), type: 'application/json' },
    { name: 'legacy-image', path: '/api/media/a5de70330e575fa03c530091f07430a2d959b70aa3df14b8804e7a3c4e2c5a6a', type: 'image/jpeg' },
    { name: 'new-image', path: '/api/media/a80e375c338e604e10af745832bcd141b155c762adf56fefe58799175a372825', type: 'image/jpeg' }
  ];
  const report = { startedAt: new Date().toISOString(), origin, generator, latencyDiagnostic,
    realIphone: false, realWechat: false, realOfficialAccount: false, paidAiCalls: 0, fixtureCount, fixtureRevision: revision,
    requestBudget: 15000, requestTimeoutMs: 10000, proposedRequestP95Ms: 3000, targetUsersConfirmed: true, targetUsers: 1000, phases: [], samples: [] };
  let inFlight = 0, nextRequest = 0, stopped = false;
  const images = new Map();
  async function request(target, phase, signal) {
    if (++nextRequest > report.requestBudget) throw Error('Read-only load request budget exhausted');
    const started = performance.now(); inFlight++; phase.peakInFlight = Math.max(phase.peakInFlight, inFlight);
    const sample = { phase: phase.users, target: target.name };
    try {
      let response, bytes; sample.statuses = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt && ++nextRequest > report.requestBudget) throw Error('Read-only load request budget exhausted');
        response = await fetch(origin + target.path, { method: 'GET', cache: 'no-store', redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(report.requestTimeoutMs)]) });
        sample.headerMs = Math.round(performance.now() - started);
        bytes = new Uint8Array(await response.arrayBuffer()); sample.bodyMs = Math.round(performance.now() - started) - sample.headerMs;
        sample.statuses.push(response.status);
        if (target.type === 'application/json' && response.status === 409 && attempt < 2 && JSON.parse(new TextDecoder().decode(bytes)).code === 'PAGE_CHANGED') {
          await sleep(300 * (attempt + 1)); continue;
        }
        break;
      }
      sample.status = response.status; sample.bytes = bytes.length;
      sample.colo = response.headers.get('cf-ray')?.split('-').at(-1) || null; sample.cache = response.headers.get('cf-cache-status');
      const serverTiming = response.headers.get('server-timing')?.match(/content;dur=([\d.]+)/);
      if (serverTiming) sample.serverMs = Number(serverTiming[1]);
      assert.equal(response.status, 200); assert.ok((response.headers.get('content-type') || '').startsWith(target.type));
      if (target.type === 'application/json') {
        assert.match(response.headers.get('cache-control') || '', /no-store/);
        const data = JSON.parse(new TextDecoder().decode(bytes)); assert.equal(data.ok, true); assert.equal(data.model, 'records-v1');
        if (target.name === 'catalog') assert.ok(data.counts.kepuCustom >= fixtureCount);
        if (target.name === 'page') { assert.equal(data.rows.length, 50); assert.ok(data.rows.every(row => row.summary)); }
        if (target.name === 'detail') { assert.equal(data.rows[0].key, detailKey); assert.ok(data.rows[0].value.detail.length > 2000); }
      } else if (target.type.startsWith('image/')) {
        const digest = hash(bytes); if (!images.has(target.name)) images.set(target.name, digest);
        assert.equal(digest, images.get(target.name)); assert.ok(bytes.length > 10000);
      } else assert.match(new TextDecoder().decode(bytes), /龙南客家/);
      sample.ok = true;
    } catch (error) { sample.ok = false; sample.cancelled = signal.aborted; sample.error = error.name; sample.message = error.message.slice(0, 160); }
    finally { sample.ms = Math.round(performance.now() - started); inFlight--; phase.samples.push(sample); report.samples.push(sample); }
    return sample;
  }
  for (const spec of phases) {
    if (stopped) break;
    if (spec.users === 1000 && peakPauseMs) await sleep(peakPauseMs);
    const phase = { ...spec, startedAt: new Date().toISOString(), samples: [], peakInFlight: 0 }, controller = new AbortController(), started = performance.now();
    const cpu = process.cpuUsage(), loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
    report.phases.push(phase);
    const failures = () => phase.samples.filter(sample => !sample.ok && !sample.cancelled).length;
    let peakWork;
    await Promise.all(Array.from({ length: spec.users }, async (_, index) => {
      for (let iteration = 0; iteration < spec.iterations; iteration++) {
        for (const target of targets) {
          if (controller.signal.aborted) return;
          const sample = await request(target, phase, controller.signal);
          if (spec.users === 1000 && !peakWork && duringPeak) peakWork = duringPeak().then(value => ({ value }), error => ({ error: error.message }));
          if (sample.status === 429 || failures() >= 10 || phase.samples.length >= 40 && failures() / phase.samples.length > 0.05) {
            stopped = true; controller.abort(); return;
          }
        }
        if (iteration + 1 < spec.iterations) await sleep(250 + index % 5 * 25);
      }
    }));
    if (peakWork) { const outcome = await peakWork; if (outcome.error) report.concurrentWriteError = outcome.error; else report.concurrentWrites = outcome.value; }
    phase.durationMs = Math.round(performance.now() - started); phase.requests = phase.samples.length;
    loop.disable(); const usedCpu = process.cpuUsage(cpu);
    phase.generatorCpuMs = Math.round((usedCpu.user + usedCpu.system) / 1000); phase.generatorLoopP95Ms = Math.round(loop.percentile(95) / 1000000);
    phase.finishedAt = new Date().toISOString();
    phase.failures = failures(); phase.cancelled = phase.samples.filter(sample => sample.cancelled).length;
    phase.versionRetries = phase.samples.reduce((sum, sample) => sum + (sample.statuses || []).filter(status => status === 409).length, 0);
    phase.failureRate = phase.failures / (phase.requests - phase.cancelled);
    phase.p50Ms = percentile(phase.samples.map(sample => sample.ms), 0.5); phase.p95Ms = percentile(phase.samples.map(sample => sample.ms), 0.95);
    phase.p99Ms = percentile(phase.samples.map(sample => sample.ms), 0.99);
    phase.requestsPerSecond = Math.round(phase.requests * 100000 / phase.durationMs) / 100;
    phase.pass = !phase.failures && !phase.cancelled && phase.p95Ms <= report.proposedRequestP95Ms;
    phase.endpoints = targets.map(target => { const samples = phase.samples.filter(sample => sample.target === target.name); return { name: target.name,
      requests: samples.length, failures: samples.filter(sample => !sample.ok).length, p95Ms: percentile(samples.map(sample => sample.ms), 0.95),
      serverP95Ms: percentile(samples.map(sample => sample.serverMs).filter(Number.isFinite), 0.95),
      headerP95Ms: percentile(samples.map(sample => sample.headerMs).filter(Number.isFinite), 0.95),
      bodyP95Ms: percentile(samples.map(sample => sample.bodyMs).filter(Number.isFinite), 0.95) }; });
    delete phase.samples;
    console.log(JSON.stringify({ users: phase.users, requests: phase.requests, failures: phase.failures, p95Ms: phase.p95Ms, pass: phase.pass }));
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    if (phase.failures || !latencyDiagnostic && phase.p95Ms > 5000) stopped = true;
    if (!stopped) await sleep(1000);
  }
  report.finishedAt = new Date().toISOString(); report.requests = report.samples.length; report.stoppedEarly = stopped;
  report.httpRequests = nextRequest;
  report.pass = report.phases.length === phases.length && report.phases.every(phase => phase.pass) && !report.concurrentWriteError;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); return report;
}
