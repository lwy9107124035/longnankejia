/**
 * Measure, per mesh, how close the model gets to the top and bottom of the 3D
 * viewport. Reports the projected NDC extent so framing can be fixed with numbers
 * instead of eyeballing screenshots.
 *
 *   node tests/probe_framing.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8947, CDP = 9347, BASE = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  fs.readFile(path.join(ROOT, rel), (e, b) => e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(rel)] || 'application/octet-stream' }).end(b));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(os.tmpdir(), 'alan-framing');
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-first-run', '--disable-gpu',
   '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${CDP}/json/version`)).ok) break; } catch {} await sleep(250); }

const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const f = pend.get(m.id); pend.delete(m.id); f(m.result); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = (x, ap = false) => send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: ap }).then((r) => r.result?.value);

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: BASE + '/index.html#/model3d' });
await ev(`new Promise(r => setTimeout(r, 4000))`, true);

const report = await ev(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  for (const it of window.Showcase3D.items()) {
    window.Showcase3D.show(it.id);
    await wait(1600);                       // let zoom/rotation lerp settle
    const m = window.Showcase3D.debugModel(), cam = window.Showcase3D.debugCamera();
    let top = -9, bottom = 9, worstName = '';
    m.updateMatrixWorld(true);
    // sample across the auto-rotation so we catch the worst angle, not one frame
    for (let s = 0; s < 12; s++) {
      m.updateMatrixWorld(true);
      m.traverse(function (o) {
        if (!o.isMesh || !o.geometry) return;
        const box = new THREE.Box3().setFromObject(o);
        // Project each mesh's own highest point at its horizontal centre. Using the
        // top-face *corners* instead inflates the answer for wide flat meshes — the
        // 围屋 stone courtyard is 4 units across and its far corner projects near the
        // horizon, which is not the roof being cropped.
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        const v = new THREE.Vector3(cx, box.max.y, cz).project(cam);
        if (v.y > top) { top = v.y; worstName = (o.material && o.material.name) || o.type; }
        const v2 = new THREE.Vector3(cx, box.min.y, cz).project(cam);
        if (v2.y < bottom) bottom = v2.y;
      });
      await wait(160);
    }
    out.push({ id: it.id, name: it.name, top: +top.toFixed(3), bottom: +bottom.toFixed(3), worstName });
  }
  return out;
})()`, true);

console.log('模型取景（NDC：±1 为视口上下边缘，>1 即被裁切）\n');
for (const r of report) {
  const bad = r.top > 0.95 || r.bottom < -0.95;
  console.log(`  ${bad ? '裁切' : '正常'}  ${r.name.padEnd(14)} top=${String(r.top).padStart(7)}  bottom=${String(r.bottom).padStart(7)}`);
}
chrome.kill(); server.close(); process.exit(0);
