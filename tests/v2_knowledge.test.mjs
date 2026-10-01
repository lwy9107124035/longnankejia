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

const reverseDifference = await ask('其他地方蓝染和客家蓝染相比有哪些不同？');
assert.match(reverseDifference.text, /南通/);
assert.match(reverseDifference.text, /白族/);
assert.match(reverseDifference.text, /工艺各有路径/);
assert.notEqual(reverseDifference.text, similar.text);
const commonAndDifferent = await ask('客家蓝染和其他地方蓝染的相同点与不同点是什么？');
assert.match(commonAndDifferent.text, /相似处/);
assert.match(commonAndDifferent.text, /区别/);
const synonymComparison = await ask('客家蓝靛染与地方蓝靛染的共同点有哪些？');
assert.match(synonymComparison.text, /相似处/);
assert.match(synonymComparison.text, /都以植物蓝靛染色/);

const craftComparison = await ask('织带和竹编的工艺区别是什么？');
assert.match(craftComparison.text, /绠瓠子/);
assert.match(craftComparison.text, /破篾/);
assert.notEqual(craftComparison.matched, '客家织带工艺与传承');

const inheritor = await ask('织带是谁在传承？');
assert.match(inheritor.text, /廖秋华、黄竹英/);
assert.match(inheritor.text, /以公布的名录为准/);
const process = await ask('客家蓝染的制靛工艺怎么做？');
assert.match(process.text, /三浸三晒三发酵/);
const bambooSummary = await ask('杨村竹编有哪些常用工具？');
assert.match(bambooSummary.text, /度篾齿/);
const bambooFollowup = await ask('那制作步骤呢？');
assert.match(bambooFollowup.text, /起底/);
const weaveEntry = window.KNOWLEDGE_BASE.find((entry) => entry.id === 'v2-zhidai');
assert.match(weaveEntry.answer, /绠瓠子/);
assert.match(weaveEntry.answer, /带尺/);
assert.match(weaveEntry.answer, /冬头帕/);
const pendingArticle = window.KNOWLEDGE_BASE.find((entry) => entry.id === 'source-pending-wechat-patterns');
assert.match(pendingArticle.answer, /无法读取正文/);
assert.match(pendingArticle.sources[0].url, /mp\.weixin\.qq\.com/);
assert.doesNotMatch(pendingArticle.answer, /花鸟|几何|吉祥愿望/,
  'the inaccessible article must not contribute unverified cultural claims');

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

const proxyEngine = new ApiEngine();
proxyEngine.cfg.apiKey = '';
proxyEngine.cfg.proxyUrl = '/api/ai/chat/completions';
fetchImpl = async (url, init) => {
  assert.equal(url, '/api/ai/chat/completions');
  assert.equal(Object.hasOwn(init.headers, 'Authorization'), false,
    'browser-to-proxy requests must not contain an API key');
  return { ok: true, json: async () => ({ choices: [{ message: { content: '服务端代理路由成功。' } }] }) };
};
const proxySuccess = await proxyEngine.ask('潮汕工夫茶冲泡方法是什么？');
assert.equal(proxySuccess.source, 'api');
assert.match(proxySuccess.text, /服务端代理路由成功/);
assert.equal(fetchCalls, 2);

fetchImpl = async () => { throw new Error('offline'); };
const apiFallback = await apiEngine.ask('潮汕工夫茶冲泡方法是什么？');
assert.equal(apiFallback.source, 'rules');
assert.equal(apiFallback.fallback, true);
assert.equal(fetchCalls, 3);

const allKbText = JSON.stringify(window.KNOWLEDGE_BASE);
assert.doesNotMatch(allKbText, /茶果/, 'the disallowed Hakka tea-fruit section must not be ingested');
assert.doesNotMatch(weaveEntry.answer + window.KNOWLEDGE_BASE.find((entry) => entry.id === 'v2-zhubian').answer
  + window.KNOWLEDGE_BASE.find((entry) => entry.id === 'landye').answer, /\b(?:76|78)岁\b/,
  'unverified ages from the source text must not enter these new answers');
console.log('v2 knowledge checks passed: distinct and combined comparisons, reversed/synonym questions, source tracking, contextual follow-ups, non-tea docx coverage, API routing, and pending article status.');
