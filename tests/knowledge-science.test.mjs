import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ window: {}, console, setTimeout, clearTimeout, AbortController });
for (const file of ['content-schema.js', 'knowledge-base.js', 'answer-engine.js']) {
  vm.runInContext(fs.readFileSync(new URL('../js/' + file, import.meta.url), 'utf8'), context);
}
const entries = context.window.KNOWLEDGE_BASE;
const schema = context.HeritageContent;
const scienceTopics = entries.flatMap(entry => (entry.sources || [])
  .filter(source => source.title.startsWith('科普 · '))
  .map(source => ({ name: source.title.slice(5), entry })));

test('science expansion adds 176 entries and supplements 11 existing entries without duplicate IDs or sources', () => {
  assert.equal(entries.length, 261);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 261);
  assert.equal(entries.filter(entry => entry.id.startsWith('kb-science-')).length, 176);
  assert.equal(scienceTopics.length, 187);
  assert.equal(new Set(scienceTopics.map(topic => topic.name)).size, 187);
  assert.equal(scienceTopics.filter(topic => !topic.entry.id.startsWith('kb-science-')).length, 11);
  assert.equal(scienceTopics.filter(topic => topic.name === '竹其居围').length, 1);
  for (const { entry } of scienceTopics) {
    assert.ok(entry.answer.length > 40);
    assert.ok(entry.sources.some(source => (source.url || '').startsWith('https://longnankejia.pages.dev/#/science?item=')));
    assert.doesNotMatch(entry.answer.split('科普补充｜').at(-1), /<\/?(?:script|style|p|div|img)\b/i);
  }
});

test('all 187 science subjects retrieve their own knowledge entry using the real rules engine', () => {
  const engine = new context.window.AnswerEngine.RulesEngine();
  for (const { name, entry } of scienceTopics) {
    const ranked = engine.rank('介绍一下' + name);
    assert.ok(ranked.chunks.some(chunk => chunk.entry.id === entry.id), name + ' must retrieve its own source');
  }
});

test('common name variants retrieve the intended entry without inventing another subject', () => {
  const engine = new context.window.AnswerEngine.RulesEngine();
  for (const [query, name] of [['启佑堂', '啟佑堂'], ['擂茶', '龙南擂茶制作技艺'], ['龙南杨村龙舟赛', '龙南杨村龙舟赛']]) {
    const expected = scienceTopics.find(topic => topic.name === name).entry.id;
    assert.ok(engine.rank('介绍一下' + query).chunks.some(chunk => chunk.entry.id === expected), query);
  }
});

test('new builtin knowledge can be edited through the normal schema but cannot collide with custom IDs', () => {
  const entry = entries.find(item => item.id.startsWith('kb-science-'));
  const edited = structuredClone(schema.defaults);
  edited.kbEdited[entry.id] = { ...entry, answer: '合成管理员修订' };
  assert.doesNotThrow(() => schema.validateBundle(edited));
  const duplicate = structuredClone(schema.defaults);
  duplicate.kbCustom.push(entry);
  assert.throws(() => schema.validateBundle(duplicate), /重复或内置 ID/);
});

test('traditional medicine entries retain cultural context without repeating dosage, treatment or manufacturing claims', () => {
  const medicine = scienceTopics.filter(topic => /渡江烫伤药|全鹿膏炮制技艺/.test(topic.name));
  assert.equal(medicine.length, 2);
  for (const { entry } of medicine) {
    assert.match(entry.answer, /文化/);
    assert.doesNotMatch(entry.answer, /地榆|大黄|冰片|宰杀|三天三夜|多服久服|无毒/);
  }
});
