import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend } from './helpers/admin-harness.mjs';

const original = fs.readFileSync(new URL('../functions/api/admin/sync.js', import.meta.url), 'utf8');
async function mutant(from, to) {
  assert.ok(original.includes(from), 'mutation target must still exist');
  return import('data:text/javascript;base64,' + Buffer.from(original.replace(from, to)).toString('base64'));
}
async function call(module, backend, body, bearer) {
  const request = new Request('http://127.0.0.1:8931/api/admin/sync', {
    method: body ? 'POST' : 'GET', headers: { ...(body && { 'Content-Type': 'application/json' }), ...(bearer && { Authorization: 'Bearer ' + bearer }) },
    body: body ? JSON.stringify(body) : undefined
  });
  return module[body ? 'onRequestPost' : 'onRequestGet']({ request, env: backend.env });
}
const backend = createAdminBackend();
try {
  const bypass = await mutant('if (await passwordHash(input, saved.value.salt) === saved.value.hash)', 'if (true)');
  const bypassResponse = await call(bypass, backend, { action: 'login', credential: 'incorrect', clientId: 'negative' });
  assert.throws(() => assert.equal(bypassResponse.status, 401), 'a password bypass must fail the rejection assertion');

  const overwrite = await mutant("SET value = ?, revision = revision + 1 WHERE key = 'content' AND revision = ?", "SET value = ?, revision = revision + 1 WHERE key = 'content' AND ? >= 0");
  const admin = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'negative-admin' })).data;
  const current = (await backend.call()).data;
  const { ok, ...payload } = current;
  Object.assign(payload, { action: 'update_custom_bundle', auditLogs: [] });
  assert.equal((await call(overwrite, backend, payload, admin.bearer)).status, 200);
  const stale = await call(overwrite, backend, { ...payload, kbCustom: [{ id: 'overwritten' }] }, admin.bearer);
  assert.throws(() => assert.equal(stale.status, 409), 'removing the version guard must fail the stale-device assertion');

  const fakeSuccess = await mutant("return json(503, { ok: false, code: 'STORAGE_UNAVAILABLE'", "return json(200, { ok: true, code: 'STORAGE_UNAVAILABLE'");
  const broken = { env: { ADMIN_DB: { prepare() { throw new Error('offline'); } } } };
  const response = await call(fakeSuccess, broken, null);
  assert.throws(() => assert.equal(response.status, 503), 'swallowing storage failure must fail the error assertion');
  console.log('3 negative controls caught: authentication bypass, stale overwrite, false storage success. Source files were not modified.');
} finally { backend.close(); }
