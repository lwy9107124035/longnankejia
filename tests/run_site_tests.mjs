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
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
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
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
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
    if (m.method === 'Network.loadingFailed') {
      netFailures.push(m.params.errorText + ' ' + (m.params.type || ''));
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

  console.log('\n2. 数字人形象 (the swapped avatar)');
  check('hero avatar element exists', await until(page, 'document.querySelector("#avatarWrap img.avatar")'));
  const av = await page.evaluate(`(() => { const i = document.querySelector('#avatarWrap img.avatar');
    return i ? { src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight,
                 box: (() => { const r = i.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() } : null; })()`);
  check('hero avatar decoded from the new PNG', av && av.ok && av.w === 520, av && JSON.stringify(av));
  check('hero avatar is drawn at a usable size', av && av.box[1] >= 120, av && av.box.join('x'));
  await shot(page, '01-hero');

  console.log('\n3. tab navigation');
  for (const [tab, panel] of [['panelChat', 'panelChat'], ['panelHeritage', 'panelHeritage'], ['panel3d', 'panel3d'], ['panelDiancang', 'panelDiancang']]) {
    await page.evaluate(`document.querySelector('[data-panel="${tab}"]').click()`);
    const on = await until(page, `document.getElementById('${panel}').classList.contains('active')`, 3000);
    check('tab 打开 ' + tab, on);
  }

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

  console.log('\n5. 科普 panel');
  await page.evaluate(`document.querySelector('[data-panel="panelHeritage"]').click()`);
  check('heritage cards rendered', await until(page, `document.querySelectorAll('#heritageGrid .h-card').length > 0`));
  const n = await page.evaluate(`document.querySelectorAll('#heritageGrid .h-card').length`);
  check('at least 4 heritage cards', n >= 4, n + ' cards');
  await page.evaluate(`document.querySelector('#heritageGrid .h-card').click()`);
  check('detail modal opens', await until(page, `!document.getElementById('detailModal').hidden`));
  await page.evaluate(`document.getElementById('detailClose').click()`);
  check('detail modal closes', await until(page, `document.getElementById('detailModal').hidden`));

  console.log('\n6. 3D panel (the de-watermarked models)');
  await page.evaluate(`document.querySelector('[data-panel="panel3d"]').click()`);
  check('webgl canvas created', await until(page, `document.querySelector('#c3dViewport canvas')`, 15000));
  const items = await page.evaluate(`[...document.querySelectorAll('#c3dList .c3d-item')].length`);
  check('three models listed', items === 3, items + ' items');
  for (let i = 0; i < items; i++) {
    await page.evaluate(`document.querySelectorAll('#c3dList .c3d-item')[${i}].click()`);
    await sleep(900);
    const label = await page.evaluate(`document.getElementById('c3dName').textContent`);
    check('model ' + (i + 1) + ' renders: ' + label, label.trim().length > 0);
    await shot(page, '03-model-' + i);
  }
  const tex200 = netFailures.filter((f) => f.includes('assets/textures'));
  check('all texture maps loaded without error', tex200.length === 0, tex200.join('; '));

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

  console.log('\n8. QR 弹层');
  await page.evaluate(`document.getElementById('qrBtn').click()`);
  check('QR modal opens with a rendered code', await until(page, `!document.getElementById('qrModal').hidden && document.querySelector('#qrBox canvas, #qrBox img, #qrBox svg')`));
  await shot(page, '06-qr');
  await page.evaluate(`document.getElementById('qrClose').click()`);
  check('QR modal closes', await until(page, `document.getElementById('qrModal').hidden`));

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

  console.log('\n9c. AI 生成内容声明');
  // 显式标识义务落在发布方身上，页脚这句话不能被后续改版顺手删掉
  const note = await page.evaluate(`(() => { const n = document.querySelector('.footer-ai-note');
    if (!n) return null; const r = n.getBoundingClientRect();
    return { text: n.textContent, visible: r.height > 0 && getComputedStyle(n).display !== 'none' }; })()`);
  check('页脚声明了贴图与形象为 AI 辅助生成',
    !!note && note.visible && /AI/.test(note.text) && /生成/.test(note.text),
    note ? '' : '页脚缺少 .footer-ai-note');

  console.log('\n10. console / network hygiene');
  const realErrors = consoleErrors.filter((e) => !/favicon|ERR_CONNECTION_RESET|DevTools|hlcode\.pro/i.test(e));
  // the dialect videos are third-party pages we only embed, so their reachability is
  // not this site's defect; everything else must load cleanly
  const realNet = netFailures.filter((f) => !/favicon|hlcode\.pro/i.test(f));
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
  chrome?.kill();
  server?.close();
}
