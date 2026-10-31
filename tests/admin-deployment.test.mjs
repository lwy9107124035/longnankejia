import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/prepare_admin_d1.mjs', import.meta.url));
const preview = '11111111-1111-4111-8111-111111111111';
const production = '22222222-2222-4222-8222-222222222222';
function run(t, branch, extra = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'longnan-binding-'));
  const config = path.join(cwd, 'wrangler.jsonc');
  t.after(() => { if (fs.existsSync(config)) fs.unlinkSync(config); fs.rmdirSync(cwd); });
  const result = spawnSync(process.execPath, [script], {
    cwd, encoding: 'utf8', env: {
      ...process.env, BRANCH: branch, CODEX_ADMIN_D1_ID: preview, MAIN_ADMIN_D1_ID: production,
      CODEX_MEDIA_D1_ID: '', MAIN_MEDIA_D1_ID: '',
      ADMIN_BOOTSTRAP_PASSWORD: '', CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '', ...extra
    }
  });
  return { ...result, config: fs.existsSync(config) ? JSON.parse(fs.readFileSync(config, 'utf8')) : null };
}
test('production binds the migrated database without resetting or requiring bootstrap credentials', t => {
  const result = run(t, 'main');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.config.name, 'longnankejia');
  assert.equal(result.config.d1_databases[0].database_id, production);
  assert.equal(result.config.d1_databases[0].binding, 'ADMIN_DB');
  assert.equal(result.config.vars, undefined);
});
test('codex continues using its independent preview database', t => {
  const result = run(t, 'codex');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.config.name, 'longnankejia-dev');
  assert.equal(result.config.d1_databases[0].database_id, preview);
});
test('production refuses a missing database rather than creating an empty default-password state', t => {
  const result = run(t, 'main', { MAIN_ADMIN_D1_ID: '' });
  assert.notEqual(result.status, 0);
  assert.equal(result.config, null);
  assert.match(result.stderr, /pre-migrated production database/);
});
test('unknown branches and invalid database IDs cannot generate deployment bindings', t => {
  for (const [branch, extra] of [['qcode', {}], ['main', { MAIN_ADMIN_D1_ID: 'invalid' }]]) {
    const result = run(t, branch, extra);
    assert.notEqual(result.status, 0);
    assert.equal(result.config, null);
  }
});

test('optional R2 bindings use existing separate buckets without changing D1 or credentials', t => {
  const previewResult = run(t, 'codex', { CODEX_ADMIN_R2_BUCKET: 'synthetic-preview-media', MAIN_ADMIN_R2_BUCKET: 'synthetic-main-media' });
  assert.equal(previewResult.status, 0, previewResult.stderr);
  assert.deepEqual(previewResult.config.r2_buckets, [{ binding: 'ADMIN_MEDIA', bucket_name: 'synthetic-preview-media' }]);
  assert.equal(previewResult.config.d1_databases[0].database_id, preview);
  assert.equal(previewResult.config.vars, undefined);
  const absent = run(t, 'codex', { CODEX_ADMIN_R2_BUCKET: '', MAIN_ADMIN_R2_BUCKET: '' });
  assert.equal(absent.config.r2_buckets, undefined);
  for (const extra of [{ CODEX_ADMIN_R2_BUCKET: 'Invalid bucket' }, { CODEX_ADMIN_R2_BUCKET: 'same-media', MAIN_ADMIN_R2_BUCKET: 'same-media' }]) {
    const rejected = run(t, 'codex', extra); assert.notEqual(rejected.status, 0); assert.equal(rejected.config, null);
  }
});

test('optional image D1 binds an existing independent database without altering the administrator binding', t => {
  const media = '33333333-3333-4333-8333-333333333333';
  const result = run(t, 'codex', { CODEX_MEDIA_D1_ID: media });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.config.d1_databases, [
    { binding: 'ADMIN_DB', database_name: 'longnankejia-admin-codex', database_id: preview },
    { binding: 'ADMIN_MEDIA_DB', database_name: 'longnankejia-media-codex', database_id: media }
  ]);
  assert.equal(run(t, 'main', { CODEX_MEDIA_D1_ID: media }).config.d1_databases.length, 1);
  for (const extra of [{ CODEX_MEDIA_D1_ID: 'invalid' }, { CODEX_MEDIA_D1_ID: preview }, { CODEX_MEDIA_D1_ID: production }, { CODEX_MEDIA_D1_ID: media, MAIN_MEDIA_D1_ID: media }]) {
    const rejected = run(t, 'codex', extra); assert.notEqual(rejected.status, 0); assert.equal(rejected.config, null);
  }
});
