/**
 * 龙南客家非遗内容管理 (Admin Console Pro)
 * ------------------------------------------------------------
 * 1. 邀请制权限与令牌鉴权体系 (超级管理员主口令 + 专属邀请令牌)
 * 2. 知识库可视化管理 (分类筛选、搜索、卡片编辑、实时提问测试)
 * 3. 科普模块动态管理 (科普卡片增删改、前台即时联动渲染)
 * 4. 方言模块动态管理 (方言语音与讲解视频增删改)
 * 5. 多格式文档智能解析入库 (支持 .txt, .md, .json, .docx 批量提取)
 * 6. AI 模型与人设工作流编排 (底座模型、System Prompt、检索严格度)
 * 7. 全站数智资产包一键打包导出与恢复
 */
(function () {
  'use strict';

  var authenticated = false;
  var currentUser = null; // { role: 'super_admin' | 'editor', name: string, title: string }
  var currentTab = 'kb';
  var editingId = null;
  var editingKepuId = null;
  var editingDialectId = null;
  var parsedDrafts = []; // 文档解析出的待入库草稿列表
  var renderedRevision = null;

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function refreshFrontEnd() {
    try {
      var h = window.Heritage || (window.UI && window.UI.Heritage);
      if (h && h.render) h.render();
      if (window.Dialect && window.Dialect.refresh) window.Dialect.refresh();
      if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
    } catch (_) {}
  }

  /* ==================== 登录模块 (支持邀请制令牌与防刷锁定) ==================== */
  function showSyncStatus() {
    var status = window.Store.getSyncStatus();
    var label = $('#adminCloudStatus');
    if (label) { label.textContent = status.message; label.dataset.status = status.status; }
    var count = $('#adminCloudCount');
    if (count) count.textContent = (status.cloudLoaded ? '云端科普 ' + status.cloudCustomCount + ' 条' : '正在读取云端资料') + (status.pendingCount ? ' · 待上传 ' + status.pendingCount + ' 项' : '');
    var reload = $('#reloadCloudBtn');
    if (reload) reload.hidden = status.status !== 'conflict';
    var review = $('#reviewConflictsBtn');
    if (review) review.hidden = !status.conflictCount;
  }
  function refreshAdminIfIdle() {
    if (!authenticated || !$('#adminBody') || $('#adminMask').hidden) return;
    if (['import', 'ai', 'token', 'sys'].indexOf(currentTab) >= 0) return;
    if (['#kbForm', '#kepuForm', '#dialectForm'].some(function (selector) { var form = $(selector); return form && form.style.display !== 'none'; })) return;
    var status = window.Store.getSyncStatus();
    if (status.revision === renderedRevision) return;
    var search = $('#adminBody input[type="text"]'), query = search && search.value;
    renderTab();
    if (query) { search = $('#adminBody input[type="text"]'); if (search) { search.value = query; search.dispatchEvent(new Event('input')); } }
  }
  function adminAction(action) {
    return Promise.resolve().then(action).catch(function (error) { alert(error.message); });
  }
  function cloudListControls(body, field, input, refresh) {
    if (!window.Store.getCatalog().model) return;
    var box = document.createElement('div'); box.className = 'admin-toolbar-row';
    var label = document.createElement('span'), more = document.createElement('button');
    more.className = 'admin-btn-sm'; more.textContent = '继续加载';
    box.appendChild(label); box.appendChild(more); body.appendChild(box);
    var query = '', cursor = window.Store.getCatalog().pages[field], request = 0, timer;
    function status() {
      label.textContent = '云端共 ' + window.Store.getContentCount(field) + ' 条，列表按页读取';
      more.hidden = !cursor;
    }
    async function load(first) {
      var current = ++request; more.disabled = true;
      try {
        var page = await window.Store.loadContentPage(field, { query: query, cursor: first ? '' : cursor, full: !!query });
        if (!box.isConnected || current !== request) return;
        cursor = page.cursor; refresh(); status();
      } catch (error) { if (box.isConnected) showAdminToast(error.message); }
      finally { more.disabled = false; }
    }
    more.addEventListener('click', function () { load(false); });
    if (input) input.addEventListener('input', function () {
      clearTimeout(timer); query = input.value.trim(); cursor = '';
      timer = setTimeout(function () { if (box.isConnected) load(true); }, 350);
    });
    status();
  }
  async function downloadBackup(file) {
    try { await window.Store.prepareExport(); }
    catch (error) { showAdminToast(error.message); return; }
    try { downloadJson(await window.Store.exportFullBundleWithMedia(), file); }
    catch (error) {
      downloadJson(window.Store.exportFullBundle(), file.replace('.json', '-文字与图片链接.json'));
      showAdminToast('已备份文字和图片链接，图片未完整打包：' + error.message);
    }
  }
  function trackEditorDraft(form, readEditor, recovery) {
    var id = 'editor:' + Date.now() + ':' + Math.random().toString(36).slice(2), content = form.firstElementChild, finished = false;
    async function preserve() {
      if (finished || form.firstElementChild !== content) return;
      var editor = readEditor(), value = editor.value;
      if (!value.name && !value.title && !value.detail && !value.answer && !value.imageUrl && !(value.item && (value.item.name || value.item.audioUrl || value.item.videoUrl))) return;
      var saved = await window.Store.saveEditorDraft(editor, id);
      var hint = content.querySelector('[data-editor-status]');
      if (hint && !finished) hint.textContent = saved ? '本机草稿已保存，尚未上传。' : '无法保存本机草稿，请复制正文备份。';
    }
    form.oninput = function () { preserve().catch(function () {
      var hint = content.querySelector('[data-editor-status]'); if (hint) hint.textContent = '草稿保存失败，请复制正文备份。';
    }); };
    return { preserve: preserve, finish: async function () { finished = true; await window.Store.clearEditorDraft(recovery && recovery.source, id); } };
  }

  function showAdminToast(msg) {
    var oldToast = document.getElementById('adminToast');
    if (oldToast) oldToast.remove();
    var toast = document.createElement('div');
    toast.id = 'adminToast';
    toast.className = 'admin-toast';
    toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1F4238;color:#FFF8EE;padding:10px 18px;border-radius:999px;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.25);z-index:999999;border:1px solid rgba(255,248,238,0.3);text-align:center;max-width:90vw;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.transition = 'opacity 0.4s';
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 400);
    }, 3200);
  }

  function showLogin(message) {
    authenticated = false;
    currentUser = null;
    $('#adminPanel').classList.remove('admin-workspace');
    $('#adminPanel').innerHTML =
      '<div class="admin-login"><div class="admin-login-icon">🔐</div>' +
      '<div class="admin-login-title">内容管理</div>' +
      '<div class="admin-login-hint">请输入管理员密码或邀请令牌</div>' +
      '<form class="admin-login-form" id="adminLoginForm">' +
      '<div class="admin-pw-wrap"><input type="password" id="adminPwInput" placeholder="请输入密码或邀请码" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false">' +
      '<button type="button" id="adminPwToggle" class="admin-pw-toggle" title="显示密码">👁️</button></div>' +
      '<div class="admin-login-error" id="adminPwError" role="alert"></div>' +
      '<button type="submit" class="admin-login-btn" id="adminLoginBtn">登 录</button></form>' +
      '<button type="button" class="admin-login-cancel" id="adminCancelBtn">返回用户页面</button></div>';
    var input = $('#adminPwInput');
    var button = $('#adminLoginBtn');
    var error = $('#adminPwError');
    error.textContent = message || '';
    $('#adminPwToggle').addEventListener('click', function () { input.type = input.type === 'password' ? 'text' : 'password'; });
    $('#adminCancelBtn').addEventListener('click', close);
    $('#adminLoginForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      if (button.disabled) return;
      if (!window.Store.normalizeAuthInput(input.value)) { error.textContent = '请输入密码或邀请令牌'; input.focus(); return; }
      button.disabled = true;
      button.textContent = '正在连接服务器…';
      error.textContent = '';
      var result = await window.Store.verifyLogin(input.value);
      button.disabled = false;
      button.textContent = '登 录';
      if (!result.ok) {
        error.textContent = result.error;
        // Service and network errors do not count as bad passwords or erase input.
        if (result.code === 'INVALID_CREDENTIALS') input.value = '';
        return;
      }
      window.Store.saveSession(result);
      authenticated = true;
      currentUser = result;
      await window.Store.syncWithCloud();
      if (window.Store.getSession()) showMain();
    });
    setTimeout(function () { input.focus(); }, 100);
  }
  function doLogout() {
    var request = window.Store.logout();
    request.catch(function (error) { showAdminToast(error.message); });
    window.Store.clearSession();
    showLogin();
  }

  /* ==================== 主工作台面板 ==================== */
  function showMain() {
    var panel = $('#adminPanel');
    panel.classList.add('admin-workspace');
    var isSuper = currentUser && currentUser.role === 'super_admin';
    var userBadge = isSuper
      ? '<span class="admin-role-badge super">超级管理员</span>'
      : '<span class="admin-role-badge guest">受邀：' + esc(currentUser.name) + '</span>';

    var notifs = (!isSuper && currentUser) ? window.Store.getTokenNotifications(currentUser.tokenId || currentUser.token) : [];
    var notifBanner = '';
    if (notifs && notifs.length) {
      notifBanner =
        '<div class="admin-notice-bar" id="tokenNoticeBar">' +
        '  <div class="admin-notice-icon">⚠️</div>' +
        '  <div class="admin-notice-content">' +
        '    <div class="admin-notice-title">审核反馈通知（您的 ' + notifs.length + ' 项修改已被超级管理员剔除/驳回）</div>' +
        '    <div class="admin-notice-list">' +
        notifs.map(function (n) {
          return '<div class="admin-notice-item"><strong>[' + esc(n.targetTypeName) + ']</strong>「' + esc(n.targetTitle) + '」<span class="admin-notice-reason">驳回原因：' + esc(n.reason) + '</span></div>';
        }).join('') +
        '    </div>' +
        '  </div>' +
        '  <button class="admin-notice-ack" id="ackNotifBtn">我知道了</button>' +
        '</div>';
    }

    panel.innerHTML =
      '<div class="admin-header">' +
      '  <div class="admin-header-left">' +
      '    <div class="admin-header-title">⚙️ 非遗内容管理</div>' +
      '    ' + userBadge +
      '  </div>' +
      '  <div class="admin-header-right">' +
      '    <button class="admin-btn-sync" id="adminHeaderSyncBtn" title="同步其他设备的新内容" style="background:var(--primary-deep,#2F5D50);color:#fff;border:none;padding:5px 10px;border-radius:4px;font-size:12px;cursor:pointer;margin-right:6px">同步</button>' +
      '    <button class="admin-btn-logout" id="adminHeaderLogoutBtn" title="退出当前登录状态">🚪 退出登录</button>' +
      '    <button class="admin-close-btn" id="adminCloseBtn">✕ 关闭</button>' +
      '  </div>' +
      '</div>' +
      '<div class="admin-cloud-bar"><span id="adminCloudStatus" role="status"></span><span id="adminCloudCount"></span><button class="admin-btn-sm" id="backupDraftBtn">导出备份</button><button class="admin-btn-sm" id="recoverDraftBtn">找回草稿</button><button class="admin-btn-sm" id="reviewConflictsBtn" hidden>核对冲突</button><button class="admin-btn-sm" id="reloadCloudBtn" hidden>读取云端版本</button></div>' +
      notifBanner +
      '<div class="admin-tabs">' +
      '  <button class="admin-tab active" data-tab="kb">📚 知识库</button>' +
      '  <button class="admin-tab" data-tab="kepu">🏮 科普管理</button>' +
      '  <button class="admin-tab" data-tab="dialect">🗣 方言管理</button>' +
      '  <button class="admin-tab" data-tab="import">📂 文档导入</button>' +
      '  <button class="admin-tab" data-tab="ai">🤖 问答设置</button>' +
      (isSuper ? '  <button class="admin-tab" data-tab="token">🔑 邀请令牌</button>' : '') +
      '  <button class="admin-tab" data-tab="sys">🛠 系统备份</button>' +
      '</div>' +
      '<div class="admin-body" id="adminBody"></div>';

    $('#adminCloseBtn').addEventListener('click', close);
    $('#adminHeaderLogoutBtn').addEventListener('click', doLogout);

    showSyncStatus();
    window.Store.getRecoveryDrafts().then(function (drafts) {
      var button = $('#recoverDraftBtn');
      if (button) button.textContent = '找回草稿' + (drafts.length ? '（' + drafts.length + '）' : '');
    }, function (error) { var button = $('#recoverDraftBtn'); if (button) button.title = error.message; });
    $('#backupDraftBtn').addEventListener('click', function () {
      downloadBackup('longnan-local-backup.json');
    });
    $('#recoverDraftBtn').addEventListener('click', function () { adminAction(async function () {
      var drafts = await window.Store.getRecoveryDrafts();
      if (!drafts.length) { alert('没有其他页面遗留的未上传草稿。'); return; }
      var selected = prompt('输入草稿编号：\n' + drafts.map(function (d, i) { return (i + 1) + '. ' + new Date(d.time).toLocaleString() + ' · ' + (d.editor ? (d.title || '未命名表单') : d.count + ' 条资料'); }).join('\n'));
      if (selected === null) return;
      var draft = drafts[Number(selected) - 1];
      if (!draft) throw new Error('请输入列表中的草稿编号');
      var recovered = await window.Store.restoreRecoveryDraft(draft.id);
      if (recovered && recovered.editor) {
        currentTab = recovered.editor.type === 'dialect' ? 'dialect' : recovered.editor.type === 'kb' ? 'kb' : 'kepu';
        panel.querySelectorAll('.admin-tab').forEach(function (tab) { tab.classList.toggle('active', tab.dataset.tab === currentTab); });
        renderTab();
        if (currentTab === 'kb') { editingId = recovered.editor.recordId || null; showKBForm(recovered.editor.value, recovered); }
        else if (currentTab === 'kepu') { editingKepuId = recovered.editor.recordId || null; showKepuForm(recovered.editor.value, recovered); }
        else showDialectForm(recovered.editor.value, recovered);
      } else renderTab();
    }); });
    $('#reviewConflictsBtn').addEventListener('click', function () { adminAction(async function () {
      var conflicts = window.Store.getConflicts();
      var selected = prompt('输入要核对的条目编号：\n' + conflicts.map(function (item, i) { return (i + 1) + '. ' + item.title; }).join('\n'));
      if (selected === null) return;
      var item = conflicts[Number(selected) - 1];
      if (!item) throw new Error('请输入列表中的编号');
      var choice = prompt('「' + item.title + '」\n输入 1 使用云端版本；' + (item.canCopy ? '输入 2 将本机内容另存为新条目。' : '本机内容可先导出备份。'));
      if (choice === null) return;
      if (choice !== '1' && !(choice === '2' && item.canCopy)) throw new Error('请选择有效的处理方式');
      await window.Store.resolveConflict(item.key, choice === '1' ? 'cloud' : 'copy'); renderTab();
    }); });
    $('#reloadCloudBtn').addEventListener('click', function () {
      if (confirm('读取云端版本？当前未上传内容会保留在“找回草稿”中。')) adminAction(async function () {
        await window.Store.reloadCloudContent(); renderTab();
      });
    });
    var syncBtn = $('#adminHeaderSyncBtn');
    syncBtn.addEventListener('click', async function () {
      syncBtn.disabled = true;
      try {
        var data = await window.Store.syncWithCloud();
        if (data) { refreshFrontEnd(); renderTab(); }
        else alert(window.Store.getSyncStatus().message);
      } finally { syncBtn.disabled = false; }
    });

    var ackBtn = $('#ackNotifBtn');
    if (ackBtn) {
      ackBtn.addEventListener('click', function () { adminAction(async function () {
        await window.Store.clearTokenNotifications(currentUser.tokenId);
        var bar = $('#tokenNoticeBar');
        if (bar) bar.style.display = 'none';
      }); });
    }

    var tabs = panel.querySelectorAll('.admin-tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        currentTab = t.getAttribute('data-tab');
        renderTab();
      });
    });

    renderTab();
    if (window.Store && window.Store.syncWithCloud) {
      window.Store.syncWithCloud(function () {
        refreshFrontEnd();
        var formKb = $('#kbForm');
        var formKp = $('#kepuForm');
        var formDialect = $('#dialectForm');
        var isEditing = (formKb && formKb.style.display !== 'none') || (formKp && formKp.style.display !== 'none') || (formDialect && formDialect.style.display !== 'none') || editingId !== null || editingKepuId !== null;
        if (!isEditing) {
          renderTab();
        }
      });
    }
  }

  function renderTab() {
    var body = $('#adminBody');
    if (!body) return;
    renderedRevision = window.Store.getSyncStatus().revision;
    if (currentTab === 'kb') renderKB(body);
    else if (currentTab === 'kepu') renderKepu(body);
    else if (currentTab === 'dialect') renderDialect(body);
    else if (currentTab === 'import') renderImport(body);
    else if (currentTab === 'ai') renderAI(body);
    else if (currentTab === 'token') renderToken(body);
    else if (currentTab === 'sys') renderSys(body);
  }

  /* ==================== 1. 知识库可视化管理 ==================== */
  var kbCurFilter = 'all';
  var kbCurSource = 'all';
  var kbCurSort = 'custom_first';
  var kbCurPage = 1;
  var kbPageSize = 15;

  function renderKB(body) {
    if (window.Store.getCatalog().model) kbPageSize = Math.min(kbPageSize, 50);
    var allEntries = window.Store.getEntries();
    var customCount = allEntries.filter(function (e) {
      return (e.id && e.id.indexOf('custom-') === 0) || e.creatorTokenId || (e.creatorName && e.creatorName !== '超级管理员' && e.creatorName !== '典藏内置');
    }).length;
    var builtinCount = allEntries.length - customCount;
    if (window.Store.getCatalog().model) customCount = window.Store.getContentCount('kbCustom');
    var totalChars = allEntries.reduce(function (sum, e) { return sum + (e.answer ? e.answer.length : 0); }, 0);
    var charsDisplay = totalChars > 10000 ? (totalChars / 10000).toFixed(1) + '万' : totalChars;

    body.innerHTML =
      '<div class="admin-stats-bar">' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + (builtinCount + customCount) + '</div><div class="admin-stat-label">知识总条目</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val" style="color:var(--primary)">' + customCount + '</div><div class="admin-stat-label">自定义录入</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + builtinCount + '</div><div class="admin-stat-label">典藏内置</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + charsDisplay + '</div><div class="admin-stat-label">' + (window.Store.getCatalog().model ? '已加载字数' : '知识总字数') + '</div></div>' +
      '</div>' +
      '<div class="admin-kb-toolbar">' +
      '  <div class="admin-search-wrap">' +
      '    <input type="text" id="kbSearch" placeholder="搜索条目标题、关键词或正文…" class="admin-search">' +
      '    <button type="button" class="admin-search-clear" id="kbSearchClear" title="清空搜索">✕</button>' +
      '  </div>' +
      '  <button class="admin-btn admin-btn-primary" id="kbAddBtn">＋ 新增条目</button>' +
      '</div>' +
      '<div class="admin-toolbar-row">' +
      '  <select id="kbSourceFilter" class="admin-select-sm">' +
      '    <option value="all">来源：全部 (' + (builtinCount + customCount) + ')</option>' +
      '    <option value="custom">来源：仅自定义 (' + customCount + ')</option>' +
      '    <option value="builtin">来源：仅内置 (' + builtinCount + ')</option>' +
      '  </select>' +
      '  <select id="kbSortSelect" class="admin-select-sm">' +
      '    <option value="custom_first">排序：置顶自定义条目（默认）</option>' +
      '    <option value="time_desc">排序：创建时间最新</option>' +
      '    <option value="title_asc">排序：标题字典序</option>' +
      '    <option value="len_desc">排序：正文字数降序</option>' +
      '  </select>' +
      '  <select id="kbPageSize" class="admin-select-sm">' +
      '    <option value="15">每页 15 条</option>' +
      '    <option value="30">每页 30 条</option>' +
      '    <option value="50">每页 50 条</option>' +
      (window.Store.getCatalog().model ? '' : '    <option value="9999">查看全部</option>') +
      '  </select>' +
      '  <button class="admin-btn-sm" id="kbExportFilterBtn" title="导出当前筛选条目为JSON">导出筛选</button>' +
      '</div>' +
      '<div class="admin-filter-bar" id="kbFilterBar">' +
      '  <button class="filter-chip active" data-cat="all">全部 (' + (builtinCount + customCount) + ')</button>' +
      '  <button class="filter-chip" data-cat="craft">手艺工艺</button>' +
      '  <button class="filter-chip" data-cat="arch">围屋建筑</button>' +
      '  <button class="filter-chip" data-cat="custom">民俗礼俗</button>' +
      '  <button class="filter-chip" data-cat="food">传统风味</button>' +
      '  <button class="filter-chip" data-cat="dialect">方言童谣</button>' +
      '</div>' +
      '<div class="admin-kb-form" id="kbForm" style="display:none"></div>' +
      '<div class="admin-kb-list" id="kbList"></div>' +
      '<div class="admin-pagination" id="kbPagination"></div>';

    var searchInput = $('#kbSearch');
    var clearBtn = $('#kbSearchClear');
    var sourceSelect = $('#kbSourceFilter');
    var sortSelect = $('#kbSortSelect');
    var pageSizeSelect = $('#kbPageSize');

    sourceSelect.value = kbCurSource;
    sortSelect.value = kbCurSort;
    pageSizeSelect.value = String(kbPageSize);

    function filteredKBEntries() {
      var q = (searchInput.value || '').toLowerCase().trim();
      return allEntries.filter(function (e) {
        var isCustom = (e.id && e.id.indexOf('custom-') === 0) || e.creatorTokenId || (e.creatorName && e.creatorName !== '超级管理员' && e.creatorName !== '典藏内置');
        if (kbCurSource === 'custom' && !isCustom) return false;
        if (kbCurSource === 'builtin' && isCustom) return false;

        var matchQ = !q || (e.title && e.title.toLowerCase().indexOf(q) !== -1) ||
                     (e.keywords && e.keywords.join(' ').toLowerCase().indexOf(q) !== -1) ||
                     (e.answer && (e.answer || '').toLowerCase().indexOf(q) !== -1);
        if (!matchQ) return false;

        if (kbCurFilter === 'all') return true;
        var text = ((e.title || '') + ' ' + (e.topics || []).join(' ') + ' ' + (e.keywords || []).join(' ')).toLowerCase();
        if (kbCurFilter === 'craft') return text.indexOf('染') !== -1 || text.indexOf('编') !== -1 || text.indexOf('织') !== -1 || text.indexOf('漆') !== -1;
        if (kbCurFilter === 'arch') return text.indexOf('围') !== -1 || text.indexOf('屋') !== -1 || text.indexOf('塔') !== -1;
        if (kbCurFilter === 'custom') return text.indexOf('俗') !== -1 || text.indexOf('寿') !== -1 || text.indexOf('节') !== -1 || text.indexOf('灯') !== -1 || text.indexOf('会') !== -1;
        if (kbCurFilter === 'food') return text.indexOf('豆腐') !== -1 || text.indexOf('米果') !== -1 || text.indexOf('茶') !== -1 || text.indexOf('食') !== -1 || text.indexOf('珍珠') !== -1;
        if (kbCurFilter === 'dialect') return text.indexOf('话') !== -1 || text.indexOf('歌') !== -1 || text.indexOf('谣') !== -1 || text.indexOf('音') !== -1;
        return true;
      });
    }

    function refreshKBView() {
      var q = (searchInput.value || '').toLowerCase().trim();
      if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

      var filtered = filteredKBEntries();

      filtered.sort(function (a, b) {
        var isCustomA = (a.id && a.id.indexOf('custom-') === 0) || a.creatorTokenId || a.createdAt;
        var isCustomB = (b.id && b.id.indexOf('custom-') === 0) || b.creatorTokenId || b.createdAt;

        if (kbCurSort === 'custom_first') {
          if (isCustomA && !isCustomB) return -1;
          if (!isCustomA && isCustomB) return 1;
          return (b.createdAt || 0) - (a.createdAt || 0);
        }
        if (kbCurSort === 'time_desc') {
          return (b.createdAt || 0) - (a.createdAt || 0);
        }
        if (kbCurSort === 'title_asc') {
          return String(a.title || '').localeCompare(String(b.title || ''), 'zh');
        }
        if (kbCurSort === 'len_desc') {
          return (b.answer ? b.answer.length : 0) - (a.answer ? a.answer.length : 0);
        }
        return 0;
      });

      var total = filtered.length;
      var totalPages = Math.ceil(total / kbPageSize) || 1;
      if (kbCurPage > totalPages) kbCurPage = totalPages;
      if (kbCurPage < 1) kbCurPage = 1;

      var startIndex = (kbCurPage - 1) * kbPageSize;
      var pageItems = filtered.slice(startIndex, startIndex + kbPageSize);

      renderKBList(pageItems);
      renderKBPagination(total, totalPages, startIndex, pageItems.length, filtered);
    }

    searchInput.addEventListener('input', function () {
      kbCurPage = 1;
      refreshKBView();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        searchInput.value = '';
        kbCurPage = 1;
        refreshKBView();
        searchInput.focus();
      });
    }

    sourceSelect.addEventListener('change', function () {
      kbCurSource = sourceSelect.value;
      kbCurPage = 1;
      refreshKBView();
    });

    sortSelect.addEventListener('change', function () {
      kbCurSort = sortSelect.value;
      kbCurPage = 1;
      refreshKBView();
    });

    pageSizeSelect.addEventListener('change', function () {
      kbPageSize = Number(pageSizeSelect.value) || 15;
      kbCurPage = 1;
      refreshKBView();
    });

    $('#kbExportFilterBtn').addEventListener('click', function () { adminAction(async function () {
      await window.Store.prepareExport(['kbCustom', 'kbEdited', 'kbDeleted']);
      allEntries = window.Store.getEntries();
      var filtered = filteredKBEntries();
      downloadJson(JSON.stringify(filtered, null, 2), '龙南知识库筛选导出-' + Date.now() + '.json');
    }); });

    $('#kbFilterBar').querySelectorAll('.filter-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('#kbFilterBar').querySelectorAll('.filter-chip').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        kbCurFilter = btn.getAttribute('data-cat');
        kbCurPage = 1;
        refreshKBView();
      });
    });

    $('#kbAddBtn').addEventListener('click', function () {
      editingId = null;
      showKBForm(null);
    });

    refreshKBView();
    cloudListControls(body, 'kbCustom', searchInput, function () { allEntries = window.Store.getEntries(); refreshKBView(); });
  }

  function renderKBList(pageEntries) {
    var list = $('#kbList');
    if (!pageEntries.length) {
      list.innerHTML = '<div class="admin-empty">没有匹配的知识条目</div>';
      return;
    }
    list.innerHTML = pageEntries.map(function (e) {
      var isCustom = (e.id && e.id.indexOf('custom-') === 0) || e.creatorTokenId || (e.creatorName && e.creatorName !== '超级管理员' && e.creatorName !== '典藏内置');
      var badge = isCustom
        ? '<span class="admin-badge admin-badge-custom">自定义</span>' + (e.creatorName ? '<span class="admin-creator-tag">👤 ' + esc(e.creatorName) + '</span>' : '')
        : '<span class="admin-badge admin-badge-default">内置</span>';
      var sourceText = (e.sources && e.sources.length && e.sources[0].title) ? ' · 📖 ' + esc(e.sources[0].title) : '';
      var kwText = (e.keywords && e.keywords.length) ? esc(e.keywords.join(' / ')) : esc(e.title);

      return '<div class="admin-kb-item" data-id="' + esc(e.id) + '">' +
        '<div class="admin-kb-item-head">' +
        '  <span class="admin-kb-item-title">' + esc(e.title) + '</span>' + badge +
        '</div>' +
        '<div class="admin-kb-item-keywords">' + kwText + '</div>' +
        '<div class="admin-kb-item-preview">' + esc((e.answer || '').slice(0, 95)) + ((e.answer || '').length > 95 ? '…' : '') + '</div>' +
        '<div class="admin-kb-fulltext" id="full-' + esc(e.id) + '">' + esc(e.answer) + '</div>' +
        '<div class="admin-kb-item-footer">' +
        '  <span class="admin-kb-item-meta">' + (e.answer === undefined ? '正文按需读取' : e.answer.length + ' 字') + sourceText + '</span>' +
        '  <div class="admin-kb-item-actions">' +
        '    <button class="admin-btn-sm admin-btn-expand" data-action="expand">展开全文</button>' +
        '    <button class="admin-btn-sm admin-btn-copy" data-action="copy">复制模板</button>' +
        '    <button class="admin-btn-sm admin-btn-test" data-action="test">测试提问</button>' +
        '    <button class="admin-btn-sm admin-btn-edit" data-action="edit">编辑</button>' +
        '    <button class="admin-btn-sm admin-btn-del" data-action="delete">删除</button>' +
        '  </div>' +
        '</div>' +
        '</div>';
    }).join('');

    list.querySelectorAll('.admin-kb-item').forEach(function (item) {
      var id = item.getAttribute('data-id');

      item.querySelector('[data-action="expand"]').addEventListener('click', function () { adminAction(async function () {
        var drawer = item.querySelector('.admin-kb-fulltext');
        var btn = item.querySelector('[data-action="expand"]');
        if (drawer.classList.contains('open')) {
          drawer.classList.remove('open');
          btn.textContent = '展开全文';
        } else {
          var full = await window.Store.loadRecord('kb', id);
          if (full) drawer.textContent = full.answer || '';
          drawer.classList.add('open');
          btn.textContent = '收起全文';
        }
      }); });

      item.querySelector('[data-action="copy"]').addEventListener('click', function () { adminAction(async function () {
        var entry = await window.Store.loadRecord('kb', id) || window.Store.getEntries().find(function (e) { return e.id === id; });
        if (entry) {
          editingId = null;
          showKBForm({
            title: entry.title + ' (复制模板)',
            keywords: (entry.keywords || []).slice(),
            answer: entry.answer,
            sources: entry.sources ? entry.sources.slice() : []
          });
        }
      }); });

      item.querySelector('[data-action="edit"]').addEventListener('click', function () { adminAction(async function () {
        var entry = await window.Store.loadRecord('kb', id) || window.Store.getEntries().find(function (e) { return e.id === id; });
        editingId = id;
        showKBForm(entry);
      }); });

      item.querySelector('[data-action="test"]').addEventListener('click', function () {
        var btn = item.querySelector('[data-action="test"]');
        var entry = window.Store.getEntries().find(function (e) { return e.id === id; });
        if (!entry) { alert('未找到该条目'); return; }

        var testQ = (entry.title || '').trim();
        if (!testQ && entry.keywords && entry.keywords.length) testQ = entry.keywords[0];
        if (!testQ) { alert('条目标题为空，无法提问'); return; }

        var oldText = btn.textContent;
        btn.textContent = '⏳ 测试中…';
        btn.disabled = true;

        try {
          var engine = (window.AnswerEngine && window.AnswerEngine.getEngine)
            ? window.AnswerEngine.getEngine()
            : window.AnswerEngine;

          if (!engine || !engine.ask) {
            btn.textContent = oldText;
            btn.disabled = false;
            alert('问答引擎暂未就绪，请刷新重试');
            return;
          }

          engine.ask(testQ).then(function (res) {
            btn.textContent = oldText;
            btn.disabled = false;
            var reply = (res && (res.answer || res.text)) || '阿蓝已核实该条目，未直接命中现成问答规则。';
            var source = (res && (res.source || res.label)) || '知识库';
            alert('【阿蓝针对「' + testQ + '」的回答测试】\n\n' + reply + '\n\n来源判定：' + source);
          }).catch(function (err) {
            btn.textContent = oldText;
            btn.disabled = false;
            alert('测试提问遇到错误：' + (err.message || err));
          });
        } catch (e) {
          btn.textContent = oldText;
          btn.disabled = false;
          alert('测试提问调用异常：' + (e.message || e));
        }
      });

      item.querySelector('[data-action="delete"]').addEventListener('click', function () {
        if (confirm('确定删除「' + item.querySelector('.admin-kb-item-title').textContent + '」？')) {
          window.Store.deleteEntry(id);
          renderTab();
        }
      });
    });
  }

  function renderKBPagination(total, totalPages, startIndex, pageCount, allFiltered) {
    var pEl = $('#kbPagination');
    if (!pEl) return;
    if (total <= kbPageSize && totalPages <= 1) {
      pEl.innerHTML = '<span class="admin-page-info">共 ' + total + ' 条</span>';
      return;
    }
    var infoText = '显示 ' + (startIndex + 1) + '-' + (startIndex + pageCount) + ' 条，共 ' + total + ' 条';
    pEl.innerHTML =
      '<span class="admin-page-info">' + infoText + '</span>' +
      '<div class="admin-page-controls">' +
      '  <button class="admin-page-btn" id="kbPagePrev"' + (kbCurPage <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '  <span class="admin-page-info" style="margin:0 4px">' + kbCurPage + ' / ' + totalPages + '</span>' +
      '  <button class="admin-page-btn" id="kbPageNext"' + (kbCurPage >= totalPages ? ' disabled' : '') + '>下一页</button>' +
      '</div>';

    var prev = $('#kbPagePrev');
    var next = $('#kbPageNext');
    if (prev) {
      prev.addEventListener('click', function () {
        if (kbCurPage > 1) {
          kbCurPage--;
          var start = (kbCurPage - 1) * kbPageSize;
          var slice = allFiltered.slice(start, start + kbPageSize);
          renderKBList(slice);
          renderKBPagination(total, totalPages, start, slice.length, allFiltered);
          var elList = $('#kbList');
          if (elList) elList.scrollTop = 0;
        }
      });
    }
    if (next) {
      next.addEventListener('click', function () {
        if (kbCurPage < totalPages) {
          kbCurPage++;
          var start = (kbCurPage - 1) * kbPageSize;
          var slice = allFiltered.slice(start, start + kbPageSize);
          renderKBList(slice);
          renderKBPagination(total, totalPages, start, slice.length, allFiltered);
          var elList = $('#kbList');
          if (elList) elList.scrollTop = 0;
        }
      });
    }
  }

  function showKBForm(entry, recovery) {
    var version = recovery ? recovery.editor.version : editingId ? window.Store.getEditVersion('kb', editingId) : null;
    var formRecordId = editingId;
    var form = $('#kbForm');
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var sourcesTitle = (entry && entry.sources && entry.sources[0]) ? entry.sources[0].title : '';

    form.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">' + (entry ? (editingId ? '编辑条目' : '基于模板新增条目') : '新增条目') + '</div>' +
      '  <label class="admin-label">条目标题 *</label>' +
      '  <input type="text" id="kbTitle" class="admin-input" value="' + esc(entry ? entry.title : '') + '" placeholder="例如：客家蓝染">' +
      '  <label class="admin-label">触发关键词（逗号或空格分隔） *</label>' +
      '  <input type="text" id="kbKeywords" class="admin-input" value="' + esc(entry && entry.keywords ? entry.keywords.join(', ') : '') + '" placeholder="蓝染, 染布, 靛蓝, 植物染">' +
      '  <label class="admin-label">文献出处 / 参考资料</label>' +
      '  <input type="text" id="kbSourceTitle" class="admin-input" value="' + esc(sourcesTitle) + '" placeholder="例如：《赣南客家蓝染技艺》田野调查记录">' +
      '  <label class="admin-label">阿蓝回答正文内容 *</label>' +
      '  <textarea id="kbAnswer" class="admin-textarea" rows="6" placeholder="阿蓝对该知识的权威回答内容…">' + esc(entry ? entry.answer : '') + '</textarea>' +
      '  <div class="admin-hint" data-editor-status>输入会保存为本机草稿，点击保存后上传。</div>' +
      '  <div class="admin-form-actions">' +
      '    <button class="admin-btn admin-btn-primary" id="kbSaveBtn">保存</button>' +
      '    <button class="admin-btn" id="kbCancelBtn">取消</button>' +
      '  </div>' +
      '</div>';

    function entryData() {
      var title = $('#kbTitle').value.trim(), keywords = $('#kbKeywords').value.split(/[,，\s]+/).filter(Boolean), source = $('#kbSourceTitle').value.trim();
      return { title: title, answer: $('#kbAnswer').value.trim(), keywords: keywords.length ? keywords : [title], sources: source ? [{ title: source }] : [] };
    }
    var draft = trackEditorDraft(form, function () { return { type: 'kb', recordId: formRecordId, version: version, value: entryData() }; }, recovery);
    $('#kbSaveBtn').addEventListener('click', async function () {
      var button = $('#kbSaveBtn'); if (button.disabled) return;
      var title = $('#kbTitle').value.trim();
      var keywords = $('#kbKeywords').value.split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      var answer = $('#kbAnswer').value.trim();
      var sourceTitle = $('#kbSourceTitle').value.trim();
      if (!title || !answer) { alert('条目标题和回答内容不能为空'); return; }

      var data = {
        title: title,
        keywords: keywords.length ? keywords : [title],
        answer: answer,
        sources: sourceTitle ? [{ title: sourceTitle }] : []
      };

      button.disabled = true; button.textContent = '正在保存…';
      try {
        if (editingId) { if (!window.Store.updateEntry(editingId, data, currentUser, version)) throw new Error('未找到该条目，请先核对'); }
        else editingId = window.Store.addEntry(data, currentUser).id;
        formRecordId = editingId;
        if (!version) version = { key: 'kbCustom/' + editingId, value: null };
        await draft.preserve();
        var saved = await window.Store.flushPending();
        if (!saved && !window.Store.isContentSaved((version && version.key.indexOf('Edited/') >= 0 ? 'kbEdited/' : 'kbCustom/') + editingId)) { showAdminToast(window.Store.getSyncStatus().message); return; }
        await draft.finish();
      } catch (error) { showAdminToast(error.message); return; }
      finally { button.disabled = false; button.textContent = '保存'; }
      showAdminToast('已保存');
      form.style.display = 'none';
      editingId = null;
      renderTab();
    });

    $('#kbCancelBtn').addEventListener('click', function () {
      form.style.display = 'none';
      editingId = null;
    });
  }

  /* ==================== 2. 科普模块动态管理 ==================== */
  var kepuCurSource = 'all';
  var listPages = {};
  function listSlice(rows, key) {
    if (!window.Store.getCatalog().model) return rows;
    listPages[key] = Math.min(Math.max(1, listPages[key] || 1), Math.max(1, Math.ceil(rows.length / 50)));
    return rows.slice((listPages[key] - 1) * 50, listPages[key] * 50);
  }
  function listNavigation(list, rows, key, refresh) {
    if (!window.Store.getCatalog().model || rows.length <= 50) return;
    var nav = document.createElement('div'); nav.className = 'admin-toolbar-row'; nav.style.gridColumn = '1 / -1';
    ['上一页', '下一页'].forEach(function (label, index) {
      var button = document.createElement('button'); button.className = 'admin-btn-sm'; button.textContent = label;
      button.disabled = index ? listPages[key] * 50 >= rows.length : listPages[key] <= 1;
      button.addEventListener('click', function () { listPages[key] += index ? 1 : -1; refresh(); }); nav.appendChild(button);
    });
    list.appendChild(nav);
  }

  function renderKepu(body) {
    var rawCards = window.Heritage ? window.Heritage.list() : window.Store.getHeritageCards([]);
    var customCards = rawCards.filter(function (c) {
      return (window.Heritage ? window.Heritage.isCustomCard(c) : true);
    });
    var builtinCards = rawCards.filter(function (c) { return customCards.indexOf(c) === -1; });

    var sortedCards = customCards.concat(builtinCards);
    var cloud = window.Store.getSyncStatus();

    var customTotal = window.Store.getCatalog().model ? window.Store.getContentCount('kepuCustom') : customCards.length;
    var totalCards = builtinCards.length + customTotal;
    body.innerHTML =
      '<div class="admin-stats-bar">' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + (cloud.cloudLoaded ? totalCards : '—') + '</div><div class="admin-stat-label">科普总卡片</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val" style="color:var(--primary)">' + (cloud.cloudLoaded ? customTotal : '—') + '</div><div class="admin-stat-label">自定义卡片</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + builtinCards.length + '</div><div class="admin-stat-label">内置卡片</div></div>' +
      '</div>' +
      '<div class="admin-kb-toolbar">' +
      '  <div class="admin-search-wrap">' +
      '    <input type="text" id="kepuSearch" placeholder="搜索科普名称、标签或详情…" class="admin-search">' +
      '    <button type="button" class="admin-search-clear" id="kepuSearchClear" title="清空搜索">✕</button>' +
      '  </div>' +
      '  <button class="admin-btn admin-btn-primary" id="kepuAddBtn">＋ 新增科普卡片</button>' +
      '</div>' +
      '<div class="admin-toolbar-row">' +
      '  <select id="kepuSourceFilter" class="admin-select-sm">' +
      '    <option value="all">来源：全部卡片 (' + totalCards + ')</option>' +
      '    <option value="custom">来源：仅自定义 (' + customTotal + ')</option>' +
      '    <option value="builtin">来源：仅内置 (' + builtinCards.length + ')</option>' +
      '  </select>' +
      '  <div class="admin-toolbar-tip" style="margin-left:auto;font-size:11px;color:var(--muted)">保存后显示在科普页</div>' +
      '</div>' +
      '<div class="admin-kb-form" id="kepuForm" style="display:none"></div>' +
      '<div class="admin-kepu-grid" id="kepuList"></div>';

    var searchInput = $('#kepuSearch');
    var clearBtn = $('#kepuSearchClear');
    var sourceSelect = $('#kepuSourceFilter');

    sourceSelect.value = kepuCurSource;

    function refreshKepuList() {
      rawCards = window.Heritage ? window.Heritage.list() : window.Store.getHeritageCards([]);
      sortedCards = rawCards;
      var q = (searchInput.value || '').toLowerCase().trim();
      if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

      var filtered = sortedCards.filter(function (c) {
        var isCustom = (window.Heritage ? window.Heritage.isCustomCard(c) : true);
        if (kepuCurSource === 'custom' && !isCustom) return false;
        if (kepuCurSource === 'builtin' && isCustom) return false;
        if (q) {
          var match = (c.name && c.name.toLowerCase().indexOf(q) !== -1) ||
                      (c.tag && c.tag.toLowerCase().indexOf(q) !== -1) ||
                      (c.detail && c.detail.toLowerCase().indexOf(q) !== -1);
          if (!match) return false;
        }
        return true;
      });

      renderKepuItems(filtered, rawCards);
    }

    searchInput.addEventListener('input', refreshKepuList);
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        searchInput.value = '';
        refreshKepuList();
        searchInput.focus();
      });
    }

    sourceSelect.addEventListener('change', function () {
      kepuCurSource = sourceSelect.value;
      refreshKepuList();
    });

    $('#kepuAddBtn').addEventListener('click', function () {
      editingKepuId = null;
      showKepuForm(null);
    });

    refreshKepuList();
    cloudListControls(body, 'kepuCustom', searchInput, refreshKepuList);
  }

  function renderKepuItems(cards, allCards) {
    var list = $('#kepuList');
    if (!cards.length) {
      list.innerHTML = '<div class="admin-empty-sm">没有匹配的科普卡片</div>';
      return;
    }

    list.innerHTML = listSlice(cards, 'kepu').map(function (c) {
      var isCustom = (window.Heritage ? window.Heritage.isCustomCard(c) : true);
      var badge = isCustom
        ? '<span class="admin-badge admin-badge-custom">自定义</span>' + (c.creatorName ? '<span class="admin-creator-tag">👤 ' + esc(c.creatorName) + '</span>' : '')
        : '<span class="admin-badge admin-badge-default">内置</span>';

      var catMap = {
        craft: '🧶 传统技艺',
        arch: '🏯 建筑聚落',
        folk: '🏮 民俗曲艺',
        food: '🍲 客家美食'
      };
      var catBadge = c.category && catMap[c.category]
        ? '<span style="font-size:10px;margin-left:4px;padding:1px 5px;background:#F0F4F8;color:#4A5568;border-radius:3px">' + catMap[c.category] + '</span>'
        : '';

      var mediaBadges = '';
      if (c.imageUrl || c.image) mediaBadges += '<span style="font-size:10px;margin-left:4px;padding:1px 5px;background:#E8F0FE;color:#1A73E8;border-radius:3px">🖼️ 配图</span>';
      if (c.videoUrl || c.video) mediaBadges += '<span style="font-size:10px;margin-left:4px;padding:1px 5px;background:#FEF3E8;color:#E37400;border-radius:3px">🎬 视频</span>';

      var previewMediaHtml = '';
      if (c.imageUrl || c.image) {
        previewMediaHtml += '<img src="' + esc(c.imageUrl || c.image) + '" style="max-height:110px;border-radius:4px;display:block;margin-bottom:6px;border:1px solid rgba(0,0,0,0.1)" alt="预览配图">';
      }
      if (c.videoUrl || c.video) {
        previewMediaHtml += '<div style="font-size:11px;color:var(--primary);margin-bottom:6px">🎬 视频：' + esc(c.videoUrl || c.video) + '</div>';
      }

      return '<div class="admin-kepu-card" style="border-left: 4px solid ' + (c.accent || '#2F5D50') + '">' +
        '<div class="admin-kepu-head">' +
      '  <span class="admin-kepu-icon">' + esc(c.icon || '🏮') + '</span>' +
        '  <span class="admin-kepu-name">' + esc(c.name) + '</span>' + badge + catBadge + mediaBadges +
        '</div>' +
        '<div class="admin-kepu-tag">' + esc(c.tag || '') + '</div>' +
        '<div class="admin-kb-fulltext" id="preview-box-' + esc(c.id) + '">' +
        '  <div style="font-weight:600;margin-bottom:4px;color:' + (c.accent || '#2F5D50') + '">【前台游客呈现预览】</div>' +
        '  <div style="background:' + (c.bg || '#E4EFEA') + ';padding:8px;border-radius:4px;color:var(--ink)">' +
        previewMediaHtml +
        '    <div class="heritage-detail" style="font-size:12px;margin-bottom:4px">' + window.UI.formatHeritageDetail(c.detail || '暂无详细介绍') + '</div>' +
        '    <div style="font-size:10px;color:var(--muted)">💬 点击卡片提问阿蓝：「' + esc(c.ask || ('介绍一下' + c.name)) + '」</div>' +
        '  </div>' +
        '</div>' +
        '<div class="admin-kepu-actions">' +
        '  <button class="admin-btn-sm admin-btn-preview" data-preview-kepu="' + esc(c.id) + '">游客预览</button>' +
        '  <button class="admin-btn-sm admin-btn-copy" data-copy-kepu="' + esc(c.id) + '">复制模板</button>' +
        '  <button class="admin-btn-sm admin-btn-edit" data-edit-kepu="' + esc(c.id) + '">编辑</button>' +
        '  <button class="admin-btn-sm admin-btn-del" data-del-kepu="' + esc(c.id) + '">删除</button>' +
        '</div>' +
        '</div>';
    }).join('');
    listNavigation(list, cards, 'kepu', function () { renderKepuItems(cards, allCards); });

    list.querySelectorAll('[data-preview-kepu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-preview-kepu');
        var box = document.getElementById('preview-box-' + id);
        function toggle() {
          if (!box || !box.isConnected) return;
          if (box.classList.contains('open')) {
            box.classList.remove('open');
            btn.textContent = '游客预览';
          } else {
            box.classList.add('open');
            btn.textContent = '收起预览';
          }
        }
        var summary = window.Store.getCatalog().summaries.some(function (key) { return key === 'kepuCustom/' + id || key === 'kepuEdited/' + id; });
        if (summary && box && !box.classList.contains('open')) {
          btn.disabled = true;
          adminAction(async function () {
            try {
              await window.Store.loadRecord('kepu', id);
              var card = window.Heritage.list().find(function (card) { return card.id === id; });
              if (!box.isConnected || !card) return;
              box.querySelector('.heritage-detail').innerHTML = window.UI.formatHeritageDetail(card.detail || '暂无详细介绍');
              toggle();
            } finally { btn.disabled = false; }
          });
        } else toggle();
      });
    });

    list.querySelectorAll('[data-copy-kepu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-copy-kepu');
        adminAction(async function () {
        var card = await window.Store.loadRecord('kepu', id) || allCards.find(function (c) { return c.id === id; });
        if (card) {
          editingKepuId = null;
          showKepuForm({
            name: card.name + ' (复制模板)',
            category: card.category || 'craft',
            icon: card.icon,
            tag: card.tag,
            accent: card.accent,
            bg: card.bg,
            detail: card.detail,
            ask: card.ask,
            imageUrl: card.imageUrl || card.image || '',
            videoUrl: card.videoUrl || card.video || ''
          });
        }
        });
      });
    });

    list.querySelectorAll('[data-edit-kepu]').forEach(function (btn) {
      btn.addEventListener('click', function () { adminAction(async function () {
        var id = btn.getAttribute('data-edit-kepu');
        var card = await window.Store.loadRecord('kepu', id) || allCards.find(function (c) { return c.id === id; });
        editingKepuId = id;
        showKepuForm(card);
      }); });
    });

    list.querySelectorAll('[data-del-kepu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-del-kepu');
        if (confirm('确定删除该科普卡片？')) {
          window.Store.deleteHeritageCard(id);
          refreshFrontEnd();
          renderTab();
        }
      });
    });
  }

  function compressAndReadImage(file, callback, onError) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      if (typeof onError === 'function') onError('请选择有效的图片文件（JPG、PNG、WebP 等）');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      if (typeof onError === 'function') onError('读取本地图片失败，请重试');
    };
    reader.onload = function (e) {
      var rawDataUrl = e.target.result;
      var img = new Image();
      img.onerror = function () {
        if (typeof onError === 'function') onError('图片解码失败，请确认文件完整有效');
      };
      img.onload = function () {
        try {
          var maxDim = 1200;
          var w = img.width;
          var h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          var quality = 0.82;
          var compressed = canvas.toDataURL('image/jpeg', quality);

          if (compressed.length > 250000) {
            compressed = canvas.toDataURL('image/jpeg', 0.68);
          }
          while (compressed.length > 250000 && canvas.width > 160 && canvas.height > 160) {
            canvas.width = Math.round(canvas.width * 0.8);
            canvas.height = Math.round(canvas.height * 0.8);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            compressed = canvas.toDataURL('image/jpeg', 0.68);
          }

          var sizeKb = Math.round(compressed.length * 0.75 / 1024);
          var origKb = Math.round(file.size / 1024);
          callback({
            dataUrl: compressed,
            fileName: file.name,
            origSizeKb: origKb,
            sizeKb: sizeKb
          });
        } catch (_) {
          if (typeof onError === 'function') onError('图片处理失败，请重新选择图片后再保存。');
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  }

  function showKepuForm(card, recovery) {
    var form = $('#kepuForm') || $('#kpForm');
    if (!form) return;
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var version = recovery ? recovery.editor.version : editingKepuId ? window.Store.getEditVersion('kepu', editingKepuId) : null;
    var formRecordId = editingKepuId;

    var initialImg = card ? (card.imageUrl || card.image || '') : '';
    var initialVid = card ? (card.videoUrl || card.video || '') : '';
    var initialCat = (card && card.category) ? card.category : 'craft';

    form.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">' + (recovery ? '继续填写科普卡片' : card ? (editingKepuId ? '编辑科普卡片' : '基于模板新增科普卡片') : '新增科普卡片') + '</div>' +
      '  <div class="admin-form-row">' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">卡片名称 *</label>' +
      '      <input type="text" id="kpName" class="admin-input" value="' + esc(card ? card.name : '') + '" placeholder="例如：龙南大漆">' +
      '    </div>' +
      '    <div style="width:130px">' +
      '      <label class="admin-label">所属板块 *</label>' +
      '      <select id="kpCategory" class="admin-select" style="height:38px;padding:4px 8px">' +
      '        <option value="craft"' + (initialCat === 'craft' ? ' selected' : '') + '>🧶 传统技艺</option>' +
      '        <option value="arch"' + (initialCat === 'arch' ? ' selected' : '') + '>🏯 建筑聚落</option>' +
      '        <option value="folk"' + (initialCat === 'folk' ? ' selected' : '') + '>🏮 民俗曲艺</option>' +
      '        <option value="food"' + (initialCat === 'food' ? ' selected' : '') + '>🍲 客家美食</option>' +
      '      </select>' +
      '    </div>' +
      '    <div style="width:80px">' +
      '      <label class="admin-label">图标Emoji</label>' +
      '      <input type="text" id="kpIcon" class="admin-input" value="' + esc(card ? card.icon : '🏮') + '" placeholder="🏺">' +
      '    </div>' +
      '  </div>' +
      '  <label class="admin-label">标签短语</label>' +
      '  <input type="text" id="kpTag" class="admin-input" value="' + esc(card ? card.tag : '') + '" placeholder="传统手艺 · 传承千年">' +
      '  <div class="admin-form-row">' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">主题主色</label>' +
      '      <input type="color" id="kpAccent" class="admin-input" value="' + (card && card.accent ? card.accent : '#2F5D50') + '" style="height:38px;padding:2px">' +
      '    </div>' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">卡片浅底色</label>' +
      '      <input type="color" id="kpBg" class="admin-input" value="' + (card && card.bg ? card.bg : '#E4EFEA') + '" style="height:38px;padding:2px">' +
      '    </div>' +
      '  </div>' +
      '  <label class="admin-label">卡片配图 (可直接选择本地图片/拍照上传，或输入链接)</label>' +
      '  <div class="admin-upload-zone" id="kpUploadZone">' +
      '    <input type="file" id="kpImageFile" accept="image/*" style="display:none">' +
      '    <div class="admin-upload-preview-wrap" id="kpPreviewWrap" style="' + (initialImg ? 'display:flex' : 'display:none') + '">' +
      '      <img id="kpImgThumb" class="admin-upload-thumb" src="' + esc(initialImg) + '" alt="配图预览">' +
      '      <div class="admin-upload-info">' +
      '        <div id="kpImgInfoText" class="admin-upload-name">' + esc(initialImg ? (initialImg.indexOf('data:') === 0 ? '已选图片' : initialImg) : '已选图片') + '</div>' +
      '        <div class="admin-upload-btns">' +
      '          <button type="button" class="admin-btn-sm" id="kpRechooseBtn">📷 更换图片</button>' +
      '          <button type="button" class="admin-btn-sm admin-btn-del" id="kpRemoveImgBtn">🗑️ 移除</button>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <div id="kpUploadPrompt" class="admin-upload-prompt" style="' + (initialImg ? 'display:none' : 'display:block') + '">' +
      '      <button type="button" class="admin-btn admin-btn-primary" id="kpChooseBtn" style="padding:7px 16px;font-size:12px">' +
      '        📷 点击选择本地图片 / 拍照上传' +
      '      </button>' +
      '      <div class="admin-upload-hint">可拍照、选图、拖入或粘贴，图片会自动压缩。</div>' +
      '    </div>' +
      '    <div class="admin-manual-toggle">' +
      '      <a href="javascript:void(0)" id="kpToggleManual" class="admin-manual-link">🔗 手动输入图片链接或本地相对路径</a>' +
      '      <div id="kpManualWrap" style="display:none;margin-top:6px">' +
      '        <input type="text" id="kpImage" class="admin-input" value="' + esc(initialImg) + '" placeholder="例如：assets/model-references/landye-237.jpg 或 https://...">' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '  <label class="admin-label">讲解视频链接或本地MP4路径 (可选)</label>' +
      '  <input type="text" id="kpVideo" class="admin-input" value="' + esc(initialVid) + '" placeholder="例如：月光光童谣.mp4 或 https://...">' +
      '  <div class="admin-hint">支持本地视频文件名（如：月光光童谣.mp4）或在线视频讲解播放链接</div>' +
      '  <label class="admin-label" style="margin-top:8px">科普详情正文</label>' +
      '  <div class="admin-hint">直接按回车换行，空一行分段，无需输入标签。兼容已有 HTML 段落。</div>' +
      '  <textarea id="kpDetail" class="admin-textarea" rows="8" placeholder="在此输入或粘贴正文，按回车即可换行…">' + esc(card ? card.detail : '') + '</textarea>' +
      '  <div class="admin-hint" id="kpDraftStatus" data-editor-status>输入内容会保存为本机草稿。点击保存后上传。</div>' +
      '  <label class="admin-label">默认提问</label>' +
      '  <input type="text" id="kpAsk" class="admin-input" value="' + esc(card ? card.ask : '') + '" placeholder="例如：龙南大漆有什么特色？">' +
      '  <div class="admin-form-actions">' +
      '    <button class="admin-btn admin-btn-primary" id="kpSaveBtn">保存</button>' +
      '    <button class="admin-btn" id="kpCancelBtn">取消</button>' +
      '  </div>' +
      '</div>';

    function editorData() {
      var ids = { name: 'kpName', category: 'kpCategory', icon: 'kpIcon', tag: 'kpTag', accent: 'kpAccent', bg: 'kpBg', imageUrl: 'kpImage', videoUrl: 'kpVideo', detail: 'kpDetail', ask: 'kpAsk' };
      var value = {};
      Object.keys(ids).forEach(function (key) { value[key] = form.querySelector('#' + ids[key]).value; });
      return { type: 'kepu', recordId: formRecordId, version: version, value: value };
    }
    var draft = trackEditorDraft(form, editorData, recovery), preserveEditor = draft.preserve;
    if (window.MediaUpload) window.MediaUpload.bind(form);
    var formContent = form.firstElementChild;

    var fileInput = $('#kpImageFile');
    var imageInput = $('#kpImage');
    var previewWrap = $('#kpPreviewWrap');
    var promptBox = $('#kpUploadPrompt');
    var imgThumb = $('#kpImgThumb');
    var infoText = $('#kpImgInfoText');
    var zone = $('#kpUploadZone');
    var imageTask = 0;
    function imageBusy(busy) {
      $('#kpSaveBtn').disabled = busy;
      $('#kpSaveBtn').textContent = busy ? '正在处理图片…' : '保存';
    }

    function applyImageData(dataUrl, label) {
      imageInput.value = dataUrl;
      imgThumb.src = dataUrl;
      imgThumb.style.display = 'block';
      infoText.textContent = label || '已选图片';
      previewWrap.style.display = 'flex';
      promptBox.style.display = 'none';
      preserveEditor();
    }

    function handleFile(file) {
      if (!file) return;
      var task = ++imageTask;
      imageBusy(true);
      compressAndReadImage(file, function (res) {
        if (task !== imageTask || !formContent.isConnected) return;
        imageBusy(false);
        applyImageData(res.dataUrl, res.fileName + ' (' + res.sizeKb + ' KB)');
        showAdminToast('图片已读取并优化 (' + res.sizeKb + ' KB)，点击保存后上传');
      }, function (err) {
        if (task !== imageTask || !formContent.isConnected) return;
        imageBusy(false);
        alert(err);
      });
    }

    $('#kpChooseBtn').addEventListener('click', function () { fileInput.click(); });
    $('#kpRechooseBtn').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) {
        handleFile(fileInput.files[0]);
      }
    });

    $('#kpRemoveImgBtn').addEventListener('click', function () {
      imageTask++;
      imageBusy(false);
      imageInput.value = '';
      fileInput.value = '';
      imgThumb.src = '';
      previewWrap.style.display = 'none';
      promptBox.style.display = 'block';
      preserveEditor();
    });

    $('#kpToggleManual').addEventListener('click', function () {
      var wrap = $('#kpManualWrap');
      wrap.style.display = (wrap.style.display === 'none') ? 'block' : 'none';
    });

    imageInput.addEventListener('input', function () {
      imageTask++;
      imageBusy(false);
      var val = imageInput.value.trim();
      if (val) {
        applyImageData(val, val);
      } else {
        previewWrap.style.display = 'none';
        promptBox.style.display = 'block';
      }
    });

    if (zone) {
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        zone.classList.add('dragover');
      });
      zone.addEventListener('dragleave', function (e) {
        e.preventDefault();
        zone.classList.remove('dragover');
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFile(e.dataTransfer.files[0]);
        }
      });
    }

    $('#kpSaveBtn').addEventListener('click', async function () {
      var saveBtn = $('#kpSaveBtn');
      if (saveBtn.disabled) return;
      var name = $('#kpName').value.trim();
      var category = $('#kpCategory') ? $('#kpCategory').value : 'craft';
      var icon = $('#kpIcon').value.trim() || '🏮';
      var tag = $('#kpTag').value.trim() || '客家非遗';
      var accent = $('#kpAccent').value;
      var bg = $('#kpBg').value;
      var imageUrl = $('#kpImage').value.trim();
      var videoUrl = $('#kpVideo').value.trim();
      var detail = $('#kpDetail').value.trim();
      var ask = $('#kpAsk').value.trim() || ('介绍一下' + name);
      if (!name) { alert('卡片名称不能为空'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = '正在上传…';

      var data = { name: name, category: category, icon: icon, tag: tag, accent: accent, bg: bg, detail: detail, ask: ask, imageUrl: imageUrl, videoUrl: videoUrl };
      try {
        if (editingKepuId && (version || (window.Heritage ? window.Heritage.list() : window.Store.getHeritageCards([])).some(function (item) { return item.id === editingKepuId; }))) {
          if (!window.Store.updateHeritageCard(editingKepuId, data, version)) throw new Error('保存失败，请先核对该条目');
        } else {
          if (editingKepuId) data.id = editingKepuId;
          editingKepuId = window.Store.addHeritageCard(data, currentUser).id;
        }
        formRecordId = editingKepuId;
        if (!version) version = { key: 'kepuCustom/' + editingKepuId, value: null };
        await preserveEditor();
      } catch (error) { saveBtn.disabled = false; saveBtn.textContent = '保存'; showAdminToast(error.message); return; }
      refreshFrontEnd();
      var saved = await window.Store.flushPending();
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
      if (!saved && !window.Store.isContentSaved((version && version.key.indexOf('Edited/') >= 0 ? 'kepuEdited/' : 'kepuCustom/') + editingKepuId)) { showAdminToast(window.Store.getSyncStatus().message); return; }
      try { await draft.finish(); } catch (error) { showAdminToast('资料已保存，草稿清理失败：' + error.message); return; }
      showAdminToast('已保存');
      form.style.display = 'none';
      editingKepuId = null;
      renderTab();
    });

    $('#kpCancelBtn').addEventListener('click', function () {
      form.style.display = 'none';
      editingKepuId = null;
    });
  }

  /* ==================== 3. 方言模块动态管理 ==================== */
  function renderDialect(body) {
    var baseTracks = (window.Diancang && window.Diancang.videoExhibits) ? window.Diancang.videoExhibits() : [];
    var customTracks = window.Store.getCustomDialectTracks();
    var customCount = window.Store.getCatalog().model ? window.Store.getContentCount('dialectCustom') : customTracks.length;
    var totalCount = baseTracks.length + customCount, localPage = 0;

    body.innerHTML =
      '<div class="admin-stats-bar">' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + totalCount + '</div><div class="admin-stat-label">方言总语料</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val" style="color:var(--primary)">' + customCount + '</div><div class="admin-stat-label">自定义录入</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + baseTracks.length + '</div><div class="admin-stat-label">典藏内置讲解</div></div>' +
      '</div>' +
      '<div class="admin-kb-toolbar">' +
      '  <div class="admin-search-wrap">' +
      '    <input type="text" id="dlSearch" placeholder="搜索方言名称、篇章或音视频地址…" class="admin-search">' +
      '    <button type="button" class="admin-search-clear" id="dlSearchClear" title="清空搜索">✕</button>' +
      '  </div>' +
      '  <button class="admin-btn admin-btn-primary" id="dialectAddBtn">＋ 新增方言讲解/音频</button>' +
      '</div>' +
      '<div class="admin-kb-form" id="dialectForm" style="display:none"></div>' +
      '<div class="admin-section-subtitle">自定义语料 (' + customCount + ')</div>' +
      '<div class="admin-dialect-list" id="customDialectList"></div>' +
      '<div class="admin-toolbar-row"><button class="admin-btn-sm" id="dlPrev">上一页</button><span id="dlPage"></span><button class="admin-btn-sm" id="dlNext">下一页</button></div>' +
      '<div class="admin-section-subtitle" style="margin-top:14px">典藏内置原声讲解 (' + baseTracks.length + ')</div>' +
      '<div class="admin-dialect-list" id="baseDialectList"></div>';

    var searchInput = $('#dlSearch');
    var clearBtn = $('#dlSearchClear');

    function refreshDialectView() {
      customTracks = window.Store.getCustomDialectTracks();
      var q = (searchInput.value || '').toLowerCase().trim();
      if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

      var filteredCustom = customTracks.filter(function (t) {
        if (!q) return true;
        var text = ((t.item && t.item.name) + ' ' + t.chapter + ' ' + (t.item && t.item.videoUrl)).toLowerCase();
        return text.indexOf(q) !== -1;
      });

      var cList = $('#customDialectList');
      localPage = Math.min(localPage, Math.max(0, Math.ceil(filteredCustom.length / 50) - 1));
      $('#dlPrev').disabled = localPage === 0; $('#dlNext').disabled = (localPage + 1) * 50 >= filteredCustom.length;
      $('#dlPage').textContent = '第 ' + (localPage + 1) + ' 页，已加载 ' + customTracks.length + ' 条';
      if (!filteredCustom.length) {
        cList.innerHTML = '<div class="admin-empty-sm">' + (customTracks.length ? '未找到匹配的自定义语料' : '暂无自定义语料，点击上方按钮新增') + '</div>';
      } else {
        cList.innerHTML = filteredCustom.slice(localPage * 50, (localPage + 1) * 50).map(function (t) {
          var creatorTag = t.creatorName ? '<span class="admin-creator-tag">👤 ' + esc(t.creatorName) + '</span>' : '';
          var isAud = globalThis.HeritageContent.isAudioTrack(t);
          var mediaBadge = isAud
            ? '<span class="admin-badge" style="background:#FEF3C7;color:#92400E;border:1px solid #FCD34D">🔊 录音</span>'
            : '<span class="admin-badge" style="background:#E0E7FF;color:#3730A3;border:1px solid #C7D2FE">🎬 视频</span>';
          var targetUrl = (t.item && (t.item.audioUrl || t.item.videoUrl)) || '';
          return '<div class="admin-dialect-item" style="border-left: 3px solid var(--primary);">' +
            '<div>' +
            '  <div class="admin-dialect-item-title">' + mediaBadge + ' ' + esc(t.item.name) + ' (' + esc(t.chapter) + ' · 第' + esc(t.item.page) + '页) <span class="admin-badge admin-badge-custom">自定义</span>' + creatorTag + '</div>' +
            '  <div class="admin-dialect-item-url">' + esc(targetUrl) + '</div>' +
            '</div>' +
            '<div class="admin-kb-item-actions">' +
            '  <button class="admin-btn-sm admin-btn-test" data-play-dialect="' + esc(targetUrl) + '">' + (isAud ? '▶ 试听' : '🎬 播放') + '</button>' +
            '  <button class="admin-btn-sm admin-btn-copy" data-copy-dialect="' + esc(targetUrl) + '">复制链接</button>' +
            '  <button class="admin-btn-sm admin-btn-del" data-del-dialect="' + esc(t.id) + '">删除</button>' +
            '</div>' +
            '</div>';
        }).join('');

        cList.querySelectorAll('[data-play-dialect]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var url = btn.getAttribute('data-play-dialect');
            if (url) window.open(url, '_blank');
          });
        });

        cList.querySelectorAll('[data-copy-dialect]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var url = btn.getAttribute('data-copy-dialect');
            if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(function () { alert('音视频链接已复制到剪贴板'); });
            } else {
              alert('链接：' + url);
            }
          });
        });

        cList.querySelectorAll('[data-del-dialect]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-del-dialect');
            if (confirm('确定删除该自定义方言条目？')) {
              window.Store.deleteDialectTrack(id);
              if (window.Dialect && window.Dialect.refresh) window.Dialect.refresh();
              renderTab();
            }
          });
        });
      }

      var filteredBase = baseTracks.filter(function (t) {
        if (!q) return true;
        var text = ((t.item && t.item.name) + ' ' + t.chapter + ' ' + (t.item && t.item.videoUrl)).toLowerCase();
        return text.indexOf(q) !== -1;
      });

      var bList = $('#baseDialectList');
      if (!filteredBase.length) {
        bList.innerHTML = '<div class="admin-empty-sm">未找到匹配的内置讲解</div>';
      } else {
        bList.innerHTML = filteredBase.map(function (t, i) {
          return '<div class="admin-dialect-item muted">' +
            '<span>' + (i + 1) + '. <span class="admin-badge" style="background:#E0E7FF;color:#3730A3;border:1px solid #C7D2FE">🎬 视频</span> ' + esc(t.item.name) + ' (' + esc(t.chapter) + ')</span>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
            '  <button class="admin-btn-sm admin-btn-test" data-play-dialect="' + esc(t.item.videoUrl) + '">🎬 观看</button>' +
            '  <span class="admin-badge admin-badge-default">内置</span>' +
            '</div>' +
            '</div>';
        }).join('');

        bList.querySelectorAll('[data-play-dialect]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var url = btn.getAttribute('data-play-dialect');
            if (url) window.open(url, '_blank');
          });
        });
      }
    }

    searchInput.addEventListener('input', function () { localPage = 0; refreshDialectView(); });
    $('#dlPrev').addEventListener('click', function () { localPage--; refreshDialectView(); });
    $('#dlNext').addEventListener('click', function () { localPage++; refreshDialectView(); });
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        searchInput.value = '';
        refreshDialectView();
        searchInput.focus();
      });
    }

    $('#dialectAddBtn').addEventListener('click', function () {
      showDialectForm();
    });

    refreshDialectView();
    cloudListControls(body, 'dialectCustom', searchInput, function () { localPage = 0; refreshDialectView(); });
  }

  function showDialectForm(track, recovery) {
    var form = $('#dialectForm');
    var recordId = recovery && recovery.editor.recordId || null;
    var version = recovery && recovery.editor.version || null;
    var newId = track && track.id || 'dialect-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    var item = track && track.item || {};
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });

    form.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">新增方言语料 / 展品原声讲解</div>' +
      '  <label class="admin-label">展品 / 方言语料名称 *</label>' +
      '  <input type="text" id="dlName" class="admin-input" value="' + esc(item.name || '') + '" placeholder="例如：黄姜豆腐制作口述">' +
      '  <div class="admin-form-row">' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">媒体形态 *</label>' +
      '      <select id="dlMediaType" class="admin-input">' +
      '        <option value="audio"' + (track && track.mediaType === 'audio' ? ' selected' : '') + '>🔊 纯音频录音 (田野采风原声)</option>' +
      '        <option value="video"' + (track && track.mediaType === 'video' ? ' selected' : '') + '>🎬 视频影像 (展品视听讲解)</option>' +
      '      </select>' +
      '    </div>' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">语料来源</label>' +
      '      <select id="dlOriginType" class="admin-input">' +
      '        <option value="custom">🎙️ 现代田野采风录入</option>' +
      '        <option value="classic"' + (track && track.originType === 'classic' ? ' selected' : '') + '>📖 文献典籍补录</option>' +
      '      </select>' +
      '    </div>' +
      '  </div>' +
      '  <div class="admin-form-row">' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">所属篇章 / 栏目</label>' +
      '      <input type="text" id="dlChapter" class="admin-input" value="' + esc(track && track.chapter || '客家风味') + '" placeholder="例如：客家风味">' +
      '    </div>' +
      '    <div style="width:100px">' +
      '      <label class="admin-label">页码编号</label>' +
      '      <input type="number" id="dlPage" class="admin-input" value="' + esc(item.page || 1) + '">' +
      '    </div>' +
      '  </div>' +
      '  <label class="admin-label">音视频嵌入链接 / 播放地址 *</label>' +
      '  <input type="url" id="dlUrl" class="admin-input" value="' + esc(item.videoUrl || item.audioUrl || '') + '" placeholder="https://... 视频或音频地址">' +
      '  <p class="admin-hint" data-editor-status>本机草稿已保留，保存后上传。</p>' +
      '  <div class="admin-form-actions">' +
      '    <button class="admin-btn admin-btn-primary" id="dlSaveBtn">保存</button>' +
      '    <button class="admin-btn" id="dlCancelBtn">取消</button>' +
      '  </div>' +
      '</div>';

    function readTrack() {
      var name = $('#dlName').value.trim();
      var mediaType = $('#dlMediaType').value || 'audio';
      var originType = $('#dlOriginType').value || 'custom';
      var chapter = $('#dlChapter').value.trim() || '客家方言';
      var page = Number($('#dlPage').value) || 1;
      var url = $('#dlUrl').value.trim();
      return {
        id: recordId || newId,
        chapter: chapter,
        mediaType: mediaType,
        originType: originType,
        isCustom: (originType === 'custom'),
        item: {
          name: name,
          page: page,
          videoUrl: (mediaType === 'video' ? url : ''),
          audioUrl: (mediaType === 'audio' ? url : ''),
          mediaType: mediaType
        }
      };
    }
    var draft = trackEditorDraft(form, function () { return { type: 'dialect', recordId: recordId, version: version, value: readTrack() }; }, recovery);
    if (window.MediaUpload) window.MediaUpload.bind(form);
    $('#dlSaveBtn').addEventListener('click', async function () {
      var button = this, value = readTrack();
      if (button.disabled) return;
      if (!value.item.name || !(value.item.videoUrl || value.item.audioUrl)) { alert('名称和音视频链接不能为空'); return; }
      button.disabled = true; button.textContent = '正在保存…';
      try {
        if (recordId) { if (!window.Store.updateDialectTrack(recordId, value, version)) throw new Error('未找到该条目，请先核对'); }
        else recordId = window.Store.addDialectTrack(value, currentUser).id;
        if (!version) version = { key: 'dialectCustom/' + recordId, value: null };
        await draft.preserve();
        var saved = await window.Store.flushPending();
        if (!saved && !window.Store.isContentSaved('dialectCustom/' + recordId)) { showAdminToast(window.Store.getSyncStatus().message); return; }
        await draft.finish(); refreshFrontEnd();
        showAdminToast('已保存'); form.style.display = 'none'; renderTab();
      } catch (error) { showAdminToast(error.message); }
      finally { button.disabled = false; button.textContent = '保存'; }
    });

    $('#dlCancelBtn').addEventListener('click', function () {
      form.style.display = 'none';
    });
  }

  /* ==================== 4. 任意格式文档智能解析入库 ==================== */
  function renderImport(body) {
    body.innerHTML =
      '<div class="admin-import-panel">' +
      '  <div class="admin-form-title">导入文档</div>' +
      '  <div class="admin-hint">支持拖拽或选择 Word (.docx)、Markdown (.md)、文本文档 (.txt) 或 JSON 文件。系统自动提取结构化问答条目。</div>' +
      '  <div class="admin-dropzone" id="fileDropzone">' +
      '    <div class="admin-dropzone-icon">📄</div>' +
      '    <div class="admin-dropzone-text">点击或拖拽文件到此处解析</div>' +
      '    <div class="admin-dropzone-sub">支持 .txt / .md / .json / .docx 格式文档</div>' +
      '    <input type="file" id="docFileInput" accept=".txt,.md,.json,.docx" style="display:none">' +
      '  </div>' +
      '  <div class="admin-drafts-header" id="draftsHeader" style="display:none">' +
      '    <span class="admin-drafts-title" id="draftsCountTitle">解析出的条目草稿 (0)</span>' +
      '    <button class="admin-btn admin-btn-primary" id="batchCommitBtn">导入所选条目</button>' +
      '  </div>' +
      '  <div class="admin-drafts-list" id="draftsList"></div>' +
      '</div>';

    var dropzone = $('#fileDropzone');
    var fileInput = $('#docFileInput');

    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('hover'); });
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('hover'); });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('hover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        processUploadedFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', function () {
      if (this.files && this.files[0]) {
        processUploadedFile(this.files[0]);
      }
    });

    $('#batchCommitBtn').addEventListener('click', async function () {
      if (!parsedDrafts.length) return;
      try {
        parsedDrafts.forEach(function (draft, i) {
          globalThis.HeritageContent.record(Object.assign({ id: 'draft-' + i }, draft), 'kb', '导入草稿 ' + (i + 1), false);
        });
      } catch (error) { alert(error.message + '，请修正草稿后重试。'); return; }
      var count = parsedDrafts.length;
      $('#batchCommitBtn').disabled = true;
      parsedDrafts.forEach(function (draft) {
        window.Store.addEntry({
          title: draft.title,
          keywords: draft.keywords,
          answer: draft.answer,
          sources: draft.sources
        }, currentUser);
      });
      parsedDrafts = [];
      var saved = await window.Store.flushPending();
      alert(saved ? '已上传云端 ' + count + ' 条非遗知识。' : '已导入本机，尚未上传成功：' + window.Store.getSyncStatus().message);
      renderTab();
    });

    renderDraftsList();
  }

  function processUploadedFile(file) {
    var name = file.name || '';
    var ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (file.size > 16 * 1024 * 1024) { alert('文件超过 16 MB，请拆分后导入。原草稿已保留。'); return; }

    if (ext === '.json') {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          if (Array.isArray(parsed)) {
            if (!parsed.length) throw new Error('文件没有条目');
            if (parsed.some(function (item) { return !item || typeof item !== 'object' || Array.isArray(item); })) throw new Error('无效条目');
            var nextDrafts = parsed.map(function (item, idx) {
              return {
                title: String(item.title || ('解析条目 ' + (idx + 1))),
                keywords: Array.isArray(item.keywords) ? item.keywords : [item.title || '非遗'],
                answer: String(item.answer || item.content || item.desc || ''),
                sources: Array.isArray(item.sources) ? item.sources : [{ title: name }]
              };
            });
            nextDrafts.forEach(function (draft, i) { globalThis.HeritageContent.record(Object.assign({ id: 'draft-' + i }, draft), 'kb', '导入条目 ' + (i + 1), false); });
            parsedDrafts = nextDrafts;
            renderDraftsList();
          } else {
            alert('JSON 文件格式不是条目数组');
          }
        } catch (err) { alert('JSON 解析失败'); }
      };
      reader.readAsText(file);
    } else if (ext === '.txt' || ext === '.md') {
      var txtReader = new FileReader();
      txtReader.onload = function () {
        parseTextToDrafts(txtReader.result, name);
      };
      txtReader.readAsText(file);
    } else if (ext === '.docx') {
      var binReader = new FileReader();
      binReader.onload = function () {
        parseDocxToDrafts(binReader.result, name);
      };
      binReader.readAsArrayBuffer(file);
    } else {
      alert('暂不支持此格式文件');
    }
  }

  function parseTextToDrafts(rawText, sourceDocName) {
    var text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var chunks = [];

    // 尝试按 Markdown 标题或问答切分
    var lines = text.split('\n');
    var curTitle = '';
    var curBody = [];

    lines.forEach(function (line) {
      var trimmed = line.trim();
      var isHeader = /^#{1,4}\s+/.test(trimmed) || /^[一二三四五六七八九十]+[、.]\s*/.test(trimmed) || /^(【.+?】)/.test(trimmed) || /^问[：:]/.test(trimmed);
      if (isHeader && (curTitle || curBody.length > 0)) {
        if (curBody.join('\n').trim().length > 0) {
          chunks.push({
            title: curTitle || '非遗知识条目',
            text: curBody.join('\n').trim()
          });
        }
        curTitle = trimmed.replace(/^#{1,4}\s+/, '').replace(/^问[：:]\s*/, '').replace(/[【】]/g, '').slice(0, 32);
        curBody = [];
      } else if (isHeader) {
        curTitle = trimmed.replace(/^#{1,4}\s+/, '').replace(/^问[：:]\s*/, '').replace(/[【】]/g, '').slice(0, 32);
      } else {
        curBody.push(line);
      }
    });

    if (curBody.join('\n').trim().length > 0) {
      chunks.push({
        title: curTitle || '非遗知识条目',
        text: curBody.join('\n').trim()
      });
    }

    // 如果未切出标题，尝试按双换行切分
    if (chunks.length === 0) {
      var rawChunks = text.split(/\n\s*\n+/);
      rawChunks.forEach(function (c, idx) {
        var ct = c.trim();
        if (ct.length > 0) {
          var firstLine = ct.split('\n')[0].slice(0, 24);
          chunks.push({
            title: firstLine || ('条目 ' + (idx + 1)),
            text: ct
          });
        }
      });
    }

    if (!chunks.length) { alert('未提取到可导入的文字，原草稿已保留'); return; }
    parsedDrafts = chunks.map(function (c) {
      return {
        title: c.title.trim(),
        keywords: [c.title.trim(), '客家非遗'],
        answer: c.text.trim(),
        sources: [{ title: sourceDocName || '导入文档' }]
      };
    });

    renderDraftsList();
  }

  function parseDocxToDrafts(arrayBuffer, fileName) {
    try {
      var bytes = new Uint8Array(arrayBuffer);
      if (bytes.length > 16 * 1024 * 1024) throw new Error('Word 文件超过 16 MB，请分成较小文档后上传');
      var parts = [], size = 0, found = false, completed = false, parseError = null;
      var unzip = new window.fflate.Unzip(function (file) {
        if (file.name !== 'word/document.xml') return;
        if (found) throw new Error('Word 文件包含重复正文部件');
        found = true;
        if (file.originalSize > 8 * 1024 * 1024) throw new Error('Word 正文解压后超过 8 MB，请拆分文档');
        file.ondata = function (error, data, final) {
          if (error) { parseError = error; return; }
          size += data.length;
          if (size > 8 * 1024 * 1024) { file.terminate(); throw new Error('Word 正文解压后超过 8 MB，请拆分文档'); }
          parts.push(data); completed = final;
        };
        file.start();
      });
      unzip.register(window.fflate.UnzipInflate);
      for (var offset = 0; offset < bytes.length; offset += 1024) unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
      if (parseError) throw parseError;
      if (!found || !completed) throw new Error('Word 文件不完整或没有正文部件');
      var xmlBytes = new Uint8Array(size), cursor = 0;
      parts.forEach(function (part) { xmlBytes.set(part, cursor); cursor += part.length; });
      var xmlText = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes);
      if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) throw new Error('Word 文件包含不支持的 XML 声明');
      var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('Word 正文格式损坏');
      var ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      var paragraphs = Array.from(doc.getElementsByTagNameNS('*', 'p')).filter(function (p) { return p.namespaceURI === ns || p.namespaceURI === 'http://purl.oclc.org/ooxml/wordprocessingml/main'; }).map(function (paragraph) {
        var text = '';
        function visit(node) {
          if ((node.namespaceURI === ns || node.namespaceURI === 'http://purl.oclc.org/ooxml/wordprocessingml/main') && node.localName === 't') { text += node.textContent; return; }
          if ((node.namespaceURI === ns || node.namespaceURI === 'http://purl.oclc.org/ooxml/wordprocessingml/main') && ['br', 'cr'].includes(node.localName)) { text += '\n'; return; }
          if ((node.namespaceURI === ns || node.namespaceURI === 'http://purl.oclc.org/ooxml/wordprocessingml/main') && node.localName === 'tab') { text += '\t'; return; }
          Array.from(node.childNodes).forEach(visit);
        }
        visit(paragraph); return text;
      });
      var fullText = paragraphs.join('\n\n');
      if (!fullText.trim()) throw new Error('Word 文档没有可导入的文字，原草稿已保留');
      parseTextToDrafts(fullText, fileName);
    } catch (error) { alert('Word 文档解析失败：' + error.message + '。原草稿已保留。'); }
  }

  function renderDraftsList() {
    var header = $('#draftsHeader');
    var list = $('#draftsList');
    if (!header || !list) return;

    if (!parsedDrafts.length) {
      header.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    header.style.display = 'flex';
    $('#draftsCountTitle').textContent = '已解析出 ' + parsedDrafts.length + ' 条非遗条目草稿（确认后可一键入库）：';

    list.innerHTML = parsedDrafts.map(function (d, idx) {
      return '<div class="admin-draft-card">' +
        '<div class="admin-draft-head">' +
        '  <input type="text" class="admin-input draft-title" data-idx="' + idx + '" value="' + esc(d.title) + '">' +
        '  <button class="admin-btn-sm admin-btn-del" data-del-draft="' + idx + '">✕</button>' +
        '</div>' +
        '<textarea class="admin-textarea draft-answer" rows="3" data-idx="' + idx + '">' + esc(d.answer) + '</textarea>' +
        '</div>';
    }).join('');

    list.querySelectorAll('.draft-title').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var idx = Number(inp.getAttribute('data-idx'));
        if (parsedDrafts[idx]) parsedDrafts[idx].title = inp.value;
      });
    });

    list.querySelectorAll('.draft-answer').forEach(function (tx) {
      tx.addEventListener('input', function () {
        var idx = Number(tx.getAttribute('data-idx'));
        if (parsedDrafts[idx]) parsedDrafts[idx].answer = tx.value;
      });
    });

    list.querySelectorAll('[data-del-draft]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = Number(btn.getAttribute('data-del-draft'));
        parsedDrafts.splice(idx, 1);
        renderDraftsList();
      });
    });
  }

  /* ==================== 5. AI 模型与工作流编排 ==================== */
  function renderAI(body) {
    var canEdit = currentUser && currentUser.role === 'super_admin';
    var apiOvr = window.Store.getApiOverrides();
    var curModel = apiOvr.model || 'Qwen/Qwen3-30B-A3B-Instruct-2507';
    var curTemp = apiOvr.temperature !== undefined ? apiOvr.temperature : 0.2;
    var curTokens = apiOvr.maxTokens !== undefined ? apiOvr.maxTokens : 900;
    var wf = window.Store.getWorkflowConfig();

    body.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">问答设置</div>' +
      '  <label class="admin-label">模型</label>' +
      '  <select id="apiModel" class="admin-input">' +
      '    <option value="Qwen/Qwen3-30B-A3B-Instruct-2507"' + (curModel === 'Qwen/Qwen3-30B-A3B-Instruct-2507' ? ' selected' : '') + '>通义千问 Qwen3-30B (垂直非遗推理推荐)</option>' +
      '    <option value="Qwen/Qwen2.5-7B-Instruct"' + (curModel === 'Qwen/Qwen2.5-7B-Instruct' ? ' selected' : '') + '>通义千问 Qwen2.5-7B (轻量高响应)</option>' +
      '    <option value="deepseek-ai/DeepSeek-V3.2"' + (curModel === 'deepseek-ai/DeepSeek-V3.2' ? ' selected' : '') + '>DeepSeek-V3.2 (深度推理通用模型)</option>' +
      '  </select>' +
      '  <label class="admin-label">虚拟讲解员「阿蓝」人设工作流 (System Prompt)</label>' +
      '  <textarea id="wfPrompt" class="admin-textarea" rows="4">' + esc(wf.systemPrompt) + '</textarea>' +
      '  <div class="admin-form-row" style="margin-top:8px">' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">生成温度 (Temperature: ' + curTemp + ')</label>' +
      '      <input type="range" id="apiTemp" min="0" max="1" step="0.05" value="' + curTemp + '" class="admin-range">' +
      '    </div>' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">最大输出 Tokens</label>' +
      '      <input type="number" id="apiMaxTokens" class="admin-input" value="' + curTokens + '" min="100" max="2000" step="50">' +
      '    </div>' +
      '  </div>' +
      '  <div class="admin-form-actions" style="margin-top:14px">' +
      '    <button class="admin-btn admin-btn-primary" id="aiSaveBtn">保存工作流与模型配置</button>' +
      '  </div>' +
      '</div>';

    $('#apiTemp').addEventListener('input', function () {
      this.previousElementSibling.textContent = '生成温度 (Temperature: ' + this.value + ')';
    });

    if (!canEdit) {
      body.querySelectorAll('input, select, textarea, button').forEach(function (element) { element.disabled = true; });
      $('#aiSaveBtn').textContent = '仅管理员可修改';
      return;
    }
    $('#aiSaveBtn').addEventListener('click', async function () {
      var button = this;
      if (button.disabled) return;
      var model = $('#apiModel').value;
      var temp = Number($('#apiTemp').value);
      var maxTokens = Number($('#apiMaxTokens').value);
      var sysPrompt = $('#wfPrompt').value.trim();

      if (!Number.isFinite(temp) || temp < 0 || temp > 1 || !Number.isInteger(maxTokens) || maxTokens < 100 || maxTokens > 2000) {
        showAdminToast('生成温度应为0～1，输出长度应为100～2000的整数'); return;
      }

      button.disabled = true;
      try {
        window.Store.setApiOverrides({ model: model, temperature: temp, maxTokens: maxTokens });
        window.Store.setWorkflowConfig({ systemPrompt: sysPrompt });
        var saved = await window.Store.flushPending();
        if (!saved && !(window.Store.isContentSaved('apiConfig') && window.Store.isContentSaved('workflowConfig'))) { showAdminToast('尚未上传：' + window.Store.getSyncStatus().message); return; }
        if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
        showAdminToast('配置已保存');
      } catch (error) { showAdminToast(error.message); }
      finally { button.disabled = false; }
    });
  }

  /* ==================== 6. 邀请令牌权限管理 (仅超级管理员) ==================== */
  function renderToken(body) {
    var tokens = window.Store.getInviteTokens();
    var auditLogs = window.Store.getAuditLogs();
    var lockedClients = window.Store.getLockedClients ? window.Store.getLockedClients() : [];

    body.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">🔑 管理员邀请令牌签发与治理</div>' +
      '  <div class="admin-hint">为录入人员生成邀请码，可暂停、撤销或查看其修改记录。</div>' +
      '  <div class="admin-form-row" style="margin-top:10px">' +
      '    <div style="flex:2">' +
      '      <label class="admin-label">使用人单位 / 备注 *</label>' +
      '      <input type="text" id="tokName" class="admin-input" placeholder="例如：龙南市文化馆-陈老师">' +
      '    </div>' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">有效期</label>' +
      '      <select id="tokDays" class="admin-input">' +
      '        <option value="7">7 天有效</option>' +
      '        <option value="30" selected>30 天有效</option>' +
      '        <option value="90">90 天有效</option>' +
      '        <option value="0">长期有效</option>' +
      '      </select>' +
      '    </div>' +
      '  </div>' +
      '  <button class="admin-btn admin-btn-primary" id="tokGenBtn" style="margin-top:10px">＋ 签发新邀请令牌</button>' +
      '  <div id="tokNewDisplay" class="admin-token-display" style="display:none"></div>' +
      '</div>' +
      '<div class="admin-section-subtitle" style="margin-top:16px">已签发的管理员令牌与监控列表 (' + tokens.length + ')</div>' +
      '<div class="admin-token-list" id="tokenList"></div>' +
      '<div id="inspectContainer" style="display:none"></div>' +
      '<div class="admin-audit-box" style="margin-top:16px;">' +
      '  <div class="admin-audit-header">' +
      '    <div class="admin-audit-title">🛡️ 登录安全防御与客户端锁定监控 (' + lockedClients.length + ')</div>' +
      '    <div style="display:flex;gap:6px">' +
      '      <button class="admin-btn-sm" id="refreshLocksBtn">🔄 刷新监控</button>' +
      '      <button class="admin-btn-sm admin-btn-del" id="unlockAllClientsBtn">🔓 全部解除</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="admin-hint" style="margin:6px 12px 10px;">当任何设备连续输错密码或令牌达到 5 次，系统将自动封锁其登录以防暴力破解。超级管理员可在此查看客户端 IP、终端类型、尝试次数并随时手动解封。</div>' +
      '  <div class="admin-token-list" id="lockList" style="padding:0 12px 12px;">' +
      (lockedClients.length ? lockedClients.map(function (l) {
        var isLocked = (l.status === 'locked' && (!l.lockedUntil || Date.now() < l.lockedUntil));
        var leftSec = (l.lockedUntil && Date.now() < l.lockedUntil) ? Math.ceil((l.lockedUntil - Date.now()) / 1000) : 0;
        var statusBadge = isLocked
          ? '<span class="admin-token-badge expired">🚨 锁定中（剩 ' + leftSec + ' 秒）</span>'
          : '<span class="admin-token-badge active">✅ 正常 / 已解除</span>';
        var actionBtn = isLocked
          ? '<button class="admin-btn-sm admin-btn-resume" data-unlock-client="' + esc(l.id) + '" data-ip="' + esc(l.ip) + '" data-cid="' + esc(l.clientId || '') + '">🔓 手动解除锁定</button>'
          : '<span style="font-size:12px;color:var(--text-muted, #8c8275);padding:4px 8px;">已恢复访问</span>';

        return '<div class="admin-token-card ' + (isLocked ? 'expired' : 'active') + '">' +
          '<div class="admin-token-card-top">' +
          '  <span class="admin-token-code" style="font-size:13px;font-family:monospace;">🌐 IP: ' + esc(l.ip) + '</span>' +
          '  ' + statusBadge +
          '</div>' +
          '<div class="admin-token-user">💻 终端设备：' + esc(l.device || '未知设备') + ' · 地理网络：' + esc(l.geo || '未知') + '</div>' +
          '<div class="admin-token-dates">连续输错：<strong>' + (l.attempts || 5) + ' 次</strong> · 拦截时间：' + (l.lockedAt ? new Date(l.lockedAt).toLocaleTimeString() : '刚刚') + '</div>' +
          '<div class="admin-token-actions" style="margin-top:8px;">' +
          '  ' + actionBtn +
          '</div>' +
          '</div>';
      }).join('') : '<div class="admin-empty-sm">当前无被封锁的客户端设备，系统运行安全</div>') +
      '  </div>' +
      '</div>' +
      '<div class="admin-audit-box" style="margin-top:16px;">' +
      '  <div class="admin-audit-header">' +
      '    <div class="admin-audit-title">📊 令牌活动与安全审计流水 (' + auditLogs.length + ')</div>' +
      '    <div style="display:flex;gap:4px">' +
      '      <button class="admin-btn-sm" id="refreshAuditBtn">🔄 刷新流水</button>' +
      '      <button class="admin-btn-sm admin-btn-del" id="clearAuditBtn">🧹 清空日志</button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="admin-audit-list" id="auditList">' +
      (auditLogs.length ? auditLogs.map(function (log) {
        var d = new Date(log.time);
        var timeStr = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
        return '<div class="admin-audit-item">' +
          '<span class="admin-audit-time">' + timeStr + '</span>' +
          '<span class="admin-audit-actor" title="' + esc(log.actor) + '">' + esc(log.actor) + '</span>' +
          '<span class="admin-audit-action">' + esc(log.action) + '</span>' +
          '<span class="admin-audit-detail">' + esc(log.detail) + '</span>' +
          '</div>';
      }).join('') : '<div class="admin-empty-sm">暂无审计流水记录</div>') +
      '  </div>' +
      '</div>';

    var list = $('#tokenList');
    if (!tokens.length) {
      list.innerHTML = '<div class="admin-empty-sm">暂未签发邀请令牌，请在上方签发</div>';
    } else {
      list.innerHTML = tokens.map(function (t) {
        var statusCls = t.statusCode;
        var activeText = t.lastActiveAt ? new Date(t.lastActiveAt).toLocaleString() : '尚未登录';
        var clientText = t.lastClient || '无记录';

        return '<div class="admin-token-card ' + statusCls + '">' +
          '<div class="admin-token-card-top">' +
          '  <span class="admin-token-code">' + esc(t.token) + '</span>' +
          '  <span class="admin-token-badge ' + statusCls + '">' + t.statusText + '</span>' +
          '</div>' +
          '<div class="admin-token-user">受邀人员：' + esc(t.name) + '</div>' +
          '<div class="admin-token-dates">签发时间：' + new Date(t.createdAt).toLocaleDateString() + ' · 到期：' + (t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : '长期') + '</div>' +
          '<div class="admin-token-stats-row">' +
          '  <div class="admin-token-stat-item">📱 登录：<strong>' + t.loginCount + ' 次</strong></div>' +
          '  <div class="admin-token-stat-item">🕒 活跃：' + activeText + '</div>' +
          '  <div class="admin-token-stat-item">💻 终端：' + clientText + '</div>' +
          '  <div class="admin-token-stat-item">📊 录入：<strong>知识 ' + t.kbCount + ' · 科普 ' + t.kepuCount + ' · 方言 ' + t.dialectCount + '</strong></div>' +
          '</div>' +
          '<div class="admin-token-actions">' +
          '  <button class="admin-btn-sm admin-btn-copy" data-copy-token="' + esc(t.token) + '">📋 复制长密钥</button>' +
          '  <button class="admin-btn-sm admin-btn-copy" data-copy-link="' + esc(t.token) + '">🔗 专属链接</button>' +
          '  <button class="admin-btn-sm admin-btn-test" data-qr-token="' + esc(t.token) + '" data-name="' + esc(t.name) + '">📱 手机扫码</button>' +
          (t.isPaused
            ? '  <button class="admin-btn-sm admin-btn-resume" data-resume-token="' + esc(t.id) + '">▶ 恢复授权</button>'
            : (!t.isRevoked ? '  <button class="admin-btn-sm admin-btn-pause" data-pause-token="' + esc(t.id) + '">⏸ 暂停授权</button>' : '')) +
          (t.totalContributions > 0
            ? '  <button class="admin-btn-sm admin-btn-inspect" data-inspect-token="' + esc(t.id) + '">🔍 审查详细改动 (' + t.totalContributions + ')</button>' +
              '  <button class="admin-btn-sm admin-btn-rollback" data-rollback-token="' + esc(t.id) + '" data-name="' + esc(t.name) + '" data-count="' + t.totalContributions + '">↩️ 撤销全部修改</button>'
            : '') +
          (!t.isRevoked ? '  <button class="admin-btn-sm admin-btn-del" data-revoke-token="' + esc(t.id) + '">🔥 销毁令牌</button>' : '') +
          '  <button class="admin-btn-sm admin-btn-del" data-del-token="' + esc(t.id) + '">🗑 删除记录</button>' +
          '</div>' +
          '</div>';
      }).join('');

      list.querySelectorAll('[data-copy-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var code = btn.getAttribute('data-copy-token');
          navigator.clipboard ? navigator.clipboard.writeText(code) : prompt('请复制令牌：', code);
          alert('已复制令牌：' + code);
        });
      });

      list.querySelectorAll('[data-copy-link]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var token = btn.getAttribute('data-copy-link');
          var isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname);
          var url = isLocal
            ? ('https://codex.longnankejia-dev.pages.dev/#admin-token=' + encodeURIComponent(token))
            : (window.location.origin + window.location.pathname + '#admin-token=' + encodeURIComponent(token));
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(function () {
              alert('专属免密邀请链接已复制到剪贴板！\n链接已自动适配公网访问，发送给受邀老师打开即可直接进入工作台。');
            });
          } else {
            prompt('请复制专属链接：', url);
          }
        });
      });

      list.querySelectorAll('[data-qr-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var token = btn.getAttribute('data-qr-token');
          var name = btn.getAttribute('data-name');
          var isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname);
          var url = isLocal
            ? ('https://codex.longnankejia-dev.pages.dev/#admin-token=' + encodeURIComponent(token))
            : (window.location.origin + window.location.pathname + '#admin-token=' + encodeURIComponent(token));
          showTokenQrModal(name, token, url);
        });
      });

      list.querySelectorAll('[data-inspect-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-inspect-token');
          showInspectBox(id);
        });
      });

      list.querySelectorAll('[data-pause-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-pause-token');
          if (confirm('确定暂停该令牌授权？暂停期间对方将暂时无法登录。')) {
            adminAction(async function () { await window.Store.pauseInviteToken(id); renderTab(); });
          }
        });
      });

      list.querySelectorAll('[data-resume-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-resume-token');
          adminAction(async function () { await window.Store.resumeInviteToken(id); renderTab(); });
        });
      });

      list.querySelectorAll('[data-rollback-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-rollback-token');
          var name = btn.getAttribute('data-name');
          var count = btn.getAttribute('data-count');
          if (confirm('确定撤销受邀人员「' + name + '」录入的全部修改？\n将清除其录入的全部 ' + count + ' 项录入及可追溯的编辑/删除；他人的后续修改会保留。历史版本上线前的编辑无法自动还原。')) {
            adminAction(async function () {
              var res = await window.Store.rollbackTokenChanges(id);
              refreshFrontEnd();
              alert('已撤回 ' + res.totalRemoved + ' 项修改。' + (res.skipped ? '另有 ' + res.skipped + ' 项包含他人的后续修改，已保留，请人工核对。' : ''));
              renderTab();
            });
          }
        });
      });

      list.querySelectorAll('[data-revoke-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-revoke-token');
          if (confirm('确定销毁该管理员令牌？销毁后对方将永久无法登录。')) {
            adminAction(async function () { await window.Store.revokeInviteToken(id); renderTab(); });
          }
        });
      });

      list.querySelectorAll('[data-del-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-del-token');
          if (confirm('确定彻底删除该令牌记录？')) {
            adminAction(async function () { await window.Store.deleteInviteToken(id); renderTab(); });
          }
        });
      });
    }

    function showInspectBox(tokenId, cursor) { return adminAction(async function () {
      var box = $('#inspectContainer');
      if (!box) return;
      var detailed = await window.Store.loadTokenContributions(tokenId, cursor);
      if (!box.isConnected) return;
      if (!detailed.items.length) {
        box.style.display = 'none';
        alert('该令牌暂无可审查的修改条目');
        return;
      }
      box.style.display = 'block';
      box.innerHTML =
        '<div class="admin-inspect-box">' +
        '  <div class="admin-inspect-head">' +
        '    <div class="admin-inspect-title">📋 审查【' + esc(detailed.token.name) + '】提交的内容明细 (' + detailed.items.length + ' 条)</div>' +
        '    <button class="admin-btn-sm" id="closeInspectBtn">✕ 收起明细</button>' +
        '  </div>' +
        '  <div class="admin-hint" style="margin-bottom:8px">每页最多50条。撤回时会保留他人的后续修改，并通知录入者。</div>' +
        (detailed.cursor || cursor ? '<div class="admin-toolbar-row"><button class="admin-btn-sm" id="inspectFirst">返回第一页</button><button class="admin-btn-sm" id="inspectNext"' + (!detailed.cursor ? ' disabled' : '') + '>下一页</button></div>' : '') +
        '  <div class="admin-inspect-list">' +
        detailed.items.map(function (item) {
          var timeStr = item.createdAt ? new Date(item.createdAt).toLocaleString() : '最近';
          return '<div class="admin-inspect-item">' +
            '<div class="admin-inspect-main">' +
            '  <div><span class="admin-inspect-badge">' + item.typeBadge + '</span><span class="admin-inspect-item-title">' + esc(item.title) + '</span></div>' +
            '  <div class="admin-inspect-preview">' + esc(item.preview) + '</div>' +
            '  <div class="admin-inspect-date">提交时间：' + timeStr + '</div>' +
            '</div>' +
            '<div class="admin-inspect-actions">' +
            '  <button class="admin-btn-reject" data-reject-id="' + esc(item.id) + '" data-reject-type="' + item.type + '" data-reject-title="' + esc(item.title) + '">🗑 剔除此项</button>' +
            '</div>' +
            '</div>';
        }).join('') +
        '  </div>' +
        '</div>';

      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      $('#closeInspectBtn').addEventListener('click', function () {
        box.style.display = 'none';
      });
      if ($('#inspectFirst')) $('#inspectFirst').addEventListener('click', function () { showInspectBox(tokenId); });
      if ($('#inspectNext')) $('#inspectNext').addEventListener('click', function () { showInspectBox(tokenId, detailed.cursor); });

      box.querySelectorAll('[data-reject-id]').forEach(function (rBtn) {
        rBtn.addEventListener('click', function () {
          var itemId = rBtn.getAttribute('data-reject-id');
          var itemType = rBtn.getAttribute('data-reject-type');
          var itemTitle = rBtn.getAttribute('data-reject-title');
          var reason = prompt('确定剔除修改项「' + itemTitle + '」？\n请输入驳回原因（此消息将发送给该管理员）：', '内容考据不严谨，需核对后录入');
          if (reason !== null && reason.trim()) {
            adminAction(async function () {
            var res = await window.Store.rejectTokenItem(tokenId, itemId, itemType, reason.trim());
            if (res.ok) {
              refreshFrontEnd();
              alert(res.totalRemoved ? '已撤回「' + itemTitle + '」，并发送审核反馈。' : '该项包含后续修改，已保留当前版本，请人工核对。');
              renderTab();
              showInspectBox(tokenId);
            } else {
              alert('剔除失败：' + (res.error || '未找到该项'));
            }
            });
          }
        });
      });
    }); }

    $('#refreshAuditBtn').addEventListener('click', function () {
      renderTab();
    });

    $('#clearAuditBtn').addEventListener('click', function () {
      if (confirm('确定清空所有操作审计日志？')) {
        adminAction(async function () { await window.Store.clearAuditLogs(); renderTab(); });
      }
    });

    $('#tokGenBtn').addEventListener('click', function () { adminAction(async function () {
      var name = $('#tokName').value.trim();
      var days = Number($('#tokDays').value);
      if (!name) { alert('请输入受邀人员姓名或单位备注'); return; }
      var created = await window.Store.generateInviteToken(name, days);
      var disp = $('#tokNewDisplay');
      disp.style.display = 'block';
      disp.innerHTML =
        '<div class="admin-token-success-title">🎉 令牌签发成功！请将以下专属邀请令牌发给对方：</div>' +
        '<div class="admin-token-key-row">' +
        '  <input type="text" readonly value="' + created.token + '" class="admin-input token-highlight" id="newTokBox">' +
        '  <button class="admin-btn admin-btn-primary" id="copyNewTokBtn">复制</button>' +
        '</div>';
      $('#copyNewTokBtn').addEventListener('click', function () {
        var box = $('#newTokBox');
        box.select();
        navigator.clipboard ? navigator.clipboard.writeText(box.value) : prompt('请复制：', box.value);
        alert('已复制专属邀请令牌！');
      });
      $('#tokName').value = '';
      renderTab();
    }); });

    body.querySelectorAll('[data-unlock-client]').forEach(function (button) {
      button.addEventListener('click', function () { adminAction(async function () {
        await window.Store.unlockClient(button.getAttribute('data-unlock-client'));
        showAdminToast('已解除该设备的登录锁定'); renderTab();
      }); });
    });
    var unlockAllBtn = $('#unlockAllClientsBtn');
    if (unlockAllBtn) unlockAllBtn.addEventListener('click', function () {
      if (confirm('确定解除所有设备的登录锁定？')) adminAction(async function () {
        await window.Store.unlockAllClients(); showAdminToast('已解除全部登录锁定'); renderTab();
      });
    });

    var refreshLocksBtn = $('#refreshLocksBtn');
    if (refreshLocksBtn) {
      refreshLocksBtn.addEventListener('click', function () {
        refreshLocksBtn.disabled = true;
        refreshLocksBtn.textContent = '⏳ 正在刷新...';
        if (window.Store && window.Store.syncWithCloud) {
          window.Store.syncWithCloud(function (data) {
            refreshLocksBtn.disabled = false;
            refreshLocksBtn.textContent = '🔄 刷新监控';
            if (!data) { showAdminToast(window.Store.getSyncStatus().message); return; }
            var list = (data && data.lockouts) || (window.Store.getLockedClients ? window.Store.getLockedClients() : []);
            var lockedCount = list.filter(function (l) { return l.status === 'locked' && (!l.lockedUntil || Date.now() < l.lockedUntil); }).length;
            showAdminToast('已同步最新监控：共 ' + list.length + ' 台设备记录（' + lockedCount + ' 台锁定中）');
            renderTab();
          });
        } else {
          refreshLocksBtn.disabled = false;
          refreshLocksBtn.textContent = '🔄 刷新监控';
          showAdminToast('已刷新本地防御监控记录');
          renderTab();
        }
      });
    }
  }

  /* ==================== 7. 系统与全站资产包备份 ==================== */
  function renderSys(body) {
    var isSuper = currentUser && currentUser.role === 'super_admin';
    var history = isSuper ? window.Store.getRecoveryHistory() : [];
    body.innerHTML =
      (isSuper ?
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">修改超级管理员主密码</div>' +
      '  <input type="password" id="newPw1" class="admin-input" placeholder="新密码">' +
      '  <input type="password" id="newPw2" class="admin-input" placeholder="确认新密码" style="margin-top:6px">' +
      '  <button class="admin-btn admin-btn-primary" id="pwSaveBtn" style="margin-top:8px">修改主密码</button>' +
      '</div>' : '') +

      '<div class="admin-form-box" style="margin-top:12px">' +
      '  <div class="admin-form-title">备份与恢复</div>' +
      '  <div class="admin-hint">导出知识、科普、方言和问答设置，供备份或恢复。</div>' +
      '  <div class="admin-form-row" style="margin-top:8px">' +
      '    <button class="admin-btn admin-btn-primary" id="exportBundleBtn">📥 导出备份 (JSON)</button>' +
      '    <button class="admin-btn" id="importBundleBtn">📤 导入备份</button>' +
      '    <input type="file" id="bundleFileInput" accept=".json" style="display:none">' +
      '  </div>' +
      '  <div class="admin-form-row" style="margin-top:8px">' +
      '    <button class="admin-btn-sm" id="exportBtn">仅导出知识库</button>' +
      '    <button class="admin-btn-sm" id="importBtn">仅导入知识库</button>' +
      '    <input type="file" id="importFile" accept=".json" style="display:none">' +
      '  </div>' +
      '</div>' +

      (isSuper ? '<div class="admin-form-box" style="margin-top:12px"><div class="admin-form-title">云端历史</div>' +
        '<div class="admin-hint">可恢复有前值的修改和删除；后续已有修改时不会覆盖。</div>' +
        (history.length ? history.slice(0, 20).map(function (op) {
          return '<div class="admin-form-row" style="margin-top:6px"><span style="flex:1">' + esc(op.title) + ' · ' + esc(op.kind) + '</span><button class="admin-btn-sm" data-restore-operation="' + esc(op.id) + '">恢复</button></div>';
        }).join('') : '<div class="admin-hint">暂无可恢复的历史记录</div>') + '</div>' : '') +

      (isSuper ? '<div class="admin-form-box" style="margin-top:12px"><div class="admin-form-title">存储空间</div>' +
        '<div class="admin-hint">图片独立保存。单张图片、正文快照和服务器套餐仍有容量保护。</div><p id="storageInfoText"></p>' +
        '<button class="admin-btn-sm" id="storageInfoBtn">查看容量</button> <button class="admin-btn-sm" id="optimizeImagesBtn">整理旧图片</button> <button class="admin-btn-sm" id="archiveHistoryBtn">归档30天前历史</button></div>' : '') +

      (isSuper ?
      '<div class="admin-form-box" style="margin-top:12px">' +
      '  <div class="admin-form-title">系统重置</div>' +
      '  <div class="admin-hint">清除所有自定义修改，恢复内置初始状态。</div>' +
      '  <button class="admin-btn admin-btn-danger" id="resetKBBtn" style="margin-top:8px">重置知识库</button>' +
      '  <button class="admin-btn admin-btn-danger" id="resetApiBtn" style="margin-top:8px;margin-left:6px">重置 AI 设置</button>' +
      '</div>' : '') +

      '<div style="text-align:center;margin-top:16px">' +
      '  <button class="admin-btn admin-btn-del" id="adminLogoutBtn">退出登录</button>' +
      '</div>';

    if (isSuper && $('#pwSaveBtn')) {
      $('#pwSaveBtn').addEventListener('click', function () {
        var p1 = $('#newPw1').value;
        var p2 = $('#newPw2').value;
        if (!p1 || p1.length < 8) { alert('密码至少 8 位'); return; }
        if (p1 !== p2) { alert('两次密码不一致'); return; }
        adminAction(async function () {
          await window.Store.setAdminPassword(p1);
          $('#newPw1').value = ''; $('#newPw2').value = '';
          alert('主密码已在云端修改，其他设备请使用新密码重新登录。');
        });
      });
    }

    $('#exportBundleBtn').addEventListener('click', function () { downloadBackup('longnan-heritage-bundle-' + new Date().toISOString().slice(0, 10) + '.json'); });
    if (isSuper) {
      $('#storageInfoBtn').addEventListener('click', function () { adminAction(async function () {
        var info = await window.Store.getStorageInfo(), mb = function (bytes) { return (bytes / 1048576).toFixed(1); };
        if (info.separateImageDatabase) {
          document.getElementById('storageInfoText').textContent = '正文和历史 ' + mb(info.metadataBytes) + ' MB；独立图片库 ' + mb(info.imageDatabaseBytes) + ' MB；原库旧图片 ' + mb(info.legacyImageBytes) + ' MB。';
          return;
        }
        if (info.model === "records-v1") {
          document.getElementById("storageInfoText").textContent = "逐条存储：正文及历史 " + mb(info.metadataBytes) + " MB；数据库旧图片 " + mb(info.mediaBytes) + " MB；媒体存储" + (info.r2Enabled ? "已接入 R2" : "尚未接入 R2") + "。";
          return;
        }
        $('#storageInfoText').textContent = '独立图片 ' + mb(info.mediaBytes) + ' MB；正文、历史及旧版图片 ' + mb(info.metadataBytes) + ' / ' + mb(info.metadataLimit) + ' MB。';
      }); });
      $('#optimizeImagesBtn').addEventListener('click', function () { var button = this; button.disabled = true;
        adminAction(async function () { try { var result = await window.Store.optimizeImageStorage(); showAdminToast('已整理 ' + result.completed + ' 张旧图片' + (result.copied ? '，迁入媒体存储 ' + result.copied + ' 张' : '')); renderTab(); } finally { button.disabled = false; } });
      });
      $('#archiveHistoryBtn').addEventListener('click', function () { var button = this; button.disabled = true;
        adminAction(async function () { try { var result = await window.Store.archiveHistory(); showAdminToast('本批已归档 ' + result.archived + ' 项，历史仍可恢复'); } finally { button.disabled = false; } });
      });
    }
    body.querySelectorAll('[data-restore-operation]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (!confirm('恢复这项修改之前的版本？已有后续修改时将停止恢复。')) return;
        adminAction(async function () { await window.Store.restoreOperation(button.dataset.restoreOperation); showAdminToast('已恢复'); renderTab(); });
      });
    });

    $('#importBundleBtn').addEventListener('click', function () {
      $('#bundleFileInput').click();
    });
    $('#bundleFileInput').addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        try { await window.Store.prepareExport(); } catch (error) { showAdminToast(error.message); return; }
        if (window.Store.importFullBundle(reader.result)) {
          var saved = await window.Store.flushPending();
          alert(saved ? '备份已恢复并上传。' : '已导入本机，尚未上传成功：' + window.Store.getSyncStatus().message);
          refreshFrontEnd();
          renderTab();
        } else {
          alert('资产包导入失败：格式不正确');
        }
      };
      reader.readAsText(file);
    });

    $('#exportBtn').addEventListener('click', function () { adminAction(async function () {
      await window.Store.prepareExport(['kbCustom', 'kbEdited', 'kbDeleted']);
      var json = window.Store.exportKB();
      downloadJson(json, 'heritage-kb-' + new Date().toISOString().slice(0, 10) + '.json');
    }); });

    $('#importBtn').addEventListener('click', function () {
      $('#importFile').click();
    });
    $('#importFile').addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        try { await window.Store.prepareExport(['kbCustom', 'kbEdited', 'kbDeleted']); } catch (error) { showAdminToast(error.message); return; }
        if (window.Store.importKB(reader.result)) {
          var saved = await window.Store.flushPending();
          alert(saved ? '已上传云端，共 ' + window.Store.getEntries().length + ' 条知识。' : '已导入本机，尚未上传成功：' + window.Store.getSyncStatus().message);
          if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
        } else {
          alert('导入失败：JSON 格式不正确');
        }
      };
      reader.readAsText(file);
    });

    if (isSuper && $('#resetKBBtn')) {
      $('#resetKBBtn').addEventListener('click', async function () {
        if (confirm('确定重置知识库？所有自定义内容将丢失。')) {
          var button = this; button.disabled = true;
          try {
            await window.Store.resetKB();
            if (!(await window.Store.flushPending())) { showAdminToast('重置尚未上传：' + window.Store.getSyncStatus().message); return; }
            if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
            showAdminToast('知识库已重置');
          } catch (error) { showAdminToast(error.message); }
          finally { button.disabled = false; }
        }
      });
    }

    if (isSuper && $('#resetApiBtn')) {
      $('#resetApiBtn').addEventListener('click', async function () {
        if (confirm('确定重置 AI 设置？')) {
          var button = this; button.disabled = true;
          try {
            window.Store.resetApi();
            var saved = await window.Store.flushPending();
            if (!saved && !(window.Store.isContentSaved('apiConfig') && window.Store.isContentSaved('workflowConfig'))) { showAdminToast('重置尚未上传：' + window.Store.getSyncStatus().message); return; }
            if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
            showAdminToast('AI 设置已重置');
          } catch (error) { showAdminToast(error.message); }
          finally { button.disabled = false; }
        }
      });
    }

    $('#adminLogoutBtn').addEventListener('click', doLogout);
  }

  function downloadJson(content, filename) {
    var blob = new Blob([content], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.hidden = true; document.body.appendChild(a);
    a.click();
    a.remove();
    // The browser may start reading the object URL after the click handler returns.
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function showTokenQrModal(name, token, url) {
    var oldModal = document.getElementById('tokenQrModal');
    if (oldModal) oldModal.remove();

    var isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname);
    if (!url) {
      url = isLocal
        ? ('https://codex.longnankejia-dev.pages.dev/#admin-token=' + encodeURIComponent(token))
        : (window.location.origin + window.location.pathname + '#admin-token=' + encodeURIComponent(token));
    }

    var div = document.createElement('div');
    div.id = 'tokenQrModal';
    div.className = 'admin-modal-mask';
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
    div.innerHTML =
      '<div style="background:var(--card,#FFFFFF);border-radius:8px;max-width:340px;width:100%;text-align:center;padding:20px;border:1px solid var(--line,#D8D0C5);box-shadow:0 8px 30px rgba(0,0,0,0.25)">' +
      '  <div style="font-size:16px;font-weight:700;color:var(--primary-deep,#2F5D50);margin-bottom:4px">📱 手机扫码直达工作台</div>' +
      '  <div style="font-size:12px;color:var(--muted,#7A8B82);margin-bottom:10px">受邀人员：' + esc(name) + '</div>' +
      '  <div id="tokenQrCanvasBox" style="display:flex;justify-content:center;align-items:center;margin:8px 0;min-height:180px"></div>' +
      '  <div style="font-size:11px;color:var(--ink-soft,#3E4D44);line-height:1.5;margin-bottom:14px">' +
      '    受邀老师使用手机微信或相机扫码，即可免密登录并开通工作台权限。' +
      '  </div>' +
      '  <div style="display:flex;gap:6px;justify-content:center">' +
      '    <button class="admin-btn admin-btn-primary" id="tokenQrCloseBtn">关 闭</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(div);
    var box = div.querySelector('#tokenQrCanvasBox');
    if (window.QR && box) {
      var canvas = document.createElement('canvas');
      canvas.style.maxWidth = '180px';
      canvas.style.maxHeight = '180px';
      canvas.style.borderRadius = '6px';
      canvas.style.border = '1px solid var(--line,#D8D0C5)';
      box.appendChild(canvas);
      window.QR.render(url, canvas, 3);
    } else if (box) {
      box.innerHTML = '<div style="font-size:11px;color:var(--muted)">二维码生成器未就绪，请使用复制专属链接</div>';
    }

    div.querySelector('#tokenQrCloseBtn').addEventListener('click', function () { div.remove(); });
    div.addEventListener('click', function (e) { if (e.target === div) div.remove(); });
  }



  /* ---------- 打开 / 关闭 ---------- */
  function open() {
    var mask = $('#adminMask');
    mask.hidden = false;
    if (!window.Store.isReady()) {
      $('#adminPanel').innerHTML = '<div class="admin-login">正在读取已保存的内容与草稿…</div>';
      window.Store.ready.then(function () { if (!mask.hidden) open(); });
      return;
    }
    var saved = window.Store.getSession();
    authenticated = !!saved;
    currentUser = saved;

    if (authenticated) {
      showMain();
    } else {
      showLogin();
    }
  }

  function close() {
    $('#adminMask').hidden = true;
    refreshFrontEnd();
  }

  function init() {
    try {
      var saved = window.Store && window.Store.getSession ? window.Store.getSession() : null;
      if (saved) {
        authenticated = true;
        currentUser = saved;
      }
    } catch (_) {}

    // Invitation links are checked by the server; legacy URL flags never grant a role.
    var hash = window.location.hash || '';
    var url = new URL(window.location.href);
    var match = hash.match(/(?:^#|[?&])admin-token=([^&]+)/);
    var invite = url.searchParams.get('admin-token');
    if (match) { try { invite = decodeURIComponent(match[1]); } catch (_) { invite = ''; } }
    ['admin-auth', 'key', 'sync', 'admin-token'].forEach(function (key) {
      url.searchParams.delete(key);
      hash = hash.replace(new RegExp('([#?&])' + key + '=[^&]*', 'g'), '$1').replace(/[?&]+$/, '');
    });
    window.history.replaceState(null, '', url.pathname + url.search + (hash === '#' ? '' : hash));
    if (invite) window.Store.verifyLogin(invite).then(async function (result) {
      if (result.ok) {
        window.Store.saveSession(result); currentUser = result; authenticated = true;
        await window.Store.syncWithCloud(); open();
      } else { open(); showLogin(result.error); }
    });
    window.addEventListener('admin-sync-status', function () {
      if (authenticated && !window.Store.getSession()) showLogin('登录已失效，请重新登录。');
      showSyncStatus();
      refreshAdminIfIdle();
    });

    var entry = document.getElementById('adminEntry');
    if (entry) {
      entry.addEventListener('click', open);
    }
    var mask = document.getElementById('adminMask');
    if (mask) {
      mask.addEventListener('click', function (e) {
        if (e.target === mask) close();
      });
    }
  }

  window.Admin = {
    init: init,
    open: open,
    close: close,
    refreshCurrentView: function () {
      refreshFrontEnd();
      refreshAdminIfIdle();
    }
  };
})();
