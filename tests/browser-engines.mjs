import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSiteServer } from './helpers/site-server.mjs';

// Install Playwright and its WebKit browser, then set PLAYWRIGHT_MODULE if it is outside node_modules.
const { webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const profiles = [
  { name: 'webkit-desktop', viewport: { width: 1280, height: 900 } },
  { name: 'webkit-phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  { name: 'webkit-wechat-simulation', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50' }
];
const evidence = { realAppleDevice: false, realWechat: false, profiles: [], passed: 0, failed: 0 };
fs.mkdirSync(path.join(root, '.cache/test-shots'), { recursive: true });
const browser = await webkit.launch();
try {
  for (const [index, profile] of profiles.entries()) {
    const port = 8954 + index, base = 'http://127.0.0.1:' + port;
    const server = await startSiteServer({ root, port, base });
    const { name, ...options } = profile;
    const context = await browser.newContext({ ...options, acceptDownloads: true });
    // Cover browsers that predate this API without changing the native WebKit engine.
    await context.addInitScript(() => { Object.hasOwn = undefined; });
    const page = await context.newPage(), errors = [], dialogs = [], checks = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { if (dialog.type() !== 'beforeunload') dialogs.push(dialog.message()); await dialog.accept(); });
    page.setDefaultTimeout(15000);
    async function check(title, action) {
      await action(); checks.push(title); evidence.passed++; console.log('PASS ' + name + ': ' + title);
    }
    async function idle() { await page.waitForFunction(() => !window.Store.getSyncStatus().pending && window.Store.getSyncStatus().status === 'saved'); }
    async function openAdmin() {
      await page.evaluate(() => window.Admin.open());
      await page.waitForSelector('#adminLoginBtn, [data-tab="kepu"]');
      if (await page.locator('#adminLoginBtn').count()) {
        await page.locator('#adminPwInput').fill('admin123'); await page.locator('#adminLoginBtn').click();
      }
      await page.locator('[data-tab="kepu"]').waitFor();
    }
    try {
      await page.goto(base + '/#/science');
      await page.waitForFunction(() => window.Store && window.Admin && window.Store.getSyncStatus().cloudLoaded);
      await check('管理员登录（缺少 Object.hasOwn）', openAdmin);
      await page.locator('[data-tab="kepu"]').click(); await page.locator('#kepuAddBtn').click();
      await page.locator('#kpName').fill(name + ' 带图资料'); await page.locator('#kpDetail').fill('第一行\n第二行\n\n第二段。');
      await page.locator('#kpImageFile').setInputFiles(path.join(root, 'assets/model-references/hutoumao-211.jpg'));
      await check('本地选图、Canvas 压缩和预览', async () => {
        await page.waitForFunction(() => document.getElementById('kpImage').value.startsWith('data:image/jpeg;'));
        assert.ok(await page.locator('#kpImgThumb').evaluate(img => img.naturalWidth > 0));
      });
      await page.locator('#kpSaveBtn').click(); await idle();
      const first = await page.evaluate(() => window.Store.getHeritageCards([])[0]);
      await check('保存为独立图片，刷新后仍可解码', async () => {
        assert.match(first.imageUrl, /^\/api\/media\/[a-f0-9]{64}$/);
        await page.reload(); await page.waitForFunction(() => window.Store && window.Store.getSyncStatus().cloudLoaded);
        assert.equal(await page.evaluate(() => window.Store.getHeritageCards([]).length), 1);
        assert.ok(await page.evaluate(async url => { const img = new Image(); img.src = url; await img.decode(); return img.naturalWidth > 0; }, first.imageUrl));
      });
      await check('独立游客设备读取完整内容和换行', async () => {
        const visitor = await browser.newContext(options), view = await visitor.newPage();
        try {
          await view.goto(base + '/#/science'); await view.waitForFunction(() => window.Store && window.Store.getSyncStatus().cloudLoaded);
          assert.equal(await view.evaluate(() => window.Store.getSession()), null);
          assert.equal(await view.evaluate(() => window.Store.getHeritageCards([]).length), 1);
          await view.locator('.h-card.is-custom').click();
          assert.equal(await view.locator('#detailBody p').count(), 2); assert.equal(await view.locator('#detailBody br').count(), 1);
          assert.ok(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        } finally { await visitor.close(); }
      });
      await openAdmin(); await page.locator('[data-tab="kepu"]').click(); await page.locator('#kepuAddBtn').click();
      await page.locator('#kpName').fill(name + ' 断网草稿'); await page.locator('#kpDetail').fill('断网后保留的正文。');
      await context.route('**/api/admin/sync', route => route.abort('internetdisconnected'));
      await page.locator('#kpSaveBtn').click();
      await check('断网保存不假报成功，刷新保留草稿', async () => {
        await page.waitForFunction(() => !document.getElementById('kpSaveBtn').disabled && window.Store.getSyncStatus().pending);
        assert.ok(await page.locator('#kepuForm').isVisible());
        await page.reload(); await page.waitForFunction(() => window.Store && window.Store.getHeritageCards([]).length === 2);
        assert.ok(await page.evaluate(() => window.Store.getHeritageCards([]).some(c => c.name.includes('断网草稿'))));
      });
      await context.unroute('**/api/admin/sync');
      await check('恢复联网后两条均上传，无重复', async () => {
        await page.evaluate(async () => { await window.Store.syncWithCloud(); await window.Store.flushPending(); }); await idle();
        const response = await context.request.get(base + '/api/admin/sync');
        assert.equal((await response.json()).kepuCustom.length, 2);
      });
      await openAdmin(); await page.locator('[data-tab="kepu"]').click();
      await page.locator('[data-del-kepu="' + first.id + '"]').click(); await idle();
      await page.locator('[data-tab="sys"]').click();
      await check('误删单项可从云端历史恢复', async () => {
        const operation = await page.evaluate(() => window.Store.getRecoveryHistory().find(op => op.kind === '删除内容').id);
        await page.locator('[data-restore-operation="' + operation + '"]').click();
        await page.waitForFunction(() => window.Store.getHeritageCards([]).length === 2); await idle();
        assert.ok(await page.evaluate(id => window.Store.getHeritageCards([]).some(c => c.id === id), first.id));
      });
      await check('容量面板和旧图片整理可用', async () => {
        await page.locator('#storageInfoBtn').click(); await page.waitForFunction(() => document.getElementById('storageInfoText').textContent.includes('独立图片'));
        await page.locator('#optimizeImagesBtn').click(); await page.waitForFunction(() => document.getElementById('adminToast')?.textContent.includes('已整理'));
      });
      let backupPath;
      await check('浏览器下载完整图片备份', async () => {
        const downloading = page.waitForEvent('download'); await page.locator('#exportBundleBtn').click(); const download = await downloading;
        backupPath = path.join(root, '.cache/' + name + '-backup.json'); await download.saveAs(backupPath);
        const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        assert.equal(backup.cloudDraft.kepuCustom.length, 2);
        assert.match(backup.cloudDraft.kepuCustom.find(c => c.id === first.id).imageUrl, /^data:image\/jpeg;base64,/);
        assert.equal(backup.password, undefined); assert.equal(backup.tokens, undefined);
      });
      await check('导入下载文件恢复图文', async () => {
        await page.evaluate(async () => { for (const card of window.Store.getHeritageCards([])) window.Store.deleteHeritageCard(card.id); await window.Store.flushPending(); });
        await page.locator('#bundleFileInput').setInputFiles(backupPath);
        await page.waitForFunction(() => window.Store.getHeritageCards([]).length === 2); await idle();
        const restored = await page.evaluate(id => window.Store.getHeritageCards([]).find(c => c.id === id), first.id);
        assert.ok(await page.evaluate(async url => { const img = new Image(); img.src = url; await img.decode(); return img.naturalWidth > 0; }, restored.imageUrl));
      });
      await page.screenshot({ path: path.join(root, '.cache/test-shots/' + name + '-storage.png'), fullPage: true });
      await check('无页面脚本异常或未预期弹窗', async () => {
        assert.deepEqual(errors, []);
        assert.ok(dialogs.every(text => /确定删除|恢复这项修改|备份已恢复并上传/.test(text)), JSON.stringify(dialogs));
      });
    } catch (error) {
      evidence.failed++; console.error('FAIL ' + name + ': ' + error.stack);
      await page.screenshot({ path: path.join(root, '.cache/test-shots/' + name + '-failed.png'), fullPage: true }).catch(() => {});
    } finally {
      evidence.profiles.push({ name, checks, errors, dialogs });
      await context.close(); await new Promise(resolve => server.close(resolve));
    }
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(root, '.cache/browser-engine-results.json'), JSON.stringify(evidence, null, 2));
console.log(evidence.passed + ' passed, ' + evidence.failed + ' failed; WebKit simulation only');
if (evidence.failed) process.exitCode = 1;
