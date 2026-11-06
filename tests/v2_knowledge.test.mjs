import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function setup(custom) {
  const window = { APP_CONFIG: { ai: { mode: 'api', mockDelay: [0, 0], api: { proxyUrl: '/api/ai/chat/completions', model: 'test', temperature: 0.2, maxTokens: 900 } } } };
  const generations = [], audits = [], requests = [], timers = [], storage = new Map();
  let draft, audit, response, reject = false, rejectAudit = false, elapsed = 0, generationElapsed = 0;
  class Clock extends Date { static now() { return Date.now() + elapsed; } }
  const sandbox = { window, console: { warn() {} }, AbortController, Date: Clock, clearTimeout,
    setTimeout(fn, ms) { timers.push(ms); return setTimeout(fn, ms); },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (url, init) => {
      const call = { url, ...init, body: JSON.parse(init.body) }, checking = call.body.messages[0].content.startsWith('你是资料一致性审核员');
      requests.push(call); (checking ? audits : generations).push(call);
      if (reject || checking && rejectAudit) throw new Error('offline');
      if (response !== undefined) return { ok: true, json: async () => response };
      let report;
      if (checking) {
        const parts = JSON.parse(call.body.messages.at(-1).content).parts;
        report = audit ?? { checks: parts.map(part => ({ index: part.index, supported: true, quotes: [part.evidence[0].text] })) };
      } else {
        elapsed += generationElapsed;
        const quote = call.body.messages[0].content.match(/\[证据1\.1\] ([\s\S]*?)(?=\n\[证据|\n出处：|$)/)?.[1];
        report = draft ?? { parts: quote ? [{ text: '资料介绍：' + quote.trim(), evidence: ['1.1'] }] : [], gaps: [] };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(report) } }] }) };
    } };
  vm.createContext(sandbox);
  for (const file of ['content-schema.js', 'knowledge-base.js', 'store.js', 'answer-engine.js']) vm.runInContext(fs.readFileSync(new URL('../js/' + file, import.meta.url), 'utf8'), sandbox);
  if (custom) window.Store.addEntry(custom);
  return { window, generations, audits, requests, timers, setDraft: value => { draft = value; }, setAudit: value => { audit = value; }, setResponse: value => { response = value; }, fail: () => { reject = true; }, failAudit: () => { rejectAudit = true; }, advanceGeneration: ms => { generationElapsed = ms; }, rules: () => new window.AnswerEngine.RulesEngine(), api: () => new window.AnswerEngine.ApiEngine() };
}
const wheel = { id: 'custom-wheel', title: '陶轮', topics: ['陶轮'], keywords: ['陶轮', '脚踏'], answer: '馆内记录使用脚踏陶轮。', sources: [{ title: '用户展品记录', url: 'https://example.com/record' }] };

test('article headings do not displace factual paragraphs and name questions retrieve the recorded naming story', () => {
  const engine = setup().rules();
  const intro = engine.rank('介绍一下象塘水围');
  assert.ok(intro.chunks.some(chunk => /炮楼|墙厚|1260/.test(chunk.text)));
  assert.ok(intro.chunks.some(chunk => /渡江镇象塘村/.test(chunk.text)));
  assert.ok(intro.chunks.every(chunk => !/^[一二三四五六七八九十]+、[^。]{0,12}$/.test(chunk.text)));
  const name = engine.rank('象塘水围为什么叫水围？');
  assert.ok(name.chunks.some(chunk => /围中有井|井生水/.test(chunk.text)));
  assert.ok(name.chunks.filter(chunk => /围中有井|井生水/.test(chunk.text)).every(chunk => chunk.legend));
  engine.lastTopics = ['象塘水围'];
  assert.match(engine.resolve('那在哪里呢？'), /象塘水围/);
  assert.match(engine.resolve('那门票多少呢？'), /象塘水围/);
  assert.equal(engine.resolve('那潮汕工夫茶怎么冲泡？'), '那潮汕工夫茶怎么冲泡？');
});

test('merged knowledge retains paragraph-specific sources instead of attributing old material to a new science card', () => {
  const engine = setup().rules();
  const original = engine.chunks.find(chunk => chunk.entry.id === 'v2-zhidai' && chunk.text.includes('冬头帕由披肩'));
  assert.ok(original); assert.ok(original.sources.every(source => !source.title.startsWith('科普 · ')));
  assert.ok(engine.chunks.some(chunk => chunk.entry.id === 'v2-zhidai' && chunk.sources.some(source => source.title === '科普 · 龙南客家织带制作技艺')));
});

test('a naming story is labelled as folklore from the start even when the model adds a later attribution', async () => {
  const s = setup(), engine = s.api();
  const ranked = engine._fallback.rank('象塘水围为什么叫这个名字？');
  const chunkIndex = ranked.chunks.findIndex(chunk => chunk.legend && chunk.text.includes('井生水'));
  assert.ok(chunkIndex >= 0);
  s.setDraft({ parts: [{ text: '水围因围中有井而得名。据传地师曾调整布局。', evidence: [(chunkIndex + 1) + '.1'] }], gaps: [] });
  const answer = await engine.ask('象塘水围为什么叫这个名字？');
  assert.equal(answer.source, 'api'); assert.match(answer.text, /^据该条目记载的民间传说/);
});

test('a model approval with invented supporting quotes is rejected by the client', async () => {
  const s = setup(wheel); s.setDraft({ parts: [{ text: '陶轮起源于火星。', evidence: ['1.1'] }], gaps: [] });
  s.setAudit({ checks: [{ index: 0, supported: true, quotes: ['不存在于资料中的证明文字。'] }] });
  const answer = await s.api().ask('陶轮怎么驱动？'); assert.equal(answer.source, 'rules'); assert.doesNotMatch(answer.text, /火星/);
});

test('a bad proof removes only its own paragraph while typographic quote variants retain the supported answer', async () => {
  const item = { ...wheel, answer: '资料将脚踏方式称为“人力驱动”。' }, s = setup(item);
  s.setDraft({ parts: [{ text: '陶轮靠人力驱动。', evidence: ['1.1'] }, { text: '陶轮起源于火星。', evidence: ['1.1'] }], gaps: [] });
  s.setAudit({ checks: [{ index: 0, supported: true, quotes: ["资料将脚踏方式称为'人力驱动'。"] }, { index: 1, supported: true, quotes: ['这是不存在的资料原句。'] }] });
  const answer = await s.api().ask('陶轮怎么驱动？');
  assert.equal(answer.source, 'api'); assert.equal(answer.partial, true); assert.match(answer.text, /人力驱动/); assert.doesNotMatch(answer.text, /火星/);
});

test('cultural overviews and detailed questions use generation and source checking while identity stays local', async () => {
  const s = setup(), engine = s.api();
  const overview = await engine.ask('什么是客家蓝染？');
  assert.equal(overview.source, 'api'); assert.equal(overview.evidenceChecked, true); assert.equal(s.requests.length, 2);
  for (const question of ['织带和竹编的工具有什么不同？', '客家蓝染和其他地方蓝染的区别？', '脖围和大襟衫的结构有什么不同？', '门榜为什么被叫作微型族谱？']) assert.equal((await engine.ask(question)).source, 'api', question);
  assert.match(s.generations[1].body.messages[0].content, /带尺/); assert.match(s.generations[1].body.messages[0].content, /度篾齿/);
  assert.match(s.generations[2].body.messages[0].content, /南通/); assert.match(s.generations[2].body.messages[0].content, /白族/);
  assert.equal(s.audits.length, 5); assert.equal(s.generations[0].headers.Authorization, undefined);
});

test('followups retain conversation while a named new topic clears old retrieval', async () => {
  const s = setup(), engine = s.api(); await engine.ask('杨村竹编常用哪些工具？'); await engine.ask('那制作步骤呢？');
  const messages = s.generations[1].body.messages;
  assert.equal(messages.length, 4); assert.match(messages[1].content, /杨村竹编/); assert.equal(messages.at(-1).content, '那制作步骤呢？'); assert.match(messages[0].content, /起底/);
  await engine.ask('那潮汕工夫茶怎么冲泡？'); assert.equal(s.generations.length, 2);
  const followup = await engine.ask('那有哪些器具？'); assert.equal(followup.route, 'clarify'); assert.doesNotMatch(followup.text, /杨村|度篾齿/);
});

test('out-of-domain questions and shared generic words do not become confident local answers or consume model calls', async () => {
  const s = setup(), rules = s.rules();
  assert.equal(rules.rank('潮汕工夫茶冲泡步骤是什么？').chunks.length, 0);
  const answer = await s.api().ask('潮汕工夫茶冲泡步骤是什么？'); assert.equal(answer.route, 'uncovered'); assert.equal(s.requests.length, 0);
  assert.doesNotMatch(answer.text, /蓝染|竹编|我是/);
  const rank = rules.rank('大襟衫的背面纹样是否有实际照片？'); assert.ok(rank.chunks.length); assert.ok(rank.chunks.every(chunk => chunk.topics.includes('大襟衫')));
});

test('social, incomplete and identity turns remain local even when the model is unavailable', async () => {
  for (const mode of ['rules', 'api']) {
    const s = setup(), engine = s[mode](); s.fail();
    for (const q of ['嗯。', '嗯嗯，好呀。', '你好！', '你在吗？', '谢谢你', '明白了', '再见']) { const answer = await engine.ask(q); assert.equal(answer.route, 'conversation', q); assert.doesNotMatch(answer.text, /不足|核实|未覆盖/, q); }
    for (const q of ['请问', '我想问一下', '怎么做呢？', '继续']) { const answer = await engine.ask(q); assert.equal(answer.route, 'clarify', q); assert.match(answer.text, /补充|名称/); }
    for (const q of ['你是', '你是谁？', '嗯，你是哪个模型？', '阿蓝是谁？']) { const answer = await engine.ask(q); assert.equal(answer.route, 'overview', q); assert.match(answer.text, /我是「阿蓝」/); }
    assert.equal(s.requests.length, 0);
  }
});

test('acknowledgments preserve context without confusing a new factual question with a greeting', async () => {
  const s = setup(), engine = s.api(); await engine.ask('杨村竹编常用哪些工具？'); await engine.ask('嗯。'); await engine.ask('谢谢'); await engine.ask('怎么做呢？');
  assert.match(s.generations[1].body.messages[0].content, /起底/); assert.match(s.generations[1].body.messages.map(message => message.content).join('\n'), /嗯。/);
  assert.equal((await engine.ask('这个项目是做什么的？')).route, 'overview'); assert.equal(s.generations.length, 2);
  await engine.ask('你好，潮汕工夫茶怎么冲泡？'); assert.equal(s.generations.length, 2);
  await engine.ask('你是谁，蓝染需要99摄氏度吗？'); assert.equal(s.generations.length, 3); assert.match(s.generations[2].body.messages[0].content, /蓝染/); assert.doesNotMatch(s.generations[2].body.messages[0].content, /我是「阿蓝」/);
});

test('a source-supported paraphrase is displayed with its actual citation rather than replaced by the original article', async () => {
  const s = setup(wheel); s.setDraft({ parts: [{ text: '这类陶轮靠人的脚力带动，操作时用脚踏来驱动。', evidence: ['1.1'] }], gaps: [] });
  const answer = await s.api().ask('陶轮是怎么驱动的？');
  assert.equal(answer.source, 'api'); assert.equal(answer.citationKind, 'grounded-summary'); assert.equal(answer.evidenceChecked, true);
  assert.match(answer.text, /人的脚力/); assert.doesNotMatch(answer.text, /馆内记录使用脚踏陶轮/); assert.equal(answer.sources[0].url, wheel.sources[0].url);
  assert.equal(s.audits.length, 1); assert.match(s.audits[0].body.messages[1].content, /馆内记录使用脚踏陶轮/);
});

test('supported content is answered while an unknown parameter is marked as a partial gap', async () => {
  const s = setup(wheel); s.setDraft({ parts: [{ text: '陶轮用脚踏驱动。', evidence: ['1.1'] }], gaps: ['99转', '如何'] });
  const answer = await s.api().ask('陶轮如何驱动，每分钟是99转吗？');
  assert.equal(answer.source, 'api'); assert.equal(answer.partial, true); assert.match(answer.text, /用脚踏驱动/); assert.match(answer.text, /尚未记载“99转”/); assert.doesNotMatch(answer.text, /尚未记载“如何/);
});

test('an empty model draft cannot turn existing evidence into a whole-topic refusal', async () => {
  const s = setup(); s.setDraft({ parts: [], gaps: ['具体温度'] });
  const answer = await s.api().ask('蓝染的具体温度是多少？'); assert.equal(answer.source, 'rules'); assert.equal(answer.route, 'evidence'); assert.ok(answer.sources.length); assert.notEqual(answer.route, 'uncovered');
});

test('invalid citations and unsupported numbers never become model-written facts', async () => {
  const s = setup(wheel), engine = s.api(); s.setDraft({ parts: [{ text: '由脚踏驱动。', evidence: ['99.1'] }], gaps: [] });
  assert.equal((await engine.ask('陶轮怎么驱动？')).source, 'rules'); assert.equal(s.audits.length, 0);
  s.setDraft({ parts: [{ text: '陶轮必须每分钟99转。', evidence: ['1.1'] }], gaps: [] });
  const answer = await engine.ask('陶轮怎么驱动？'); assert.equal(answer.source, 'rules'); assert.doesNotMatch(answer.text, /99/); assert.equal(s.audits.length, 0);
});

test('semantic checking removes an unsupported place claim while preserving a supported paragraph', async () => {
  const s = setup(wheel); s.setDraft({ parts: [{ text: '陶轮用脚踏驱动。', evidence: ['1.1'] }, { text: '陶轮起源于火星。', evidence: ['1.1'] }], gaps: [] });
  s.setAudit({ checks: [{ index: 0, supported: true, quotes: [wheel.answer] }, { index: 1, supported: false }] });
  const answer = await s.api().ask('介绍陶轮的特点'); assert.equal(answer.source, 'api'); assert.equal(answer.partial, true); assert.match(answer.text, /脚踏/); assert.doesNotMatch(answer.text, /火星/);
});

test('unavailable or incomplete source checking falls back without displaying the unverified draft', async () => {
  for (const fail of ['offline', 'missing', 'duplicate']) {
    const s = setup(wheel); s.setDraft({ parts: [{ text: '未审核的特别说法。', evidence: ['1.1'] }], gaps: [] });
    if (fail === 'offline') s.failAudit(); else s.setAudit({ checks: fail === 'missing' ? [] : [{ index: 0, supported: true }, { index: 0, supported: true }] });
    const answer = await s.api().ask('陶轮怎么驱动？'); assert.equal(answer.source, 'rules'); assert.doesNotMatch(answer.text, /未审核的特别说法/); assert.ok(answer.sources.length);
  }
});

test('upstream failures retain relevant sourced excerpts and never expose reasoning_content', async () => {
  const s = setup(), engine = s.api(); s.fail();
  const answer = await engine.ask('杨村竹编和日本竹艺的工具有哪些区别？'); assert.equal(answer.source, 'rules'); assert.match(answer.text, /度篾齿/); assert.ok(answer.sources.length);
  const t = setup(); t.setResponse({ choices: [{ message: { content: '', reasoning_content: '不能展示的内部思考' } }] });
  const missing = await t.api().ask('蓝染具体发酵温度是多少？'); assert.equal(missing.source, 'rules'); assert.doesNotMatch(missing.text, /内部思考/);
});

test('draft gaps cannot smuggle an invented explanation or URL into the answer', async () => {
  const s = setup(wheel); s.setDraft({ parts: [{ text: '陶轮用脚踏驱动。', evidence: ['1.1'] }], gaps: ['资料未记载，但在日本通常为99转', 'https://example.net/'] });
  const answer = await s.api().ask('陶轮在日本如何驱动？'); assert.equal(answer.source, 'api'); assert.doesNotMatch(answer.text, /99|通常|example/);
});

test('generation and audit share one twenty-second deadline', async () => {
  const s = setup(wheel); s.advanceGeneration(16000); await s.api().ask('陶轮如何驱动？');
  assert.ok(s.timers.some(ms => ms > 19000 && ms <= 20000)); assert.ok(s.timers.some(ms => ms > 3000 && ms <= 4000));
});

test('the built-in Qwen3 proxy uses the smaller reviewer without changing the configured answer model', async () => {
  const s = setup(wheel), configured = s.window.Store.getEffectiveAi().api;
  configured.model = 'Qwen/Qwen3-30B-A3B-Instruct-2507';
  const engine = s.api(); engine.cfg = configured;
  await engine.ask('陶轮如何驱动？');
  assert.equal(s.generations[0].body.model, 'Qwen/Qwen3-30B-A3B-Instruct-2507');
  assert.equal(s.audits[0].body.model, 'Qwen/Qwen2.5-7B-Instruct');
  assert.equal(configured.model, 'Qwen/Qwen3-30B-A3B-Instruct-2507');
  engine.cfg = { ...configured, apiKey: 'local-test-placeholder' };
  await engine.ask('陶轮如何驱动？');
  assert.equal(s.audits[1].body.model, configured.model);
  assert.deepEqual(s.audits[1].body.response_format, { type: 'json_object' });
});

test('imported custom knowledge preserves its topics and provenance', () => {
  const s = setup(wheel); assert.equal(s.window.Store.importKB(JSON.stringify([wheel])), true);
  const imported = s.window.Store.getEntries().find(entry => entry.id === wheel.id); assert.equal(imported.sources[0].url, wheel.sources[0].url); assert.equal(imported.topics[0], '陶轮');
});

test('curated article facts stay present while excluded material and contradictory ages remain excluded', () => {
  const { window } = setup(), text = JSON.stringify(window.KNOWLEDGE_BASE); assert.doesNotMatch(text, /茶果|待核验微信文章|无法读取正文/);
  const article = window.KNOWLEDGE_BASE.filter(entry => entry.id.startsWith('pattern-')); assert.ok(article.length >= 8); assert.ok(article.every(entry => entry.sources.length));
  assert.match(window.KNOWLEDGE_BASE.find(entry => entry.id === 'indigo-process').answer, /没有逐道列明/);
  assert.doesNotMatch(window.KNOWLEDGE_BASE.find(entry => entry.id === 'weave-people').answer, /76岁|78岁/);
});

test('public answers and source labels contain no internal document filenames', async () => {
  const { window } = setup(); assert.doesNotMatch(JSON.stringify(window.KNOWLEDGE_BASE), /非遗\.docx|\.docx|\.pdf|用户下载PDF/i);
  const engine = new window.AnswerEngine.RulesEngine();
  for (const q of ['什么是客家织带？', '杨村竹编有什么工具？', '客家蓝染有什么历史？', '冬头帕有哪些组成？', '子孙袋的结构是什么？']) {
    const answer = await engine.ask(q); assert.doesNotMatch(answer.text, /非遗\.docx|\.docx|\.pdf|用户下载PDF/i);
    for (const source of answer.sources || []) assert.doesNotMatch(source.title, /非遗\.docx|\.docx|\.pdf|用户下载PDF/i);
  }
});
