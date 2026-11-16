import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const cards = [
  { id: 'yan', name: '燕翼围', detail: '<h2>一、概述</h2><p>燕翼围始建于清顺治七年（1650），康熙十六年（1677）完工。</p>' },
  { id: 'wu', name: '乌石围', detail: '<p>乌石围始建于1582年，1610年完工，前方后圆。</p>' },
  { id: 'guanxi', name: '关西新围', detail: '关西新围始建于1798年，1827年竣工，是九幢十八厅的典型建筑。' },
  { id: 'song', name: '龙南客家童谣《数 数 歌》', tag: '客家童谣', category: 'craft', detail: '<p>这是一首测试童谣。</p><p>第一句测试歌词，第二句测试歌词。</p>' }
];

for (const records of [false, true]) test(`published science grounds answers and later edits (${records ? 'records' : 'legacy'})`, async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = Array.from({ length: 110 }, (_, i) => ({ id: 'a-' + String(i).padStart(3, '0'), name: '合成测试内容' + i, detail: '无关内容。' })).concat(cards.filter(card => card.id !== 'guanxi'));
  content.kepuEdited.guanxi = cards[2];
  content.kepuDeleted = ['festival'];
  if (records) {
    backend.sqlite.exec(read('migrations/admin/0002_content_records.sql'));
    await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  } else backend.sqlite.prepare("UPDATE admin_state SET value=? WHERE key='content'").run(JSON.stringify(content));
  const device = setupEnvironment(backend);
  vm.runInContext(read('js/knowledge-base.js'), device.sandbox);
  // A same-source snapshot and a generic alias must both lose to the published card.
  device.window.KNOWLEDGE_BASE.push({ id: 'stale-yan', title: '燕翼围', topics: ['燕翼围'], answer: '燕翼围始建于明万历年间。', sources: [{ title: '科普 · 燕翼围', url: '#/science?item=yan' }] });
  device.window.KNOWLEDGE_BASE.push({ id: 'retired-snapshot', title: '旧组合卡', answer: '已经下架的资料。', sources: [{ title: '科普 · 旧组合卡', url: '#/science?item=festival' }] });
  device.window.UI = { Heritage: { list: () => device.store.getHeritageCards([{ id: 'guanxi', name: '关西新围', detail: '旧概述。' }]) } };
  vm.runInContext(read('js/answer-engine.js'), device.sandbox);
  await device.store.syncWithCloud();
  assert.ok(!device.store.getAnswerEntries().some(entry => entry.id === 'retired-snapshot'));
  for (const [query, id, expected] of [['介绍燕翼围', 'yan', /1650/], ['乌石围是什么', 'wu', /1582/], ['关西新围哪年建', 'guanxi', /1798/], ['数数歌怎么唱', 'song', /测试歌词/]]) {
    await device.store.searchKnowledge(query);
    const engine = new device.window.AnswerEngine.RulesEngine(), ranked = engine.rank(query);
    assert.ok(ranked.chunks.length, query);
    assert.ok(ranked.chunks.every(chunk => chunk.entry.id === 'live-science-' + id), query + ' uses its own published source');
    assert.match(ranked.chunks.map(chunk => chunk.text).join('\n'), expected);
    assert.ok(ranked.chunks.every(chunk => chunk.sources[0].url === '#/science?item=' + id));
    assert.doesNotMatch(ranked.chunks.map(chunk => chunk.text).join('\n'), /明万历|<p>|旧概述/);
  }
  assert.ok(new device.window.AnswerEngine.RulesEngine().rank('推荐客家童谣').chunks.some(chunk => chunk.entry.id === 'live-science-song'));
  const update = structuredClone(content); update.kepuCustom.find(card => card.id === 'yan').detail = '燕翼围修订后的测试说明，清顺治七年1650始建。';
  if (records) {
    // Exercise the real optimistic update API rather than changing a client cache.
    const auth = await backend.call({ action: 'login', credential: 'admin123', clientId: 'science-test' });
    const result = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/yan', baseHash: await globalThis.HeritageContent.cellHash(cards[0], true), value: update.kepuCustom.find(card => card.id === 'yan') }] }, auth.data.bearer);
    assert.equal(result.status, 200); assert.equal(result.data.accepted.length, 1);
    await device.store.searchKnowledge('燕翼围');
  } else {
    backend.sqlite.prepare("UPDATE admin_state SET value=?,revision=revision+1 WHERE key='content'").run(JSON.stringify(update));
    await device.store.syncWithCloud();
  }
  assert.match(device.store.getAnswerEntries().find(entry => entry.id === 'live-science-yan').answer, /修订后的/);
});

test('retired customs disappear from active collection, science and answer topics', () => {
  const window = {};
  vm.runInNewContext(read('js/knowledge-base.js'), { window });
  assert.doesNotMatch(JSON.stringify(window.KNOWLEDGE_BASE), /迎龙灯|烧瓦塔|走古事/);
  assert.doesNotMatch(read('js/diancang-data.js'), /迎龙灯|烧瓦塔|走古事/);
  assert.doesNotMatch(read('js/ui.js'), /迎龙灯|烧瓦塔|走古事|name: '岁时节令'/);
});
