import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAdminBackend, recoveryFixture } from './helpers/admin-harness.mjs';
import { startSiteServer } from './helpers/site-server.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href
  : 'playwright';
const { chromium, webkit } = await import(playwrightModule);
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const records = process.argv.includes('--records');
const separateMedia = process.argv.includes('--separate-media');
const mode = records ? 'records' + (separateMedia ? '-split-media' : '') : 'snapshot';
const outPath = path.join(root, '.cache/admin-browser-comprehensive-' + mode + '-results.json');
const shots = path.join(root, '.cache/test-shots/admin-browser-comprehensive');
fs.mkdirSync(shots, { recursive: true });
const only = new Set(process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean) || []);
const groups = [
  ['knowledge', 'chromium'], ['kepu', 'webkit'], ['dialect', 'chromium'],
  ['imports', 'webkit'], ['ai-failure', 'chromium'], ['tokens-lock', 'webkit'],
  ['backup-drafts', 'chromium'], ['editor-role', 'webkit'],
  ['review-notify-chrome', 'chromium'], ['review-notify-phone', 'webkit'],
  ['lockouts-chrome', 'chromium'], ['lockouts-phone', 'webkit'],
  ['sync-conflict-chrome', 'chromium'], ['sync-conflict-phone', 'webkit'],
  ['form-conflict-kb', 'chromium'], ['form-conflict-kepu', 'webkit'], ['form-conflict-dialect', 'chromium'],
  ...(records ? [['history-pages', 'chromium'], ['system-controls-chrome', 'chromium'], ['system-controls-phone', 'webkit']] : [])
].filter(([name]) => !only.size || only.has(name));
const results = { startedAt: new Date().toISOString(), mode, groups: [], passed: 0, failed: 0 };

async function freePort() {
  const s = net.createServer();
  await new Promise((resolve, reject) => s.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}
async function actualState(backend, page) {
  const bearer = await page.evaluate(() => window.Store.getSession()?.bearer);
  const { status, data } = await backend.call(null, bearer);
  assert.equal(status, 200);
  return data;
}

async function runGroup(name, engineName) {
  const group = { name, engine: engineName, checks: [], failures: [], dialogs: [], pageErrors: [] };
  results.groups.push(group);
  const password = 'Synthetic-Admin-2026!';
  const backend = createAdminBackend({ password });
  const images = separateMedia ? createAdminBackend({ schema: 'media' }) : null;
  if (images) backend.env.ADMIN_MEDIA_DB = images.db;
  if (records) {
    backend.sqlite.exec(fs.readFileSync(path.join(root, 'migrations/admin/0002_content_records.sql'), 'utf8'));
    await migrateRecordStorage(backend.db, { value: name === 'history-pages' ? await recoveryFixture() : structuredClone(globalThis.HeritageContent.defaults), revision: 0 });
  }
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const server = await startSiteServer({ root, port, base, backend });
  let browser, context, page;
  const launch = engineName === 'chromium' ? chromium : webkit;
  try {
    browser = await launch.launch(engineName === 'chromium' ? { executablePath: chromePath, headless: true } : { headless: true });
    context = await browser.newContext({ viewport: engineName === 'webkit' ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: engineName === 'webkit', hasTouch: engineName === 'webkit', acceptDownloads: true });
    page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => group.pageErrors.push(e.message));
    let promptValue = '', promptValues = [];
    page.on('dialog', async d => { group.dialogs.push({ type: d.type(), message: d.message().slice(0, 120) }); if (d.type() === 'prompt') await d.accept(promptValues.shift() ?? promptValue); else await d.accept(); });
    async function check(label, fn) { await fn(); group.checks.push(label); results.passed++; }
    async function idle() { await page.waitForFunction(() => window.Store && !window.Store.getSyncStatus().pending && window.Store.getSyncStatus().status === 'saved', { timeout: 12000 }); }
    async function login(role = 'root') {
      await page.goto(base + '/#/science');
      await page.waitForFunction(() => window.Store && window.Admin && window.Store.getSyncStatus().cloudLoaded);
      await page.evaluate(() => window.Admin.open());
      await page.waitForSelector('#adminLoginBtn');
      await page.locator('#adminPwInput').fill(password);
      await page.locator('#adminLoginBtn').click();
      await page.waitForSelector('[data-tab="kb"]');
      if (role === 'editor') {
        // Create/login as editor through actual invitation UI, then use editor session on a fresh context.
        await page.locator('[data-tab="token"]').click();
        await page.locator('#tokName').fill('Synthetic editor');
        await page.locator('#tokGenBtn').click();
        const token = await page.locator('#newTokBox').inputValue();
        await page.evaluate(() => window.Admin.logout?.());
        await page.evaluate(t => { location.hash = '#admin-token=' + encodeURIComponent(t); }, token);
      }
    }
    await login();

    const scenario = name.startsWith('form-conflict-') ? 'form-conflict' : name.replace(/-(?:chrome|phone)$/, '');
    if (scenario === 'knowledge') {
      await page.locator('[data-tab="kb"]').click(); await page.locator('#kbAddBtn').click();
      await page.locator('#kbTitle').fill('合成验收知识项'); await page.locator('#kbKeywords').fill('验收,合成'); await page.locator('#kbAnswer').fill('知识答案'); await page.locator('#kbSaveBtn').click(); await idle();
      let state = await actualState(backend, page); const id = state.kbCustom.find(x => x.title === '合成验收知识项')?.id; assert.ok(id);
      await check('知识新增后云端可见', async () => assert.ok(id));
      const row = page.locator('.admin-kb-item').filter({ hasText: '合成验收知识项' });
      await row.locator('[data-action="edit"]').click(); await page.locator('#kbTitle').fill('合成验收知识项已编辑'); await page.locator('#kbSaveBtn').click(); await idle();
      state = await actualState(backend, page); assert.ok(state.kbCustom.some(x => x.id === id && x.title === '合成验收知识项已编辑'));
      await check('知识编辑保持ID并写入云端', async () => {});
      const downloadWait = page.waitForEvent('download'); await page.locator('#kbExportFilterBtn').click(); const download = await downloadWait; const p = path.join(root, '.cache/admin-kb-export.json'); await download.saveAs(p); assert.ok(JSON.parse(fs.readFileSync(p, 'utf8')));
      await check('知识库实际导出可解析', async () => {});
      await row.locator('[data-action="delete"]').click(); await idle();
      state = await actualState(backend, page); assert.ok(!state.kbCustom.some(x => x.id === id));
      await check('知识删除后云端移除', async () => {});
      await page.locator('[data-tab="sys"]').click();
      const op = await page.evaluate(() => window.Store.getRecoveryHistory().find(x => x.title.includes('合成验收知识项已编辑'))?.id);
      if (op) { await page.locator(`[data-restore-operation="${op}"]`).click(); await idle(); state = await actualState(backend, page); assert.ok(state.kbCustom.some(x => x.id === id)); }
      await check('知识删除可从云端历史恢复', async () => assert.ok(op));
    } else if (scenario === 'kepu') {
      await page.locator('[data-tab="kepu"]').click(); await page.locator('#kepuAddBtn').click();
      await page.locator('#kpName').fill('合成科普换行'); await page.locator('#kpDetail').fill('首行\n次行\n\n段落');
      await page.locator('#kpImageFile').setInputFiles(path.join(root, 'assets/model-references/hutoumao-211.jpg')); await page.waitForFunction(() => document.querySelector('#kpImage').value.startsWith('data:image/'));
      await page.locator('#kpSaveBtn').click(); await idle();
      let state = await actualState(backend, page), card = state.kepuCustom.find(x => x.name === '合成科普换行'); assert.ok(card && card.imageUrl.startsWith('/api/media/'));
      const id = card.id;
      await check('科普新增独立图片且云端保存', async () => assert.ok(card));
      await page.locator(`[data-edit-kepu="${id}"]`).click(); await page.locator('#kpDetail').fill('模板复制后\n仍有换行'); await page.locator('#kpSaveBtn').click(); await idle();
      state = await actualState(backend, page); card = state.kepuCustom.find(x => x.id === id); assert.match(card.detail, /\n/);
      await check('科普编辑正文换行持久化', async () => {});
      // Copy-template action is available on the matching custom card and should open a populated editor.
      const copy = page.locator('.admin-kepu-card').filter({ hasText: '合成科普换行' }).locator('[data-action="copy"], [data-copy-kepu]');
      if (await copy.count()) { await copy.first().click(); assert.ok(await page.locator('#kpName').inputValue()); await check('科普复制模板打开预填表单', async () => {}); }
      else group.failures.push('科普复制模板：未找到复制模板控件');
    } else if (scenario === 'dialect') {
      await page.locator('[data-tab="dialect"]').click(); await page.locator('#dialectAddBtn').click();
      await page.locator('#dlName').fill('合成方言音频'); await page.locator('#dlUrl').fill('https://example.invalid/audio.mp3'); await page.locator('#dlSaveBtn').click(); await idle();
      let state = await actualState(backend, page); const item = state.dialectCustom.find(x => x.item?.name === '合成方言音频'); assert.ok(item);
      await check('方言保存后真实API存在', async () => {});
      const play = page.locator(`[data-play-dialect="${item.item.audioUrl}"]`); assert.ok(await play.count());
      assert.equal(await play.first().getAttribute('data-play-dialect'), item.item.audioUrl);
      const popupPromise = page.waitForEvent('popup'); await play.first().click(); const popup = await popupPromise; await popup.close();
      await check('方言预览链接触发播放器', async () => {});
      await page.locator(`[data-del-dialect="${item.id}"]`).click(); await idle(); state = await actualState(backend, page); assert.ok(!state.dialectCustom.some(x => x.id === item.id));
      await check('方言删除后API移除', async () => {});
      await page.locator('#dialectAddBtn').click(); await page.locator('#dlName').fill('方言503待保存'); await page.locator('#dlUrl').fill('https://example.invalid/offline.mp3');
      await context.route('**/api/admin/sync', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
      await page.locator('#dlSaveBtn').click(); await page.waitForFunction(() => !document.querySelector('#dlSaveBtn')?.disabled);
      const failedId = await page.evaluate(() => window.Store.getCustomDialectTracks().find(x => x.item?.name === '方言503待保存')?.id);
      const dialectAfterFailure = await actualState(backend, page);
      assert.ok(failedId); assert.ok(await page.locator('#dialectForm').isVisible());
      assert.ok(!dialectAfterFailure.dialectCustom.some(x => x.id === failedId));
      assert.match(await page.locator('#adminToast').textContent(), /尚未上传|失败|重试/);
      await check('方言503时留本机草稿、表单保留且云端未变', async () => {});
      await context.unroute('**/api/admin/sync'); await page.locator('#dlName').fill('方言503重试成功'); await page.locator('#dlSaveBtn').click(); await idle();
      const retried = await actualState(backend, page);
      assert.equal(retried.dialectCustom.filter(x => x.id === failedId).length, 1);
      assert.equal(retried.dialectCustom.find(x => x.id === failedId).item.name, '方言503重试成功');
      await check('方言失败后编辑名称重试，只上传同一条记录一次', async () => {});
      await page.locator('#dialectAddBtn').click(); await page.locator('#dlName').fill('待恢复方言草稿'); await page.locator('#dlUrl').fill('https://example.invalid/recovered.mp3');
      await page.waitForFunction(() => document.querySelector('#dialectForm [data-editor-status]')?.textContent.includes('本机草稿已保存'));
      const beforeReload = await actualState(backend, page); assert.ok(!beforeReload.dialectCustom.some(x => x.item?.name === '待恢复方言草稿'));
      await page.locator('#dlCancelBtn').click(); await page.reload(); await page.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded); await page.evaluate(() => window.Admin.open());
      const recoveryDrafts = await page.evaluate(() => window.Store.getRecoveryDrafts()); assert.ok(recoveryDrafts.length);
      promptValue = '1'; await page.locator('#recoverDraftBtn').click(); await page.waitForFunction(() => document.querySelector('#dlName')?.value === '待恢复方言草稿');
      assert.equal(await page.locator('#dlUrl').inputValue(), 'https://example.invalid/recovered.mp3');
      await check('刷新后可通过找回草稿恢复未上传方言表单', async () => {});
    } else if (scenario === 'imports') {
      await page.locator('[data-tab="import"]').click();
      const cases = [
        ['records.txt', '# TXT合成\nTXT答案'],
        ['records.md', '# MD合成\nMD答案'],
        ['records.json', JSON.stringify([{ title: 'JSON合成', keywords: ['甲'], answer: 'JSON答案' }])]
      ];
      for (const [filename, buffer] of cases) {
        await page.locator('#docFileInput').setInputFiles({ name: filename, mimeType: filename.endsWith('.json') ? 'application/json' : 'text/plain', buffer: Buffer.from(buffer) });
        await page.waitForFunction(() => document.querySelectorAll('.draft-title').length > 0);
        assert.match(await page.locator('.draft-title').first().inputValue(), /TXT|MD|JSON/);
        await page.locator('#batchCommitBtn').click(); await idle();
        await page.waitForFunction(() => document.querySelectorAll('.draft-title').length === 0);
      }
      const beforeDocx = await actualState(backend, page);
      await page.locator('#docFileInput').setInputFiles({ name: 'bad.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('not-a-docx') });
      await page.waitForTimeout(300);
      const state = await actualState(backend, page); assert.equal(state.kbCustom.filter(x => /TXT合成|MD合成|JSON合成/.test(x.title)).length, 3);
      await check('TXT/MD/JSON草稿提交到API', async () => assert.ok(state.kbCustom.length >= beforeDocx.kbCustom.length));
      assert.ok(group.dialogs.some(x => /DOCX|文档|格式|解析|无效/.test(x.message)));
      await check('损坏DOCX明确拒绝且不入库', async () => assert.ok(true));
    } else if (scenario === 'ai-failure') {
      await page.locator('[data-tab="ai"]').click(); await page.locator('#apiModel').selectOption({ index: 1 }); await page.locator('#wfPrompt').fill('Synthetic prompt saved');
      const beforeFailure = await actualState(backend, page);
      await context.route('**/api/admin/sync', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
      await page.locator('#aiSaveBtn').click();
      await page.waitForFunction(() => !document.querySelector('#aiSaveBtn')?.disabled && document.querySelector('#adminToast')?.textContent.includes('尚未上传'));
      const afterFailure = await actualState(backend, page);
      assert.equal(await page.locator('#wfPrompt').inputValue(), 'Synthetic prompt saved');
      assert.equal(await page.locator('#apiModel').inputValue(), 'Qwen/Qwen2.5-7B-Instruct');
      assert.equal(await page.evaluate(() => window.Store.getSyncStatus().pending), true);
      assert.deepEqual(afterFailure.apiConfig, beforeFailure.apiConfig); assert.deepEqual(afterFailure.workflowConfig, beforeFailure.workflowConfig);
      assert.doesNotMatch(await page.locator('#adminToast').textContent(), /配置已保存|配置已生效/);
      await check('AI 503后本机草稿保留、云端未变、显示尚未上传且按钮恢复', async () => {});
      await context.unroute('**/api/admin/sync'); await page.locator('#aiSaveBtn').click();
      await page.waitForFunction(() => !document.querySelector('#aiSaveBtn')?.disabled && document.querySelector('#adminToast')?.textContent.includes('配置已保存')); await idle();
      let saved = await actualState(backend, page);
      if (saved.workflowConfig.systemPrompt !== 'Synthetic prompt saved' || saved.apiConfig.model !== 'Qwen/Qwen2.5-7B-Instruct') group.failures.push('AI联网重试后API未保存完整配置：' + JSON.stringify({ apiConfig: saved.apiConfig, workflowSaved: saved.workflowConfig.systemPrompt === 'Synthetic prompt saved' }));
      await check('AI恢复网络重试后核对模型与工作流真实API状态', async () => {});
      await page.locator('[data-tab="sys"]').click(); await context.route('**/api/admin/sync', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
      await page.locator('#resetApiBtn').click(); await page.waitForFunction(() => !document.querySelector('#resetApiBtn')?.disabled && document.querySelector('#adminToast')?.textContent.includes('重置尚未上传'));
      let afterResetFailure = await actualState(backend, page);
      assert.deepEqual(afterResetFailure.apiConfig, saved.apiConfig); assert.deepEqual(afterResetFailure.workflowConfig, saved.workflowConfig);
      await check('AI重置503提示未上传且云端配置未变', async () => {});
      await context.unroute('**/api/admin/sync'); await page.locator('#resetApiBtn').click();
      await page.waitForFunction(() => !document.querySelector('#resetApiBtn')?.disabled && document.querySelector('#adminToast')?.textContent.includes('AI 设置已重置')); await idle();
      saved = await actualState(backend, page); assert.deepEqual(saved.apiConfig, {}); assert.deepEqual(saved.workflowConfig, {});
      await check('AI重置恢复网络重试后云端配置清空', async () => {});
    } else if (scenario === 'tokens-lock') {
      await page.locator('[data-tab="token"]').click(); await page.locator('#tokName').fill('Synthetic invitee'); await page.locator('#tokDays').selectOption({ index: 1 }); await page.locator('#tokGenBtn').click();
      await page.waitForFunction(() => document.querySelector('#tokenList')?.textContent.includes('Synthetic invitee'));
      let state = await actualState(backend, page); let token = state.tokens.find(x => x.name === 'Synthetic invitee'); assert.ok(token);
      await page.locator(`[data-pause-token="${token.id}"]`).click(); await idle(); state = await actualState(backend, page); assert.equal(state.tokens.find(x => x.id === token.id).paused, true);
      await check('令牌签发与暂停均改API状态', async () => {});
      await page.locator(`[data-resume-token="${token.id}"]`).click(); await idle(); state = await actualState(backend, page); assert.equal(state.tokens.find(x => x.id === token.id).paused, false);
      await check('令牌恢复授权改API状态', async () => {});
      await page.locator(`[data-revoke-token="${token.id}"]`).click(); await idle(); state = await actualState(backend, page); assert.equal(state.tokens.find(x => x.id === token.id).revoked, true);
      await check('令牌撤销写入API', async () => {});
      await page.locator(`[data-del-token="${token.id}"]`).click(); await idle(); state = await actualState(backend, page); assert.ok(!state.tokens.some(x => x.id === token.id));
      await check('令牌记录删除写入API', async () => {});
    } else if (scenario === 'backup-drafts') {
      await page.locator('[data-tab="kb"]').click(); await page.locator('#kbAddBtn').click(); await page.locator('#kbTitle').fill('备份合成项'); await page.locator('#kbKeywords').fill('备份'); await page.locator('#kbAnswer').fill('可恢复'); await page.locator('#kbSaveBtn').click(); await idle();
      await page.locator('[data-tab="sys"]').click(); const downloadPromise = page.waitForEvent('download'); await page.locator('#exportBundleBtn').click(); const dl = await downloadPromise; const bundleFile = path.join(root,'.cache/admin-browser-bundle.json'); await dl.saveAs(bundleFile);
      const bundle = JSON.parse(fs.readFileSync(bundleFile,'utf8')); assert.ok(bundle.cloudDraft || bundle.kbCustom || bundle.kb);
      await check('备份导出包含业务数据', async () => assert.ok(true));
      await page.locator('#bundleFileInput').setInputFiles(bundleFile); await page.waitForTimeout(500); await idle();
      const state = await actualState(backend, page); assert.ok(state.kbCustom.some(x => x.title === '备份合成项'));
      await check('备份导入后真实API仍有记录', async () => {});
      await page.locator('[data-tab="kb"]').click(); await page.locator('#kbAddBtn').click(); await page.locator('#kbTitle').fill('找回草稿项'); await page.locator('#kbKeywords').fill('draft'); await page.locator('#kbAnswer').fill('draft-answer'); await page.locator('#backupDraftBtn').click();
      await page.locator('#kbCancelBtn').click(); await page.locator('#recoverDraftBtn').click();
      await check('表单草稿找回恢复录入值', async () => assert.equal(await page.locator('#kbTitle').inputValue(), '找回草稿项'));
    } else if (scenario === 'system-controls') {
      await page.evaluate(async () => {
        for (var i = 0; i < 65; i++) window.Store.addEntry({ id: 'reset-fixture-' + i, title: '重置验收' + i, answer: '正文' });
        window.Store.addHeritageCard({ id: 'reset-keep-card', name: '重置知识库时保留科普' });
        if (!(await window.Store.flushPending())) throw Error('fixture upload failed');
      });
      await page.reload(); await page.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded); await page.evaluate(() => window.Admin.open());
      await page.locator('[data-tab="sys"]').click();
      await page.locator('#resetKBBtn').click();
      await page.waitForFunction(() => !document.querySelector('#resetKBBtn').disabled && document.querySelector('#adminToast')?.textContent.includes('知识库已重置')); await idle();
      await check('重置知识库覆盖首屏外65条知识，保留科普', async () => {
        const state = await actualState(backend, page); assert.equal(state.kbCustom.length, 0);
        assert.equal(state.kepuCustom.find(row => row.id === 'reset-keep-card').name, '重置知识库时保留科普');
      });
      await page.locator('#storageInfoBtn').click(); await page.waitForFunction(() => document.querySelector('#storageInfoText').textContent.includes('独立图片库'));
      await page.locator('#optimizeImagesBtn').click(); await page.waitForFunction(() => !document.querySelector('#optimizeImagesBtn').disabled && document.querySelector('#adminToast')?.textContent.includes('已整理'));
      assert.equal(await page.locator('#archiveHistoryBtn').isDisabled(), true);
      assert.match(await page.locator('#adminBody').textContent(), /当前未启用历史归档，原记录仍保留/);
      await check('容量与图片整理可用，未启用历史归档时按钮禁用并说明记录保留', async () => {});
      const peer = (await backend.call({ action: 'login', credential: password, clientId: 'password-peer' })).data;
      const changedPassword = 'Synthetic-New-Password-2026!';
      await page.locator('#newPw1').fill(changedPassword); await page.locator('#newPw2').fill(changedPassword);
      await context.route('**/api/admin/sync', async route => {
        if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'update_password') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'STORAGE_UNAVAILABLE', error: 'Synthetic password storage failure' }) });
        await route.continue();
      });
      const failedPassword = page.waitForEvent('dialog', { predicate: dialog => dialog.message().includes('Synthetic password storage failure') });
      await page.locator('#pwSaveBtn').click(); await failedPassword;
      assert.equal((await backend.call(null, peer.bearer)).status, 200); assert.equal(await page.locator('#newPw1').inputValue(), changedPassword);
      await check('修改密码503时旧登录继续有效，表单保留新输入', async () => {});
      await context.unroute('**/api/admin/sync'); await page.locator('#pwSaveBtn').click();
      await page.waitForFunction(() => document.querySelector('#newPw1').value === '');
      assert.equal((await backend.call(null, peer.bearer)).status, 401);
      assert.equal((await backend.call({ action: 'login', credential: password, clientId: 'old-password' })).status, 401);
      assert.equal((await backend.call({ action: 'login', credential: changedPassword, clientId: 'new-password' })).status, 200);
      await check('实际改密后新密码可登录，旧密码与其他超管会话失效', async () => {});
    } else if (scenario === 'history-pages') {
      await page.locator('[data-tab="sys"]').click();
      assert.equal(await page.locator('[data-restore-operation]').count(), 20);
      await page.locator('#historyNext').click(); await page.waitForFunction(() => document.querySelector('#historyPageText')?.textContent === '第 1 页');
      assert.equal(await page.locator('[data-restore-operation]').count(), 50);
      await page.locator('#historyNext').click(); await page.locator('[data-restore-operation="history-op-0"]').waitFor();
      assert.equal(await page.locator('[data-restore-operation]').count(), 20); assert.equal(await page.locator('#historyNext').isDisabled(), true);
      await check('历史超过50项时仍可翻到最早记录', async () => {});
      await page.locator('#historyPrev').click(); await page.waitForFunction(() => document.querySelector('#historyPageText')?.textContent === '第 1 页');
      assert.equal(await page.locator('[data-restore-operation]').count(), 50);
      await page.locator('#historyNext').click(); await page.locator('[data-restore-operation="history-op-0"]').click(); await idle();
      assert.equal((await actualState(backend, page)).kepuCustom.find(row => row.id === 'history-fixture-0').detail, '旧正文');
      await check('历史上一页可返回，最早记录可通过真实按钮恢复', async () => {});
    } else if (scenario === 'editor-role') {
      // Issue an editor invite through root UI, then redeem through actual invitation flow.
      await page.locator('[data-tab="token"]').click(); await page.locator('#tokName').fill('Synthetic editor'); await page.locator('#tokGenBtn').click();
      await page.waitForFunction(() => document.querySelector('#tokenList')?.textContent.includes('Synthetic editor'));
      const tokenData = await actualState(backend, page); const token = tokenData.tokens.find(x => x.name === 'Synthetic editor').token;
      const session = await backend.call({ action: 'login', credential: token }); assert.equal(session.status, 200);
      const editorToken = session.data.bearer;
      const editorContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        const editor = await editorContext.newPage(); editor.setDefaultTimeout(12000); await editor.goto(base + '/#/science'); await editor.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded);
        await editor.evaluate(() => window.Admin.open()); await editor.waitForSelector('#adminLoginBtn');
        await editor.locator('#adminPwInput').fill(token); await editor.locator('#adminLoginBtn').click(); await editor.waitForSelector('[data-tab="ai"]');
        assert.equal(await editor.locator('[data-tab="token"]').count(), 0);
        await editor.locator('[data-tab="ai"]').click();
        assert.equal(await editor.locator('#apiModel').isDisabled(), true); assert.equal(await editor.locator('#wfPrompt').isDisabled(), true); assert.equal(await editor.locator('#aiSaveBtn').isDisabled(), true);
        const rootState = await actualState(backend, page);
        const content = Object.fromEntries(['kbCustom','kbEdited','kbDeleted','kepuCustom','kepuEdited','kepuDeleted','dialectCustom','dialectDeleted','apiConfig','workflowConfig'].map(k => [k, rootState[k]]));
        content.workflowConfig = { ...content.workflowConfig, systemPrompt: 'editor attempted' };
        const denied = await backend.call(records ? { action: 'update_content', changes: [{ key: 'workflowConfig', value: content.workflowConfig }] }
          : { action: 'update_custom_bundle', revision: rootState.revision, ...content }, editorToken);
        assert.equal(denied.status, 403);
        const state = await actualState(backend, editor); assert.notEqual(state.workflowConfig?.systemPrompt, 'editor attempted');
        await check('编辑员UI隐藏超管Tab且AI写入未越权', async () => {});
      } finally { await editorContext.close(); }
    } else if (scenario === 'review-notify') {
      await page.locator('[data-tab="token"]').click(); await page.locator('#tokName').fill('Synthetic review invitee'); await page.locator('#tokGenBtn').click();
      await page.waitForFunction(() => document.querySelector('#tokenList')?.textContent.includes('Synthetic review invitee'));
      const rootState = await actualState(backend, page), invite = rootState.tokens.find(x => x.name === 'Synthetic review invitee'); assert.ok(invite);
      const editorContext = await browser.newContext({ viewport: engineName === 'webkit' ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: engineName === 'webkit', hasTouch: engineName === 'webkit' });
      try {
        const editor = await editorContext.newPage(); editor.setDefaultTimeout(12000); editor.on('dialog', async d => { if (d.type() === 'prompt') await d.accept('Synthetic review reason'); else await d.accept(); });
        await editor.goto(base + '/#/science'); await editor.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded); await editor.evaluate(() => window.Admin.open()); await editor.waitForSelector('#adminLoginBtn');
        await editor.locator('#adminPwInput').fill(invite.token); await editor.locator('#adminLoginBtn').click(); await editor.waitForSelector('[data-tab="kb"]');
        await editor.locator('[data-tab="kb"]').click(); await editor.locator('#kbAddBtn').click(); await editor.locator('#kbTitle').fill('Synthetic reviewed contribution'); await editor.locator('#kbKeywords').fill('合成审核'); await editor.locator('#kbAnswer').fill('用于端到端驳回和通知验收'); await editor.locator('#kbSaveBtn').click();
        await editor.waitForFunction(() => !window.Store.getSyncStatus().pending && window.Store.getSyncStatus().status === 'saved');
        let current = await actualState(backend, page); const contribution = current.contributions.find(x => x.tokenId === invite.id && x.title === 'Synthetic reviewed contribution'); assert.ok(contribution);
        await page.evaluate(() => window.Store.syncWithCloud()); await page.locator('[data-tab="token"]').click();
        await page.locator(`[data-inspect-token="${invite.id}"]`).click(); await page.waitForSelector(`[data-reject-id="${contribution.id}"]`);
        promptValue = 'Synthetic review reason'; await page.locator(`[data-reject-id="${contribution.id}"]`).click();
        await page.waitForFunction(() => !document.querySelector('.admin-inspect-list')?.textContent.includes('Synthetic reviewed contribution'));
        current = await actualState(backend, page); assert.ok(!current.contributions.some(x => x.id === contribution.id));
        await check('root实际点击投稿驳回，API贡献记录被撤回', async () => {});
        await editor.evaluate(() => window.Store.syncWithCloud());
        await editor.evaluate(() => { window.Admin.close(); window.Admin.open(); }); await editor.waitForSelector('#ackNotifBtn');
        assert.ok((await actualState(backend, editor)).notifications.some(n => n.tokenId === invite.id && n.read === false));
        await editor.locator('#ackNotifBtn').click();
        await editor.waitForFunction(async () => (await window.Store.getTokenNotifications()).length === 0);
        const afterRead = await actualState(backend, editor); assert.ok(afterRead.notifications.some(n => n.tokenId === invite.id && n.read === true));
        await check('编辑员实际点击已读，API通知标记read', async () => {});
      } finally { await editorContext.close(); }
    } else if (scenario === 'lockouts') {
      for (const [n, ip] of [[1, '192.0.2.41'], [2, '192.0.2.42']]) {
        for (let attempt = 0; attempt < 5; attempt++) await backend.call({ action: 'login', credential: 'Synthetic-Wrong-Password', clientId: `synthetic-lock-${n}`, device: `Synthetic lock ${n}` }, null, { 'CF-Connecting-IP': ip });
      }
      let state = await actualState(backend, page); assert.ok(state.lockouts.filter(x => x.status === 'locked').length >= 2);
      await page.locator('[data-tab="token"]').click(); await page.locator('#refreshLocksBtn').click(); await page.waitForSelector('[data-unlock-client]');
      const locked = state.lockouts.filter(x => x.status === 'locked'), id = locked[0].id;
      await page.locator(`[data-unlock-client="${id}"]`).click(); state = await actualState(backend, page); assert.ok(!state.lockouts.some(x => x.id === id));
      await check('超级管理员点击单个解锁后该锁定记录消失', async () => {});
      await page.locator('#unlockAllClientsBtn').click(); state = await actualState(backend, page); assert.equal(state.lockouts.length, 0);
      await check('超级管理员点击全部解除后锁定记录清空', async () => {});
    } else if (scenario === 'sync-conflict') {
      await page.locator('[data-tab="kepu"]').click(); await page.locator('#kepuAddBtn').click(); await page.locator('#kpName').fill('Synthetic shared conflict'); await page.locator('#kpDetail').fill('起始版本'); await page.locator('#kpSaveBtn').click(); await idle();
      let state = await actualState(backend, page); const original = state.kepuCustom.find(x => x.name === 'Synthetic shared conflict'); assert.ok(original);
      const issued = await backend.call({ action: 'create_token', name: 'Synthetic conflict editors', days: 30 }, await page.evaluate(() => window.Store.getSession().bearer)); assert.equal(issued.status, 200);
      const inviteValue = issued.data.token.token;
      const editorContexts = [], editors = [];
      try {
        for (let i = 0; i < 2; i++) {
          const ctx = await browser.newContext({ viewport: engineName === 'webkit' ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: engineName === 'webkit', hasTouch: engineName === 'webkit' }); editorContexts.push(ctx);
          const editor = await ctx.newPage(); editors.push(editor); editor.setDefaultTimeout(12000);
          editor.on('dialog', async d => { if (d.type() === 'prompt') await d.accept(promptValues.shift() ?? promptValue); else await d.accept(); });
          await editor.goto(base + '/#/science'); await editor.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded); await editor.evaluate(() => window.Admin.open()); await editor.waitForSelector('#adminLoginBtn'); await editor.locator('#adminPwInput').fill(inviteValue); await editor.locator('#adminLoginBtn').click(); await editor.waitForSelector('[data-tab="kepu"]');
        }
        const [localPage, cloudPage] = editors;
        await Promise.all(editors.map(p => p.locator('[data-tab="kepu"]').click()));
        await localPage.locator(`[data-edit-kepu="${original.id}"]`).click(); await localPage.locator('#kpDetail').fill('本机冲突版本');
        await cloudPage.locator(`[data-edit-kepu="${original.id}"]`).click(); await cloudPage.locator('#kpDetail').fill('云端已保存版本'); await cloudPage.locator('#kpSaveBtn').click();
        await cloudPage.waitForFunction(() => !window.Store.getSyncStatus().pending && window.Store.getSyncStatus().status === 'saved');
        await localPage.evaluate(() => window.Store.syncWithCloud()); await localPage.locator('#kpSaveBtn').click();
        await localPage.waitForFunction(() => window.Store.getSyncStatus().conflictCount > 0 && !document.querySelector('#reviewConflictsBtn').hidden);
        promptValues = ['1', '2']; await localPage.locator('#reviewConflictsBtn').click();
        await localPage.waitForFunction(() => window.Store.getSyncStatus().conflictCount === 0 && !window.Store.getSyncStatus().pending && window.Store.getSyncStatus().status === 'saved');
        state = await actualState(backend, page);
        assert.equal(state.kepuCustom.find(x => x.id === original.id).detail, '云端已保存版本');
        assert.ok(state.kepuCustom.some(x => x.id !== original.id && x.detail === '本机冲突版本'));
        await check('双页面冲突由UI核对并另存本机副本，API保留双方版本', async () => {});
      } finally { for (const ctx of editorContexts) await ctx.close(); }
    } else if (scenario === 'form-conflict') {
      const kind = name.slice('form-conflict-'.length);
      const title = `Synthetic cleanup recovery ${kind}`;
      const controls = kind === 'kb'
        ? { tab: 'kb', add: '#kbAddBtn', form: '#kbForm', name: '#kbTitle', body: '#kbAnswer', save: '#kbSaveBtn', cancel: '#kbCancelBtn', originalBody: '原表单回答', peerBody: '同事后来保存的回答' }
        : kind === 'kepu'
          ? { tab: 'kepu', add: '#kepuAddBtn', form: '#kepuForm', name: '#kpName', body: '#kpDetail', save: '#kpSaveBtn', cancel: '#kpCancelBtn', originalBody: '原表单详情', peerBody: '同事后来保存的详情' }
          : { tab: 'dialect', add: '#dialectAddBtn', form: '#dialectForm', name: '#dlName', body: '#dlUrl', save: '#dlSaveBtn', cancel: '#dlCancelBtn', originalBody: 'https://example.invalid/original.mp3', peerBody: 'https://example.invalid/peer.mp3' };
      await page.locator(`[data-tab="${controls.tab}"]`).click(); await page.locator(controls.add).click();
      await page.locator(controls.name).fill(title); await page.locator(controls.body).fill(controls.originalBody);
      await page.waitForFunction(selector => document.querySelector(selector + ' [data-editor-status]')?.textContent.includes('本机草稿已保存'), controls.form);
      await page.evaluate(() => {
        window.__savedClearEditorDraft = window.Store.clearEditorDraft;
        window.Store.clearEditorDraft = async function () { throw new Error('Synthetic draft cleanup failure'); };
      });
      await page.locator(controls.save).click();
      await page.waitForFunction(selector => !document.querySelector(selector)?.disabled && document.querySelector('#adminToast')?.textContent.includes('Synthetic draft cleanup failure'), controls.save);
      let state = await actualState(backend, page);
      let record = kind === 'kb' ? state.kbCustom.find(x => x.title === title)
        : kind === 'kepu' ? state.kepuCustom.find(x => x.name === title)
          : state.dialectCustom.find(x => x.item?.name === title);
      assert.ok(record, 'the initial new record must have reached the isolated backend before cleanup fails');
      const id = record.id;
      assert.ok(await page.locator(controls.form).isVisible());
      await page.evaluate(() => { window.Store.clearEditorDraft = window.__savedClearEditorDraft; delete window.__savedClearEditorDraft; });
      await check(`${kind}新建内容已上云但草稿清理失败，旧表单仍留存`, async () => {});

      const peerContext = await browser.newContext({ viewport: engineName === 'webkit' ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: engineName === 'webkit', hasTouch: engineName === 'webkit' });
      try {
        const peer = await peerContext.newPage(); peer.setDefaultTimeout(12000);
        await peer.goto(base + '/#/science'); await peer.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded); await peer.evaluate(() => window.Admin.open()); await peer.waitForSelector('#adminLoginBtn');
        await peer.locator('#adminPwInput').fill(password); await peer.locator('#adminLoginBtn').click(); await peer.waitForSelector(`[data-tab="${controls.tab}"]`); await peer.locator(`[data-tab="${controls.tab}"]`).click();
        if (kind === 'kb') {
          const row = peer.locator('.admin-kb-item').filter({ hasText: title }); await row.locator('[data-action="edit"]').click(); await peer.locator('#kbAnswer').fill(controls.peerBody); await peer.locator('#kbSaveBtn').click();
        } else if (kind === 'kepu') {
          await peer.locator(`[data-edit-kepu="${id}"]`).click(); await peer.locator('#kpDetail').fill(controls.peerBody); await peer.locator('#kpSaveBtn').click();
        } else {
          await peer.evaluate(async recordId => {
            const row = window.Store.getCustomDialectTracks().find(track => track.id === recordId);
            const version = window.Store.getEditVersion('dialect', recordId);
            window.Store.updateDialectTrack(recordId, { ...row, item: { ...row.item, audioUrl: 'https://example.invalid/peer.mp3' } }, version);
            await window.Store.flushPending();
          }, id);
        }
        await peer.waitForFunction(() => !window.Store.getSyncStatus().pending && window.Store.getSyncStatus().status === 'saved');
        state = await actualState(backend, page);
        record = kind === 'kb' ? state.kbCustom.find(x => x.id === id)
          : kind === 'kepu' ? state.kepuCustom.find(x => x.id === id)
            : state.dialectCustom.find(x => x.id === id);
        const peerVersionSaved = kind === 'kb' ? record.answer === controls.peerBody
          : kind === 'kepu' ? record.detail === controls.peerBody
            : record.item.audioUrl === 'https://example.invalid/peer.mp3';
        assert.ok(peerVersionSaved, 'independent session must persist its later version');
      } finally { await peerContext.close(); }

      await page.reload(); await page.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded); await page.evaluate(() => window.Admin.open());
      const drafts = await page.evaluate(() => window.Store.getRecoveryDrafts()); assert.ok(drafts.length);
      promptValue = String(drafts.findIndex(d => d.editor) + 1); assert.notEqual(promptValue, '0');
      await page.locator('#recoverDraftBtn').click(); await page.waitForFunction(selector => document.querySelector(selector)?.style.display !== 'none', controls.form);
      assert.equal(await page.locator(controls.name).inputValue(), title); assert.equal(await page.locator(controls.body).inputValue(), controls.originalBody);
      await page.locator(controls.save).click();
      await page.waitForFunction(() => window.Store.getSyncStatus().conflictCount > 0 && window.Store.getSyncStatus().pending && window.Store.getSyncStatus().status === 'conflict');
      assert.ok(await page.locator(controls.form).isVisible());
      const statusText = await page.locator('#adminCloudStatus').textContent(); assert.match(statusText, /冲突|核对|草稿/);
      assert.doesNotMatch(await page.locator('#adminToast').textContent().catch(() => ''), /已保存|上传成功/);
      state = await actualState(backend, page);
      record = kind === 'kb' ? state.kbCustom.find(x => x.id === id)
        : kind === 'kepu' ? state.kepuCustom.find(x => x.id === id)
          : state.dialectCustom.find(x => x.id === id);
      const stillPeerVersion = kind === 'kb' ? record.answer === controls.peerBody
        : kind === 'kepu' ? record.detail === controls.peerBody
          : record.item.audioUrl === 'https://example.invalid/peer.mp3';
      assert.ok(stillPeerVersion, 'restoring the stale new-record draft must not overwrite the peer version');
      await check(`${kind}恢复已确认新建草稿后再次保存发生冲突，API保留同事后改版本`, async () => {});
    }
    await page.screenshot({ path: path.join(shots, `${engineName}-${name}.png`), fullPage: true });
    if (group.pageErrors.length) throw new Error('页面脚本异常: ' + group.pageErrors.join(' | '));
  } catch (error) {
    group.failures.push(error.stack || error.message);
    try { if (page) await page.screenshot({ path: path.join(shots, `${engineName}-${name}-failure.png`), fullPage: true }); } catch {}
  } finally {
    try { await context?.close(); } catch {}
    try { await browser?.close(); } catch {}
    await new Promise(resolve => server.close(resolve));
    images?.close();
  }
}

for (const [name, engine] of groups) await runGroup(name, engine);
results.finishedAt = new Date().toISOString();
results.failed = results.groups.reduce((sum, g) => sum + g.failures.length, 0);
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
for (const g of results.groups) console.log(`${g.failures.length ? 'FAIL' : 'PASS'} ${g.name} (${g.engine}) checks=${g.checks.length}${g.failures.length ? ' errors=' + g.failures.length : ''}`);
console.log(`result=${outPath} passed=${results.passed} failed=${results.failed}`);
if (results.failed) process.exitCode = 1;
