import assert from 'node:assert/strict';
const origin = 'https://codex.longnankejia-dev.pages.dev';
const targets = ['html', 'catalog', 'page', 'detail', 'legacy-image', 'new-image'];
const p95 = values => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null;
function peakCount(intervals) {
  const events = intervals.flatMap(([start, end]) => [[start, 1], [end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, peak = 0; for (const [, delta] of events) { active += delta; peak = Math.max(peak, active); } return peak;
}
export function confirmPeakWrites(report, windows, serverTimes) {
  const start = Date.parse(report.allUsersActiveFrom), end = Date.parse(report.allUsersActiveUntil), window = windows[0];
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && windows.length === 1
    && window.actors === 3 && window.accepted === 3 && window.sameRecordAccepted === 1 && window.sameRecordConflict === 1
    && Date.parse(window.startedAt) >= start && Date.parse(window.finishedAt) <= end && Date.parse(window.finishedAt) >= Date.parse(window.startedAt)
    && serverTimes.length === 3 && serverTimes.every(time => Date.parse(time) >= start && Date.parse(time) <= end);
}
export function aggregateReadLoads(reports, { staticOnly = false } = {}) {
  assert.equal(reports.length, 4, 'all four generators are required');
  assert.deepEqual(reports.map(r => r.shard).sort(), [0, 1, 2, 3]);
  const samples = [], phases = [], journeys = [];
  for (const report of reports) {
    assert.equal(report.origin, origin); assert.equal(report.shardCount, 4);
    assert.ok(report.coordinatedStart && report.coordinatedStart === reports[0].coordinatedStart, 'all generators must use the same start barrier');
    const phase = report.phases.find(p => p.users === 250); assert.ok(phase, 'a generator did not reach its peak'); phases.push(phase);
    const rows = staticOnly ? phase.samples : report.samples.filter(s => s.phase === 250);
    assert.equal(rows.length, 250 * (staticOnly ? 1 : 6));
    for (let user = 0; user < 250; user++) {
      const owned = rows.filter(row => row.user === user);
      assert.equal(owned.length, staticOnly ? 1 : 6, 'every virtual user must finish the expected journey');
      if (!staticOnly) assert.deepEqual(owned.map(row => row.target).sort(), [...targets].sort());
      const starts = owned.map(row => Date.parse(row.startedAt)), ends = owned.map(row => Date.parse(row.finishedAt));
      assert.ok(starts.every(Number.isFinite) && ends.every(Number.isFinite));
      assert.ok(owned.every((row, i) => ends[i] >= starts[i] && Number.isFinite(row.ms) && row.ms >= 0));
      journeys.push([Math.min(...starts), Math.max(...ends)]);
    }
    if (!staticOnly) {
      assert.equal(report.fixturePrefix, reports[0].fixturePrefix); assert.equal(report.fixtureRevision, reports[0].fixtureRevision);
      assert.equal(report.fixtureCount, 188); assert.deepEqual(report.imageDigests, reports[0].imageDigests);
      for (const target of ['legacy-image', 'new-image']) assert.match(report.imageDigests?.[target] || '', /^[a-f0-9]{64}$/);
    }
    samples.push(...rows);
  }
  const starts = phases.map(p => Date.parse(p.startedAt)), finishes = phases.map(p => Date.parse(p.finishedAt));
  assert.ok(starts.every(Number.isFinite) && finishes.every(Number.isFinite));
  const failures = samples.filter(s => !s.ok || s.status !== 200).length, startSpreadMs = Math.max(...starts) - Math.min(...starts);
  const httpRequests = reports.reduce((total, r) => total + (r.httpRequests ?? r.requestBudget), 0); assert.ok(httpRequests <= 15000);
  const concurrentUsers = peakCount(journeys), latency = p95(samples.map(s => s.ms));
  return { at: new Date().toISOString(), origin, staticOnly, targetUsers: 1000, actualGenerators: 4, virtualUsers: journeys.length,
    concurrentUsers, peakHttpRequests: peakCount(samples.map(s => [Date.parse(s.startedAt), Date.parse(s.finishedAt)])),
    allUsersActiveFrom: new Date(Math.max(...journeys.map(([start]) => start))).toISOString(),
    allUsersActiveUntil: new Date(Math.min(...journeys.map(([, end]) => end))).toISOString(),
    startedAt: new Date(Math.min(...starts)).toISOString(), finishedAt: new Date(Math.max(...finishes)).toISOString(), startSpreadMs,
    peakRequests: samples.length, httpRequests, failures, p95Ms: latency, proposedRequestP95Ms: 3000,
    pass: reports.every(r => r.pass) && !failures && latency <= 3000 && startSpreadMs <= 1000 && concurrentUsers === 1000,
    endpoints: (staticOnly ? ['html'] : targets).map(target => { const rows = staticOnly ? samples : samples.filter(s => s.target === target); return { target, requests: rows.length,
      p95Ms: p95(rows.map(s => s.ms)), serverP95Ms: p95(rows.map(s => s.serverMs).filter(Number.isFinite)) }; }),
    generators: reports.map((r, i) => ({ shard: r.shard, cpuMs: phases[i].generatorCpuMs, loopP95Ms: phases[i].generatorLoopP95Ms })) };
}
