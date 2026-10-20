import fs from 'node:fs';

const branch = process.env.BRANCH;
const target = {
  codex: { project: 'longnankejia-dev', database: 'longnankejia-admin-codex', id: process.env.CODEX_ADMIN_D1_ID },
  main: { project: 'longnankejia', database: 'longnankejia-admin-main', id: process.env.MAIN_ADMIN_D1_ID }
}[branch];
if (!target) throw new Error('Admin D1 setup is restricted to main and codex.');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const configuredId = target.id;
// Production must use the migrated state, including the current password; never initialize an empty replacement.
if (branch === 'main' && !configuredId) throw new Error('MAIN_ADMIN_D1_ID must identify the pre-migrated production database.');
if (!configuredId && (!account || !token || (process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim().length < 8)) {
  throw new Error('Configure CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and ADMIN_BOOTSTRAP_PASSWORD (8+ characters) in GitHub secrets.');
}
const root = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
async function api(url, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`D1 setup failed (HTTP ${response.status}). The deployment token needs Account > D1 > Edit in addition to Pages > Edit.`);
  return data.result;
}
const name = target.database;
let database;
if (configuredId) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(configuredId)) throw new Error('The configured admin database ID must be a D1 UUID.');
  // A pre-provisioned database lets the deployment token retain Pages-only permissions.
  database = { name, uuid: configuredId };
} else {
  const databases = await api(root + '?name=' + encodeURIComponent(name) + '&per_page=100');
  database = databases.find(d => d.name === name);
  if (!database) database = await api(root, { name });
  const result = await api(root + '/' + database.uuid + '/query', { sql: fs.readFileSync(new URL('../migrations/admin/0001_admin.sql', import.meta.url), 'utf8') });
  if (!result.every(r => r.success)) throw new Error('Admin schema migration failed.');
}
fs.writeFileSync('wrangler.jsonc', JSON.stringify({
  name: target.project, pages_build_output_dir: '_site', compatibility_date: '2026-10-20',
  d1_databases: [{ binding: 'ADMIN_DB', database_name: name, database_id: database.uuid }]
}, null, 2));
console.log(configuredId ? `${branch} deployment binding is ready for the pre-provisioned D1 database.` : `${branch} admin D1 schema and deployment binding are ready.`);
