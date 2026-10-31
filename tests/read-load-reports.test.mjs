import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateReadLoads } from './helpers/read-load-reports.mjs';

test('distributed acceptance requires complete synchronized journeys, matching images and all reports without relaxing latency', () => {
  const start = '2026-10-31T08:00:00.000Z', end = '2026-10-31T08:00:01.000Z';
  const reports = Array.from({ length: 4 }, (_, shard) => ({ shard, shardCount: 4, origin: 'https://codex.longnankejia-dev.pages.dev', coordinatedStart: start,
    fixturePrefix: 'synthetic', fixtureRevision: 1, fixtureCount: 188, imageDigests: { 'legacy-image': 'a'.repeat(64), 'new-image': 'b'.repeat(64) }, pass: true, httpRequests: 1506,
    phases: [{ users: 250, startedAt: start, finishedAt: end }], samples: Array.from({ length: 250 }, (_, user) => ['html', 'catalog', 'page', 'detail', 'legacy-image', 'new-image']
      .map((target, step) => ({ user, target, phase: 250, ok: true, status: 200, ms: 100,
        startedAt: new Date(Date.parse(start) + step * 150).toISOString(), finishedAt: new Date(Date.parse(start) + step * 150 + 100).toISOString() }))).flat() }));
  const result = aggregateReadLoads(reports); assert.equal(result.pass, true); assert.equal(result.concurrentUsers, 1000); assert.equal(result.peakRequests, 6000);
  assert.throws(() => aggregateReadLoads(reports.slice(1)));
  const missing = structuredClone(reports); missing[0].samples.pop(); assert.throws(() => aggregateReadLoads(missing));
  const mismatched = structuredClone(reports); mismatched[0].imageDigests['new-image'] = 'c'.repeat(64); assert.throws(() => aggregateReadLoads(mismatched));
  const slow = structuredClone(reports); slow.forEach(r => r.samples.forEach(s => { s.ms = 3001; })); assert.equal(aggregateReadLoads(slow).pass, false);
  const failed = structuredClone(reports); failed[0].samples[0].ok = false; failed[0].samples[0].status = 503; assert.equal(aggregateReadLoads(failed).failures, 1);
  const duplicate = structuredClone(reports); duplicate[3].shard = 2; assert.throws(() => aggregateReadLoads(duplicate));
  const excess = structuredClone(reports); excess.forEach(r => { r.httpRequests = 4000; }); assert.throws(() => aggregateReadLoads(excess));
  const late = structuredClone(reports); late[3].phases[0].startedAt = '2026-10-31T08:00:02.000Z'; assert.equal(aggregateReadLoads(late).pass, false);
  const staticReports = reports.map(report => ({ ...report, requestBudget: 251, httpRequests: undefined,
    phases: [{ ...report.phases[0], samples: report.samples.filter(sample => sample.target === 'html') }] }));
  assert.equal(aggregateReadLoads(staticReports, { staticOnly: true }).pass, true);
  staticReports[3].phases[0].samples = staticReports[3].phases[0].samples.map(sample => ({ ...sample,
    startedAt: '2026-10-31T08:00:00.200Z', finishedAt: '2026-10-31T08:00:00.300Z' }));
  const staggered = aggregateReadLoads(staticReports, { staticOnly: true });
  assert.equal(staggered.concurrentUsers, 750); assert.equal(staggered.pass, false);
});
