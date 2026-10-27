import fs from 'node:fs';
import path from 'node:path';

export async function runCollaborationRegression({ page, Page, BASE, CDP_PORT, ROOT, check, until, reloadPage, shot }) {
  if (BASE !== 'http://127.0.0.1:8931') throw new Error('Collaboration regression requires the isolated test backend.');
  async function api(body, bearer) {
    const response = await fetch(BASE + '/api/admin/sync', { method: body ? 'POST' : 'GET',
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(bearer && { Authorization: 'Bearer ' + bearer }) },
      body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  }
  const root = await api({ action: 'login', credential: 'admin123', clientId: 'collaboration-root' });
  const token = (await api({ action: 'create_token', name: '三人共用录入', days: 1 }, root.bearer)).token;
  const version = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).json();
  const browser = await Page.connect(version.webSocketDebuggerUrl), tabs = [], contexts = [];
  try {
    for (let i = 0; i < 3; i++) {
      const { browserContextId } = await browser.send('Target.createBrowserContext'); contexts.push(browserContextId);
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const tab = await Page.attach(targetId); tabs.push(tab);
      await tab.send('Page.enable'); await tab.send('Runtime.enable');
      if (i === 2) await tab.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
      await tab.send('Page.navigate', { url: BASE + '/index.html' });
      await until(tab, 'document.readyState==="complete"&&!!window.Store');
      const user = await api({ action: 'login', credential: token.token, clientId: 'collaboration-device-' + i });
      await tab.evaluate('window.Store.saveSession(' + JSON.stringify(user) + ');window.Store.syncWithCloud()', true);
      await tab.evaluate("window.Admin.open();document.querySelector('[data-tab=\"kepu\"]').click()");
    }
    const [a, b, phone] = tabs;
    await Promise.all(tabs.map((tab, i) => tab.evaluate("window.Store.addHeritageCard({id:'collab-" + i + "',name:'设备" + i + "录入',detail:'原文'});window.Store.flushPending()", true)));
    for (const tab of tabs) await tab.evaluate('window.Store.syncWithCloud()', true);
    check('三台独立设备共用同一邀请码，三条上传均保存', (await api()).kepuCustom.filter(c => c.id.startsWith('collab-')).length === 3);
    check('后台列表随云端更新，无需关闭重进', await until(a, "!!document.querySelector('[data-edit-kepu=\"collab-1\"]')"));

    await a.evaluate("document.querySelector('[data-edit-kepu=\"collab-0\"]').click();document.getElementById('kpDetail').value='表单中的本机版本';document.getElementById('kpDetail').dispatchEvent(new Event('input',{bubbles:true}))");
    await b.evaluate("window.Store.updateHeritageCard('collab-0',{detail:'同事已保存的版本'});window.Store.flushPending()", true);
    await a.evaluate('window.Store.syncWithCloud()', true);
    check('后台同步保留当前正在编辑的表单', await a.evaluate("document.getElementById('kpDetail')?.value==='表单中的本机版本'"));
    await a.evaluate("document.getElementById('kpSaveBtn').click()");
    check('旧表单保存时准确提示冲突，保留双方内容', await until(a, "window.Store.getSyncStatus().conflictCount===1&&!document.getElementById('kpSaveBtn').disabled") && (await api()).kepuCustom.find(c => c.id === 'collab-0').detail === '同事已保存的版本');
    await a.evaluate("document.getElementById('kpCancelBtn').click();document.getElementById('kepuAddBtn').click();document.getElementById('kpName').value='矮守围新条目';document.getElementById('kpDetail').value='独立新增不受旧稿影响';document.getElementById('kpSaveBtn').click()");
    check('另有冲突时，新建条目仍由服务器确认并关闭表单', await until(a, "document.getElementById('kepuForm').style.display==='none'&&!!window.Store.getHeritageCards([]).find(c=>c.name==='矮守围新条目')") && (await api()).kepuCustom.some(c => c.name === '矮守围新条目'));
    await phone.evaluate('window.Store.syncWithCloud()', true);
    check('手机后台自动显示新条目和云端条数', await until(phone, "document.getElementById('kepuList').textContent.includes('矮守围新条目')&&document.getElementById('adminCloudCount').textContent.includes('云端科普')"));

    await phone.evaluate("document.getElementById('kepuAddBtn').click();document.getElementById('kpName').value='未点击保存的资料';document.getElementById('kpDetail').value='刷新后仍须保留的正文';document.getElementById('kpDetail').dispatchEvent(new Event('input',{bubbles:true}))");
    await until(phone, "document.getElementById('kpDraftStatus').textContent.includes('本机草稿已保存')");
    await reloadPage(phone); await phone.evaluate('window.Store.ready', true);
    const drafts = await phone.evaluate('window.Store.getRecoveryDrafts()', true);
    check('未点击上传的表单刷新后可找回', drafts.some(d => d.title === '未点击保存的资料'));
    await phone.evaluate("window.Admin.open();document.querySelector('[data-tab=\"kepu\"]').click();window.prompt=()=>String(" + (drafts.findIndex(d => d.title === '未点击保存的资料') + 1) + ");document.getElementById('recoverDraftBtn').click()");
    check('找回草稿按钮恢复原表单正文', await until(phone, "document.getElementById('kpDetail')?.value==='刷新后仍须保留的正文'"));
    await shot(phone, 'collaboration-phone-form-recovered');

    await a.evaluate('window.Store.reloadCloudContent()', true);
    const offline = "window.__recheckFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/api/admin/sync')?Promise.reject(new Error('offline recheck')):window.__recheckFetch(url,options);";
    await a.evaluate(offline);
    await a.evaluate("window.Store.addHeritageCard({id:'duplicate-original-one',name:'原页第一条'});window.Store.flushPending()", true);
    const pointer = await a.evaluate("sessionStorage.getItem('nfyj_draft_pointer')");
    const { targetId: duplicateId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: contexts[0] });
    const duplicate = await Page.attach(duplicateId); tabs.push(duplicate);
    await duplicate.send('Page.enable'); await duplicate.send('Runtime.enable');
    await duplicate.send('Page.addScriptToEvaluateOnNewDocument', { source: offline + "sessionStorage.setItem('nfyj_draft_pointer'," + JSON.stringify(pointer) + ');' });
    await duplicate.send('Page.navigate', { url: BASE + '/index.html' });
    await until(duplicate, 'document.readyState==="complete"&&!!window.Store'); await duplicate.evaluate('window.Store.ready', true);
    await a.evaluate("window.Store.addHeritageCard({id:'duplicate-original-newer',name:'原页新输入的独有资料'});window.Store.flushPending()", true);
    await duplicate.evaluate("window.Store.addHeritageCard({id:'duplicate-new',name:'复制页输入'});window.Store.flushPending()", true);
    await a.send('Page.addScriptToEvaluateOnNewDocument', { source: offline });
    await reloadPage(a); await a.evaluate('window.Store.ready', true);
    check('复制标签页不能删掉原页较新的 IndexedDB 草稿', await a.evaluate("window.Store.getHeritageCards([]).some(c=>c.id==='duplicate-original-newer')"));

    const { browserContextId: migrationContext } = await browser.send('Target.createBrowserContext'); contexts.push(migrationContext);
    const { targetId: migrationId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: migrationContext });
    const migration = await Page.attach(migrationId); tabs.push(migration);
    await migration.send('Page.enable'); await migration.send('Runtime.enable');
    await migration.send('Page.navigate', { url: BASE + '/index.html' });
    await until(migration, 'document.readyState==="complete"&&!!window.Store');
    await migration.evaluate('window.Store.syncWithCloud()', true);
    await migration.evaluate("(()=>{const current=JSON.parse(window.Store.exportFullBundle()).cloudDraft;for(const [field,key] of Object.entries({kbCustom:'nfyj_kb_custom',kbEdited:'nfyj_kb_edited',kbDeleted:'nfyj_kb_deleted',kepuCustom:'nfyj_kepu_custom',kepuEdited:'nfyj_kepu_edited',kepuDeleted:'nfyj_kepu_deleted',dialectCustom:'nfyj_dialect_custom',dialectDeleted:'nfyj_dialect_deleted',apiConfig:'nfyj_api_config',workflowConfig:'nfyj_workflow_config'}))localStorage.setItem(key,JSON.stringify(current[field]));localStorage.setItem('nfyj_cloud_base',JSON.stringify(current));localStorage.setItem('nfyj_kepu_custom',JSON.stringify(current.kepuCustom.concat([{id:'legacy-unsent',name:'旧版从未上传的资料'}])));localStorage.setItem('nfyj_cloud_revision',JSON.stringify(window.Store.getSyncStatus().revision));localStorage.setItem('nfyj_cloud_pending','true');sessionStorage.removeItem('nfyj_draft_pointer');})()");
    await migration.send('Page.addScriptToEvaluateOnNewDocument', { source: offline });
    await reloadPage(migration); await migration.evaluate('window.Store.ready', true);
    check('已有 IndexedDB 发布缓存时，升级仍保留旧版 localStorage 未上传资料', await migration.evaluate("JSON.parse(window.Store.exportFullBundle()).cloudDraft.kepuCustom.some(c=>c.id==='legacy-unsent')"));
    const { browserContextId: restrictedContext } = await browser.send('Target.createBrowserContext'); contexts.push(restrictedContext);
    const { targetId: restrictedId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId: restrictedContext });
    const restricted = await Page.attach(restrictedId); tabs.push(restricted);
    await restricted.send('Page.enable'); await restricted.send('Runtime.enable');
    const restriction = await restricted.send('Page.addScriptToEvaluateOnNewDocument', { source: offline + "Object.defineProperty(window,'indexedDB',{value:{open(){throw new Error('storage blocked')}}});" });
    await restricted.send('Page.navigate', { url: BASE + '/index.html' });
    await until(restricted, 'document.readyState==="complete"&&!!window.Store'); await restricted.evaluate('window.Store.ready', true);
    await restricted.evaluate("window.Store.addHeritageCard({id:'restricted-draft',name:'数据库受限时的资料'});window.Store.flushPending()", true);
    await reloadPage(restricted); await restricted.evaluate('window.Store.ready', true);
    check('IndexedDB 打开失败时仍能在刷新后恢复降级存储草稿', await restricted.evaluate("window.Store.getHeritageCards([]).some(c=>c.id==='restricted-draft')"));
    await restricted.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: restriction.identifier });
    await restricted.send('Page.addScriptToEvaluateOnNewDocument', { source: offline });
    await reloadPage(restricted); await restricted.evaluate('window.Store.ready', true);
    check('IndexedDB 恢复可用后仍会读取上次的降级草稿', await restricted.evaluate("window.Store.getHeritageCards([]).some(c=>c.id==='restricted-draft')"));

    await phone.evaluate("document.getElementById('kpCancelBtn').click();document.querySelector('[data-tab=\"kb\"]').click();document.getElementById('kbAddBtn').click();document.getElementById('kbTitle').value='知识库断网保存';document.getElementById('kbAnswer').value='保存失败不能关闭表单';document.getElementById('kbAnswer').dispatchEvent(new Event('input',{bubbles:true}));");
    await phone.evaluate(offline);
    await phone.evaluate("document.getElementById('kbSaveBtn').click()");
    check('知识库上传失败时保留表单并明确显示待上传', await until(phone, "!document.getElementById('kbSaveBtn').disabled&&document.getElementById('kbForm').style.display!=='none'&&window.Store.getSyncStatus().pending"));
    await reloadPage(phone); await phone.evaluate('window.Store.ready', true);
    const kbDrafts = await phone.evaluate('window.Store.getRecoveryDrafts()', true);
    const kbIndex = kbDrafts.findIndex(d => d.title === '知识库断网保存');
    await phone.evaluate("window.Admin.open();window.prompt=()=>String(" + (kbIndex + 1) + ");document.getElementById('recoverDraftBtn').click()");
    check('知识库表单也能从找回草稿恢复标题和正文', kbIndex >= 0 && await until(phone, "document.getElementById('kbTitle')?.value==='知识库断网保存'&&document.getElementById('kbAnswer')?.value==='保存失败不能关闭表单'"));
    const snapshot = await api();
    fs.writeFileSync(path.join(ROOT, '.cache', 'incident-browser-collaboration.json'), JSON.stringify({ revision: snapshot.revision, count: snapshot.kepuCustom.length, sharedInvitationDevices: 3, recoveredForm: true }, null, 2));
  } finally {
    for (const tab of tabs) tab.ws.close();
    for (const id of contexts) await browser.send('Target.disposeBrowserContext', { browserContextId: id });
    browser.ws.close();
  }
}
