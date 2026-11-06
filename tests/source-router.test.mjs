import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(hash) {
  const calls = [], window = { location: { hash }, App: { switchPanel: panel => calls.push(panel), openSource: (name, params) => calls.push({ name, ...params }) } };
  vm.runInNewContext(fs.readFileSync(new URL('../js/router.js', import.meta.url), 'utf8'), { window, URLSearchParams });
  return { window, calls, router: window.Router };
}

test('source permalinks preserve their route and exact record while applying a panel', () => {
  const { router, calls } = setup('#/science?item=source-water');
  assert.equal(router.current(), 'science');
  assert.equal(router.apply(), 'science');
  assert.equal(calls[0], 'panelHeritage');
  assert.deepEqual(calls[1], { name: 'science', item: 'source-water', title: '', quote: '' });
});

test('collection links round-trip encoded names and support applying the same URL again', () => {
  const { window, router, calls } = setup('#/chat');
  assert.equal(router.go('diancang', { item: '客家蓝染' }), true);
  assert.equal(window.location.hash, '#/diancang?item=%E5%AE%A2%E5%AE%B6%E8%93%9D%E6%9F%93');
  router.go('diancang', { item: '客家蓝染' });
  assert.deepEqual(calls.at(-1), { name: 'diancang', item: '客家蓝染', title: '', quote: '' });
});

test('ordinary routes and invitation handling do not open a record or rewrite a missing hash', () => {
  for (const hash of ['', '#/science', '#admin-token=private', '#/unknown?item=wrong']) {
    const { window, router, calls } = setup(hash);
    router.apply();
    assert.equal(calls.length, 1);
    assert.equal(window.location.hash, hash);
    assert.equal(router.go('not-a-route'), false);
  }
});
