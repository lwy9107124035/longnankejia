/**
 * 抓线上站点的入口二维码，交给 tests/decode_entry_qr.py 解码。
 *
 * 本地三段测试只证明「这份代码是对的」；部署之后还得确认 Netlify 上那一份也扫得开。
 *
 *   node scripts/check_live_qr.mjs [url]        # 默认 https://prismatic-syrniki-1e0e96.netlify.app/
 *   QR_PNG=.cache/live-entry-qr.png python tests/decode_entry_qr.py
 *
 * 需要本机 Chrome，不需要任何依赖。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CDP_PORT = 9344;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'https://prismatic-syrniki-1e0e96.netlify.app/';
const OUT = '.cache/live-entry-qr.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }

  static async attach() {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
        if (t) {
          const ws = new WebSocket(t.webSocketDebuggerUrl);
          await new Promise((res, rej) => {
            ws.addEventListener('open', res, { once: true });
            ws.addEventListener('error', rej, { once: true });
          });
          const p = new Page(ws);
          ws.addEventListener('message', (ev) => p.onmsg(JSON.parse(ev.data)));
          return p;
        }
      } catch { /* Chrome 还没起 */ }
      await sleep(250);
    }
    throw new Error('Chrome 没开调试端口');
  }

  onmsg(m) {
    if (!m.id || !this.pending.has(m.id)) return;
    const { res, rej } = this.pending.get(m.id);
    this.pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    // Chrome 半路退了的话，这个 Promise 不该永远悬着（tests 套件里已经踩过一次）
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时 30s`));
      }, 30000);
      this.pending.set(id, {
        res: (v) => { clearTimeout(timer); resolve(v); },
        rej: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

async function until(page, expr, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await page.ev(`!!(${expr})`)) return true; } catch { /* 导航中 */ }
    await sleep(200);
  }
  return false;
}

/** 只按我们自己的 PID 连子进程树收，不动用户开着的 Chrome。 */
function killChrome(proc) {
  if (!proc) return;
  proc.kill();
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

const profile = path.join(os.tmpdir(), 'alan-live-qr-profile');
fs.rmSync(profile, { recursive: true, force: true });
// 上一轮的残留实例会占住端口，attach() 连到旧页面就会拿一次假的通过/假的失败
try {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
  if (r.ok) throw new Error(`端口 ${CDP_PORT} 上已有 Chrome 在跑（上一轮没退干净），先关掉它再跑`);
} catch (e) {
  if (/已有 Chrome/.test(e.message)) { console.log('ERROR ' + e.message); process.exit(1); }
}
// 先删掉上一次的产物：否则这一轮失败了，tests/decode_entry_qr.py 还会解出旧图报 ok
fs.rmSync(OUT, { force: true });
const chrome = spawn(CHROME, [
  '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--headless=new',
  'about:blank',
], { stdio: 'ignore' });

let code = 1;
try {
  const page = await Page.attach();
  await page.send('Page.enable');
  await page.send('Page.navigate', { url: URL });
  // 公网这条链路慢的时候 index.html 自己就能要十几秒，别按本地速度设预算
  if (!await until(page, 'document.readyState==="complete"', 90000)) throw new Error('页面未加载完成：' + URL);
  if (!await until(page, '!!window.QR', 30000)) {
    const why = await page.ev(`(() => ({
      qrcode: typeof window.qrcode, QR: typeof window.QR,
      srcs: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')),
    }))()`).catch((e) => ({ probeFailed: e.message }));
    throw new Error('线上页面没有 window.QR（编码器没部署上去？） ' + JSON.stringify(why));
  }
  await page.ev(`document.getElementById('accessBtn').click()`);
  if (!await until(page, `!!document.querySelector('#addrQr canvas')`)) {
    throw new Error('线上页面没有渲染入口二维码画布');
  }
  const info = await page.ev(`(() => {
    const c = document.querySelector('#addrQr canvas');
    const a = document.querySelector('#addrRow a.addr-link');
    return { w: c.width, h: c.height, href: a ? a.getAttribute('href') : '',
             png: c.toDataURL('image/png') };
  })()`);
  fs.mkdirSync('.cache', { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(info.png.split(',')[1], 'base64'));
  console.log(JSON.stringify({ site: URL, canvas: info.w + 'x' + info.h, link: info.href, png: OUT }));
  code = 0;
} catch (e) {
  console.log('ERROR ' + e.message);
} finally {
  killChrome(chrome);
}
process.exit(code);
