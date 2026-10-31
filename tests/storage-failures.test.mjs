import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminBackend } from './helpers/admin-harness.mjs';

test('storage faults expose a bounded category while database error details and credentials stay private', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  const secret = 'SYNTHETIC-PRIVATE-DATABASE-PARAMETER';
  const logs = [], original = console.error; console.error = (...args) => logs.push(args.join(' ')); t.after(() => { console.error = original; });
  for (const [message, reason] of [
    ['D1_ERROR: database overloaded; queue is full', 'storage_busy'], ['D1_ERROR: daily rows read limit exceeded', 'storage_quota'],
    ['Too many API requests by single Worker invocation', 'request_limit'], ['D1 timed out', 'storage_timeout'],
    ['SQLITE_TOOBIG: too large', 'storage_size'], ['unclassified database error', 'unknown']
  ]) {
    backend.db.prepare = () => { throw new Error('Database request failed ' + secret, { cause: new Error(message) }); };
    const result = await backend.call(); assert.equal(result.status, 503); assert.equal(result.data.reason, reason);
    assert.equal(result.data.code, 'STORAGE_UNAVAILABLE'); assert.equal(JSON.stringify(result.data).includes(secret), false);
  }
  assert.equal(logs.length, 6); assert.equal(logs.join('\n').includes(secret), false);
});
