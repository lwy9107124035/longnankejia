import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareRead, getProjectAccount } from './_lib/cloudflare-read.mjs';

export async function readD1Usage(accountId, { now = Date.now(), read = cloudflareRead } = {}) {
  const at = new Date(now).toISOString(), periodStart = at.slice(0, 10) + 'T00:00:00Z';
  const result = await read('/graphql', {
    query: 'query getD1MetricsOverviewQuery($accountTag: string, $filter: ZoneWorkersRequestsFilter_InputObject) {viewer {accounts(filter:{accountTag:$accountTag}) {d1AnalyticsAdaptiveGroups(limit:10000,filter:$filter) {sum {rowsRead rowsWritten} dimensions {datetimeHour}}}}}',
    variables: { accountTag: accountId, filter: { AND: [{ datetimeHour_geq: periodStart, datetimeHour_leq: at }] } }
  });
  const rows = result.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
  if (result.errors?.length || !Array.isArray(rows) || !rows.every(row => Number.isSafeInteger(row.sum?.rowsRead) && row.sum.rowsRead >= 0 && Number.isSafeInteger(row.sum?.rowsWritten) && row.sum.rowsWritten >= 0)) throw Error('Account-wide D1 usage is unknown');
  return { at, periodStart, scope: 'all account databases, hourly analytics, may lag', rowsRead: rows.reduce((sum, row) => sum + row.sum.rowsRead, 0), rowsWritten: rows.reduce((sum, row) => sum + row.sum.rowsWritten, 0), planUnknown: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await readD1Usage(await getProjectAccount()); fs.mkdirSync('.cache', { recursive: true });
  fs.writeFileSync('.cache/account-read-budget-' + Date.now() + '.json', JSON.stringify(report, null, 2), { flag: 'wx' });
  fs.writeFileSync('.cache/account-read-budget-latest.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
