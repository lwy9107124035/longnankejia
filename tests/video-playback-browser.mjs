import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createMediaRuntime } from './helpers/media-r2.mjs';
import { startSiteServer } from './helpers/site-server.mjs';

const root = process.cwd();
const { chromium, webkit } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || path.join(root, '.cache/browser-check/node_modules/playwright/index.mjs')).href);
const cleanup = [], report = { realIPhone: false, realWechat: false, profiles: [] };
const runtime = await createMediaRuntime({ after(fn) { cleanup.push(fn); } }, { api: true });
const bytes = fs.readFileSync(path.join(root, 'assets/audio/yueguangguang.mp4'));
const hash = createHash('sha256').update(bytes).digest('hex');
await runtime.bucket.put('media/' + hash, bytes, { sha256: hash, httpMetadata: { contentType: 'video/mp4' }, customMetadata: { mediaId: hash } });
const server = await startSiteServer({ root, port: 0, backend: { fetchApi: runtime.fetch, close() {} } });
const base = 'http://127.0.0.1:' + server.address().port;
const evidence = path.join(root, '.cache/customer-feedback-20261111');
fs.mkdirSync(evidence, { recursive: true });
try {
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch(name === 'chromium' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {});
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(), errors = [], checks = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://**', route => route.abort());
    page.setDefaultTimeout(12000);
    try {
      await page.goto(base + '/#/diancang');
      await page.waitForFunction(() => window.Diancang && window.UI && document.querySelector('#dcTabs button'));
      assert.equal(await page.evaluate(() => DIANCANG.chapters.flatMap(ch => ch.items).some(item => item.name === '虎形围')), false);
      assert.equal(await page.evaluate(() => KNOWLEDGE_BASE.some(item => item.id === 'dc-huxingwei')), false);
      assert.equal(await page.evaluate(() => Diancang.openItem('虎形围')), false);
      const exhibitCount = await page.evaluate(() => DIANCANG.chapters.reduce((count, chapter) => count + chapter.items.length, 0));
      assert.match(await page.locator('#dcQuery').getAttribute('placeholder'), new RegExp(' ' + exhibitCount + ' '));
      checks.push('removed exhibit cannot be opened or retrieved from built-in knowledge');

      await page.evaluate(() => UI.DetailModal.open({ id: 'test-video', name: '围屋视频', detail: '围屋介绍', videoUrl: 'https://example.com/share/123' }));
      await page.locator('#detailPlayVidBtn').click();
      assert.equal(await page.locator('#videoMask').isVisible(), true);
      assert.equal(await page.locator('#videoFrame iframe, #videoFrame video').count(), 0);
      assert.match(await page.locator('#videoFrame').textContent(), /外部网页链接/);
      assert.equal(await page.locator('#videoFrame a').getAttribute('href'), 'https://example.com/share/123');
      assert.equal(await page.evaluate(() => {
        const close = document.getElementById('videoClose'), rect = close.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === close;
      }), true);
      assert.equal(await page.locator('#videoDesc').textContent(), '');
      await page.screenshot({ path: path.join(evidence, name + '-external-page.png'), fullPage: true, animations: 'disabled' });
      await page.locator('#videoClose').click();
      assert.equal(await page.locator('#detailModal').isVisible(), true);
      assert.equal(await page.locator('#videoFrame').textContent(), '');
      checks.push('external pages show a usable source link above the open detail, without a blank iframe');

      await page.evaluate(url => Diancang.playVideo({ name: '本地视频验证', videoUrl: url }), '/api/media/' + hash);
      const video = page.locator('#videoFrame video');
      assert.equal(await video.count(), 1);
      await page.waitForFunction(() => document.querySelector('#videoFrame video').readyState >= 2);
      assert.ok(await video.evaluate(element => element.duration > 1 && element.videoWidth > 0));
      await video.evaluate(async element => { element.muted = true; await element.play(); });
      await page.waitForFunction(() => document.querySelector('#videoFrame video').currentTime > 0.2);
      await page.screenshot({ path: path.join(evidence, name + '-native-video.png'), fullPage: true, animations: 'disabled' });
      await page.locator('#videoClose').click();
      assert.equal(await page.locator('#videoFrame video').count(), 0);
      checks.push('extensionless R2 media decodes, displays video dimensions, advances playback and stops on close');

      await page.evaluate(url => UI.DetailModal.open({ id: 'test-video', name: '围屋视频', detail: '围屋介绍', videoUrl: url }), '/api/media/' + hash);
      assert.equal(await page.locator('#detailMedia video').count(), 1);
      await page.waitForFunction(() => document.querySelector('#detailMedia video').readyState >= 2);
      await page.locator('#detailClose').click();
      checks.push('science detail renders an extensionless uploaded file as native video');

      await page.evaluate(url => {
        Store.getCustomDialectTracks = () => [{ id: 'dl-video-test', mediaType: 'video', item: { name: '围屋视频', videoUrl: url } }];
        App.switchPanel('viewDialect'); Dialect.refresh();
        Dialect.select(Dialect.tracks().findIndex(track => track.id === 'dl-video-test'));
      }, '/api/media/' + hash);
      await page.waitForFunction(() => document.querySelector('#dlFrame video').readyState >= 2);
      assert.equal(await page.locator('#dlFrame video').isVisible(), true);
      checks.push('dialect library renders uploaded video using the same native player');

      await page.evaluate(() => Diancang.playVideo({ name: '失效视频', videoUrl: '/api/media/' + '0'.repeat(64) }));
      await page.waitForFunction(() => document.querySelector('#videoFrame .media-player-status').textContent.includes('未能加载'));
      await page.locator('#videoClose').click();
      await page.evaluate(() => Diancang.playVideo(Diancang.videoExhibits()[0].item));
      assert.match(await page.locator('#videoFrame iframe').getAttribute('src'), /hlcode\.pro/);
      assert.match(await page.locator('#videoFrame a').textContent(), /原播放页面/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#videoFrame iframe').count(), 0);
      assert.equal(await page.evaluate(() => MediaPlayer.isVideoFile('https://')), false);
      assert.equal(await page.evaluate(() => MediaPlayer.isVideoFile('javascript:alert(1)')), false);
      checks.push('failed media has a visible error, QR pages retain a source fallback, escape removes the iframe, invalid URLs are rejected');
      assert.deepEqual(errors, []);
      report.profiles.push({ name, passed: true, checks });
      console.log(name + ': ' + checks.length + ' playback checks passed');
    } finally { await context.close(); await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  for (const close of cleanup.reverse()) await close();
  fs.writeFileSync(path.join(evidence, 'video-playback.json'), JSON.stringify(report, null, 2));
}
