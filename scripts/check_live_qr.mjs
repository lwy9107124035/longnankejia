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
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
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

const profile = path.join(os.tmpdir(), 'alan-live-qr-profile');
fs.rmSync(profile, { recursive: true, force: true });
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
  if (!await until(page, 'document.readyState==="complete"')) throw new Error('页面未加载完成：' + URL);
  if (!await until(page, '!!window.QR', 10000)) throw new Error('线上页面没有 window.QR（编码器没部署上去？）');
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
  chrome.kill();
}
process.exit(code);
