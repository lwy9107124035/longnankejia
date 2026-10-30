import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createMediaRuntime } from './helpers/media-r2.mjs';

const root = process.cwd();
const { chromium, webkit } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || path.join(root, '.cache/browser-check/node_modules/playwright/index.mjs')).href);
const evidence = { remoteResources: false, realAppleDevice: false, profiles: [] }, cleanup = [];
const runtime = await createMediaRuntime({ after(fn) { cleanup.push(fn); } }, { api: true });
const requests = [];
const fixture = `<!doctype html><meta charset="utf-8"><title>本地媒体上传验收</title>
  <form id="form"><select id="dlMediaType"><option value="audio">音频</option><option value="video">视频</option></select>
  <input id="dlUrl" value="/original.mp3"><button type="button" id="dlSaveBtn">保存</button></form><output id="draft"></output>
  <script>window.Store = { getSession() { return { bearer: sessionStorage.getItem('test-bearer') }; } };
  document.getElementById('form').oninput = () => { document.getElementById('draft').textContent = document.getElementById('dlUrl').value; };
  window.hashReads = []; const read = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = function () { window.hashReads.push(this.size); if (this.size > 1048576) throw Error('Unbounded client hash read'); return read.call(this); };</script>
  <script type="module">import { bind } from '/js/media-upload.js'; bind(document.getElementById('form'));</script>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      requests.push({ path: url.pathname, action: url.searchParams.get('action'), part: url.searchParams.get('partNumber') });
      const response = await runtime.fetch(base + req.url, { method: req.method, headers: req.headers,
        ...(req.method === 'POST' && { body: Buffer.concat(chunks) }) });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fixture); return; }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !url.pathname.startsWith('/js/')) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(file));
  } catch (error) { res.writeHead(500).end(error.name); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch(name === 'chromium' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {});
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      const login = await context.request.post(base + '/api/admin/sync', { data: { action: 'login', credential: 'admin123', clientId: 'media-browser-' + name } });
      assert.equal(login.status(), 200);
      const { bearer } = await login.json();
      await context.addInitScript(bearer => sessionStorage.setItem('test-bearer', bearer), bearer);
      await page.goto(base); await page.waitForSelector('[data-media-choose]');
      await page.evaluate(() => { MediaUpload.bind(document.getElementById('form')); MediaUpload.bind(document.getElementById('form')); });
      assert.equal(await page.locator('.admin-media-upload').count(), 1);
      await page.evaluate(() => { Store.getCatalog = () => ({ capabilities: { mediaUploads: false } }); MediaUpload.bind(document.getElementById('form')); });
      assert.equal(await page.locator('[data-media-choose]').isDisabled(), true);
      assert.equal(await page.locator('[data-media-choose]').textContent(), '文件上传待启用');
      await page.evaluate(() => { Store.getCatalog = () => ({ capabilities: { mediaUploads: true } }); MediaUpload.bind(document.getElementById('form')); });
      assert.equal(await page.locator('[data-media-choose]').isDisabled(), false);
      let interrupt = true;
      await context.route('**/api/admin/uploads?*', async route => {
        if (interrupt && new URL(route.request().url()).searchParams.get('partNumber') === '2') { interrupt = false; await route.abort('internetdisconnected'); }
        else await route.continue();
      });
      const bytes = Buffer.alloc(8 * 1024 * 1024 + 1031, name === 'chromium' ? 61 : 62), hash = createHash('sha256').update(bytes).digest('hex');
      const file = { name: '本地断点视频.mp4', mimeType: 'video/mp4', buffer: bytes }, firstRequest = requests.length;
      await page.locator('.admin-media-upload input[type=file]').setInputFiles(file);
      await page.waitForFunction(() => document.querySelector('.admin-media-upload [role=status]').textContent.includes('当前资料链接尚未更改'));
      assert.equal(await page.locator('#dlUrl').inputValue(), '/original.mp3');
      assert.equal(requests.slice(firstRequest).filter(item => item.part === '1').length, 1);
      assert.ok(await page.evaluate(() => Math.max(...hashReads) <= 1048576));
      assert.ok(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('heritage-media-upload:')).every(key => sessionStorage.getItem(key).length < 1000)));
      await page.reload(); await page.waitForSelector('[data-media-choose]');
      await page.locator('.admin-media-upload input[type=file]').setInputFiles(file);
      await page.waitForFunction(() => document.querySelector('.admin-media-upload [role=status]').textContent.includes('已上传并确认'));
      const url = await page.locator('#dlUrl').inputValue(); assert.equal(url, '/api/media/' + hash);
      assert.equal(await page.locator('#draft').textContent(), url); assert.equal(await page.locator('#dlMediaType').inputValue(), 'video');
      assert.equal(requests.slice(firstRequest).filter(item => item.part === '1').length, 1);
      assert.equal(requests.slice(firstRequest).filter(item => item.part === '2').length, 1);
      const object = await runtime.bucket.get('media/' + hash);
      assert.equal(createHash('sha256').update(Buffer.from(await object.arrayBuffer())).digest('hex'), hash);
      let loseComplete = true;
      await context.route('**/api/admin/uploads', async route => {
        if (loseComplete && route.request().postDataJSON()?.action === 'complete') { loseComplete = false; await route.fetch(); await route.abort('internetdisconnected'); }
        else await route.continue();
      });
      const audio = Buffer.from('confirmed audio ' + name), audioHash = createHash('sha256').update(audio).digest('hex');
      await page.locator('.admin-media-upload input[type=file]').setInputFiles({ name: '确认丢失.mp3', mimeType: 'audio/mpeg', buffer: audio });
      await page.waitForFunction(() => document.querySelector('.admin-media-upload [role=status]').textContent.includes('当前资料链接尚未更改'));
      assert.equal(await page.locator('#dlUrl').inputValue(), url);
      await page.locator('[data-media-retry]').click();
      await page.waitForFunction(() => document.querySelector('.admin-media-upload [role=status]').textContent.includes('已上传并确认'));
      assert.equal(await page.locator('#dlUrl').inputValue(), '/api/media/' + audioHash);
      assert.equal(await page.locator('#dlMediaType').inputValue(), 'audio');
      await page.evaluate(() => {
        const previous = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = function () {
          const reading = previous.call(this);
          return new Promise(resolve => { window.releaseHash = async () => { Blob.prototype.arrayBuffer = previous; resolve(await reading); }; });
        };
      });
      const beforeManual = requests.length;
      await page.locator('.admin-media-upload input[type=file]').setInputFiles({ name: '手动修改链接.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('manual link wins') });
      await page.waitForFunction(() => typeof window.releaseHash === 'function');
      await page.locator('#dlUrl').fill('/manual-edit.mp3');
      await page.evaluate(() => window.releaseHash());
      await page.waitForFunction(() => document.querySelector('.admin-media-upload [role=status]').textContent.includes('上传已暂停'));
      assert.equal(await page.locator('#dlUrl').inputValue(), '/manual-edit.mp3');
      assert.equal(requests.length, beforeManual);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(root, '.cache/media-upload-browser-' + name + '.png'), fullPage: true });
      evidence.profiles.push({ name, passed: true, checks: ['bounded incremental SHA256', 'bind idempotency', 'explicit false capability disables upload', 'part failure preserves URL', 'reload and reselect resumes without retransmitting part 1', 'binary SHA256 readback', 'confirmed receipt dispatches draft input', 'lost completion confirmation recovers from status', 'media type follows chosen file', 'manual URL edit cancels pending upload', 'no page errors'] });
      console.log(name + ': 11 checks passed');
    } finally { await context.close(); await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  for (const close of cleanup.reverse()) await close();
  fs.writeFileSync(path.join(root, '.cache/media-upload-browser-20261028.json'), JSON.stringify(evidence, null, 2));
}
