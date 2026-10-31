import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { startSiteServer } from './helpers/site-server.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';
import { storeMedia } from '../functions/_lib/admin-media.js';
import { loadContentState } from '../functions/api/admin/sync.js';

const root = process.cwd();
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(path.join(root, '.cache/browser-check/node_modules/playwright/index.mjs')).href);
const report = { at: new Date().toISOString(), remoteResources: false, realAppleDevice: false, profiles: [] };
const seed = fs.readFileSync('assets/model-references/hutoumao-211.jpg');
const mediaRows = backend => backend.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_state WHERE key LIKE 'media:%'").get().n;
for (const engine of ['chromium', 'webkit']) {
  const backend = createAdminBackend(), images = createAdminBackend({ schema: 'media' });
  let browser, server;
  const group = { engine, checks: [], errors: [], failures: [] }; report.profiles.push(group);
  try {
    const old = await storeMedia(backend.db, 'data:image/jpeg;base64,' + seed.toString('base64'));
    const content = structuredClone(globalThis.HeritageContent.defaults);
    content.kepuCustom = [{ id: 'legacy-picture', name: '旧库图片', detail: '迁移前正文', imageUrl: old.url }];
    backend.sqlite.exec(fs.readFileSync('migrations/admin/0002_content_records.sql', 'utf8'));
    await migrateRecordStorage(backend.db, { value: content, revision: 0 });
    backend.env.ADMIN_MEDIA_DB = images.db;
    const primaryRows = mediaRows(backend);
    server = await startSiteServer({ root, port: 0, backend });
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await (engine === 'chromium' ? chromium : webkit).launch(engine === 'chromium' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true } : {});
    const context = await browser.newContext({ viewport: engine === 'chromium' ? { width: 1280, height: 900 } : { width: 390, height: 844 }, acceptDownloads: true });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => group.errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    async function check(name, action) { await action(); group.checks.push(name); }
    async function idle() { await page.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded && !window.Store.getSyncStatus().pending); }
    await page.goto(origin + '/#/science', { waitUntil: 'domcontentloaded' }); await idle();
    await page.evaluate(() => window.Admin.open()); await page.waitForSelector('#adminLoginBtn');
    await page.locator('#adminPwInput').fill('admin123'); await page.locator('#adminLoginBtn').click(); await page.locator('[data-tab="kepu"]').click();
    await check('旧库图片在真实后台仍可显示', async () => {
      await page.locator('[data-edit-kepu="legacy-picture"]').click();
      await page.waitForFunction(() => document.querySelector('#kpImgThumb')?.naturalWidth > 0);
      assert.equal(await page.locator('#kpDetail').inputValue(), '迁移前正文');
      await page.locator('#kpCancelBtn').click();
    });
    await page.locator('#kepuAddBtn').click(); await page.locator('#kpName').fill('独立图片库验收');
    await page.locator('#kpDetail').fill('第一行\n第二行');
    await page.locator('#kpImageFile').setInputFiles(path.join(root, 'assets/model-references/hutoumao-211.jpg'));
    await page.waitForFunction(() => document.querySelector('#kpImage').value.startsWith('data:image/'));
    const chosen = await page.locator('#kpImage').inputValue();
    await page.locator('#kpSaveBtn').click(); await idle();
    const saved = (await loadContentState(backend.db)).value.kepuCustom.find(row => row.name === '独立图片库验收');
    await check('真实文件上传仅写独立图片库，正文与旧图保留', async () => {
      assert.ok(saved?.imageUrl.startsWith('/api/media/')); assert.equal(saved.detail, '第一行\n第二行');
      assert.equal(mediaRows(backend), primaryRows); assert.ok(mediaRows(images) > 0);
      assert.deepEqual(Buffer.from(await (await backend.fetchApi(saved.imageUrl)).arrayBuffer()), Buffer.from(chosen.split(',')[1], 'base64'));
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await idle(); await page.evaluate(() => window.Admin.open());
    await page.locator('[data-tab="kepu"]').click();
    await check('刷新后两条记录及新库图片仍可编辑显示', async () => {
      await page.locator('[data-edit-kepu="' + saved.id + '"]').click();
      await page.waitForFunction(() => document.querySelector('#kpImgThumb')?.naturalWidth > 0);
      assert.equal(await page.locator('#kpDetail').inputValue(), '第一行\n第二行'); await page.locator('#kpCancelBtn').click();
    });
    await page.locator('[data-tab="sys"]').click();
    const downloading = page.waitForEvent('download'); await page.locator('#exportBundleBtn').click();
    const file = '.cache/media-database-backup-' + engine + '.json'; await (await downloading).saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    await check('后台导出备份包含旧库和新库的完整图片', async () => {
      assert.equal(backup.cloudDraft.kepuCustom.length, 2);
      assert.equal(backup.cloudDraft.kepuCustom.find(row => row.id === saved.id).imageUrl, chosen);
      assert.equal(backup.cloudDraft.kepuCustom.find(row => row.id === 'legacy-picture').imageUrl, 'data:image/jpeg;base64,' + seed.toString('base64'));
    });
    await check('导出的双库备份能恢复到另一空库并逐字节核对', async () => {
      const restored = createAdminBackend(), restoredImages = createAdminBackend({ schema: 'media' });
      try {
        restored.env.ADMIN_MEDIA_DB = restoredImages.db;
        restored.sqlite.exec(fs.readFileSync('migrations/admin/0002_content_records.sql', 'utf8'));
        await migrateRecordStorage(restored.db, { value: structuredClone(globalThis.HeritageContent.defaults), revision: 0 });
        const device = setupEnvironment(restored), user = await device.store.verifyLogin('admin123');
        device.store.saveSession(user); await device.store.syncWithCloud();
        assert.equal(device.store.importFullBundle(JSON.stringify(backup)), true); assert.equal(await device.store.flushPending(), true);
        const records = (await loadContentState(restored.db)).value.kepuCustom;
        assert.equal(records.length, 2); assert.equal(mediaRows(restored), 0);
        for (const row of records) {
          const expected = backup.cloudDraft.kepuCustom.find(item => item.id === row.id);
          assert.equal(row.detail, expected.detail);
          assert.deepEqual(Buffer.from(await (await restored.fetchApi(row.imageUrl)).arrayBuffer()), Buffer.from(expected.imageUrl.split(',')[1], 'base64'));
        }
      } finally { restored.close(); restoredImages.close(); }
    });
    assert.deepEqual(group.errors, []);
  } catch (error) { group.failures.push(error.stack || error.message); }
  finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); else backend.close(); images.close(); }
}
report.passed = report.profiles.reduce((n, group) => n + group.checks.length, 0);
report.failed = report.profiles.reduce((n, group) => n + group.failures.length, 0);
fs.writeFileSync('.cache/media-database-browser-results.json', JSON.stringify(report, null, 2));
for (const group of report.profiles) console.log(group.engine + ': ' + group.checks.length + ' passed, failures=' + group.failures.length + (group.failures.length ? '\n' + group.failures.join('\n') : ''));
if (report.failed) process.exitCode = 1;
