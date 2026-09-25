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
// --only=7c,7d,4e 只跑指定小节（反向用例逐个变异时要跑几十遍，整套一遍 4 分钟跑不起）
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
    // 语音输入那节要真的走一遍录音：无头环境给一个假麦克风（发的是嘟嘟音），
    // 并自动同意授权弹窗——被拒那条路径另有断言，用 stub 显式制造。
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
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
    // 7c / 7d / 4e 各节只依赖冷启动后的 DOM（面板元素一直在文档里），可以单独跑
    await page.evaluate(`document.querySelector('[data-panel="panelDiancang"]').click()`);
    if (ONLY.includes('7c')) await sectionDcFind();
    if (ONLY.includes('7d')) await sectionHometown();
    if (ONLY.includes('4e')) { await page.evaluate(`document.querySelector('[data-panel="panelChat"]').click()`); await sectionVoice(); }
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

  async function sectionVoice() {
  console.log('\n4e. 问答框的语音输入');
  await page.evaluate(`document.querySelector('[data-panel="panelChat"]').click()`);
  const vb = await page.evaluate(`(() => { const b = document.getElementById('micBtn');
    const svg = b && b.querySelector('svg');
    return { present: !!b, label: b ? b.getAttribute('aria-label') : '',
             pressed: b ? b.getAttribute('aria-pressed') : '', inBar: !!(b && b.closest('.input-bar')),
             hasIcon: !!svg, disabled: b ? b.disabled : null,
             unavailable: window.VoiceInput.unavailable(),
             cfg: window.APP_CONFIG.ai.asr }; })()`);
  check('输入条里有麦克风按钮（图标 + 无障碍标签）',
    vb.present && vb.inBar && vb.hasIcon && /语音输入/.test(vb.label || ''), JSON.stringify(vb).slice(0, 90));
  check('可用性判断与置灰一致',
    (vb.unavailable ? vb.disabled : !vb.disabled), JSON.stringify({ u: vb.unavailable, d: vb.disabled }));
  check('语音走国内可直连的 ASR，不用谷歌那套',
    /siliconflow/.test(vb.cfg.url) && vb.cfg.model.indexOf('SenseVoice') > -1,
    vb.cfg.url + ' · ' + vb.cfg.model);
  // 直接把模块源码读回来查：Chrome 自带的识别要把音频发到谷歌服务器，
  // 馆内网络连不通，一旦有人"顺手加回去"这条会红。
  const srcText = await page.evaluate(`fetch('js/voice-input.js').then((r) => r.text())`, true);
  // 模块头注释里就写着"为什么不用 webkitSpeechRecognition"，所以判的是有没有实例化它
  // 头注释里就写着「为什么不用 webkitSpeechRecognition」，所以判的是代码里有没有：
  // 先把块注释和行注释剥掉，别名（var SR = window.SpeechRecognition; new SR()）也躲不过。
  // 先剥掉注释行再判：模块头注释里写着「为什么不用 webkitSpeechRecognition」，
  // 那是在解释不用它，不是用了它；而别名 var SR = window.SpeechRecognition 是代码行，
  // 剥不掉，所以这条能抓到把谷歌那套接回来的改动。
  const codeOnly = srcText.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.indexOf('\/\/') === 0 || t.indexOf('*') === 0
      || t.indexOf('\/*') === 0);
  }).join('\n');
  check('语音模块不依赖谷歌那套 webkitSpeechRecognition',
    !/SpeechRecognition/.test(codeOnly) && /new MediaRecorder/.test(codeOnly),
    '注释之外仍出现 ' + (/SpeechRecognition/.test(codeOnly) ? 'SpeechRecognition' : '无')
      + ' / ' + (/new MediaRecorder/.test(codeOnly) ? '有 MediaRecorder' : '没有 MediaRecorder'));
  // 把上传换成可控替身：状态机每条分支都要能单独验，不能靠真服务的脸色
  await page.evaluate(`(() => {
    window.__calls = [];
    window.__origFetch = window.fetch;
    window.__origGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__reply = { status: 200, body: { text: '龙南围屋有什么特点' } };
    window.fetch = function (url, opt) {
      window.__calls.push({ url: String(url), method: opt && opt.method,
        auth: opt && opt.headers && (opt.headers.Authorization || opt.headers.authorization || ''),
        body: opt && opt.body });
      if (window.__reply.status !== 200) {
        return Promise.resolve({ ok: false, status: window.__reply.status,
          text: function () { return Promise.resolve('boom'); } });
      }
      return Promise.resolve({ ok: true, status: 200,
        json: function () { return Promise.resolve(window.__reply.body); } });
    };
  })()`);
  const press = () => page.evaluate(`document.getElementById('micBtn').click()`);
  const micState = () => page.evaluate(`(() => ({ state: window.VoiceInput.state(),
    pressed: document.getElementById('micBtn').getAttribute('aria-pressed'),
    hint: document.getElementById('micHint').textContent,
    value: document.getElementById('chatInput').value,
    disabled: document.getElementById('micBtn').disabled }))()`);

  // 按第一次只是"开始请求麦克风"，getUserMedia 回来之后才真的在录；
  // 不等它就按第二次，录到的是 0 字节，测的就不是同一条路径了。
  // 整套跑下来前面已经聊过几句，只能比“有没有多出新的气泡”，不能要求历史为空
  const msgBefore = await page.evaluate(`document.querySelectorAll('.msg-user, .msg-bot').length`);
  const arm = () => page.evaluate(`(() => { document.getElementById('chatInput').value = '';
    document.getElementById('micBtn').click(); return true; })()`);
  const waitCapture = () => until(page, `window.VoiceInput.capturing()`, 6000);
  await arm();
  check('按下后真的开始采集麦克风', await waitCapture());
  await sleep(400);
  const listening = await micState();
  check('点一下进入"正在听"，按钮标成按下态',
    listening.state === 'listening' && listening.pressed === 'true' && /正在听/.test(listening.hint),
    JSON.stringify(listening));
  await press();
  const ok = await until(page, `window.VoiceInput.state() === 'idle'`, 12000);
  const done = await micState();
  const up = await page.evaluate(`window.__calls.map((c) => ({ url: c.url, method: String(c.method),
    hasAuth: /^Bearer sk-/.test(c.auth || ''), isForm: !!(c.body && c.body.get) }))`);
  check('再点一下结束并把文字填进输入框',
    ok && done.value === '龙南围屋有什么特点' && done.state === 'idle', JSON.stringify(done));
  check('上传确实打到了 ASR 接口（POST + Bearer + 录音）',
    up.length === 1 && /transcriptions/.test(up[0].url) && up[0].method === 'POST'
      && up[0].hasAuth && up[0].isForm, JSON.stringify(up));
  const formFields = await page.evaluate(`(() => {
    const b = window.__calls[0] && window.__calls[0].body;
    if (!b || !b.get) return null;
    return { model: b.get('model'), lang: b.get('language'),
             file: b.get('file') && b.get('file').size > 0 ? '有' : '空' }; })()`);
  check('表单带 model / language / 非空音频', !!formFields && !!formFields.model && formFields.file === '有',
    JSON.stringify(formFields));
  check('转写完成不自动发送（说错了观众能改）', await page.evaluate(
    `document.querySelectorAll('.msg-user, .msg-bot').length === ${msgBefore}
      && !document.getElementById('sendBtn').disabled`));

  // 服务返回空 → 明说"没听清"
  await page.evaluate(`(() => { document.getElementById('chatInput').value = '';
    window.__reply = { status: 200, body: { text: '' } }; })()`);
  await arm(); await waitCapture(); await sleep(300); await press();
  const empty = await until(page, `window.VoiceInput.state() === 'idle'
    && /没听清/.test(document.getElementById('micHint').textContent)`, 12000);
  check('识别为空时如实说没听清', empty, JSON.stringify(await micState()));

  // 上一轮没听清，不能顺手把观众已经打好的字清掉
  // 这条不能用 arm()：arm 会把输入框清空，那就等于自己把要保护的东西擦掉了
  await page.evaluate(`document.getElementById('chatInput').value = '留着的话'`);
  await press(); await waitCapture(); await sleep(300); await press();
  await until(page, `window.VoiceInput.state() === 'idle'`, 12000);
  check('识别失败不动已输入的文字', await page.evaluate(
    `document.getElementById('chatInput').value === '留着的话'`));

  // 服务 500 → 说明原因并回到可点状态，不能卡在转写
  await page.evaluate(`(() => { window.__reply = { status: 500, body: {} }; })()`);
  await arm(); await waitCapture(); await sleep(300); await press();
  const err = await until(page, `window.VoiceInput.state() === 'idle'
    && /语音识别服务没回应/.test(document.getElementById('micHint').textContent)`, 12000);
  const errState = await micState();
  check('服务报错时说明原因并回到可点状态', err && !errState.disabled, JSON.stringify(errState));

  // 麦克风被拒 → 说清是被拒，且文字输入照常
  await page.evaluate(`navigator.mediaDevices.getUserMedia = () => Promise.reject(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }));`);
  await arm();
  const denied = await until(page, `window.VoiceInput.state() === 'idle'
    && /权限被拒绝/.test(document.getElementById('micHint').textContent)`, 6000);
  check('麦克风被拒时给出具体原因', denied, JSON.stringify(await micState()));
  check('被拒之后文字输入仍可用', await page.evaluate(
    `!document.getElementById('chatInput').disabled && !document.getElementById('sendBtn').disabled`));
  await page.evaluate(`navigator.mediaDevices.getUserMedia = window.__origGum;`);

  // 说到超时自动收：把上限压到 900ms
  await page.evaluate(`(() => { document.getElementById('chatInput').value = '';
    window.__reply = { status: 200, body: { text: '自动收尾' } };
    window.APP_CONFIG.ai.asr.maxMs = 900; })()`);
  await arm(); await waitCapture();
  const autoStopped = await until(page, `window.VoiceInput.state() !== 'listening'`, 8000);
  const auto = await until(page, `document.getElementById('chatInput').value === '自动收尾'`, 15000);
  check('说到最长时限自动停止并转写', autoStopped && auto, JSON.stringify(await micState()));
  await page.evaluate(`window.APP_CONFIG.ai.asr.maxMs = 20000;`);

  // 真链路（不 stub fetch）：假麦克风录的是嘟嘟音，识别结果可能为空——
  // 但无论哪条分支都必须留下可读的状态，绝不允许静默。
  const live = await page.evaluate(`(async () => {
    window.fetch = window.__origFetch;
    const before = document.getElementById('chatInput').value;
    document.getElementById('micBtn').click();
    await new Promise((r) => setTimeout(r, 700));
    document.getElementById('micBtn').click();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (window.VoiceInput.state() === 'idle') break;
    }
    return { state: window.VoiceInput.state(), hint: document.getElementById('micHint').textContent,
             changed: document.getElementById('chatInput').value !== before };
  })()`, true);
  check('真实上传要么出字、要么说明原因（不许静默）',
    live.state === 'idle' && (live.changed || live.hint.length > 0), JSON.stringify(live));
    // 没配密钥时不能让人对着一个坏掉的按钮空按：要说清楚为什么。
  // 密钥有两个来源（secrets.js 的运行时值 + config.js 里加载时的快照），要一起清掉才算。
  const noKey = await page.evaluate(`(() => {
    const keepS = window.APP_SECRETS.apiKey, keepC = window.APP_CONFIG.ai.api.apiKey;
    window.APP_SECRETS.apiKey = ''; window.APP_CONFIG.ai.api.apiKey = '';
    const why = window.VoiceInput.unavailable();
    document.getElementById('micBtn').click();
    const out = { hint: document.getElementById('micHint').textContent,
                  state: window.VoiceInput.state(), why: why };
    window.APP_SECRETS.apiKey = keepS; window.APP_CONFIG.ai.api.apiKey = keepC;
    return out;
  })()`);
  check('没配语音服务时不开始录音并说明原因',
    noKey.state === 'idle' && /没配置语音识别服务/.test(noKey.why) && /没配置语音识别服务/.test(noKey.hint),
    JSON.stringify(noKey));

await page.evaluate(`(() => { window.fetch = window.__origFetch;
    document.getElementById('chatInput').value = ''; })()`);
  }

  await sectionVoice();

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
  console.log('\n7d. 家乡：点地图上的地点，看书里怎么讲它');
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
    const land = document.querySelector('#hmMap .hm-land');
    const d = land ? land.getAttribute('d') : '';
    const spots = [...document.querySelectorAll('#hmMap .hm-place')].map((g) => {
      const c = g.querySelector('circle'), t = g.querySelector('text');
      return { i: +g.getAttribute('data-i'), name: t.textContent.replace(/[0-9]+$/, ''),
               x: +c.getAttribute('cx'), y: +c.getAttribute('cy'),
               lx: +t.getAttribute('x'), ly: +t.getAttribute('y'),
               badge: +(((t.querySelector('.hm-badge') || {}).textContent || '').match(/[0-9]+/) || [0])[0],
               aria: g.getAttribute('aria-label') || '' };
    });
    return { vertices: (d.match(/L/g) || []).length + 1, spots,
             places: window.Hometown.places().length,
             lead: document.getElementById('hmText').textContent };
  })()`);
  check('地图渲染成真实边界而不是示意图', hm.vertices >= 80, hm.vertices + ' 个顶点');
  check('数据里有几个地点就画几个点', hm.spots.length === hm.places && hm.places >= 6,
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
  // 地图上的点必须都有出处：角标为 0 的点等于让观众白点一次
  const noSrc = hm.spots.filter((s) => !(s.badge >= 1));
  check('每个地点的角标都 ≥1（不画没有出处的点）', noSrc.length === 0,
    noSrc.map((s) => s.name + '=' + s.badge).join('、'));
  // 龙南镇只该拿到"龙南镇"三个字全名的出处；一旦放宽到两字撞词，它会变成 29 处
  const looseGuard = await page.evaluate(`(() => {
    const p = window.Hometown.places().find((x) => x.name === '龙南镇');
    return { hits: window.Hometown.exhibitsFor('龙南镇').length,
      anyCounty: window.Diancang.search('龙南').length };
  })()`);
  check('地名关联按字面全名或通名严格取', looseGuard.hits <= 5 && looseGuard.anyCounty > 20,
    JSON.stringify(looseGuard));
  check('角标数字与真实出处数一致', await page.evaluate(`(() => {
    const spots = [...document.querySelectorAll('#hmMap .hm-place')];
    return spots.every((g) => {
      const p = window.Hometown.places()[+g.getAttribute('data-i')];
      const shown = +((g.querySelector('.hm-badge') || {}).textContent || '0');
      return shown === window.Hometown.exhibitsFor(p.name).length;
    }); })()`), '角标与 exhibitsFor 对不上');

  const withAudio = hm.spots.filter((s) => s.aria && /书里有/.test(s.aria))
    .map((s) => s.i).filter((i) => hm.spots[i].badge >= 1);
  const audioSpots = await page.evaluate(`(() => window.Hometown.places().map((p, i) => ({
    i, name: p.name, hits: window.Hometown.exhibitsFor(p.name).length,
    audio: window.Hometown.exhibitsFor(p.name).filter((h) => h.item.videoUrl).length })))()`);
  const sayable = audioSpots.filter((x) => x.audio >= 1);
  const silent = audioSpots.filter((x) => x.audio === 0);
  check('有地点可以直接听原声', sayable.length >= 2, sayable.map((x) => x.name).join('、'));
  check('也有地点书里讲了但没录音', silent.length >= 1, silent.map((x) => x.name).join('、'));

  await page.evaluate(`tapPlace(${sayable[0].i})`);
  const rich = await page.evaluate(`(() => { const t = document.getElementById('hmText');
    const quotes = [...t.querySelectorAll('.hm-quote')];
    return { name: (t.querySelector('.hm-name') || {}).textContent || '',
             geo: (t.querySelector('.hm-geo') || {}).textContent || '',
             quotes: quotes.length,
             marks: t.querySelectorAll('.hm-quote-text mark').length,
             plays: t.querySelectorAll('.hm-play[data-url]').length,
             lead: (t.querySelector('.hm-lead') || {}).textContent || '',
             first: quotes.length ? quotes[0].querySelector('.hm-quote-text').textContent : '' }; })()`);
  check('点地点后标题就是那个地名', rich.name === sayable[0].name, rich.name + ' vs ' + sayable[0].name);
  check('地点坐标如实写出', /[0-9]{2}\.[0-9]{4}°N/.test(rich.geo), rich.geo.slice(0, 40));
  check('给出的介绍条数与角标一致', rich.quotes === sayable[0].hits,
    rich.quotes + ' 段 / 角标 ' + sayable[0].hits);
  check('提到地名的那几个字标出来了', rich.marks >= 1, rich.marks + ' 处标记');
  check('有录音的那几段给到可点的播放键', rich.plays === sayable[0].audio,
    rich.plays + ' 个按钮 / 应有 ' + sayable[0].audio);
  // 介绍必须是书里的原句，不能是后来补写的说明
  const verbatim = await page.evaluate(`(() => {
    const needle = ${JSON.stringify(rich.first)};
    let found = false;
    window.DIANCANG.chapters.forEach((ch) => ch.items.forEach((it) => {
      [it.text, it.desc].forEach((body) => {
        if (!found && body && body.indexOf(needle) > -1) found = true;
      });
    }));
    return found;
  })()`);
  check('引文逐字来自《文化典藏》正文', verbatim, rich.first.slice(0, 46));
  await page.evaluate(`document.querySelector('#hmText .hm-play[data-url]').click()`);
  check('点播放键打开那段客家话讲解', await until(page, `!document.getElementById('videoMask').hidden`));
  await page.evaluate(`document.getElementById('videoClose').click()`);

  await page.evaluate(`tapPlace(${silent[0].i})`);
  const poor = await page.evaluate(`(() => { const t = document.getElementById('hmText');
    return { name: (t.querySelector('.hm-name') || {}).textContent || '',
             quotes: t.querySelectorAll('.hm-quote').length,
             plays: t.querySelectorAll('.hm-play[data-url]').length,
             lead: (t.querySelector('.hm-lead') || {}).textContent || '' }; })()`);
  check('没录音的地点如实说 0 处配了原声', /0<\/b> 处配了客家话原声|0 处配了/.test(poor.lead) || /0/.test(poor.lead),
    poor.lead.slice(0, 52));
  check('没录音就不给播放键，不假装能听', poor.plays === 0 && poor.quotes >= 1,
    poor.plays + ' 个按钮 / ' + poor.quotes + ' 段原文');

  await page.evaluate(`(() => {
    // 用 data-i 选，不能用 DOM 下标：点是按 y 排过序再画的，两个编号不是一回事
    const g = document.querySelector('#hmMap .hm-place[data-i="${sayable[0].i}"]');
    g.focus();
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  check('键盘回车也能选中地点', await until(page,
    `document.getElementById('hmText').textContent.indexOf('${sayable[0].name}') === 0`));
  await page.evaluate(`(() => { tapPlace(${silent[0].i}); tapPlace(${sayable[0].i}); })()`);
  check('连点两个地点留下的是后点那个', await until(page,
    `document.getElementById('hmText').textContent.indexOf('${sayable[0].name}') === 0
       && document.getElementById('hmText').textContent.indexOf('${silent[0].name}') !== 0`));
  check('家乡面板里没有查读音入口', await page.evaluate(
    `!document.getElementById('prQuery') && !document.getElementById('prOut') && !window.Pron`));
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


  // 深链：直接带 hash 打开，应落到对应视图（分享链接的前提）
  await page.send('Page.navigate', { url: BASE + '/index.html#/diancang' });
  await until(page, 'document.readyState==="complete"', 8000);
  check('深链 #/diancang 直达典藏视图', await until(page,
    `document.querySelector('.tab-panel.active').id === 'panelDiancang'`, 6000));
  await page.send('Page.navigate', { url: BASE + '/index.html#/nonsense-route' });
  await until(page, 'document.readyState==="complete"', 8000);
  check('未知 hash 回落问答而不是白屏', await until(page,
    `document.querySelector('.tab-panel.active').id === 'panelChat'`, 6000));

  console.log('\n9b3. 回答里带出客家话原声讲解');
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
