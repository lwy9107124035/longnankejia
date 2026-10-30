import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { startSiteServer } from './helpers/site-server.mjs';
import { createMediaBucket } from './helpers/media-r2.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';
import { storeMedia } from '../functions/_lib/admin-media.js';
import { checkHealth } from '../scripts/maintenance-health.mjs';

const root = process.cwd(), scale = process.argv.includes('--scale');
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(path.join(root, '.cache/browser-check/node_modules/playwright/index.mjs')).href);
const report = { at: new Date().toISOString(), scope: 'local SQLite + real local R2 + full application UI', remoteResources: false, realAppleDevice: false, scale, profiles: [] };
const cleanup = [], count = scale ? 10000 : 125;
const mediaFolder = path.join(root, '.cache/media-scale-10000-250k-parallel4-worker');
const bucket = await createMediaBucket({ after(fn) { cleanup.push(fn); } }, scale ? { persistPath: path.join(mediaFolder, 'r2') } : {});
let images;
if (scale) {
  images = JSON.parse(fs.readFileSync(path.join(mediaFolder, 'manifest-10000.json'), 'utf8'));
  assert.equal(images.length, 10000);
  const source = fs.readFileSync('assets/model-references/hutoumao-211.jpg');
  let nextImage = 0, prepared = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let index; (index = nextImage++) < images.length;) {
      const expected = images[index];
      if ((await bucket.head('media/' + expected.id))?.size === 250000) continue;
      const segments = [], note = Buffer.from('local scale image ' + String(index).padStart(5, '0'));
      let remaining = 250000 - source.length;
      while (remaining) {
        let size = Math.min(65533, remaining - 4);
        if (remaining - size - 4 > 0 && remaining - size - 4 < 4) size -= 4 - (remaining - size - 4);
        const segment = Buffer.alloc(size + 4, 32); segment[0] = 255; segment[1] = 254; segment.writeUInt16BE(size + 2, 2); note.copy(segment, 4, 0, Math.min(size, note.length));
        segments.push(segment); remaining -= segment.length;
      }
      const bytes = Buffer.concat([source.subarray(0, 2), ...segments, source.subarray(2)]);
      const result = await storeMedia(null, 'data:image/jpeg;base64,' + bytes.toString('base64'), bucket);
      assert.equal(result.id, expected.id);
      if (++prepared % 1000 === 0) console.log('Prepared and verified ' + prepared + ' scale images');
    }
  }));
  assert.equal((await bucket.head('media/' + images[9999].id))?.size, 250000);
} else {
  const bytes = fs.readFileSync('assets/model-references/hutoumao-211.jpg');
  const image = await storeMedia(null, 'data:image/jpeg;base64,' + bytes.toString('base64'), bucket);
  images = Array.from({ length: count }, () => image);
}
let browser;
try {
  for (const [engine, viewport] of [['chromium', { width: 1280, height: 900 }], ['webkit', { width: 390, height: 844 }]]) {
    const backend = createAdminBackend(); backend.env.ADMIN_MEDIA = bucket;
    const rootSession = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'fixture-root' })).data;
    const author = (await backend.call({ action: 'create_token', name: '合成录入者', days: 1 }, rootSession.bearer)).data.token;
    for (const file of ['0002_content_records.sql', '0003_media_uploads.sql']) backend.sqlite.exec(fs.readFileSync(path.join(root, 'migrations/admin', file), 'utf8'));
    const content = structuredClone(globalThis.HeritageContent.defaults); content.auditLogs = [];
    content.kepuCustom = Array.from({ length: count }, (_, index) => ({ id: 'scale-' + String(index).padStart(5, '0'), name: '规模资料' + String(index).padStart(5, '0'), category: 'craft',
      detail: '第一行\n第二行\n\n' + ('完整正文' + index + '。').repeat(160), imageUrl: '/api/media/' + images[index].id, creatorName: '合成录入者', creatorTokenId: author.id, createdAt: index + 1 }));
    content.kbCustom = Array.from({ length: 125 }, (_, index) => ({ id: 'custom-kb-' + String(index).padStart(3, '0'), title: '检索资料' + String(index).padStart(3, '0'),
      answer: '指定正文' + index, keywords: ['检索资料' + String(index).padStart(3, '0')], creatorName: '合成录入者', creatorTokenId: author.id, createdAt: index + 1 }));
    content.dialectCustom = Array.from({ length: 125 }, (_, index) => ({ id: 'dl-' + String(index).padStart(3, '0'), chapter: '采风', mediaType: index === 124 ? 'audio' : 'video', isCustom: true,
      item: { name: '方言资料' + String(index).padStart(3, '0'), page: 1, mediaType: index === 124 ? 'audio' : 'video', ...(index === 124 ? { audioUrl: 'https://example.invalid/sample.mp3' } : { videoUrl: 'https://example.invalid/sample.mp4' }) } }));
    const migrated = await migrateRecordStorage(backend.db, { value: content, revision: 0 });
    const server = await startSiteServer({ root, port: 0, backend });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const group = { engine, count, metadataBytes: migrated.bytes, checks: [], errors: [], failures: [] };
    report.profiles.push(group);
    let context;
    try {
      browser = await (engine === 'chromium' ? chromium : webkit).launch(engine === 'chromium' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true } : {});
      context = await browser.newContext({ viewport, acceptDownloads: true });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on('pageerror', error => group.errors.push(error.message));
      page.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.dismiss() : dialog.accept());
      async function check(name, action) { await action(); group.checks.push(name); }
      await page.goto(origin + '/#/science', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded);
      await check('云端总数完整，首页只读取首批摘要', async () => {
        assert.equal(await page.locator('#hPillCustom').textContent(), String(count));
        assert.ok(await page.locator('.h-card').count() <= 50);
        assert.equal(await page.evaluate(() => window.Store.getCatalog().model), 'records-v1');
      });
      await page.locator('.h-cat-pill[data-cat="custom"]').click();
      const first = await page.locator('.h-card .h-name').allTextContents(); assert.equal(first.length, 50);
      await page.locator('#heritagePages button').filter({ hasText: '下一页' }).click();
      await page.waitForFunction(firstName => document.querySelector('.h-card .h-name')?.textContent !== firstName, first[0]);
      await check('第二页50条且与第一页不重复，上一页可返回', async () => {
        const next = await page.locator('.h-card .h-name').allTextContents(); assert.equal(next.length, 50); assert.ok(next.every(name => !first.includes(name)));
        await page.locator('#heritagePages button').filter({ hasText: '上一页' }).click();
        assert.deepEqual(await page.locator('.h-card .h-name').allTextContents(), first);
      });
      const target = '规模资料' + String(count - 1).padStart(5, '0');
      await page.locator('#heritageSearch').fill(target); await page.getByRole('button', { name: new RegExp(target) }).waitFor();
      await page.getByRole('button', { name: new RegExp(target) }).click();
      await check('末尾记录可以搜索并按需展开正文、换行和实际R2图片', async () => {
        await page.waitForFunction(name => !document.querySelector('#detailModal').hidden && document.querySelector('#detailTitle').textContent === name, target);
        assert.match(await page.locator('#detailBody').textContent(), /完整正文/);
        await page.waitForFunction(() => document.querySelector('#detailMedia img')?.naturalWidth > 0);
      });
      await page.locator('#detailClose').click(); await page.locator('#heritageSearchClear').click();
      await check('搜索后清除仍能继续正常翻页', async () => {
        assert.deepEqual(await page.locator('.h-card .h-name').allTextContents(), first);
        await page.locator('#heritagePages button').filter({ hasText: '下一页' }).click();
        await page.waitForFunction(firstName => document.querySelector('.h-card .h-name')?.textContent !== firstName, first[0]);
        assert.equal(await page.locator('.h-card').count(), 50);
      });
      await page.evaluate(() => window.Admin.open()); await page.waitForSelector('#adminLoginBtn');
      await page.locator('#adminPwInput').fill('admin123'); await page.locator('#adminLoginBtn').click(); await page.waitForSelector('[data-tab="kepu"]');
      await page.locator('[data-tab="kepu"]').click();
      await check('管理员统计显示云端全部条数，列表限制50条', async () => {
        assert.equal(await page.locator('.admin-stat-val').nth(1).textContent(), String(count));
        assert.ok(await page.locator('[data-edit-kepu]').count() <= 50);
      });
      await page.locator('#kepuSearch').fill(target); await page.locator(`[data-edit-kepu="scale-${String(count - 1).padStart(5, '0')}"]`).waitFor();
      await page.locator(`[data-edit-kepu="scale-${String(count - 1).padStart(5, '0')}"]`).click();
      await page.waitForSelector('#kpDetail');
      await check('末尾记录编辑表单保留完整原文', async () => { assert.match(await page.locator('#kpDetail').inputValue(), /完整正文/); });
      await page.locator('#kpDetail').fill('编辑后第一行\n第二行'); await page.locator('#kpSaveBtn').click();
      await page.waitForFunction(() => !window.Store.getSyncStatus().pending);
      await check('保存编辑没有删除其余记录', async () => {
        const row = backend.sqlite.prepare("SELECT COUNT(*) AS count FROM admin_content_items WHERE kind='kepuCustom' AND value!='null'").get(); assert.equal(row.count, count);
      });
      await page.locator('[data-tab="kb"]').click(); await page.locator('#kbSearch').fill('检索资料124');
      await page.locator('.admin-kb-item').filter({ hasText: '检索资料124' }).waitFor();
      await page.locator('.admin-kb-item').filter({ hasText: '检索资料124' }).locator('[data-action="edit"]').click();
      await page.waitForSelector('#kbAnswer');
      await check('知识库末尾条目可搜索编辑且原文完整', async () => { assert.equal(await page.locator('#kbAnswer').inputValue(), '指定正文124'); });
      await page.locator('[data-tab="dialect"]').click();
      await check('方言管理总数准确、分页限制50条、末尾录音能检索', async () => {
        assert.equal(await page.locator('.admin-stat-val').nth(1).textContent(), '125');
        assert.ok(await page.locator('#customDialectList .admin-dialect-item').count() <= 50);
        await page.locator('#dlSearch').fill('方言资料124');
        await page.locator('#customDialectList .admin-dialect-item').filter({ hasText: '方言资料124' }).waitFor();
        assert.match(await page.locator('#customDialectList').textContent(), /录音/);
      });
      await page.evaluate(() => window.Admin.close());
      await check('全局搜索可以找到首批以外的科普完整正文', async () => {
        await page.evaluate(() => window.App.switchPanel('panelChat'));
        await page.locator('#chatSearchInput').fill('规模资料00075');
        await page.locator('.chat-search-item').filter({ hasText: '规模资料00075' }).waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.chat-search-item')].some(node => node.textContent.includes('规模资料00075') && node.textContent.includes('完整正文')));
        assert.match(await page.locator('.chat-search-item').filter({ hasText: '规模资料00075' }).textContent(), /完整正文/);
        await page.locator('#chatSearchClear').click();
      });
      await check('方言公开列表的末尾录音可检索，完整知识导出包含全部125条正文', async () => {
        await page.evaluate(() => window.App.switchPanel('viewDialect'));
        await page.locator('#dialectSearch').fill('方言资料124');
        await page.locator('#dlTracks .dl-track').filter({ hasText: '方言资料124' }).waitFor();
        const exported = await page.evaluate(async () => { await window.Store.prepareExport(['kbCustom', 'kbEdited', 'kbDeleted']); return JSON.parse(window.Store.exportKB()); });
        assert.equal(exported.filter(row => row.id.startsWith('custom-kb-')).length, 125);
        assert.equal(exported.find(row => row.id === 'custom-kb-124').answer, '指定正文124');
      });
      await check('管理员审查明细按50条分页，统计包含全部未加载记录', async () => {
        await page.evaluate(() => window.Admin.open());
        await page.locator('[data-tab="token"]').click();
        const button = page.locator('[data-inspect-token="' + author.id + '"]');
        assert.match(await button.textContent(), new RegExp(String(count + 125)));
        await button.click(); await page.waitForSelector('.admin-inspect-item');
        assert.equal(await page.locator('.admin-inspect-item').count(), 50);
        const first = await page.locator('.admin-inspect-item-title').first().textContent();
        await page.locator('#inspectNext').click();
        await page.waitForFunction(name => document.querySelector('.admin-inspect-item-title')?.textContent !== name, first);
        assert.equal(await page.locator('.admin-inspect-item').count(), 50);
      });
      if (engine === 'chromium' && process.argv.includes('--backup')) await check('所有正文及本站图片完整备份，隔离库及对象存储逐项恢复核验', async () => {
        const snapshotDir = path.join(root, '.cache/records-' + (scale ? 'scale-' : '') + 'backup');
        const saved = await checkHealth({ origin, baseline: { revision: migrated.revision, ids: content.kepuCustom.map(row => row.id) }, snapshotDir,
          fetchImpl: (url, options) => backend.fetchApi(url, options) });
        assert.deepEqual(saved.problems, []); assert.equal(saved.snapshotComplete, true);
        const snapshot = JSON.parse(fs.readFileSync(saved.snapshotPath, 'utf8'));
        assert.equal(snapshot.kepuCustom.length, count);
        const restored = createAdminBackend(), restoredBucket = await createMediaBucket({ after(fn) { cleanup.push(fn); } });
        try {
          restored.sqlite.exec(fs.readFileSync('migrations/admin/0002_content_records.sql', 'utf8'));
          const bundle = Object.fromEntries(Object.keys(globalThis.HeritageContent.defaults).map(field => [field, snapshot[field]])); bundle.auditLogs = [];
          const receipt = await migrateRecordStorage(restored.db, { value: bundle, revision: 0 });
          const rows = restored.sqlite.prepare("SELECT key,value FROM admin_content_items WHERE generation=? AND kind NOT IN ('auditLogs','_history','_notifications') AND value!='null'").all(receipt.generation);
          const expected = globalThis.HeritageContent.contentCells(bundle);
          assert.equal(rows.length, expected.size);
          for (const row of rows) assert.equal(globalThis.HeritageContent.canonical(JSON.parse(row.value)), globalThis.HeritageContent.canonical(expected.get(row.key)));
          const uniqueImages = [...new Map(images.map(image => [image.id, image])).values()];
          for (let offset = 0; offset < uniqueImages.length; offset += 4) await Promise.all(uniqueImages.slice(offset, offset + 4).map(async image => {
            const bytes = fs.readFileSync(path.join(snapshotDir, 'media', image.id + '.jpeg'));
            const result = await storeMedia(null, 'data:image/jpeg;base64,' + bytes.toString('base64'), restoredBucket);
            assert.equal(result.id, image.id);
            const object = await restoredBucket.get('media/' + image.id);
            assert.deepEqual(Buffer.from(await object.arrayBuffer()), bytes);
          }));
          let cursor, restoredCount = 0;
          do { const listed = await restoredBucket.list({ cursor }); restoredCount += listed.objects.length; cursor = listed.truncated ? listed.cursor : undefined; } while (cursor);
          assert.equal(restoredCount, uniqueImages.length);
          report.backupRestore = { revision: saved.revision, records: count, media: uniqueImages.length, snapshotComplete: saved.snapshotComplete,
            mediaArchived: saved.mediaArchived, mediaReused: saved.mediaReused, snapshotPath: saved.snapshotPath, privateHistoryIncluded: false, remoteResources: false };
        } finally { restored.close(); }
      });
      await page.screenshot({ path: '.cache/test-shots/records-' + (scale ? 'scale-' : '') + engine + '.png' });
      assert.deepEqual(group.errors, []);
    } catch (error) {
      group.failures.push(error.stack || error.message);
      group.diagnostic = await page.evaluate(() => ({ dialectSearch: document.querySelector('#dialectSearch')?.value,
        dialectText: document.querySelector('#dlTracks')?.textContent.slice(0, 800), sync: window.Store.getSyncStatus() })).catch(() => null);
    }
    finally { await context?.close(); await browser?.close(); browser = null; await new Promise(resolve => server.close(resolve)); }
  }
} finally { for (const close of cleanup.reverse()) await close(); }
report.passed = report.profiles.reduce((sum, group) => sum + group.checks.length, 0); report.failed = report.profiles.reduce((sum, group) => sum + group.failures.length, 0);
const output = '.cache/records-browser-' + (scale ? 'scale-' : '') + 'results.json'; fs.writeFileSync(output, JSON.stringify(report, null, 2));
for (const group of report.profiles) console.log(group.engine + ': ' + group.checks.length + ' passed, failures=' + group.failures.length + (group.failures.length ? '\n' + group.failures.join('\n') : ''));
if (report.failed) process.exitCode = 1;
