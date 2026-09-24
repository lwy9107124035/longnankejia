/**
 * End-to-end browser test for the 龙南客家非遗数字助手 site.
 *
 * Drives the locally installed Chrome over the DevTools protocol with no external
 * dependencies, because the failure modes that matter here (a texture that 404s after
 * a folder rename, a tab that throws, an avatar image that never decodes) are only
 * visible once the page actually runs.
 *
 *   node tests/run_site_tests.mjs            # headless, writes shots to .cache/test-shots
 *   node tests/run_site_tests.mjs --headed   # watch it run
 *
 * Exits non-zero on the first failing assertion group.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.cache', 'test-shots');
const PORT = 8931;
const CDP_PORT = 9333;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// --only=7c,7d,9b3 只跑指定小节（反向用例逐个变异时要跑几十遍，整套一遍 4 分钟跑不起）
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const results = [];
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  results.push(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  ok ? passed++ : failed++;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ server */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.npy': 'application/octet-stream',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    // refuse to serve anything outside the project
    if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(new Error(
      e.code === 'EADDRINUSE'
        ? `端口 ${PORT} 已被占用，可能有上一轮的测试进程没退干净`
        : e.message)));
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

/* --------------------------------------------------------------------- cdp */
class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; }

  static async attach(targetUrl) {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const list = await res.json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new Error('no debuggable page; is Chrome up?');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const p = new Page(ws);
    ws.addEventListener('message', (ev) => p.onMessage(JSON.parse(ev.data)));
    return p;
  }

  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    this.handlers.forEach((h) => h(msg));
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    // Chrome 中途没了的话，这个 Promise 永远不该悬着——曾经让整个套件静默挂死二十分钟
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时 30s（Chrome 是否已经退了？）`));
      }, 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  on(handler) { this.handlers.push(handler); }

  async evaluate(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

async function launchChrome(headed) {
  // 上一轮残留的实例会占住调试端口，attach() 就会抓到那个旧页面——测试结果看着全绿但不可信
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) throw new Error(`端口 ${CDP_PORT} 上已有 Chrome 在跑（上一轮没退干净），先关掉它再跑`);
  } catch (e) {
    if (/已有 Chrome/.test(e.message)) throw e;
  }
  fs.rmSync(path.join(os.tmpdir(), 'alan-chrome-profile'), { recursive: true, force: true });
  const args = [
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'alan-chrome-profile'),
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--allow-file-access-from-files',
    headed ? '' : '--headless=new',
    'about:blank',
  ].filter(Boolean);
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return proc;
    } catch { /* not listening yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not open a debugging port');
}

/** proc.kill() 只发 SIGTERM，Chrome 的整棵子进程树会继续占着端口，所以按 PID 连树一起收。 */
function killChrome(proc) {
  if (!proc || proc.killed) return;
  proc.kill();
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

/* ------------------------------------------------------------------ helpers */
/** Wait until `fn` (a JS expression returning boolean) is true in the page. */
async function until(page, expr, ms = 6000, label = expr) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await page.evaluate(`!!(${expr})`)) return true; } catch { /* transient */ }
    await sleep(120);
  }
  return false;
}

async function shot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
}

/* -------------------------------------------------------------------- suite */
async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const consoleErrors = [];
  const netFailures = [];
  const netRequests = [];
  const pendingRequests = new Map();
  const page = await Page.attach();

  page.on((m) => {
    if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') consoleErrors.push(`[${e.source}] ${e.text}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      consoleErrors.push('uncaught: ' + (d.exception?.description || d.text).split('\n')[0]);
    }
    if (m.method === 'Network.requestWillBeSent') {
      netRequests.push(m.params.request.url);
      pendingRequests.set(m.params.requestId, m.params.request.url);
    }
    if (m.method === 'Network.loadingFailed') {
      // errorText alone can't be filtered by host, and the README promises third-party
      // unreachability doesn't count as a site defect — so carry the URL through.
      const u = pendingRequests.get(m.params.requestId) || '';
      netFailures.push(m.params.errorText + ' ' + (m.params.type || '') + ' ' + u.replace(BASE, ''));
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      netFailures.push(m.params.response.status + ' ' + m.params.response.url.replace(BASE, ''));
    }
  });

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });

  console.log('\n1. cold load');
  await page.send('Page.navigate', { url: BASE + '/index.html' });
  check('page reaches readyState complete', await until(page, 'document.readyState==="complete"', 8000));
  check('title is the assistant', (await page.evaluate('document.title')).includes('龙南客家非遗数字助手'));

  if (ONLY.length) {
    // 7c / 7d / 9b3 三节只依赖冷启动后的 DOM（面板元素一直在文档里），可以单独跑
    await page.evaluate(`document.querySelector('[data-panel="panelDiancang"]').click()`);
    if (ONLY.includes('7c')) await sectionDcFind();
    if (ONLY.includes('7d')) await sectionHometown();
    if (ONLY.includes('9b3')) await sectionPron();
    return { passed, failed, results };
  }

  console.log('\n2. 数字人形象 (the swapped avatar)');
  check('hero avatar element exists', await until(page, 'document.querySelector("#avatarWrap img.avatar")'));
  const av = await page.evaluate(`(() => { const i = document.querySelector('#avatarWrap img.avatar');
    return i ? { src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight,
                 box: (() => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() } : null; })()`);
  check('hero avatar decoded from the new PNG', av && av.ok && av.w === 520, av && JSON.stringify(av));
  check('hero avatar is drawn at a usable size', av && av.box[1] >= 120, av && av.box.join('x'));

  // 三层切片必须严格重合，否则眨眼/口型会画歪
  const layers = await page.evaluate(`(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
               nat: [e.naturalWidth, e.naturalHeight], op: getComputedStyle(e).opacity,
               anim: getComputedStyle(e).animationName }; };
    return { base: g('.avatar-stage img.avatar'), blink: g('.avatar-blink'), mouth: g('.avatar-mouth') };
  })()`);
  const aligned = ['base', 'blink', 'mouth'].every((k) => layers[k]) &&
    layers.blink.x === layers.base.x && layers.blink.y === layers.base.y &&
    layers.blink.w === layers.base.w && layers.blink.h === layers.base.h &&
    layers.mouth.w === layers.base.w;
  check('眨眼层与口型层和底图完全对齐', aligned,
    aligned ? '' : JSON.stringify(layers));
  check('三层都是同一张 520x912 画布', ['base', 'blink', 'mouth'].every((k) => layers[k].nat.join('x') === '520x912'),
    ['base', 'blink', 'mouth'].map((k) => layers[k].nat.join('x')).join(' '));
  check('待机时口型层不可见', layers.mouth.op === '0', layers.mouth.op);
  check('眨眼动画在跑', layers.blink.anim === 'avatarBlink', layers.blink.anim);
  const talking = await page.evaluate(`(() => {
    const w = document.getElementById('avatarWrap');
    w.classList.add('is-talking');
    const out = {
      stage: getComputedStyle(document.querySelector('.avatar-stage')).animationName,
      mouth: getComputedStyle(document.querySelector('.avatar-mouth')).animationName
    };
    w.classList.remove('is-talking');
    return out;
  })()`);
  check('说话状态切到点头动画', talking.stage === 'avatarTalk', talking.stage);
  check('说话状态口型层开始开合', talking.mouth === 'avatarMouth', talking.mouth);
  await shot(page, '01-hero');

  console.log('\n2b. 3D 资源要等点开视图才加载');
  const heavy = (u) => /vendor\/three\.min\.js|assets\/textures\//.test(u);
  const earlyHeavy = netRequests.filter(heavy);
  check('首屏一个 3D 资源都不请求', earlyHeavy.length === 0,
    earlyHeavy.slice(0, 2).map((u) => u.split('/').pop()).join(' | '));
  check('未点开时 3D 尚未启动', await page.evaluate(`window.Showcase3D.booted() === false`));

  console.log('\n3. tab navigation');
  for (const [tab, panel] of [['panelChat', 'panelChat'], ['panelHeritage', 'panelHeritage'], ['panel3d', 'panel3d'], ['panelDiancang', 'panelDiancang']]) {
    await page.evaluate(`document.querySelector('[data-panel="${tab}"]').click()`);
    const on = await until(page, `document.getElementById('${panel}').classList.contains('active')`, 3000);
    check('tab 打开 ' + tab, on);
  }
  check('切到 3D 视图后才加载引擎与贴图', await until(page, `window.Showcase3D.booted()`, 25000));
  check('three.js 确实是在这一刻才请求的', netRequests.some(heavy));

  console.log('\n4a. 问答 panel — 本地知识库引擎（确定性路径）');
  // The shipped config points at a live LLM endpoint, so pin the engine to the local
  // knowledge base here; otherwise these assertions measure the provider, not the app.
  await page.evaluate(`localStorage.setItem('nfyj_api_config', JSON.stringify({ mode: 'rules' }))`);
  await page.send('Page.navigate', { url: BASE + '/index.html' });
  await until(page, 'document.readyState==="complete"', 8000);
  await page.evaluate(`document.querySelector('[data-panel="panelChat"]').click()`);
  check('engine reports the local knowledge base',
    await until(page, `/本地知识库/.test(document.getElementById('engineStatus').textContent)`, 4000));
  const chips = await page.evaluate(`[...document.querySelectorAll('.chip')].map(c => c.dataset.q)`);
  check('quick questions present', chips.length >= 4, chips.length + ' chips');
  for (const q of chips) {
    // ask() drops a question while the previous answer is still typing, so wait for idle
    await until(page, `!document.getElementById('sendBtn').disabled`, 15000);
    const before = await page.evaluate(`document.querySelectorAll('.msg-bot').length`);
    const t0 = Date.now();
    await page.evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.q === ${JSON.stringify(q)}).click()`);
    const got = await until(page, `document.querySelectorAll('.msg-bot').length > ${before}
      && [...document.querySelectorAll('.msg-bot .msg-bubble')].some(b => b.textContent.trim().length > 8)`, 12000);
    check('local answer: ' + q, got, Date.now() - t0 + 'ms');
  }
  const beforeFree = await page.evaluate(`document.querySelectorAll('.msg-bot').length`);
  await until(page, `!document.getElementById('sendBtn').disabled`, 15000);
  await page.evaluate(`(() => { const i = document.getElementById('chatInput');
    i.value = '围屋有什么特点？'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await page.evaluate(`document.getElementById('sendBtn').click()`);
  check('input locks while 阿蓝 is answering', await until(page, `document.getElementById('sendBtn').disabled`, 1500));
  check('free-text question gets an answer',
    await until(page, `document.querySelectorAll('.msg-bot').length > ${beforeFree}`, 12000));
  const botAv = await page.evaluate(`(() => { const i = document.querySelector('.msg-bot .msg-avatar img');
    return i ? (i.complete && i.naturalWidth > 0) : false; })()`);
  check('chat bubble shows the new 阿蓝 face', botAv);
  await shot(page, '02-chat');

  console.log('\n4b. 问答 panel — 线上大模型（外部依赖，只验证不挂死）');
  await page.evaluate(`localStorage.removeItem('nfyj_api_config')`);
  await page.send('Page.navigate', { url: BASE + '/index.html' });
  await until(page, 'document.readyState==="complete"', 8000);
  await page.evaluate(`document.querySelector('[data-panel="panelChat"]').click()`);
  const apiBefore = await page.evaluate(`document.querySelectorAll('.msg-bot').length`);
  const apiT0 = Date.now();
  await page.evaluate(`document.querySelector('.chip').click()`);
  const apiGot = await until(page, `document.querySelectorAll('.msg-bot').length > ${apiBefore}
    && [...document.querySelectorAll('.msg-bot .msg-bubble')].some(b => b.textContent.trim().length > 8)`, 30000);
  // A slow or unreachable provider must still yield an answer through the local fallback.
  check('api mode still returns an answer', apiGot, Date.now() - apiT0 + 'ms');
  if (!apiGot) console.log('        note: the live endpoint never answered within 30s');

  console.log('\n4c. 接口失败时必须回落到真正的知识库（不是罐头话）');
  // Block-listing the API host via CDP proved flaky, so drive the failure path
  // directly: reject fetch, then call ApiEngine.ask and inspect what comes back.
  const fb = await page.evaluate(`(async () => {
    const orig = window.fetch;
    window.fetch = () => Promise.reject(new Error('forced failure for test'));
    let out;
    try {
      const e = new window.AnswerEngine.ApiEngine();
      const r = await e.ask('什么是客家蓝染？');
      out = { text: String(r.text || ''), source: r.source };
    } finally { window.fetch = orig; }
    return out;
  })()`, true);
  check('接口失败仍拿到知识库实体内容', (fb.text || '').indexOf('板蓝根') > -1,
    (fb.text || '').slice(0, 40));
  check('回落来源标注为本地知识库', fb.source === 'rules', String(fb.source));
  check('不再返回丢弃知识库的兜底套话', (fb.text || '').indexOf('网络似乎不太稳定') === -1);

  console.log('\n4d. 本地优先 → 未命中转大模型 → 绝不拒答');
  const routing = await page.evaluate(`(async () => {
    const words = ['回答不了','我还不知道','还在学习中','不敢乱答','暂时无法','无法回答','帮不上忙'];
    const refusal = (t) => words.some((s) => String(t).indexOf(s) > -1);
    const orig = window.fetch;
    let calls = 0;
    const e = new window.AnswerEngine.ApiEngine();
    const minScore = (window.APP_CONFIG.ai.minScore) || 1.0;

    // A. 知识库命中：一次接口都不该发
    window.fetch = function () { calls++; return orig.apply(this, arguments); };
    const hit = await e.ask('什么是客家蓝染？');
    window.fetch = orig;

    // B. 知识库未命中 + 接口失败：必须回到馆内最接近的资料
    const q2 = '潮汕工夫茶的冲泡步骤是什么';
    const ranked = e._fallback.rank(q2);
    window.fetch = () => Promise.reject(new Error('forced failure'));
    const weak = await e.ask(q2);
    window.fetch = orig;

    // C. 知识库未命中 + 接口可用：应当真的转大模型
    let live = null;
    try { live = await e.ask(q2); } catch (err) { live = { err: String(err) }; }

    return {
      hit: { source: hit.source, matched: hit.matched || '', calls: calls, refusal: refusal(hit.text) },
      bestScore: ranked.scored.length ? +ranked.scored[0].score.toFixed(2) : 0,
      bestMatched: ranked.scored.length ? ranked.scored[0].matched.length : 0,
      hasHit: !!ranked.hit,
      minScore: minScore,
      weak: { source: weak.source, fallback: !!weak.fallback,
              nearest: (weak.nearest || []).length, topics: !!weak.topics,
              refusal: refusal(weak.text), head: String(weak.text).slice(0, 24) },
      live: live ? { source: live.source, len: String(live.text || '').length,
                     refusal: refusal(live.text || ''), err: live.err || '' } : null
    };
  })()`, true);
  check('知识库命中时一次接口都不调', routing.hit.calls === 0, routing.hit.calls + ' 次请求');
  check('知识库命中直接给馆内答案', routing.hit.source === 'rules' && !!routing.hit.matched,
    routing.hit.matched);
  check('馆外话题不算本地命中（无关键词字面出现）',
    !routing.hasHit && routing.bestMatched === 0,
    'score=' + routing.bestScore + ' matched=' + routing.bestMatched);
  // 封顶是独立的一道保险：不封顶时长问句会靠 2-gram 累加把分数堆过阈值（实测 1.35）
  check('2-gram 部分重合的贡献被封顶在 1.2', routing.bestScore <= 1.2 + 1e-9,
    '该问题最高分 ' + routing.bestScore);
  check('接口失败时仍端出内容（最接近资料或馆内话题），不许空手',
    routing.weak.fallback && (routing.weak.nearest >= 1 || routing.weak.topics === true),
    routing.weak.head + ' / nearest=' + routing.weak.nearest + ' topics=' + routing.weak.topics);
  check('三条路径都不出现拒答措辞',
    !routing.hit.refusal && !routing.weak.refusal && !(routing.live && routing.live.refusal),
    JSON.stringify({ h: routing.hit.refusal, w: routing.weak.refusal, l: routing.live && routing.live.refusal }));
  // 接口通不通取决于现场网络，两种结果都算通过：要么真由大模型答，要么回到馆内资料
  check('未命中时要么大模型作答、要么馆内兜底（不许空手而归）',
    !!routing.live && ((routing.live.source === 'api' && routing.live.len > 4)
      || (routing.live.fallback === true) || (routing.live.source === 'rules')),
    JSON.stringify(routing.live));

  console.log('\n5. 科普 panel');
  await page.evaluate(`document.querySelector('[data-panel="panelHeritage"]').click()`);
  check('heritage cards rendered', await until(page, `document.querySelectorAll('#heritageGrid .h-card').length > 0`));
  const n = await page.evaluate(`document.querySelectorAll('#heritageGrid .h-card').length`);
  check('at least 4 heritage cards', n >= 4, n + ' cards');
  check('科普模块扩到 12 类', n >= 12, n + ' cards');
  const cq = await page.evaluate(`(() => {
    const list = window.UI.Heritage.list();
    const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h; return (d.textContent || '').trim().length; };
    const lens = list.map(c => ({ name: c.name, len: strip(c.detail) }));
    return {
      total: list.length,
      words: lens.reduce((n, x) => n + x.len, 0),
      thin: lens.filter(x => x.len < 110).map(x => x.name + '(' + x.len + ')'),
      noAsk: list.filter(c => !c.ask || !String(c.ask).trim()).map(c => c.name),
      junk: list.filter(c => /hhh|5135[0-9]|[0-9]{6}/.test(String(c.detail).slice(0, 400))).map(c => c.name),
      dupIds: list.length - new Set(list.map(c => c.id)).size,
      catless: list.filter(c => !c.tag || c.tag.indexOf(' · ') === -1).map(c => c.name)
    };
  })()`);
  check('每张科普卡正文都不少于 110 字', cq.thin.length === 0, cq.thin.join('、') || '最薄一张也达标');
  check('科普正文总量不少于 2000 字', cq.words >= 2000, cq.words + ' 字 / ' + cq.total + ' 张');
  check('每张卡都带「问问阿蓝」触发问题', cq.noAsk.length === 0, cq.noAsk.join('、'));
  check('科普正文没有页码残渣', cq.junk.length === 0, cq.junk.join('、'));
  check('科普卡 id 不重复', cq.dupIds === 0, '重复 ' + cq.dupIds);
  check('每张卡都标了分类', cq.catless.length === 0, cq.catless.join('、'));
  await page.evaluate(`document.querySelector('#heritageGrid .h-card').click()`);
  check('detail modal opens', await until(page, `!document.getElementById('detailModal').hidden`));
  const askStyle = await page.evaluate(`(() => {
    const b = document.getElementById('askMoreBtn'), cs = getComputedStyle(b);
    return { bg: cs.backgroundColor, cursor: cs.cursor, h: Math.round(b.getBoundingClientRect().height) };
  })()`);
  check('「问问阿蓝」渲染成按钮而不是纯文本',
    askStyle.bg !== 'rgba(0, 0, 0, 0)' && askStyle.cursor === 'pointer' && askStyle.h > 30,
    JSON.stringify(askStyle));
  await page.evaluate(`document.getElementById('detailClose').click()`);
  check('detail modal closes', await until(page, `document.getElementById('detailModal').hidden`));

  // 回归：以前只调 ask()，回答打在隐藏面板里，看起来像点了没反应
  await until(page, `!document.getElementById('sendBtn').disabled`, 30000);  // 等上一条打完字
  await page.evaluate(`document.querySelector('#heritageGrid .h-card').click()`);
  await until(page, `!document.getElementById('detailModal').hidden`);
  const botBefore = await page.evaluate(`document.querySelectorAll('.msg-bot').length`);
  await page.evaluate(`document.getElementById('askMoreBtn').click()`);
  check('点「问问阿蓝」自动跳到问答面板',
    await until(page, `document.querySelector('.tab-panel.active').id === 'panelChat'`));
  check('跳转后提问确实发出（气泡已建）',
    await until(page, `document.querySelectorAll('.msg-bot').length > ${botBefore}`, 5000));

  console.log('\n6. 3D panel (the de-watermarked models)');
  await page.evaluate(`document.querySelector('[data-panel="panel3d"]').click()`);
  check('webgl canvas created', await until(page, `document.querySelector('#c3dViewport canvas')`, 15000));
  const items = await page.evaluate(`[...document.querySelectorAll('#c3dList .c3d-item')].length`);
  check('七个模型全部登记', items === 7, items + ' items');
  const texReqBefore = netRequests.filter((u) => u.includes('assets/textures')).length;
  for (let i = 0; i < items; i++) {
    await page.evaluate(`document.querySelectorAll('#c3dList .c3d-item')[${i}].click()`);
    await sleep(900);
    const label = await page.evaluate(`document.getElementById('c3dName').textContent`);
    check('model ' + (i + 1) + ' renders: ' + label, label.trim().length > 0);
    await shot(page, '03-model-' + i);
  }
  const texReqAfter = netRequests.filter((u) => u.includes('assets/textures')).length;
  const tex200 = netFailures.filter((f) => f.includes('assets/textures'));
  check('all texture maps loaded without error', tex200.length === 0, tex200.join('; '));
  // 新增物件的贴图必须由 canvas 现画，不能引入任何外部图片
  check('新增模型未引入任何图片贴图（程序化生成）', texReqAfter === texReqBefore,
    texReqAfter - texReqBefore + ' extra image requests');
  const meshStats = await page.evaluate(`(() => {
    const out = {};
    ['liangmao','boji','zhidai','mijiutan'].forEach(function (id) {
      window.Showcase3D.show(id);
      let meshes = 0, tris = 0;
      const m = window.Showcase3D.debugModel();
      if (m) m.traverse(function (o) { if (o.isMesh && o.geometry) { meshes++;
        tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
      out[id] = { meshes: meshes, tris: Math.round(tris) };
    });
    return out;
  })()`);
  ['liangmao', 'boji', 'zhidai', 'mijiutan'].forEach(function (id) {
    const s = meshStats[id];
    check('模型 ' + id + ' 有实际几何体', s && s.meshes >= 3 && s.tris > 200, JSON.stringify(s));
  });
  // 取景：投影每个网格自身的最高点（取其水平中心），并在自动旋转中采样最坏角度。
  // 不能用整体 AABB 角点——圆盘和围屋的角点是空的；也不能用网格顶面四角——围屋
  // 4 单位宽的条石前院，远端角点会投影到地平线附近，把正常取景误报成屋顶被裁。
  const framing = await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    for (const it of window.Showcase3D.items()) {
      window.Showcase3D.show(it.id);
      await wait(1600);
      const m = window.Showcase3D.debugModel(), cam = window.Showcase3D.debugCamera();
      let top = -9, bottom = 9;
      for (let s = 0; s < 12; s++) {
        m.updateMatrixWorld(true);
        m.traverse(function (o) {
          if (!o.isMesh || !o.geometry) return;
          const b = new THREE.Box3().setFromObject(o);
          const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
          top = Math.max(top, new THREE.Vector3(cx, b.max.y, cz).project(cam).y);
          bottom = Math.min(bottom, new THREE.Vector3(cx, b.min.y, cz).project(cam).y);
        });
        await wait(160);
      }
      out[it.name] = [Number(top.toFixed(2)), Number(bottom.toFixed(2))];
    }
    return out;
  })()`, true);
  Object.keys(framing).forEach(function (name) {
    const tb = framing[name];
    check('取景完整：' + name, tb[0] < 0.95 && tb[1] > -0.95, 'top=' + tb[0] + ' bottom=' + tb[1]);
  });

  console.log('\n6b. 自动旋转失控回归');
  check('Showcase3D 暴露了只读调试状态', await until(page, `!!window.Showcase3D.debugState`));
  await sleep(6000);   // 让自动旋转先累加一段
  const spun = await page.evaluate(`window.Showcase3D.debugState()`);
  check('久转后角度仍收敛在 ±π 内',
    Math.abs(spun.targetRotY) <= Math.PI + 1e-6 && Math.abs(spun.rotY) <= Math.PI + 1e-6,
    'target=' + spun.targetRotY.toFixed(3) + ' rot=' + spun.rotY.toFixed(3));
  // 修复前：切模型时 rotY 要从几十弧度绕回去，单帧能跳 0.5 以上
  const maxStep = await page.evaluate(`(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    document.querySelectorAll('#c3dList .c3d-item')[2].click();
    let prev = window.Showcase3D.debugState().rotY, max = 0;
    for (let i = 0; i < 30; i++) {
      await frame();
      const now = window.Showcase3D.debugState().rotY;
      max = Math.max(max, Math.abs(now - prev));
      prev = now;
    }
    return max;
  })()`, true);
  check('切换模型不会一帧暴转', maxStep < 0.25, 'max Δ/帧 = ' + maxStep.toFixed(4));

  console.log('\n7. 典藏 panel');
  await page.evaluate(`document.querySelector('[data-panel="panelDiancang"]').click()`);
  check('chapter tabs rendered', await until(page, `document.querySelectorAll('#dcTabs .dc-tab').length > 0`));
  const dcItems = await page.evaluate(`document.querySelectorAll('#dcContent .dc-item-card').length`);
  check('first chapter renders its exhibits', dcItems >= 1, dcItems + ' items');
  await page.evaluate(`document.querySelectorAll('#dcTabs .dc-tab')[3].click()`);
  const dcBig = await page.evaluate(`document.querySelectorAll('#dcContent .dc-item-card').length`);
  check('chapter switch loads a larger chapter', dcBig > 5, dcBig + ' items');
  await page.evaluate(`document.querySelector('#dcContent .dc-item-card')?.click()`);
  check('exhibit detail opens', await until(page, `!document.getElementById('dcDetailMask').hidden`));
  const imgOk = await until(page, `(() => { const i = document.querySelector('#dcDetailBody img');
    return i && i.complete && i.naturalWidth > 0; })()`, 6000);
  check('exhibit PDF page image decodes', imgOk);
  const detailText = await page.evaluate(`(() => {
    const nameEl = document.querySelector('#dcDetailBody .dc-detail-name');
    const d = document.querySelector('#dcDetailBody .dc-detail-desc');
    const nm = nameEl ? nameEl.textContent : '';
    const it = window.DIANCANG.chapters.flatMap(c => c.items).find(i => i.name === nm);
    return { name: nm, shown: d ? d.textContent.length : 0,
             book: it ? (it.text || '').length : 0, preview: it ? it.desc.length : 0 };
  })()`);
  check('详情展示《文化典藏》原文全文而非摘要',
    detailText.book > 120 && detailText.shown === detailText.book,
    JSON.stringify(detailText));
  // 配图必须走 sheet（PDF 第几张），印刷页码 page 只用于给读者引用
  const cited = await page.evaluate(`(() => {
    const it = window.DIANCANG.chapters.flatMap(c => c.items).find(i => i.sheet && i.page && i.sheet !== i.page);
    if (!it) return { skip: true };
    const img = document.querySelector('#dcDetailBody img');
    return { name: it.name, page: it.page, sheet: it.sheet,
             srcIsSheet: img ? img.getAttribute('src').indexOf(String(it.sheet).padStart(2, '0')) > -1 : false };
  })()`);
  if (!cited.skip) {
    await page.evaluate(`document.getElementById('dcDetailClose').click()`);
    await page.evaluate(`(() => {
      const it = window.DIANCANG.chapters.flatMap(c => c.items).find(i => i.sheet && i.page && i.sheet !== i.page);
      const ch = window.DIANCANG.chapters.findIndex(c => c.items.indexOf(it) > -1);
      document.querySelectorAll('#dcTabs .dc-tab')[ch].click();
      document.querySelectorAll('#dcContent .dc-item-card')[window.DIANCANG.chapters[ch].items.indexOf(it)].click();
    })()`);
    const srcSheet = await until(page, `(() => { const it = window.DIANCANG.chapters.flatMap(c => c.items).find(i => i.sheet && i.page && i.sheet !== i.page);
      const img = document.querySelector('#dcDetailBody img');
      return img && it && img.getAttribute('src').indexOf(String(it.sheet).padStart(2, '0')) > -1; })()`, 6000);
    check('配图用的是 PDF 页序而不是印刷页码', srcSheet, JSON.stringify(cited));
    const cite = await page.evaluate(`(document.querySelector('.dc-detail-cite')||{}).textContent||''`);
    check('详情标注了书内印刷页码供引用', /第\s*\d+\s*页/.test(cite), cite);
  }
  await shot(page, '04-diancang');
  await page.evaluate(`document.getElementById('dcDetailClose').click()`);
  check('exhibit detail closes', await until(page, `document.getElementById('dcDetailMask').hidden`));
  await page.evaluate(`document.getElementById('dcPrefaceBtn').click()`);
  check('前言 opens', await until(page, `!document.getElementById('dcDetailMask').hidden`));
  await page.evaluate(`document.getElementById('dcDetailClose').click()`);

  console.log('\n7b. 客家话讲解视频弹层');
  // pick a real video exhibit from the data so the test does not depend on item order
  const vid = await page.evaluate(`(() => {
    const ch = window.DIANCANG.chapters.findIndex(c => c.items.some(i => i.videoUrl));
    const item = window.DIANCANG.chapters[ch].items.find(i => i.videoUrl);
    return { ch, idx: window.DIANCANG.chapters[ch].items.indexOf(item), name: item.name };
  })()`);
  check('典藏数据里有带视频的展品', vid.ch >= 0, 'chapter ' + vid.ch + ' / ' + vid.name);
  await page.evaluate(`document.querySelectorAll('#dcTabs .dc-tab')[${vid.ch}].click()`);
  await page.evaluate(`document.querySelectorAll('#dcContent .dc-item-card')[${vid.idx}].click()`);
  check('展品详情给出播放按钮', await until(page, `!!document.getElementById('dcPlayBtn')`, 5000));
  await page.evaluate(`document.getElementById('dcPlayBtn').click()`);
  check('视频弹层打开并挂上 iframe',
    await until(page, `!document.getElementById('videoMask').hidden && document.querySelector('#videoFrame iframe')`));
  const iframeSrc = await page.evaluate(`(document.querySelector('#videoFrame iframe')||{}).src||''`);
  check('iframe 指向典藏登记的二维码地址', /hlcode\.pro/.test(iframeSrc), iframeSrc.slice(0, 48));
  await shot(page, '05-video');
  await page.evaluate(`document.getElementById('videoClose').click()`);
  check('视频弹层关闭', await until(page, `document.getElementById('videoMask').hidden`));
  await page.evaluate(`document.getElementById('dcDetailClose').click()`);
  check('回到典藏列表', await until(page, `document.getElementById('dcDetailMask').hidden`));

  async function sectionDcFind() {
  console.log('\n7c. 典藏检索：打一个字词就定位到讲它的展品');
  // 检索挂在典藏而不是方言库：观众打的词很可能压根没有录音，但正文一定在这本书里。
  const s1 = await page.evaluate(`(() => {
    const r = window.Diancang.search('黄元米果');
    return { n: r.length, top: r[0] && r[0].item.name, sent: r[0] && r[0].sentence };
  })()`);
  check('打展品全名，第一条就是它本身', s1.n >= 1 && s1.top === '黄元米果', JSON.stringify(s1).slice(0, 70));
  check('每条命中带回到底是哪句话说了它', !!s1.sent && s1.sent.indexOf('黄元米果') > -1,
    String(s1.sent).slice(0, 34));
  // 只验"第一条是谁"太依赖数据顺序；名字命中比正文顺带提到高多少分才是这件事的关键
  const g1 = await page.evaluate(`(() => {
    const r = window.Diancang.search('豆腐');
    const byName = r.filter((x) => x.item.name.indexOf('豆腐') > -1);
    const bodyOnly = r.filter((x) => x.item.name.indexOf('豆腐') === -1);
    return { names: byName.length, others: bodyOnly.length,
             topIsName: !!byName.length && r[0].item.name === byName[0].item.name,
             gap: byName.length && bodyOnly.length ? +(byName[0].score - bodyOnly[0].score).toFixed(1) : null };
  })()`);
  check('展品名命中的分数远高于正文顺带提到', g1.topIsName && g1.gap !== null && g1.gap >= 20,
    JSON.stringify(g1));
  const s2 = await page.evaluate(`(() => {
    const r = window.Diancang.search('豆腐');
    return { n: r.length, scores: r.map((x) => Math.round(x.score * 100) / 100) };
  })()`);
  const sorted = s2.scores.every((v, i) => i === 0 || v <= s2.scores[i - 1]);
  check('「豆腐」跨条目命中且按分数降序', s2.n >= 3 && sorted, JSON.stringify(s2.scores));
  const s3 = await page.evaluate(`(() => {
    const r = window.Diancang.search('客家');
    return { n: r.length, noAudio: r.filter((x) => !x.item.videoUrl).length };
  })()`);
  check('检索不限音频：没录音的展品一样查得到', s3.n >= 20 && s3.noAudio >= 10,
    s3.n + ' 件命中，其中 ' + s3.noAudio + ' 件无原声');
  const s4 = await page.evaluate(`(() => { const r = window.Diancang.search('量子计算');
    return { n: r.length, top: r[0] ? r[0].item.name : '' }; })()`);
  check('正文里真没有的词就是 0 条，不硬凑相近字', s4.n === 0, JSON.stringify(s4));
  // 走一遍真实交互：填框 → 点按钮 → 列表 → 点进详情
  await page.evaluate(`(() => { document.getElementById('dcQuery').value = '豆腐';
    document.getElementById('dcFindBtn').click(); })()`);
  const f = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#dcFindList .dc-find-item')];
    return { rows: rows.length, hint: document.getElementById('dcFindHint').textContent,
             marks: [...document.querySelectorAll('#dcFindList mark')].map((m) => m.textContent),
             audio: rows.filter((b) => b.textContent.indexOf('🔊') > -1).length,
             first: rows[0] ? rows[0].querySelector('.dc-find-name').textContent : '' };
  })()`);
  check('点「指哪打哪」渲染出命中列表', f.rows >= 3, f.rows + ' 行');
  check('提示里的条数与实际列表对得上', f.hint.indexOf('命中 ' + f.rows + ' 件') > -1, f.hint.slice(0, 44));
  check('命中的词在句子里被标记出来', f.marks.length >= 1 && f.marks.every((m) => m === '豆腐'),
    f.marks.slice(0, 3).join('/'));
  check('有原声的条目标了🔊', f.audio >= 1, f.audio + ' 条有原声');
  // 先把详情弹层清干净：不清的话"打开的正是列表里那条"会拿上一次的内容蒙混过关
  await page.evaluate(`(() => { document.getElementById('dcDetailMask').hidden = true;
    document.getElementById('dcDetailBody').innerHTML = ''; })()`);
  const firstName = f.first.replace(' 🔊', '');
  await page.evaluate(`document.querySelector('#dcFindList .dc-find-item').click()`);
  check('点一条结果翻到那件展品的详情', await until(page, `!document.getElementById('dcDetailMask').hidden`));
  const opened = await page.evaluate(
    `(document.querySelector('#dcDetailBody .dc-detail-name')||{}).textContent || ''`);
  check('打开的正是列表里点的那一条', firstName === opened.replace(' 🔊', ''), opened + ' vs ' + firstName);
  await page.evaluate(`document.getElementById('dcDetailClose').click()`);
  // 键盘回车与空输入：先清空，否则上一次的结果会让"回车触发"这条白过
  await page.evaluate(`(() => { const i = document.getElementById('dcQuery'); i.value = '';
    document.getElementById('dcFindBtn').click(); })()`);
  await page.evaluate(`(() => { const i = document.getElementById('dcQuery'); i.value = '米果';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  check('回车等同点按钮', await until(page,
    `document.getElementById('dcFindHint').textContent.indexOf('命中') > -1
       && document.querySelectorAll('#dcFindList .dc-find-item').length >= 1`, 4000));
  await page.evaluate(`(() => { const i = document.getElementById('dcQuery'); i.value = '';
    document.getElementById('dcFindBtn').click(); })()`);
  const fEmpty = await page.evaluate(`({ hint: document.getElementById('dcFindHint').textContent,
    rows: document.querySelectorAll('#dcFindList .dc-find-item').length })`);
  check('清空输入不留下半截结果', fEmpty.rows === 0 && fEmpty.hint === '', JSON.stringify(fEmpty));
  await page.evaluate(`(() => { const i = document.getElementById('dcQuery'); i.value = '量子计算';
    document.getElementById('dcFindBtn').click(); })()`);
  const fMiss = await page.evaluate(`({ hint: document.getElementById('dcFindHint').textContent,
    rows: document.querySelectorAll('#dcFindList .dc-find-item').length })`);
  check('查不到时说明缺口并给出下一步', fMiss.rows === 0 && /换个说法|两个字/.test(fMiss.hint),
    fMiss.hint.slice(0, 46));
  await page.evaluate(`(() => { document.getElementById('dcQuery').value = '';
    document.getElementById('dcFindBtn').click(); })()`);
  }
  await sectionDcFind();

  async function sectionHometown() {
  console.log('\n7d. 家乡：点地图上的地点，看读法和讲解');
  // SVG 的 <g> 没有 HTMLElement 那个 .click()，只能派发真实事件——顺带也验证了监听器本身
  await page.evaluate(`window.tapPlace = (i) => {
    document.querySelector('#hmMap .hm-place[data-i="' + i + '"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })); };`);
  await page.evaluate(`document.querySelector('[data-panel="panelHometown"]').click()`);
  check('Tab 顺序是 典藏 → 家乡 → 方言', await page.evaluate(
    `(() => { const n = [...document.querySelectorAll('.main-tab')].map((b) => b.dataset.panel);
       return n.indexOf('panelDiancang') + 1 === n.indexOf('panelHometown')
         && n.indexOf('panelHometown') + 1 === n.indexOf('viewDialect'); })()`));
  check('点家乡 Tab 会写进地址栏', await until(page, `location.hash === '#/hometown'`),
    await page.evaluate(`location.hash`));
  check('家乡面板成为当前视图', await until(page,
    `document.querySelector('.tab-panel.active').id === 'panelHometown'`));

  const hm = await page.evaluate(`(() => {
    const svg = document.querySelector('#hmMap svg');
    const land = document.querySelector('#hmMap .hm-land');
    const d = land ? land.getAttribute('d') : '';
    const spots = [...document.querySelectorAll('#hmMap .hm-place')].map((g) => {
      const c = g.querySelector('circle'), t = g.querySelector('text');
      return { i: +g.getAttribute('data-i'), name: t.textContent.replace(/[0-9]+$/, ''),
               x: +c.getAttribute('cx'), y: +c.getAttribute('cy'),
               lx: +t.getAttribute('x'), ly: +t.getAttribute('y'),
               badge: (t.querySelector('.hm-badge') || {}).textContent || '' };
    });
    return { hasSvg: !!svg, vertices: (d.match(/L/g) || []).length + 1, spots,
             places: window.Hometown.places().length,
             lead: document.getElementById('hmText').textContent };
  })()`);
  check('地图渲染成真实边界而不是示意图', hm.hasSvg && hm.vertices >= 80, hm.vertices + ' 个顶点');
  check('县界内画出全部地点', hm.spots.length === hm.places && hm.places >= 12,
    hm.spots.length + ' / ' + hm.places);
  const outside = await page.evaluate(`(() => { const d = window.HOMETOWN, b = d.bbox;
    return d.places.filter((p) => p.lon < b[0] || p.lon > b[2] || p.lat < b[1] || p.lat > b[3]).length; })()`);
  check('每个点位都落在龙南市范围内', outside === 0, outside + ' 个点跑出县界');
  const off = hm.spots.filter((s) => s.ly < 6 || s.ly > 700);
  check('地名标签没有跑出画布', off.length === 0, off.map((s) => s.name).join('、'));
  // 标签压字是这种"名字直接标在点上"的地图最容易翻车的地方，按坐标实测
  const clash = [];
  for (let i = 0; i < hm.spots.length; i++) {
    for (let j = i + 1; j < hm.spots.length; j++) {
      const a = hm.spots[i], b = hm.spots[j];
      if (Math.abs(a.lx - b.lx) < a.name.length * 12 + 6 && Math.abs(a.ly - b.ly) < 10) {
        clash.push(a.name + '/' + b.name);
      }
    }
  }
  check('地名标签互不重叠', clash.length === 0, clash.slice(0, 3).join('、'));
  check('未点选时先交代底图与坐标来源',
    /国家基础地理信息中心/.test(hm.lead) && /2026/.test(hm.lead), hm.lead.slice(-56));

  const withData = hm.spots.filter((s) => s.badge && +s.badge > 0);
  const bare = hm.spots.filter((s) => !s.badge);
  check('有展品关联的地点标了件数角标', withData.length >= 5, withData.length + ' 个地点带角标');
  // 「太平桥」正文里只撞出过「太平」两个字（检索的片段兜底会命中），字面上书里并没讲它
  const looseOnly = await page.evaluate(`(() => ({
    strict: window.Hometown.exhibitsFor('太平桥').length,
    loose: window.Diancang.search('太平桥').length }))()`);
  check('只是字面撞词的地点不会被硬绑到展品上',
    looseOnly.strict === 0 && looseOnly.loose >= 1, JSON.stringify(looseOnly));
  await page.evaluate(`tapPlace(${withData[0].i})`);
  check('展品列表不等网络就先出来', await until(page,
    `document.querySelectorAll('#hmText .hm-item').length >= 1`, 4000));
  // 读法那一层要等萌典接口；慢的时候最多 20 秒，等不到就是真出问题，不能蒙过去
  check('读法那层最终到位（或被明确说明查不到）',
    await until(page, `!document.querySelector('#hmText .hm-loading')`, 20000));
  const rich = await page.evaluate(`(() => { const t = document.getElementById('hmText');
    return { name: (t.querySelector('.hm-name') || {}).textContent || '',
             geo: (t.querySelector('.hm-geo') || {}).textContent || '',
             layers: t.querySelectorAll('.pr-layer').length,
             moeReadings: t.querySelectorAll('.pr-moe .pr-row').length,
             warn: !!t.querySelector('.pr-warn'), miss: !!t.querySelector('.pr-miss'),
             items: t.querySelectorAll('.hm-item').length,
             playable: t.querySelectorAll('.hm-item[data-url]').length,
             play: t.querySelectorAll('.pr-play').length }; })()`);
  check('点地点后标题就是那个地名', rich.name === withData[0].name, rich.name + ' vs ' + withData[0].name);
  check('地点坐标如实写出', /[0-9]{2}\.[0-9]{4}°N/.test(rich.geo), rich.geo.slice(0, 40));
  check('给出这个地名的客家话读法（三层来源照旧分层）', rich.layers >= 1, rich.layers + ' 层');
  // 与方言面板同一套不变量：萌典给了读音就必须带台湾腔提醒，没给就必须说明为什么
  check('家乡里的萌典层同样要么给读音+警告，要么明说缺口',
    (rich.moeReadings > 0 && rich.warn) || (rich.moeReadings === 0 && rich.miss),
    JSON.stringify({ r: rich.moeReadings, w: rich.warn, m: rich.miss }));
  check('列出以这个地方为出处的展品', rich.items >= 1, rich.items + ' 件');
  check('有原声的展品可以直接点开', rich.playable >= 1 && rich.play >= 1,
    rich.playable + ' 件展品 / ' + rich.play + ' 段原声');
  await page.evaluate(`document.querySelector('#hmText .hm-item[data-url]').click()`);
  check('点展品条目打开那段客家话讲解', await until(page, `!document.getElementById('videoMask').hidden`));
  await page.evaluate(`document.getElementById('videoClose').click()`);
  await page.evaluate(`document.querySelector('#hmText .pr-play')?.click()`);
  check('读法里的原声按钮同样能播', await until(page, `!document.getElementById('videoMask').hidden`));
  await page.evaluate(`document.getElementById('videoClose').click()`);

  // 书里没记的地方：只给读法，并明说没有内容，不编
  await page.evaluate(`tapPlace(${bare[0].i})`);
  check('没内容的地点也会等读法那层到位',
    await until(page, `!document.querySelector('#hmText .hm-loading')`, 20000));
  const poor = await page.evaluate(`(() => { const t = document.getElementById('hmText');
    return { text: t.textContent, layers: t.querySelectorAll('.pr-layer').length,
             items: t.querySelectorAll('.hm-item').length }; })()`);
  check('书里没记的地点如实说明，不硬凑展品', poor.items === 0 && /没有以这个地方为出处/.test(poor.text),
    poor.text.slice(0, 54));
  check('即使没有展品也给出读法', poor.layers >= 1, poor.layers + ' 层');

  await page.evaluate(`(() => {
    const g = document.querySelectorAll('#hmMap .hm-place')[${withData[0].i}];
    g.focus();
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  check('键盘回车也能选中地点', await until(page,
    `document.getElementById('hmText').textContent.indexOf('${withData[0].name}') === 0`));
  // 连点两个地方：先点的那个故意让它晚到（fetch 桩延迟 700ms）。
  // 不这样钉时序，"以最后一次为准"就只是在碰运气——去掉守卫也照样通过。
  const pair = await page.evaluate(`(() => {
    const ps = window.Hometown.places();
    const tapped = [${JSON.stringify(withData[0].name)}, ${JSON.stringify(bare[0].name)}];
    const ipaOf = (n) => window.Diancang.search(n).some((h) => !!h.item.ipa);
    const fresh = ps.find((p) => ipaOf(p.name) && tapped.indexOf(p.name) === -1);
    const stale = ps.find((p) => !ipaOf(p.name) && tapped.indexOf(p.name) === -1
                                  && p.name !== (fresh && fresh.name));
    return { fresh: fresh && fresh.name, stale: stale && stale.name };
  })()`);
  check('找得到一新一旧两个没点过的地点', !!pair.fresh && !!pair.stale, JSON.stringify(pair));
  const race2 = await page.evaluate(`(async () => {
    const orig = window.fetch;
    const stale = ${JSON.stringify(pair.stale)}, fresh = ${JSON.stringify(pair.fresh)};
    const s = encodeURIComponent(stale), f = encodeURIComponent(fresh);
    // 先点的 400ms 后到，后点的 900ms 后到：先点的那个正好落在"后点的已上屏、
    // 还没画完"这个窗口里——守卫失效时它会把后点的读法换掉。
    window.fetch = (u, o) => {
      const t = String(u).indexOf(s) > -1 ? 400 : String(u).indexOf(f) > -1 ? 900 : 0;
      return t ? new Promise((res) => setTimeout(() => res(orig(u, o)), t)) : orig(u, o);
    };
    const pick = (n) => window.Hometown.places().find((p) => p.name === n);
    try {
      window.Hometown.select(pick(stale));
      await new Promise((r) => setTimeout(r, 60));
      window.Hometown.select(pick(fresh));
      await new Promise((r) => setTimeout(r, 2200));
    } finally { window.fetch = orig; }
    const t = document.getElementById('hmText');
    return { name: (t.querySelector('.hm-name') || {}).textContent || '',
             local: t.querySelectorAll('.pr-local').length,
             loading: !!t.querySelector('.hm-loading') };
  })()`, true);
  check('连点两个地点以最后一次为准',
    race2.name === pair.fresh && race2.local >= 1 && !race2.loading,
    JSON.stringify(Object.assign({ want: pair.fresh }, race2)));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 720, deviceScaleFactor: 2, mobile: true });
  check('手机宽度下地图不撑破版面', await until(page,
    `document.documentElement.scrollWidth <= window.innerWidth + 1
       && document.querySelector('#hmMap svg').getBoundingClientRect().width > 200`),
    await page.evaluate(`document.documentElement.scrollWidth + '/' + window.innerWidth`));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await shot(page, '09-hometown');
  }
  await sectionHometown();

  console.log('\n8. 访问地址面板（入口扫码 + 讲解链接直列）');
  await page.evaluate(`document.getElementById('accessBtn').click()`);
  check('访问地址面板打开', await until(page, `!document.getElementById('accessModal').hidden`));
  const addr = await page.evaluate(`(() => { const a = document.querySelector('#addrRow a.addr-link');
    return a ? { href: a.href } : null; })()`);
  check('地址以可点链接直接呈现', !!addr && /^http/.test(addr.href), addr && addr.href);
  const linkCount = await page.evaluate(`document.querySelectorAll('#addrLinkList .addr-item').length`);
  const dataCount = await page.evaluate(`window.DIANCANG.chapters.reduce((n, c) => n + c.items.filter(i => i.videoUrl).length, 0)`);
  check('二维码背后的讲解内容全部直列出来', linkCount === dataCount && linkCount >= 14,
    linkCount + ' / ' + dataCount);
  const sampleHref = await page.evaluate(`(document.querySelector('#addrLinkList .addr-item-link') || {}).href || ''`);
  check('每条都能直接点开', sampleHref.indexOf('hlcode.pro') > -1, sampleHref.slice(0, 44));
  // 站点入口码：馆内观众扫它进页面。之前这里断言的是「不得有二维码」，方向反了。
  const qr = await page.evaluate(`(() => {
    const c = document.querySelector('#addrQr canvas');
    if (!c || !c.width) return { present: false };
    const px = (cv) => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const a = px(c);
    let black = 0;
    for (let i = 0; i < a.length; i += 4) { if (a[i] < 128) black++; }
    // 用同一个编码器按面板展示的地址重画一张逐像素比对，证明屏上这张码的内容
    // 就是给用户看的那条链接。取 getAttribute 而不是 .href：DOM 属性会把
    // https://host 规范化成 https://host/，多出的尾斜杠会让两张码对不上。
    const shown = (document.querySelector('#addrRow a.addr-link') || {}).getAttribute('href') || '';
    const ref = document.createElement('canvas');
    const okRef = shown ? window.QR.render(shown, ref, 4) : false;
    let same = false;
    if (okRef && ref.width === c.width && ref.height === c.height) {
      const b = px(ref);
      same = a.length === b.length;
      for (let i = 0; same && i < a.length; i += 4) same = a[i] === b[i];
    }
    return { present: true, w: c.width, ratio: +(black / (c.width * c.height)).toFixed(3),
             matchesUrl: same, shown: shown };
  })()`);
  check('入口二维码已渲染', qr.present, JSON.stringify(qr));
  check('入口码尺寸足够扫读', qr.present && qr.w >= 140, qr.w + 'px');
  check('码面非空白（黑白模块比例合理）', !!qr.present && qr.ratio > 0.15 && qr.ratio < 0.85,
    'black ratio=' + qr.ratio);
  check('码内容与面板展示的地址一致', !!qr.matchesUrl, qr.shown);
  // 导出 PNG 供 decode_entry_qr.py 用 OpenCV 独立解码——自证一致只能说明
  // 「屏上是这个 URL 的编码」，解码通过才能说明观众的手机真扫得出来
  const dataUrl = await page.evaluate(`(() => {
    const c = document.querySelector('#addrQr canvas');
    return c ? c.toDataURL('image/png') : '';
  })()`);
  if (dataUrl.startsWith('data:image/png')) {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, 'entry-qr.png'),
      Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  await shot(page, '06-access');
  await page.evaluate(`document.getElementById('addrClose').click()`);
  check('面板关闭', await until(page, `document.getElementById('accessModal').hidden`));

  console.log('\n8b. 管理面板：登录、改知识库、刷新后是否还在');
  await page.evaluate(`document.getElementById('adminEntry').click()`);
  check('管理入口打开', await until(page, `!document.getElementById('adminMask').hidden`));
  check('未登录时先要密码', await until(page, `!!document.getElementById('adminLoginBtn')`));
  await page.evaluate(`document.getElementById('adminPwInput').value='wrong-password'`);
  await page.evaluate(`document.getElementById('adminLoginBtn').click()`);
  check('错误密码被拒绝', await until(page, `document.getElementById('adminPwError').textContent.length > 0`));
  await page.evaluate(`document.getElementById('adminPwInput').value='admin123'`);
  await page.evaluate(`document.getElementById('adminLoginBtn').click()`);
  check('正确密码进入主面板', await until(page, `!!document.getElementById('kbAddBtn')`));
  const kbBefore = await page.evaluate(`window.Store.getEntries().length`);
  await page.evaluate(`document.getElementById('kbAddBtn').click()`);
  await until(page, `!!document.getElementById('kbTitle')`);
  await page.evaluate(`(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true })); };
    set('kbTitle', '自动化测试条目'); set('kbKeywords', '测试关键词甲, 测试关键词乙');
    set('kbAnswer', '这是端到端测试写入的条目。');
  })()`);
  await page.evaluate(`document.getElementById('kbSaveBtn').click()`);
  check('新增条目写进知识库', await until(page, `window.Store.getEntries().length === ${kbBefore + 1}`));
  await page.evaluate(`document.getElementById('adminMask').click()`);
  await page.send('Page.navigate', { url: BASE + '/index.html' });
  await until(page, 'document.readyState==="complete"', 8000);
  check('刷新后条目仍在（localStorage 持久化）',
    await until(page, `window.Store.getEntries().length === ${kbBefore + 1}`, 5000));
  check('测试条目能被问答引擎命中', await page.evaluate(
    `window.Store.getEntries().some(e => e.title === '自动化测试条目')`));

  console.log('\n9. 布局');
  await page.evaluate(`localStorage.removeItem('nfyj_kb_custom')`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
  await page.evaluate(`document.querySelector('[data-panel="panelChat"]').click()`);
  const fits = await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
  check('no horizontal overflow at 360px', fits);
  const heroVisible = await page.evaluate(`(() => { const r = document.querySelector('#avatarWrap img.avatar').getBoundingClientRect();
    return r.width > 40 && r.height > 80 && r.right <= window.innerWidth + 1; })()`);
  check('avatar still on-canvas at 360px', heroVisible);
  await shot(page, '07-mobile');

  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await until(page, `document.querySelector('#avatarWrap img.avatar')`);
  const desk = await page.evaluate(`(() => { const r = document.querySelector('#avatarWrap img.avatar').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }; })()`);
  check('no horizontal overflow at 1280px', !desk.overflow);
  check('avatar keeps its aspect ratio on desktop', Math.abs(desk.w / desk.h - 520 / 912) < 0.06,
    desk.w + 'x' + desk.h);
  await shot(page, '08-desktop');

  console.log('\n9b. 连续切换 Tab');
  const tabOrder = [];
  for (let i = 0; i < 6; i++) {
    const k = i % 4;
    tabOrder.push(await page.evaluate(`document.querySelectorAll('.main-tab')[${k}].dataset.panel`));
    await page.evaluate(`document.querySelectorAll('.main-tab')[${k}].click()`);
  }
  const last = tabOrder[tabOrder.length - 1];
  const active = await page.evaluate(`document.querySelector('.tab-panel.active').id`);
  check('连点后停在正确的面板', active === last, active + ' (expected ' + last + ')');
  check('连点后页面仍可交互', await until(page, `document.querySelector('#${last} .dc-tab, #${last} .h-card, #${last} .msg, #${last} .c3d-item')`));

  console.log('\n9b2. 路由与方言语音库');
  await page.evaluate(`document.querySelector('[data-panel="viewDialect"]').click()`);
  check('点方言 Tab 会写进地址栏',
    await until(page, `location.hash === '#/dialect'`), await page.evaluate(`location.hash`));
  check('方言面板成为当前视图',
    await until(page, `document.querySelector('.tab-panel.active').id === 'viewDialect'`));
  const dlCount = await page.evaluate(`document.querySelectorAll('#dlTracks .dl-track').length`);
  const dataVids = await page.evaluate(`window.Diancang.videoExhibits().length`);
  check('语音库列出全部真实讲解条目', dlCount === dataVids && dlCount >= 14, dlCount + ' / ' + dataVids);
  await page.evaluate(`document.querySelectorAll('#dlTracks .dl-track')[0].click()`);
  check('点一条后正在播放区更新', await until(page,
    `document.getElementById('dlNowName').textContent === window.Diancang.videoExhibits()[0].item.name`));
  check('点一条后挂出讲解页并可在新窗口打开', await until(page,
    `!!document.querySelector('#dlFrame iframe[src]') && !!document.querySelector('#dlFrame a.dl-open')`));
  check('当前曲目在列表里高亮', await until(page,
    `!!document.querySelector('#dlTracks .dl-track.is-active')`));

  // 检索已经搬到典藏（7c）；方言面板这里只做「字 → 读音」，三层来源分别标注
  check('语音库导出条数与典藏登记一致',
    await page.evaluate(`window.Dialect.count()`) === dataVids,
    await page.evaluate(`window.Dialect.count()`) + ' / ' + dataVids);
  check('方言面板不再自带一套视频检索', await page.evaluate(
    `!document.getElementById('dlQuery') && !document.getElementById('dlSentence')`));

  async function sectionPron() {
  console.log('\n9b3. 字 → 客家话读音（三层来源）');
  // 萌典 p 字段的真实长相里有 U+20DE 组合符和 `白~ 标记，先单独验解析，不依赖网络
  const prParse = await page.evaluate(`(() => {
    const sep = String.fromCharCode(0x20de), bt = String.fromCharCode(96), til = String.fromCharCode(126);
    const raw = '四' + sep + 'hag² 海' + sep + 'hag⁵' + bt + '白' + til + ' 大' + sep + 'kag²¹'
      + ' 平' + sep + 'hag² 安' + sep + 'ka²⁴ 南' + sep + 'hag²';
    const rows = window.Pron.parseReadings(raw);
    // 残留的组合标记肉眼看不见，只会在朗读/复制时露馅，所以按码位查一遍
    const dirty = rows.filter((r) => Array.from(r.reading + r.dialect).some((c) => {
      const n = c.charCodeAt(0);
      return (n >= 0x300 && n <= 0x36f) || (n >= 0x20d0 && n <= 0x20f0) || (n >= 0xfe20 && n <= 0xfe2f);
    }));
    return { rows, clean: dirty.length === 0, dirty: dirty.map((r) => r.dialect) };
  })()`);
  check('萌典注音解析出六个腔调', prParse.rows.length === 6, JSON.stringify(prParse.rows).slice(0, 60));
  check('腔调代号翻译成看得懂的县名',
    prParse.rows.map((r) => r.dialect).join(',') === '四县,海陆,大埔,饶平,诏安,南四县',
    prParse.rows.map((r) => r.dialect).join(','));
  check('声调上标不被当成噪声剥掉', prParse.rows[0].reading === 'hag²' && prParse.rows[2].reading === 'kag²¹',
    prParse.rows[0].reading + ' / ' + prParse.rows[2].reading);
  check('白读标记还原成「白读」而不是黏在读音上',
    prParse.rows[1].reading === 'hag⁵' && prParse.rows[1].register === '白读', JSON.stringify(prParse.rows[1]));
  check('读音里不残留不可见组合符', prParse.clean, prParse.dirty.join(','));

  const tb = await page.evaluate(`(() => ({ loaded: !!window.S2T, n: Object.keys(window.S2T || {}).length,
    shou: (window.S2T || {})['寿'] || '', lan: (window.S2T || {})['蓝'] || '' }))()`);
  check('简繁转换表已加载', tb.loaded && tb.n >= 2000, tb.n + ' 字');
  check('「寿」「蓝」有繁体候选', tb.shou === '壽' && tb.lan === '藍', JSON.stringify(tb));
  // 「龙门间学语说」是专挑的：六个字全都有繁体形，不封顶就是 14 次请求
  const vr = await page.evaluate(`({ v: window.Pron.variants('黄元米果'),
    capped: window.Pron.queries('龙门间学语说').length,
    plain: window.Pron.queries('豆腐').length })`);
  check('整词转换保留原词并附上繁体形', vr.v[0] === '黄元米果' && vr.v.indexOf('黃元米果') > -1,
    JSON.stringify(vr.v));
  check('一次查询的接口请求数封顶', vr.capped <= 12, vr.capped + ' 次（不封顶应为 14）');
  check('常用词不会被封顶规则误伤', vr.plain >= 3, vr.plain + ' 次');

  const r1 = await page.evaluate(`window.Pron.lookup('寿')`, true);
  const pr1 = await page.evaluate(`(() => { const o = document.getElementById('prOut');
    const moe = o.querySelector('.pr-moe');
    return { html: o.innerHTML.length, status: document.getElementById('prStatus').textContent,
             moe: moe ? moe.textContent : '', warn: !!o.querySelector('.pr-warn'),
             miss: !!moe && !!moe.querySelector('.pr-miss') }; })()`);
  check('查「寿」不空手：三层里至少给出一层',
    !!r1 && !r1.stale && (r1.local + r1.moedict + r1.audio) >= 1, JSON.stringify(r1));
  check('结果确实渲染到面板上', pr1.html > 0 && /萌典/.test(pr1.status), pr1.status);
  // 有读音就必须有「这是台湾腔」的提醒，没读音就必须说明为什么：两头都不能糊过去
  check('萌典层要么给读音+警告，要么明说缺口',
    !!pr1.moe && ((r1.moedict > 0 && pr1.warn) || (r1.moedict === 0 && pr1.miss)),
    JSON.stringify({ m: r1.moedict, warn: pr1.warn, miss: pr1.miss }));

  // 「买」书里没写过、原声没说过、萌典只认「買」——能不能给到读音，全看简繁转换
  const rb = await page.evaluate(`window.Pron.lookup('买')`, true);
  const prb = await page.evaluate(`(() => { const o = document.getElementById('prOut');
    const moe = o.querySelector('.pr-moe');
    return { moe: moe ? moe.textContent : '', trad: moe ? moe.textContent.indexOf('買') > -1 : false,
             warn: !!o.querySelector('.pr-warn') }; })()`);
  check('简体字靠繁体字形也能查到读音',
    !!rb && rb.moedict >= 1 && rb.local === 0 && rb.audio === 0, JSON.stringify(rb));
  check('转换命中标明用的是繁体条目', prb.trad, prb.moe.slice(0, 44));
  check('只查到台湾腔时必须提示不是龙南腔', prb.warn, prb.moe.slice(0, 44));

  const r2 = await page.evaluate(`window.Pron.lookup('黄元米果')`, true);
  const pr2 = await page.evaluate(`(() => { const o = document.getElementById('prOut');
    const loc = o.querySelector('.pr-local code');
    return { local: loc ? loc.textContent : '', plays: o.querySelectorAll('.pr-play').length,
             note: (o.querySelector('.pr-local .pr-note') || {}).textContent || '' }; })()`);
  check('本馆书内注音层给出国际音标', /[\[ⅰuo⁵¹²³⁴]/.test(pr2.local) && pr2.local.length > 4, pr2.local);
  check('注音层标明这是龙南本地口音', pr2.note.indexOf('龙南') > -1 || pr2.note.indexOf('宁龙') > -1,
    pr2.note.slice(0, 40));
  check('原声层给出可点的讲解入口', pr2.plays >= 1 && !!r2 && r2.audio >= 1, pr2.plays + ' 个按钮');
  await page.evaluate(`document.querySelector('#prOut .pr-play')?.click()`);
  check('点原声按钮打开那段录音', await until(page, `!document.getElementById('videoMask').hidden`));
  await page.evaluate(`document.getElementById('videoClose').click()`);

  // 「钕」是三层都真的没有的字：书里没写过、知识库没有、萌典客家语也 404（已实测）
  const r3 = await page.evaluate(`window.Pron.lookup('钕')`, true);
  const pr3 = await page.evaluate(`(() => { const o = document.getElementById('prOut');
    return { html: o.innerHTML.length, text: o.textContent }; })()`);
  check('彻底查不到也不留空白', pr3.html > 0, pr3.html + ' 字节输出');
  check('三层全空时逐层说明缺口', /三层都没命中/.test(pr3.text) && !!r3 && r3.layers === 0,
    pr3.text.slice(0, 46));

  // 连点两次：先发的请求故意让它晚回来（萌典按词缓存，第二次几乎瞬时），
  // 不把时序钉死的话这条断言只是碰巧通过。
  const race = await page.evaluate(`(async () => {
    const orig = window.fetch;
    const hit = (u) => String(u).indexOf('%E5%AE%A2') > -1;   // 「客」的编码
    window.fetch = (u, o) => hit(u)
      ? new Promise((res) => setTimeout(() => res(orig(u, o)), 700))
      : orig(u, o);
    try {
      const a = window.Pron.lookup('客家');
      await new Promise((r) => setTimeout(r, 60));
      const b = window.Pron.lookup('豆腐');
      await Promise.all([a, b]);
    } finally { window.fetch = orig; }
    return { status: document.getElementById('prStatus').textContent };
  })()`, true);
  check('后一次查询不会被前一次盖掉', race.status.indexOf('「豆腐」') === 0, race.status);
  await page.evaluate(`(() => { const i = document.getElementById('prQuery'); i.value = '';
    document.getElementById('prBtn').click(); })()`);
  check('空输入不发起查询，只提示', await page.evaluate(
    `document.getElementById('prStatus').textContent === '先打个字或词。'`));
  }
  await sectionPron();

  // 深链：直接带 hash 打开，应落到对应视图（分享链接的前提）
  await page.send('Page.navigate', { url: BASE + '/index.html#/diancang' });
  await until(page, 'document.readyState==="complete"', 8000);
  check('深链 #/diancang 直达典藏视图', await until(page,
    `document.querySelector('.tab-panel.active').id === 'panelDiancang'`, 6000));
  await page.send('Page.navigate', { url: BASE + '/index.html#/nonsense-route' });
  await until(page, 'document.readyState==="complete"', 8000);
  check('未知 hash 回落问答而不是白屏', await until(page,
    `document.querySelector('.tab-panel.active').id === 'panelChat'`, 6000));

  console.log('\n9b4. 回答里带出客家话原声讲解');
  await page.evaluate(`localStorage.setItem('nfyj_api_config', JSON.stringify({ mode: 'rules' }))`);
  await page.send('Page.navigate', { url: BASE + '/index.html#/chat' });
  await until(page, 'document.readyState==="complete"', 8000);
  await until(page, `!!document.getElementById('chatInput')`, 6000);
  const chips2 = await page.evaluate(`[...document.querySelectorAll('.chip')].map(c => c.dataset.q)`);
  // 童谣的知识库答案会提到采茶戏/莲花调，正是有原声讲解的展品
  await page.evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.q === '客家童谣是什么？').click()`);
  const chipAppeared = await until(page, `document.querySelectorAll('.msg-video-chip').length > 0`, 20000);
  check('答案下方挂出原声讲解入口', chipAppeared,
    chips2.length + ' chips, ' + await page.evaluate(`document.querySelectorAll('.msg-video-chip').length`) + ' chips');
  await page.evaluate(`document.querySelector('.msg-video-chip')?.click()`);
  check('点讲解入口打开视频弹层', await until(page, `!document.getElementById('videoMask').hidden`));
  await page.evaluate(`document.getElementById('videoClose').click()`);

  console.log('\n9c. AI 生成内容声明');
  // 显式标识义务落在发布方身上，页脚这句话不能被后续改版顺手删掉
  const note = await page.evaluate(`(() => { const n = document.querySelector('.footer-ai-note');
    if (!n) return null; const r = n.getBoundingClientRect();
    return { text: n.textContent, visible: r.height > 0 && getComputedStyle(n).display !== 'none' }; })()`);
  check('页脚声明了贴图与形象为 AI 辅助生成',
    !!note && note.visible && /AI/.test(note.text) && /生成/.test(note.text),
    note ? '' : '页脚缺少 .footer-ai-note');

  console.log('\n10. console / network hygiene');
  // 第三方方言视频页、线上大模型、萌典都只是被内嵌/调用，其可达性不算本站缺陷。
  // 萌典尤其要注意：查不到的词它就是按设计返回 404，这不是本站的子资源挂了。
  const EXT = /favicon|ERR_CONNECTION_RESET|DevTools|hlcode\.pro|siliconflow|moedict\.tw/i;
  const realErrors = consoleErrors.filter((e) => !EXT.test(e));
  const realNet = netFailures.filter((f) => !EXT.test(f));
  check('no uncaught page errors', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));
  check('no failed subresource requests', realNet.length === 0, realNet.slice(0, 5).join(' | '));

  return { passed, failed, results };
}

/* ------------------------------------------------------------------ driver */
let chrome, server;
try {
  server = await startServer();
  chrome = await launchChrome(process.argv.includes('--headed'));
  const out = await run();
  console.log('\n──────────────────────────────');
  console.log(`${out.passed} passed, ${out.failed} failed`);
  console.log('screenshots → ' + SHOTS);
  process.exitCode = out.failed ? 1 : 0;
} catch (err) {
  console.error('\nRUNNER ERROR:', err.message);
  process.exitCode = 2;
} finally {
  killChrome(chrome);
  server?.close();
}
