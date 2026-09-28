import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {
  APP_CONFIG: { ai: { mode: 'rules', mockDelay: [0, 0], minScore: 1, api: { apiKey: '', baseUrl: 'https://example.invalid', model: 'test' } } },
};
let fetchCalls = 0;
let fetchImpl = async () => { throw new Error('fetch should not run'); };
const sandbox = {
  window,
  console: { warn() {}, error() {} },
  AbortController,
  setTimeout,
  clearTimeout,
  fetch: (...args) => { fetchCalls += 1; return fetchImpl(...args); },
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/knowledge-base.js'), 'utf8'), sandbox, { filename: 'knowledge-base.js' });
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/answer-engine.js'), 'utf8'), sandbox, { filename: 'answer-engine.js' });
const { RulesEngine, ApiEngine } = window.AnswerEngine;
const rules = new RulesEngine();
const ask = (q) => rules.ask(q);

const different = await ask('客家蓝染和其他地方蓝染对比，有何区别？');
const similar = await ask('其他地方蓝染和客家蓝染相似之处？');
const sourceUrls = (a) => (a.sources || []).map((s) => s.url).join(' ');
assert.match(different.text, /南通/);
assert.match(different.text, /白族/);
assert.match(different.text, /刻花版/);
assert.match(different.text, /扎缝/);
assert.match(similar.text, /相似处/);
assert.match(similar.text, /都以植物蓝靛染色/);
assert.doesNotMatch(similar.text, /差异主要在/);
assert.notEqual(different.text, similar.text, 'difference and similarity intents must get different answers');
// 出处链接在 sources 里，由界面上的"资料出处"展开区呈现，不塞进回答正文
assert.match(sourceUrls(different), /ihchina\.cn/);
assert.match(sourceUrls(similar), /yndali\.gov\.cn/);

const reversed = await ask('与龙南客家蓝染相近的地方染艺有哪些共同点？');
assert.match(reversed.text, /相似处/);
assert.match(reversed.text, /不代表其他地区都一样/);
assert.notEqual(reversed.matched, '蓝染', '“相近的地方染艺”这类问法不能掉回通用蓝染条目');

const craftComparison = await ask('织带和竹编的工艺区别是什么？');
assert.match(craftComparison.text, /绠瓠子/);
assert.match(craftComparison.text, /破篾/);
assert.notEqual(craftComparison.matched, '客家织带工艺与传承');

const inheritor = await ask('织带是谁在传承？');
assert.match(inheritor.text, /廖秋华、黄竹英/);
assert.match(inheritor.text, /以公布的名录为准/);
const process = await ask('客家蓝染的制靛工艺怎么做？');
assert.match(process.text, /三浸三晒三发酵/);

fetchCalls = 0;
fetchImpl = async () => { throw new Error('offline'); };
const apiOffline = new ApiEngine();
apiOffline.cfg.apiKey = 'test-key';
const offlineAnswer = await apiOffline.ask('其他地方蓝染和客家蓝染相似之处？');
assert.match(offlineAnswer.text, /相似处/);
assert.equal(offlineAnswer.source, 'rules');
assert.equal(fetchCalls, 0, 'intent-specific local answer is available offline');

const apiEngine = new ApiEngine();
apiEngine.cfg.apiKey = 'test-key';
fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'API 路由成功。' } }] }) });
const apiSuccess = await apiEngine.ask('潮汕工夫茶冲泡方法是什么？');
assert.equal(apiSuccess.source, 'api');
assert.match(apiSuccess.text, /API 路由成功/);
assert.equal(fetchCalls, 1);

fetchImpl = async () => { throw new Error('offline'); };
const apiFallback = await apiEngine.ask('潮汕工夫茶冲泡方法是什么？');
assert.equal(apiFallback.source, 'rules');
assert.equal(apiFallback.fallback, true);
assert.equal(fetchCalls, 2);

const allKbText = JSON.stringify(window.KNOWLEDGE_BASE);
assert.doesNotMatch(allKbText, /茶果/, 'the disallowed Hakka tea-fruit section must not be ingested');
console.log('v2 knowledge checks passed: comparison intents, source links, multi-topic routing, inheritor/process answers, API route/fallback, and tea-fruit exclusion.');
