import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { startSiteServer } from './helpers/site-server.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';
const { chromium, webkit } = await import(pathToFileURL(path.resolve('.cache/browser-check/node_modules/playwright/index.mjs')).href);
const report = { at: new Date().toISOString(), realIphone: false, realWechat: false, profiles: [] };
for (const engine of ['chromium', 'webkit']) {
  const backend = createAdminBackend(), group = { engine, checks: [], errors: [], failures: [] }; report.profiles.push(group);
  backend.sqlite.exec(fs.readFileSync('migrations/admin/0002_content_records.sql', 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = Array.from({ length: 70 }, (_, i) => ({ id: 'public-read-' + i, name: '公开读取' + i, detail: '完整资料' + i }));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const server = await startSiteServer({ root: process.cwd(), port: 0, backend }), origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await (engine === 'chromium' ? chromium : webkit).launch(engine === 'chromium' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true } : {});
  try {
    for (const scenario of ['one-conflict', 'persistent-conflict']) {
      const context = await browser.newContext({ viewport: engine === 'chromium' ? { width: 1280, height: 900 } : { width: 390, height: 844 } });
      try {
        let requests = 0;
        await context.route('**/api/admin/sync?*', async route => {
          if (new URL(route.request().url()).searchParams.get('format') === 'pages') {
            requests++;
            if (scenario === 'persistent-conflict' || requests === 1) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'PAGE_CHANGED', error: '内容已更新，请刷新列表' }) });
          }
          return route.continue();
        });
        const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => group.errors.push(error.message));
        await page.goto(origin + '/#/science', { waitUntil: 'domcontentloaded' });
        if (scenario === 'one-conflict') {
          await page.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded);
          assert.equal(await page.locator('#hPillCustom').textContent(), '70'); assert.equal(requests, 2);
          group.checks.push('首次读取409后自动恢复，公开70条统计正确');
          const refreshed = page.waitForResponse(response => response.url().includes('/api/admin/sync?') && response.status() === 200);
          await page.locator('#heritageRefresh').click(); await refreshed;
          await page.waitForFunction(() => !document.querySelector('#heritageRefresh').disabled);
          assert.equal(requests, 3); group.checks.push('普通访客可手动刷新内容，按钮完成后恢复');
        } else {
          await page.waitForFunction(() => window.Store?.getSyncStatus().status === 'error'); assert.equal(requests, 3);
          assert.equal(await page.locator('#heritageSyncNotice').isVisible(), true); assert.match(await page.locator('#heritageSyncLabel').textContent(), /离线内容/);
          group.checks.push('持续版本冲突最多三次并明确离线状态，不假报加载成功');
          await context.unroute('**/api/admin/sync?*'); await page.locator('#heritageSyncRetry').click();
          await page.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded);
          assert.equal(await page.locator('#hPillCustom').textContent(), '70'); await page.locator('#heritageSyncNotice').waitFor({ state: 'hidden' });
          group.checks.push('公开页面重试按钮恢复完整统计和列表');
        }
      } finally { await context.close(); }
    }
    assert.deepEqual(group.errors, []);
  } catch (error) { group.failures.push(error.stack || error.message); }
  finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
report.passed = report.profiles.reduce((n, group) => n + group.checks.length, 0); report.failed = report.profiles.reduce((n, group) => n + group.failures.length, 0);
console.log(JSON.stringify(report, null, 2)); fs.writeFileSync('.cache/public-read-browser-results.json', JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
