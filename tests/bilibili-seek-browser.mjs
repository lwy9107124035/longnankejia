import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const { chromium } = await import(pathToFileURL(path.join(root, '.cache/browser-check/node_modules/playwright/index.mjs')).href);
const configured = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxyUrl = configured && new URL(configured);
const proxy = proxyUrl && { server: proxyUrl.origin, bypass: '127.0.0.1,localhost',
  ...(proxyUrl.username && { username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) }) };
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', ...(proxy && { proxy }) });
const live = process.env.SEEK_LIVE === '1';
const evidence = path.join(root, '.cache/customer-feedback-20261111');
const report = { live, realPhone: false, profiles: [] };
fs.mkdirSync(evidence, { recursive: true });
try {
  for (const profile of [
    { name: 'desktop-mouse', viewport: { width: 1280, height: 900 } },
    { name: 'phone-touch', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    if (process.env.SEEK_PROFILE && process.env.SEEK_PROFILE !== profile.name) continue;
    const { name, ...options } = profile;
    const context = await browser.newContext(options), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    try {
      if (!live) for (const file of ['js/video-links.js', 'js/media-player.js', 'css/style.css']) {
        await context.route('**/' + file, route => route.fulfill({ contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(path.join(root, file), 'utf8') }));
      }
      await page.goto('https://codex.longnankejia-dev.pages.dev/#/dialect');
      await page.waitForFunction(() => window.MediaPlayer && document.getElementById('dlFrame'));
      await page.evaluate(url => {
        const container = document.getElementById('dlFrame'); container.hidden = false;
        MediaPlayer.mount(container, url, '进度拖动验证');
      }, process.env.VIDEO_TEST_URL || 'https://www.bilibili.com/video/BV1B7411m7LV/');
      const iframe = page.locator('#dlFrame iframe'), stage = page.locator('#dlFrame .media-embed-viewport');
      await iframe.waitFor();
      const frame = iframe.contentFrame();
      await frame.locator('video').first().waitFor();
      await frame.locator('video').first().evaluate(video => new Promise((resolve, reject) => {
        if (video.duration > 0) return resolve();
        const timeout = setTimeout(() => reject(new Error('Video metadata unavailable')), 15000);
        video.addEventListener('loadedmetadata', () => { clearTimeout(timeout); resolve(); }, { once: true });
      }));
      await stage.scrollIntoViewIfNeeded();
      const area = await stage.boundingBox();
      await page.mouse.move(area.x + area.width / 2, area.y + area.height - 10);
      const progress = frame.locator('.bpx-player-progress-wrap');
      await progress.waitFor({ state: 'visible' });
      const dimensions = await frame.locator('body').evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(dimensions.width >= 480);
      const local = await progress.evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      const box = await iframe.boundingBox(), scaleX = box.width / dimensions.width, scaleY = box.height / dimensions.height;
      const duration = await frame.locator('video').first().evaluate(video => video.duration);
      const target = Math.min(180, duration * 0.4), start = box.x + (local.x + 1) * scaleX;
      const end = box.x + (local.x + local.width * target / duration) * scaleX, y = box.y + (local.y + local.height / 2) * scaleY;
      if (profile.hasTouch) {
        const client = await context.newCDPSession(page);
        const touch = (type, x) => client.send('Input.dispatchTouchEvent', { type,
          touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }] });
        await touch('touchStart', start);
        for (let i = 1; i <= 12; i++) await touch('touchMove', start + (end - start) * i / 12);
        await touch('touchEnd'); await client.detach();
      } else {
        await page.mouse.move(start, y); await page.mouse.down();
        await page.mouse.move(end, y, { steps: 12 }); await page.mouse.up();
      }
      const after = await frame.locator('video').first().evaluate((video, target) => new Promise((resolve, reject) => {
        const check = () => { if (video.currentTime > target * 0.7) { clearInterval(timer); clearTimeout(timeout); resolve(video.currentTime); } };
        const timer = setInterval(check, 100), timeout = setTimeout(() => { clearInterval(timer); reject(new Error('Dragging did not seek: ' + video.currentTime)); }, 8000);
        check();
      }), target);
      assert.ok(after > target * 0.7);
      assert.equal(await page.locator('#dlFrame .media-source-link').isVisible(), true);
      await stage.screenshot({ path: path.join(evidence, 'seek-' + name + (live ? '-live' : '') + '.png') });
      if (profile.hasTouch) {
        await page.setViewportSize({ width: 320, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.ok(await frame.locator('body').evaluate(() => innerWidth >= 480));
      } else {
        await page.locator('#dlFrame .media-fullscreen-btn').click();
        await page.waitForFunction(() => document.fullscreenElement?.classList.contains('media-embed-viewport'));
        assert.ok(await frame.locator('video').first().evaluate(video => video.currentTime > 1));
        await page.locator('#dlFrame .media-exit-fullscreen').click();
        await page.waitForFunction(() => !document.fullscreenElement);
      }
      await page.evaluate(() => MediaPlayer.clear(document.getElementById('dlFrame')));
      assert.equal(await page.locator('#dlFrame iframe').count(), 0);
      assert.deepEqual(errors, []);
      report.profiles.push({ name, duration, target, after, iframeWidth: dimensions.width, sourceFallback: true, passed: true });
      console.log(name + ': real progress drag changed playback time to ' + after.toFixed(1) + 's');
    } catch (error) {
      report.profiles.push({ name, passed: false, error: error.message, errors }); throw error;
    } finally { await context.close(); }
  }
} finally {
  fs.writeFileSync(path.join(evidence, 'bilibili-seek' + (live ? '-live' : '') + '.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
