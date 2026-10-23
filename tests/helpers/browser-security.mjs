import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function runSecurityRegression({ page, Page, BASE, CDP_PORT, ROOT, check, until, reloadPage, shot }) {
  if (BASE !== 'http://127.0.0.1:8931') throw new Error('Security regression must use the isolated local backend.');
  const evidence = [];
  function verify(name, ok, detail = '') { check(name, ok, detail); evidence.push({ name, passed: !!ok, detail }); }
  async function api(body, bearer) {
    const response = await fetch(BASE + '/api/admin/sync', {
      method: body ? 'POST' : 'GET',
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(bearer && { Authorization: 'Bearer ' + bearer }) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  }
  const fields = ['kbCustom', 'kbEdited', 'kbDeleted', 'kepuCustom', 'kepuEdited', 'kepuDeleted', 'dialectCustom', 'dialectDeleted', 'apiConfig', 'workflowConfig'];
  const payload = data => Object.fromEntries(fields.map(key => [key, data[key]]));
  const root = (await api({ action: 'login', credential: 'admin123', clientId: 'security-root' })).data;
  const invitation = (await api({ action: 'create_token', name: '安全回归协管员', days: 1 }, root.bearer)).data.token;
  const editor = (await api({ action: 'login', credential: invitation.token, clientId: 'security-editor' })).data;
  async function publish(cards, bearer = root.bearer) {
    const current = (await api(null, bearer)).data;
    return api({ action: 'update_custom_bundle', revision: current.revision, ...payload(current), kepuCustom: cards }, bearer);
  }
  console.log('\nSecurity regression: XSS, schema, DOCX and same-origin offline draft recovery');
  const script = "window.__securityExecuted=true;window.Store.setAdminPassword('AuditOnly2026!')";
  const upload = await publish([{
    id: 'security-icon', name: '安全样本', icon: '<img src="data:," onerror="' + script + '">',
    tag: '<svg onload="window.__securityExecuted=true">',
    detail: '<p>合法<strong>段落</strong></p><img src="data:," onerror="window.__securityExecuted=true"><a href="javascript:alert(1)">链接</a>'
  }], editor.bearer);
  await page.evaluate('window.Store.saveSession(' + JSON.stringify(root) + '); window.Store.syncWithCloud()', true);
  await until(page, "!![...document.querySelectorAll('.h-card')].find(b=>b.textContent.includes('安全样本'))");
  await page.evaluate("[...document.querySelectorAll('.h-card')].find(b=>b.textContent.includes('安全样本')).click()");
  const safe = await page.evaluate("({executed:!!window.__securityExecuted,cardsHaveMarkup:!!document.querySelector('.h-icon img, .h-tag svg'),detailHasUnsafe:!!document.querySelector('#detailBody img, #detailBody [onerror], #detailBody a[href^=\"javascript:\"]'),strong:document.querySelector('#detailBody strong')?.textContent,purified:window.UI.formatHeritageDetail('<p>合法</p><svg onload=\"alert(1)\"></svg><a href=\"javascript:alert(1)\">链接</a>')})");
  const takeover = await api({ action: 'login', credential: 'AuditOnly2026!', clientId: 'security-password-probe' });
  verify('F01 协管员上传内容不能执行脚本或借超管会话改密',
    upload.status === 200 && !safe.executed && !safe.cardsHaveMarkup && !safe.detailHasUnsafe && takeover.status === 401, JSON.stringify(safe));
  verify('F01 富文本净化保留合法强调并删除危险标签、事件和链接',
    safe.strong === '段落' && !/svg|onload|javascript:/i.test(safe.purified));
  await page.evaluate("document.getElementById('detailClose').click()");
  const malformed = await publish([null], editor.bearer);
  const duplicate = await publish([{ id: 'dup', name: '甲' }, { id: 'dup', name: '乙' }], editor.bearer);
  await page.evaluate('window.Store.syncWithCloud()', true);
  const renders = await page.evaluate("(()=>{try{window.Heritage.render();return true}catch{return false}})()");
  verify('F04/F06 无效条目和重复 ID 被拒绝，公开页面仍可渲染', malformed.status === 400 && duplicate.status === 400 && renders);
  await publish([]);
  await page.evaluate('window.Store.syncWithCloud()', true);

  const wordFixture = path.join(ROOT, '.cache', 'audit-valid-word.docx');
  const fixture = spawnSync('python', [path.join(ROOT, 'tests', 'helpers', 'create-audit-word-fixture.py'), wordFixture], { encoding: 'utf8' });
  if (fixture.status !== 0) throw new Error('DOCX fixture failed: ' + fixture.stderr);
  await page.evaluate('window.__securityAlerts=[];window.alert=m=>window.__securityAlerts.push(m);window.Admin.open()');
  await until(page, "!!document.querySelector('[data-tab=\"import\"]')");
  await page.evaluate("document.querySelector('[data-tab=\"import\"]').click()");
  const dom = await page.send('DOM.getDocument');
  const input = await page.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#docFileInput' });
  await page.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [wordFixture] });
  const wordReady = await until(page, "document.querySelectorAll('.draft-answer').length>0");
  const extracted = await page.evaluate("[...document.querySelectorAll('.draft-answer')].map(t=>t.value).join('\\n')");
  verify('F12 普通压缩 DOCX 可提取中文、段落、实体、换行和表格正文',
    wordReady && extracted.includes('客家蓝染') && extracted.includes('来源 & 考据') && extracted.includes('表格内文字') && extracted.includes('\n'));
  async function syntheticWord(expression) {
    await page.evaluate("(()=>{const transfer=new DataTransfer();transfer.items.add(new File([" + expression + "],'边界测试.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));const input=document.getElementById('docFileInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  }
  for (const [name, expression] of [
    ['损坏文件', 'new Uint8Array([1,2,3,4])'],
    ['空文档', "fflate.zipSync({'word/document.xml':fflate.strToU8('<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body/></w:document>')})"],
    ['解压超限', "fflate.zipSync({'word/document.xml':new Uint8Array(8*1024*1024+1)})"]
  ]) {
    const prior = await page.evaluate('window.__securityAlerts.length');
    await syntheticWord(expression);
    const rejected = await until(page, 'window.__securityAlerts.length>' + prior);
    verify('F12 ' + name + '明确报错并保留已有导入草稿', rejected && extracted === await page.evaluate("[...document.querySelectorAll('.draft-answer')].map(t=>t.value).join('\\n')"));
  }
  await page.evaluate('window.Admin.close()');

  const version = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).json();
  const browser = await Page.connect(version.webSocketDebuggerUrl);
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  let tabA, tabB;
  try {
    const a = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const b = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
    tabA = await Page.attach(a.targetId); tabB = await Page.attach(b.targetId);
    for (const tab of [tabA, tabB]) {
      await tab.send('Page.enable'); await tab.send('Runtime.enable');
      await tab.send('Page.navigate', { url: BASE + '/index.html' });
      await until(tab, "document.readyState==='complete'&&!!window.Store");
      const user = (await api({ action: 'login', credential: 'admin123', clientId: 'security-tab-' + Math.random() })).data;
      await tab.evaluate('window.Store.saveSession(' + JSON.stringify(user) + ');window.Store.syncWithCloud()', true);
    }
    const offline = "window.__securityFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/api/admin/sync')?Promise.reject(new Error('offline regression')):window.__securityFetch(url,options);";
    await tabA.evaluate(offline); await tabB.evaluate(offline);
    await tabA.evaluate("window.Store.addHeritageCard({id:'tab-a-draft',name:'标签 A 未上传资料'});window.Store.flushPending()", true);
    await tabB.evaluate("window.Store.addHeritageCard({id:'tab-b-draft',name:'标签 B 未上传资料'});window.Store.flushPending()", true);
    const injection = await tabA.send('Page.addScriptToEvaluateOnNewDocument', { source: offline });
    tabA.on(event => { if (event.method === 'Page.javascriptDialogOpening') tabA.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });
    await reloadPage(tabA);
    await tabA.evaluate('window.Store.ready', true);
    const afterA = await tabA.evaluate('JSON.parse(window.Store.exportFullBundle()).cloudDraft.kepuCustom.map(c=>c.id)');
    const afterB = await tabB.evaluate('JSON.parse(window.Store.exportFullBundle()).cloudDraft.kepuCustom.map(c=>c.id)');
    verify('F02 同源双标签页各自保留离线草稿，刷新后甲乙都未被覆盖',
      afterA.includes('tab-a-draft') && !afterA.includes('tab-b-draft') && afterB.includes('tab-b-draft'), JSON.stringify({ afterA, afterB }));
    const recovery = await tabA.evaluate('window.Store.getRecoveryDrafts()', true);
    verify('F02 可以发现另一页面遗留的未上传草稿', recovery.length === 1);
    await tabA.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
    await tabA.evaluate("window.App.switchPanel('panelHeritage');document.querySelector('.h-cat-pill[data-cat=\"custom\"]').click()");
    await shot(tabA, 'security-multi-tab-drafts-preserved');
    await tabA.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
    await tabA.evaluate('window.fetch=window.__securityFetch;window.Store.syncWithCloud()', true);
    await browser.send('Target.closeTarget', { targetId: b.targetId }); tabB.ws.close(); tabB = null;
    await tabA.evaluate('window.Store.restoreRecoveryDraft(' + JSON.stringify(recovery[0].id) + ')', true);
    const recovered = await tabA.evaluate('window.Store.flushPending()', true);
    const cloud = (await api()).data.kepuCustom.map(c => c.id);
    verify('F02 已确认上传的恢复副本不再误报为未上传草稿', (await tabA.evaluate('window.Store.getRecoveryDrafts()', true)).length === 0);
    verify('F02 关闭原页面后能找回草稿，重连合并上传两份资料',
      recovered && cloud.includes('tab-a-draft') && cloud.includes('tab-b-draft'), JSON.stringify(cloud));
  } finally {
    tabA?.ws.close(); tabB?.ws.close();
    await browser.send('Target.disposeBrowserContext', { browserContextId }); browser.ws.close();
    fs.writeFileSync(path.join(ROOT, '.cache', 'codex-security-regression-browser.json'), JSON.stringify(evidence, null, 2));
  }
}
