import test from 'node:test';
import assert from 'node:assert/strict';
import { readD1Usage } from '../scripts/d1-usage.mjs';
import { getProjectAccount } from '../scripts/_lib/cloudflare-read.mjs';
import { TARGETS, curlConfiguration } from '../scripts/migrate-content-records.mjs';

test('D1 monitoring sums the current UTC day across the project account and rejects unknown counters', async () => {
  const now = Date.parse('2026-11-01T00:05:00Z');
  const response = { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 100, rowsWritten: 2 } }, { sum: { rowsRead: 30, rowsWritten: 3 } }] }] } } };
  const report = await readD1Usage('a'.repeat(32), { now, read: async (_, body) => { assert.equal(body.variables.filter.AND[0].datetimeHour_geq, '2026-11-01T00:00:00Z'); return response; } });
  assert.equal(report.rowsRead, 130); assert.equal(report.rowsWritten, 5); assert.equal(report.planUnknown, true);
  const empty = structuredClone(response); empty.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups = [];
  assert.equal((await readD1Usage('a'.repeat(32), { now, read: async () => empty })).rowsRead, 0);
  for (const bad of [{ errors: [{ code: 10000 }] }, { data: {} }, { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: null, rowsWritten: 1 } }] }] } } }]) await assert.rejects(readD1Usage('a'.repeat(32), { now, read: async () => bad }), /unknown/);
});

test('the usage account must contain the codex database instead of selecting the first membership', async () => {
  const wrong = 'a'.repeat(32), correct = 'b'.repeat(32);
  const account = await getProjectAccount({ accountId: '', read: async path => {
    if (path === '/accounts') return [{ id: wrong }, { id: correct }];
    if (path.includes(wrong)) throw Error('Cloudflare read rejected: 7404');
    return { uuid: TARGETS.codex.id };
  } });
  assert.equal(account, correct);
  const config = curlConfiguration('https://api.cloudflare.com/client/v4/accounts', 'synthetic-auth', undefined, 'GET');
  assert.match(config, /request = "GET"/); assert.doesNotMatch(config, /\ndata =/);
});

test('expired monitoring authorization refreshes once through read-only Wrangler info before retrying account discovery', async () => {
  const account = 'b'.repeat(32); let refreshed = 0, checks = 0;
  const result = await getProjectAccount({ accountId: '', read: async path => {
    if (path === '/accounts') { checks++; if (!refreshed) throw Error('Cloudflare read rejected: 9109'); return [{ id: account }]; }
    return { uuid: TARGETS.codex.id };
  }, refresh: async id => { assert.equal(id, TARGETS.codex.id); refreshed++; } });
  assert.equal(result, account); assert.equal(refreshed, 1); assert.equal(checks, 2);
});

test('unrecoverable or unrelated monitoring failures stop instead of repeatedly refreshing or starting login', async () => {
  for (const message of ['Cloudflare read rejected: 9109', 'Cloudflare read transport was not confirmed']) {
    let refreshed = 0, checks = 0;
    await assert.rejects(getProjectAccount({ accountId: '', read: async () => { checks++; throw Error(message); }, refresh: async () => { refreshed++; } }), error => error.message === message);
    assert.equal(refreshed, message.endsWith('9109') ? 1 : 0); assert.equal(checks, refreshed + 1);
  }
});
