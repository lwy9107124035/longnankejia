import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { startSiteServer } from './helpers/site-server.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const records = process.argv.includes('--records');
const report = { startedAt: new Date().toISOString(), records, productionWrites: false, profiles: [] };
const output = process.env.SEARCH_SOURCE_REPORT || path.join(root, '.cache/search-source-browser.json');

for (const engine of ['chromium', 'webkit']) {
  const result = { engine, checks: [], errors: [] }; report.profiles.push(result);
  const backend = createAdminBackend();
  const fixture = structuredClone(globalThis.HeritageContent.defaults);
  fixture.kepuCustom = Array.from({ length: 105 }, (_, i) => ({ id: 'search-fixture-' + i, name: '合成围屋' + String(i).padStart(3, '0'), detail: '浏览检索用的合成正文。' }));
  fixture.kepuCustom.push({ id: 'search-water', name: '象塘水围', detail: '象塘水围的合成检索正文；仅用于本地自动测试。\n\n这项合成工艺使用合成石料。', ask: '象塘水围有哪些特点？' });
  fixture.kbCustom = Array.from({ length: 60 }, (_, i) => ({ id: 'search-knowledge-' + String(i).padStart(3, '0'), title: '合成围屋资料' + i, keywords: ['合成围屋'], answer: '只用于检索的本地合成正文。' }));
  fixture.kbCustom.push({ id: 'zz-remote-craft', title: '合成石砌工艺', topics: ['合成石砌工艺'], keywords: ['合成石砌工艺'], answer: '这项合成工艺使用合成石料。', sources: [{ title: '工艺合成记录', url: 'https://longnankejia.pages.dev/#/science?item=search-water' }] });
  if (records) {
    backend.sqlite.exec(fs.readFileSync(path.join(root, 'migrations/admin/0002_content_records.sql'), 'utf8'));
    await migrateRecordStorage(backend.db, { value: fixture, revision: 0 });
  } else backend.sqlite.prepare("UPDATE admin_state SET value=? WHERE key='content'").run(JSON.stringify(fixture));
  const server = await startSiteServer({ root, port: 0, backend }), origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await (engine === 'chromium' ? chromium : webkit).launch(engine === 'chromium' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true } : {});
  try {
    const context = await browser.newContext({ viewport: engine === 'chromium' ? { width: 1280, height: 900 } : { width: 390, height: 844 } });
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => result.errors.push(error.message));
    await page.goto(origin + '/#/chat'); await page.waitForFunction(() => window.Store?.getSyncStatus().cloudLoaded);
    await page.locator('#chatSearchInput').fill('围');
    const water = page.locator('.chat-search-item').filter({ has: page.locator('.chat-search-item-title', { hasText: /^象塘水围$/ }) }).filter({ hasText: '科普卡片' });
    for (let i = 0; i < 40 && !await water.count(); i++) {
      try { await page.locator('#chatSearchMore').click({ timeout: 1500 }); }
      catch (error) { if (await water.count()) break; throw error; }
    }
    assert.equal(await water.count(), 1);
    assert.ok(await page.locator('.chat-search-item').count() > 8);
    result.checks.push('single-character search reaches 象塘水围 beyond the first local and remote pages');
    await page.locator('#chatSearchInput').fill('象塘水');
    await water.waitFor(); await water.click();
    await page.waitForFunction(() => !document.querySelector('#detailModal').hidden && document.querySelector('#detailTitle').textContent === '象塘水围');
    await page.locator('#detailClose').click(); result.checks.push('a specific partial name opens the correct science card');

    await page.evaluate(url => { const bubble = window.UI.Chat.addBotShell(); window.UI.Chat.addSources(bubble, [{ title: '科普 · 象塘水围', url, quote: '象塘水围的合成检索正文；仅用于本地自动测试。' }]); }, origin + '/#/science?item=search-water');
    await page.locator('.msg-sources summary').last().click();
    await page.locator('.msg-sources a').last().click();
    await page.waitForFunction(() => !document.querySelector('#detailModal').hidden && document.querySelector('#detailTitle').textContent === '象塘水围');
    assert.equal(context.pages().length, 1); assert.match(page.url(), /science\?item=search-water/);
    assert.match(await page.locator('#detailBody .source-highlight').textContent(), /合成检索正文/);
    result.checks.push('a source link opens the exact science record in the same page');
    await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForFunction(() => !document.querySelector('#detailModal').hidden && document.querySelector('#detailTitle').textContent === '象塘水围');
    assert.equal(await page.locator('#detailBody .source-highlight').count(), 1);
    result.checks.push('a fresh permalink loads a record beyond the initial catalog page');
    await page.goto(origin + '/#/science?item=missing-record');
    await page.waitForFunction(() => document.querySelector('#sourceStatus')?.textContent.includes('未找到'));
    assert.equal(await page.locator('#detailModal').isHidden(), true);
    result.checks.push('an unavailable source reports its absence instead of opening another record');
    const exhibit = await page.evaluate(() => window.DIANCANG.chapters[0].items[0].name);
    await page.goto(origin + '/#/diancang?item=' + encodeURIComponent(exhibit));
    await page.waitForFunction(() => !document.querySelector('#dcDetailMask').hidden);
    assert.ok((await page.locator('#dcDetailBody').textContent()).includes(exhibit));
    result.checks.push('a collection permalink opens the specified exhibit');
    await page.evaluate(() => {
      window.App.switchPanel('panelChat'); const bubble = window.UI.Chat.addBotShell();
      window.UI.Chat.addSources(bubble, [{ title: '外部资料', url: 'https://example.org/reference#page=3' }, { title: '不安全地址', url: 'javascript:alert(1)' }]);
    });
    assert.equal(await page.locator('.msg-sources').last().locator('a').count(), 1);
    assert.equal(await page.locator('.msg-sources').last().locator('a').getAttribute('target'), '_blank');
    let drafts = 0, audits = 0;
    await context.route('**/api/ai/chat/completions', async route => {
      const body = route.request().postDataJSON();
      const checking = body.messages[0].content.startsWith('你是资料一致性审核员');
      if (checking) audits++; else { drafts++; assert.match(body.messages[0].content, /合成石料/); }
      const evidence = checking ? JSON.parse(body.messages.at(-1).content).parts[0].evidence[0].text : '';
      const content = checking ? { checks: [{ index: 0, supported: true, quotes: [evidence] }] } : { parts: [{ text: '这项工艺以合成石料为材料，重点可以从材料选择来理解。', evidence: ['1.1'] }], gaps: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) });
    });
    await page.locator('#chatInput').fill('合成石砌工艺有哪些特点？'); await page.locator('#sendBtn').click();
    await page.waitForFunction(() => !document.querySelector('#sendBtn').disabled && document.querySelector('#engineStatus').textContent.includes('AI整理'));
    assert.equal(drafts, 1); assert.equal(audits, 1);
    const answer = page.locator('.msg-bot').last(); assert.match(await answer.textContent(), /材料选择/);
    await answer.locator('.msg-sources summary').click(); await answer.locator('.msg-sources a').click();
    await page.waitForFunction(() => !document.querySelector('#detailModal').hidden && document.querySelector('#detailTitle').textContent === '象塘水围');
    assert.match(await page.locator('#detailBody .source-highlight').textContent(), /合成石料/);
    assert.equal(context.pages().length, 1);
    result.checks.push('the UI retrieves off-page knowledge, shows an audited paraphrase, and opens its exact source');
    assert.deepEqual(result.errors, []); result.checks.push('external references remain links while unsafe URL schemes are not clickable');
    result.passed = true;
  } catch (error) { result.failure = error.stack; }
  finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
report.passed = report.profiles.every(profile => profile.passed);
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report)); if (!report.passed) process.exitCode = 1;
