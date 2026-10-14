/**
 * 龙南客家非遗数智管理工作台 (Admin Console Pro)
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
  var LOCK_STORAGE_KEY = 'nfyj_login_lock_state';

  function getLoginLockState() {
    try {
      var raw = localStorage.getItem(LOCK_STORAGE_KEY);
      if (!raw) return { count: 0, until: 0 };
      var parsed = JSON.parse(raw);
      return {
        count: Number(parsed.count) || 0,
        until: Number(parsed.until) || 0
      };
    } catch (_) {
      return { count: 0, until: 0 };
    }
  }

  function setLoginLockState(count, until, lockedAt) {
    try {
      localStorage.setItem(LOCK_STORAGE_KEY, JSON.stringify({
        count: count,
        until: until,
        lockedAt: lockedAt || (until ? Date.now() : 0)
      }));
    } catch (_) {}
  }

  function clearLoginLockState() {
    try {
      localStorage.removeItem(LOCK_STORAGE_KEY);
      if (window.Store && window.Store.consumeClientUnlock) {
        window.Store.consumeClientUnlock();
      }
    } catch (_) {}
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

  function showLogin() {
    var panel = $('#adminPanel');
    panel.innerHTML =
      '<div class="admin-login">' +
      '  <div class="admin-login-icon">🔐</div>' +
      '  <div class="admin-login-title">数智管理工作台</div>' +
      '  <div class="admin-login-hint">请输入超级管理员密码或邀请令牌</div>' +
      '  <form class="admin-login-form" id="adminLoginForm" onsubmit="return false;">' +
      '    <div class="admin-pw-wrap">' +
      '      <input type="password" id="adminPwInput" placeholder="请输入密码或邀请码" autocomplete="off">' +
      '      <button type="button" id="adminPwToggle" class="admin-pw-toggle" title="显示明文">👁️</button>' +
      '    </div>' +
      '    <div class="admin-login-error" id="adminPwError"></div>' +
      '    <button type="submit" class="admin-login-btn" id="adminLoginBtn">登 录</button>' +
      '    <button type="button" class="admin-login-cancel" id="adminCancelBtn">返回用户页面</button>' +
      '  </form>' +
      '</div>';

    var input = $('#adminPwInput');
    var btn = $('#adminLoginBtn');
    var err = $('#adminPwError');
    var toggleBtn = $('#adminPwToggle');
    var form = $('#adminLoginForm');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (input.type === 'password') {
          input.type = 'text';
          toggleBtn.textContent = '🙈';
          toggleBtn.title = '隐藏明文';
        } else {
          input.type = 'password';
          toggleBtn.textContent = '👁️';
          toggleBtn.title = '显示明文';
        }
      });
    }

    var lockTimer = null;

    var lastCloudSync = 0;

    function checkLockStatus() {
      var state = getLoginLockState();
      var now = Date.now();
      var isLocked = !!(state.until && now < state.until);

      if (isLocked) {
        if (window.Store && window.Store.isClientUnlocked && window.Store.isClientUnlocked()) {
          clearLoginLockState();
          if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
          input.disabled = false;
          btn.disabled = false;
          btn.style.opacity = '';
          err.className = 'admin-login-error';
          err.textContent = '✅ 管理员已手动解除锁定，请重新输入口令';
          return false;
        }

        var remainSec = Math.ceil((state.until - now) / 1000);
        input.disabled = true;
        btn.disabled = true;
        btn.style.opacity = '0.5';
        err.className = 'admin-login-error admin-lock-countdown';
        err.textContent = '⚠️ 连续输错超限，系统已锁定保护。请等待 ' + remainSec + ' 秒后再试（刷新页面不会重置锁定）';
        if (!lockTimer) {
          lockTimer = setInterval(function () {
            var curNow = Date.now();
            if (window.Store && window.Store.syncWithCloud && curNow - lastCloudSync > 2500) {
              lastCloudSync = curNow;
              window.Store.syncWithCloud(function () {
                if (window.Store.isClientUnlocked && window.Store.isClientUnlocked()) {
                  clearInterval(lockTimer);
                  lockTimer = null;
                  clearLoginLockState();
                  input.disabled = false;
                  btn.disabled = false;
                  btn.style.opacity = '';
                  err.className = 'admin-login-error';
                  err.textContent = '✅ 管理员已手动解除锁定，请重新输入口令';
                }
              });
            }

            if (window.Store && window.Store.isClientUnlocked && window.Store.isClientUnlocked()) {
              clearInterval(lockTimer);
              lockTimer = null;
              clearLoginLockState();
              input.disabled = false;
              btn.disabled = false;
              btn.style.opacity = '';
              err.className = 'admin-login-error';
              err.textContent = '✅ 管理员已手动解除锁定，请重新输入口令';
              return;
            }
            var curState = getLoginLockState();
            if (curState.until && curNow < curState.until) {
              var left = Math.ceil((curState.until - curNow) / 1000);
              err.textContent = '⚠️ 连续输错超限，系统已锁定保护。请等待 ' + left + ' 秒后再试（刷新页面不会重置锁定）';
            } else {
              clearInterval(lockTimer);
              lockTimer = null;
              input.disabled = false;
              btn.disabled = false;
              btn.style.opacity = '';
              err.className = 'admin-login-error';
              err.textContent = '锁定已解除，请重新输入正确口令';
              setLoginLockState(0, 0);
            }
          }, 1000);
        }
        return true;
      } else {
        if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
        input.disabled = false;
        btn.disabled = false;
        btn.style.opacity = '';
        return false;
      }
    }

    checkLockStatus();

    function doLogin() {
      if (checkLockStatus()) return;
      var raw = input.value;
      var pw = raw.trim().replace(/^['"“‘]+|['"”’]+$/g, '').trim();
      var authResult = window.Store.verifyLogin(pw);
      if (authResult.ok) {
        clearLoginLockState();
        if (lockTimer) { clearInterval(lockTimer); lockTimer = null; }
        authenticated = true;
        currentUser = authResult;
        if (window.Store && window.Store.saveSession) {
          window.Store.saveSession(authResult);
        }
        showMain();
      } else {
        var state = getLoginLockState();
        var nextCount = (Number(state.count) || 0) + 1;
        if (nextCount >= 5) {
          var lockUntil = Date.now() + 60000;
          setLoginLockState(nextCount, lockUntil, Date.now());
          if (window.Store && window.Store.reportClientLock) {
            window.Store.reportClientLock(nextCount, lockUntil);
          }
          checkLockStatus();
        } else {
          setLoginLockState(nextCount, 0);
          err.className = 'admin-login-error';
          err.textContent = '密码错误或邀请令牌无效，请重试（还剩 ' + (5 - nextCount) + ' 次机会）';
        }
        input.value = '';
        input.focus();
      }
    }

    btn.addEventListener('click', doLogin);
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        doLogin();
      });
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('#adminCancelBtn').addEventListener('click', close);
    setTimeout(function () { input.focus(); }, 100);
  }

  function doLogout() {
    authenticated = false;
    currentUser = null;
    if (window.Store && window.Store.clearSession) {
      window.Store.clearSession();
    }
    showLogin();
  }

  /* ==================== 主工作台面板 ==================== */
  function showMain() {
    var panel = $('#adminPanel');
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
      '    <div class="admin-header-title">⚙️ 非遗数智管理工作台</div>' +
      '    ' + userBadge +
      '  </div>' +
      '  <div class="admin-header-right">' +
      '    <button class="admin-btn-logout" id="adminHeaderLogoutBtn" title="退出当前登录状态">🚪 退出登录</button>' +
      '    <button class="admin-close-btn" id="adminCloseBtn">✕ 关闭</button>' +
      '  </div>' +
      '</div>' +
      notifBanner +
      '<div class="admin-tabs">' +
      '  <button class="admin-tab active" data-tab="kb">📚 知识库</button>' +
      '  <button class="admin-tab" data-tab="kepu">🏮 科普管理</button>' +
      '  <button class="admin-tab" data-tab="dialect">🗣 方言管理</button>' +
      '  <button class="admin-tab" data-tab="import">📂 文档导入</button>' +
      '  <button class="admin-tab" data-tab="ai">🤖 AI工作流</button>' +
      (isSuper ? '  <button class="admin-tab" data-tab="token">🔑 邀请令牌</button>' : '') +
      '  <button class="admin-tab" data-tab="sys">🛠 系统备份</button>' +
      '</div>' +
      '<div class="admin-body" id="adminBody"></div>';

    $('#adminCloseBtn').addEventListener('click', close);
    $('#adminHeaderLogoutBtn').addEventListener('click', doLogout);

    var ackBtn = $('#ackNotifBtn');
    if (ackBtn) {
      ackBtn.addEventListener('click', function () {
        window.Store.clearTokenNotifications(currentUser.tokenId || currentUser.token);
        var bar = $('#tokenNoticeBar');
        if (bar) bar.style.display = 'none';
      });
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
  }

  function renderTab() {
    var body = $('#adminBody');
    if (!body) return;
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
    var allEntries = window.Store.getEntries();
    var customCount = allEntries.filter(function (e) {
      return (e.id && e.id.indexOf('custom-') === 0) || e.creatorTokenId || (e.creatorName && e.creatorName !== '超级管理员' && e.creatorName !== '典藏内置');
    }).length;
    var builtinCount = allEntries.length - customCount;
    var totalChars = allEntries.reduce(function (sum, e) { return sum + (e.answer ? e.answer.length : 0); }, 0);
    var charsDisplay = totalChars > 10000 ? (totalChars / 10000).toFixed(1) + '万' : totalChars;

    body.innerHTML =
      '<div class="admin-stats-bar">' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + allEntries.length + '</div><div class="admin-stat-label">知识总条目</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val" style="color:var(--primary)">' + customCount + '</div><div class="admin-stat-label">自定义录入</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + builtinCount + '</div><div class="admin-stat-label">典藏内置</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + charsDisplay + '</div><div class="admin-stat-label">知识总字数</div></div>' +
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
      '    <option value="all">来源：全部 (' + allEntries.length + ')</option>' +
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
      '    <option value="9999">查看全部</option>' +
      '  </select>' +
      '  <button class="admin-btn-sm" id="kbExportFilterBtn" title="导出当前筛选条目为JSON">导出筛选</button>' +
      '</div>' +
      '<div class="admin-filter-bar" id="kbFilterBar">' +
      '  <button class="filter-chip active" data-cat="all">全部 (' + allEntries.length + ')</button>' +
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

    function refreshKBView() {
      var q = (searchInput.value || '').toLowerCase().trim();
      if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

      var filtered = allEntries.filter(function (e) {
        var isCustom = (e.id && e.id.indexOf('custom-') === 0) || e.creatorTokenId || (e.creatorName && e.creatorName !== '超级管理员' && e.creatorName !== '典藏内置');
        if (kbCurSource === 'custom' && !isCustom) return false;
        if (kbCurSource === 'builtin' && isCustom) return false;

        var matchQ = !q || (e.title && e.title.toLowerCase().indexOf(q) !== -1) ||
                     (e.keywords && e.keywords.join(' ').toLowerCase().indexOf(q) !== -1) ||
                     (e.answer && e.answer.toLowerCase().indexOf(q) !== -1);
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

    $('#kbExportFilterBtn').addEventListener('click', function () {
      var q = (searchInput.value || '').toLowerCase().trim();
      var filtered = allEntries.filter(function (e) {
        var isCustom = (e.id && e.id.indexOf('custom-') === 0) || e.creatorTokenId;
        if (kbCurSource === 'custom' && !isCustom) return false;
        if (kbCurSource === 'builtin' && isCustom) return false;
        if (q && (e.title.toLowerCase().indexOf(q) === -1 && e.answer.toLowerCase().indexOf(q) === -1)) return false;
        return true;
      });
      downloadJson(JSON.stringify(filtered, null, 2), '龙南知识库筛选导出-' + Date.now() + '.json');
    });

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
        '<div class="admin-kb-item-preview">' + esc(e.answer.slice(0, 95)) + (e.answer.length > 95 ? '…' : '') + '</div>' +
        '<div class="admin-kb-fulltext" id="full-' + esc(e.id) + '">' + esc(e.answer) + '</div>' +
        '<div class="admin-kb-item-footer">' +
        '  <span class="admin-kb-item-meta">' + e.answer.length + ' 字' + sourceText + '</span>' +
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

      item.querySelector('[data-action="expand"]').addEventListener('click', function () {
        var drawer = item.querySelector('.admin-kb-fulltext');
        var btn = item.querySelector('[data-action="expand"]');
        if (drawer.classList.contains('open')) {
          drawer.classList.remove('open');
          btn.textContent = '展开全文';
        } else {
          drawer.classList.add('open');
          btn.textContent = '收起全文';
        }
      });

      item.querySelector('[data-action="copy"]').addEventListener('click', function () {
        var entry = window.Store.getEntries().find(function (e) { return e.id === id; });
        if (entry) {
          editingId = null;
          showKBForm({
            title: entry.title + ' (复制模板)',
            keywords: (entry.keywords || []).slice(),
            answer: entry.answer,
            sources: entry.sources ? entry.sources.slice() : []
          });
        }
      });

      item.querySelector('[data-action="edit"]').addEventListener('click', function () {
        var entry = window.Store.getEntries().find(function (e) { return e.id === id; });
        editingId = id;
        showKBForm(entry);
      });

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

  function showKBForm(entry) {
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
      '  <input type="text" id="kbKeywords" class="admin-input" value="' + esc(entry ? entry.keywords.join(', ') : '') + '" placeholder="蓝染, 染布, 靛蓝, 植物染">' +
      '  <label class="admin-label">文献出处 / 参考资料</label>' +
      '  <input type="text" id="kbSourceTitle" class="admin-input" value="' + esc(sourcesTitle) + '" placeholder="例如：《赣南客家蓝染技艺》田野调查记录">' +
      '  <label class="admin-label">阿蓝回答正文内容 *</label>' +
      '  <textarea id="kbAnswer" class="admin-textarea" rows="6" placeholder="阿蓝对该知识的权威回答内容…">' + esc(entry ? entry.answer : '') + '</textarea>' +
      '  <div class="admin-form-actions">' +
      '    <button class="admin-btn admin-btn-primary" id="kbSaveBtn">保 存</button>' +
      '    <button class="admin-btn" id="kbCancelBtn">取 消</button>' +
      '  </div>' +
      '</div>';

    $('#kbSaveBtn').addEventListener('click', function () {
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

      if (editingId) {
        window.Store.updateEntry(editingId, data, currentUser);
      } else {
        window.Store.addEntry(data, currentUser);
      }
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

  function renderKepu(body) {
    var rawCards = window.Store.getHeritageCards(window.Heritage ? window.Heritage.list() : []);
    var customCards = rawCards.filter(function (c) {
      return (c.id && c.id.indexOf('kepu-') === 0) || c.creatorTokenId || (c.creatorName && c.creatorName !== '超级管理员');
    });
    var builtinCards = rawCards.filter(function (c) { return customCards.indexOf(c) === -1; });

    var sortedCards = customCards.concat(builtinCards);

    body.innerHTML =
      '<div class="admin-stats-bar">' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + rawCards.length + '</div><div class="admin-stat-label">科普总卡片</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val" style="color:var(--primary)">' + customCards.length + '</div><div class="admin-stat-label">自定义卡片</div></div>' +
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
      '    <option value="all">来源：全部卡片 (' + rawCards.length + ')</option>' +
      '    <option value="custom">来源：仅自定义 (' + customCards.length + ')</option>' +
      '    <option value="builtin">来源：仅内置 (' + builtinCards.length + ')</option>' +
      '  </select>' +
      '  <div class="admin-toolbar-tip" style="margin-left:auto;font-size:11px;color:var(--muted)">前台【🏮 科普】面板内容，即时联动渲染</div>' +
      '</div>' +
      '<div class="admin-kb-form" id="kepuForm" style="display:none"></div>' +
      '<div class="admin-kepu-grid" id="kepuList"></div>';

    var searchInput = $('#kepuSearch');
    var clearBtn = $('#kepuSearchClear');
    var sourceSelect = $('#kepuSourceFilter');

    sourceSelect.value = kepuCurSource;

    function refreshKepuList() {
      var q = (searchInput.value || '').toLowerCase().trim();
      if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

      var filtered = sortedCards.filter(function (c) {
        var isCustom = (c.id && c.id.indexOf('kepu-') === 0) || c.creatorTokenId || (c.creatorName && c.creatorName !== '超级管理员');
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
  }

  function renderKepuItems(cards, allCards) {
    var list = $('#kepuList');
    if (!cards.length) {
      list.innerHTML = '<div class="admin-empty-sm">没有匹配的科普卡片</div>';
      return;
    }

    list.innerHTML = cards.map(function (c) {
      var isCustom = (c.id && c.id.indexOf('kepu-') === 0) || c.creatorTokenId || (c.creatorName && c.creatorName !== '超级管理员');
      var badge = isCustom
        ? '<span class="admin-badge admin-badge-custom">自定义</span>' + (c.creatorName ? '<span class="admin-creator-tag">👤 ' + esc(c.creatorName) + '</span>' : '')
        : '<span class="admin-badge admin-badge-default">内置</span>';

      return '<div class="admin-kepu-card" style="border-left: 4px solid ' + (c.accent || '#2F5D50') + '">' +
        '<div class="admin-kepu-head">' +
        '  <span class="admin-kepu-icon">' + (c.icon || '🏮') + '</span>' +
        '  <span class="admin-kepu-name">' + esc(c.name) + '</span>' + badge +
        '</div>' +
        '<div class="admin-kepu-tag">' + esc(c.tag || '') + '</div>' +
        '<div class="admin-kb-fulltext" id="preview-box-' + esc(c.id) + '">' +
        '  <div style="font-weight:600;margin-bottom:4px;color:' + (c.accent || '#2F5D50') + '">【前台游客呈现预览】</div>' +
        '  <div style="background:' + (c.bg || '#E4EFEA') + ';padding:8px;border-radius:4px;color:var(--ink)">' +
        '    <div style="font-size:12px;margin-bottom:4px">' + (c.detail || '暂无详细介绍') + '</div>' +
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

    list.querySelectorAll('[data-preview-kepu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-preview-kepu');
        var box = document.getElementById('preview-box-' + id);
        if (box) {
          if (box.classList.contains('open')) {
            box.classList.remove('open');
            btn.textContent = '游客预览';
          } else {
            box.classList.add('open');
            btn.textContent = '收起预览';
          }
        }
      });
    });

    list.querySelectorAll('[data-copy-kepu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-copy-kepu');
        var card = allCards.find(function (c) { return c.id === id; });
        if (card) {
          editingKepuId = null;
          showKepuForm({
            name: card.name + ' (复制模板)',
            icon: card.icon,
            tag: card.tag,
            accent: card.accent,
            bg: card.bg,
            detail: card.detail,
            ask: card.ask
          });
        }
      });
    });

    list.querySelectorAll('[data-edit-kepu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-edit-kepu');
        var card = allCards.find(function (c) { return c.id === id; });
        editingKepuId = id;
        showKepuForm(card);
      });
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

  function showKepuForm(card) {
    var form = $('#kepuForm');
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });

    form.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">' + (card ? (editingKepuId ? '编辑科普卡片' : '基于模板新增科普卡片') : '新增科普卡片') + '</div>' +
      '  <div class="admin-form-row">' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">卡片名称 *</label>' +
      '      <input type="text" id="kpName" class="admin-input" value="' + esc(card ? card.name : '') + '" placeholder="例如：龙南大漆">' +
      '    </div>' +
      '    <div style="width:100px">' +
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
      '  <label class="admin-label">科普详情正文 (支持HTML段落)</label>' +
      '  <textarea id="kpDetail" class="admin-textarea" rows="5" placeholder="<p>科普介绍段落…</p>">' + esc(card ? card.detail : '') + '</textarea>' +
      '  <label class="admin-label">点击向阿蓝提问的默认问题</label>' +
      '  <input type="text" id="kpAsk" class="admin-input" value="' + esc(card ? card.ask : '') + '" placeholder="例如：龙南大漆有什么特色？">' +
      '  <div class="admin-form-actions">' +
      '    <button class="admin-btn admin-btn-primary" id="kpSaveBtn">保 存</button>' +
      '    <button class="admin-btn" id="kpCancelBtn">取 消</button>' +
      '  </div>' +
      '</div>';

    $('#kpSaveBtn').addEventListener('click', function () {
      var name = $('#kpName').value.trim();
      var icon = $('#kpIcon').value.trim() || '🏮';
      var tag = $('#kpTag').value.trim() || '客家非遗';
      var accent = $('#kpAccent').value;
      var bg = $('#kpBg').value;
      var detail = $('#kpDetail').value.trim();
      var ask = $('#kpAsk').value.trim() || ('介绍一下' + name);
      if (!name) { alert('卡片名称不能为空'); return; }

      var data = { name: name, icon: icon, tag: tag, accent: accent, bg: bg, detail: detail, ask: ask };
      if (editingKepuId) {
        window.Store.updateHeritageCard(editingKepuId, data);
      } else {
        window.Store.addHeritageCard(data, currentUser);
      }
      refreshFrontEnd();
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
    var totalCount = baseTracks.length + customTracks.length;

    body.innerHTML =
      '<div class="admin-stats-bar">' +
      '  <div class="admin-stat-card"><div class="admin-stat-val">' + totalCount + '</div><div class="admin-stat-label">方言总语料</div></div>' +
      '  <div class="admin-stat-card"><div class="admin-stat-val" style="color:var(--primary)">' + customTracks.length + '</div><div class="admin-stat-label">自定义录入</div></div>' +
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
      '<div class="admin-section-subtitle">自定义语料 (' + customTracks.length + ') · 置顶管理</div>' +
      '<div class="admin-dialect-list" id="customDialectList"></div>' +
      '<div class="admin-section-subtitle" style="margin-top:14px">典藏内置原声讲解 (' + baseTracks.length + ')</div>' +
      '<div class="admin-dialect-list" id="baseDialectList"></div>';

    var searchInput = $('#dlSearch');
    var clearBtn = $('#dlSearchClear');

    function refreshDialectView() {
      var q = (searchInput.value || '').toLowerCase().trim();
      if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

      var filteredCustom = customTracks.filter(function (t) {
        if (!q) return true;
        var text = ((t.item && t.item.name) + ' ' + t.chapter + ' ' + (t.item && t.item.videoUrl)).toLowerCase();
        return text.indexOf(q) !== -1;
      });

      var cList = $('#customDialectList');
      if (!filteredCustom.length) {
        cList.innerHTML = '<div class="admin-empty-sm">' + (customTracks.length ? '未找到匹配的自定义语料' : '暂无自定义语料，点击上方按钮新增') + '</div>';
      } else {
        cList.innerHTML = filteredCustom.map(function (t) {
          var creatorTag = t.creatorName ? '<span class="admin-creator-tag">👤 ' + esc(t.creatorName) + '</span>' : '';
          var isAud = (t.mediaType === 'audio' || (t.item && t.item.mediaType === 'audio') || (t.item && t.item.audioUrl) || /\.(mp3|wav|ogg|aac|m4a)(\?.*)?$/i.test((t.item && (t.item.videoUrl || t.item.audioUrl)) || ''));
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

    searchInput.addEventListener('input', refreshDialectView);
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
  }

  function showDialectForm() {
    var form = $('#dialectForm');
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });

    form.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">新增方言语料 / 展品原声讲解</div>' +
      '  <label class="admin-label">展品 / 方言语料名称 *</label>' +
      '  <input type="text" id="dlName" class="admin-input" placeholder="例如：黄姜豆腐制作口述">' +
      '  <div class="admin-form-row">' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">媒体形态 *</label>' +
      '      <select id="dlMediaType" class="admin-input">' +
      '        <option value="audio">🔊 纯音频录音 (田野采风原声)</option>' +
      '        <option value="video">🎬 视频影像 (展品视听讲解)</option>' +
      '      </select>' +
      '    </div>' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">语料来源</label>' +
      '      <select id="dlOriginType" class="admin-input">' +
      '        <option value="custom">🎙️ 现代田野采风录入</option>' +
      '        <option value="classic">📖 文献典籍补录</option>' +
      '      </select>' +
      '    </div>' +
      '  </div>' +
      '  <div class="admin-form-row">' +
      '    <div style="flex:1">' +
      '      <label class="admin-label">所属篇章 / 栏目</label>' +
      '      <input type="text" id="dlChapter" class="admin-input" value="客家风味" placeholder="例如：客家风味">' +
      '    </div>' +
      '    <div style="width:100px">' +
      '      <label class="admin-label">页码编号</label>' +
      '      <input type="number" id="dlPage" class="admin-input" value="1">' +
      '    </div>' +
      '  </div>' +
      '  <label class="admin-label">音视频嵌入链接 / 播放地址 *</label>' +
      '  <input type="url" id="dlUrl" class="admin-input" placeholder="https://... 视频或音频地址">' +
      '  <div class="admin-form-actions">' +
      '    <button class="admin-btn admin-btn-primary" id="dlSaveBtn">保 存</button>' +
      '    <button class="admin-btn" id="dlCancelBtn">取 消</button>' +
      '  </div>' +
      '</div>';

    $('#dlSaveBtn').addEventListener('click', function () {
      var name = $('#dlName').value.trim();
      var mediaType = $('#dlMediaType').value || 'audio';
      var originType = $('#dlOriginType').value || 'custom';
      var chapter = $('#dlChapter').value.trim() || '客家方言';
      var page = Number($('#dlPage').value) || 1;
      var url = $('#dlUrl').value.trim();
      if (!name || !url) { alert('名称和音视频链接不能为空'); return; }

      window.Store.addDialectTrack({
        id: 'dl-' + Date.now(),
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
      }, currentUser);
      refreshFrontEnd();
      form.style.display = 'none';
      renderTab();
    });

    $('#dlCancelBtn').addEventListener('click', function () {
      form.style.display = 'none';
    });
  }

  /* ==================== 4. 任意格式文档智能解析入库 ==================== */
  function renderImport(body) {
    body.innerHTML =
      '<div class="admin-import-panel">' +
      '  <div class="admin-form-title">📂 智能文档解析与批量入库</div>' +
      '  <div class="admin-hint">支持拖拽或选择 Word (.docx)、Markdown (.md)、文本文档 (.txt) 或 JSON 文件。系统自动提取结构化问答条目。</div>' +
      '  <div class="admin-dropzone" id="fileDropzone">' +
      '    <div class="admin-dropzone-icon">📄</div>' +
      '    <div class="admin-dropzone-text">点击或拖拽文件到此处解析</div>' +
      '    <div class="admin-dropzone-sub">支持 .txt / .md / .json / .docx 格式文档</div>' +
      '    <input type="file" id="docFileInput" accept=".txt,.md,.json,.docx" style="display:none">' +
      '  </div>' +
      '  <div class="admin-drafts-header" id="draftsHeader" style="display:none">' +
      '    <span class="admin-drafts-title" id="draftsCountTitle">解析出的条目草稿 (0)</span>' +
      '    <button class="admin-btn admin-btn-primary" id="batchCommitBtn">🚀 一键批量入库</button>' +
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

    $('#batchCommitBtn').addEventListener('click', function () {
      if (!parsedDrafts.length) return;
      parsedDrafts.forEach(function (draft) {
        window.Store.addEntry({
          title: draft.title,
          keywords: draft.keywords,
          answer: draft.answer,
          sources: draft.sources
        }, currentUser);
      });
      alert('成功批量入库 ' + parsedDrafts.length + ' 条非遗知识！');
      parsedDrafts = [];
      renderTab();
    });

    renderDraftsList();
  }

  function processUploadedFile(file) {
    var name = file.name || '';
    var ext = name.slice(name.lastIndexOf('.')).toLowerCase();

    if (ext === '.json') {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          if (Array.isArray(parsed)) {
            parsedDrafts = parsed.map(function (item, idx) {
              return {
                title: String(item.title || ('解析条目 ' + (idx + 1))),
                keywords: Array.isArray(item.keywords) ? item.keywords : [item.title || '非遗'],
                answer: String(item.answer || item.content || item.desc || ''),
                sources: Array.isArray(item.sources) ? item.sources : [{ title: name }]
              };
            });
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
        if (curBody.join('\n').trim().length > 10) {
          chunks.push({
            title: curTitle || '非遗知识条目',
            text: curBody.join('\n').trim()
          });
        }
        curTitle = trimmed.replace(/^#{1,4}\s+/, '').replace(/^问[：:]\s*/, '').replace(/[【】]/g, '').slice(0, 32);
        curBody = [];
      } else if (isHeader) {
        curTitle = trimmed.replace(/^#{1,4}\s+/, '').replace(/^问[：:]\s*/, '').replace(/[【】]/g, '').slice(0, 32);
      } else if (trimmed) {
        curBody.push(trimmed);
      }
    });

    if (curBody.join('\n').trim().length > 10) {
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
        if (ct.length > 20) {
          var firstLine = ct.split('\n')[0].slice(0, 24);
          chunks.push({
            title: firstLine || ('条目 ' + (idx + 1)),
            text: ct
          });
        }
      });
    }

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
      var str = '';
      // 简单抽样解码抽取 XML 文本段落
      var decoder = new TextDecoder('utf-8', { fatal: false });
      var decoded = decoder.decode(bytes);
      var texts = [];
      var regex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g;
      var match;
      while ((match = regex.exec(decoded)) !== null) {
        if (match[1]) texts.push(match[1]);
      }
      if (texts.length) {
        var fullText = texts.join('');
        parseTextToDrafts(fullText, fileName);
      } else {
        alert('Word 文档解析未提取到文字，建议转换为 TXT 或 Markdown 上传');
      }
    } catch (e) {
      alert('Word 文档解析失败，建议转为 TXT 格式上传');
    }
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
    var apiOvr = window.Store.getApiOverrides();
    var curModel = apiOvr.model || 'Qwen/Qwen3-30B-A3B-Instruct-2507';
    var curTemp = apiOvr.temperature !== undefined ? apiOvr.temperature : 0.2;
    var curTokens = apiOvr.maxTokens !== undefined ? apiOvr.maxTokens : 900;
    var wf = window.Store.getWorkflowConfig();

    body.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">🤖 智能体工作流与模型编排</div>' +
      '  <label class="admin-label">底座大语言模型 (LLM)</label>' +
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

    $('#aiSaveBtn').addEventListener('click', function () {
      var model = $('#apiModel').value;
      var temp = Number($('#apiTemp').value);
      var maxTokens = Number($('#apiMaxTokens').value);
      var sysPrompt = $('#wfPrompt').value.trim();

      window.Store.setApiOverrides({ model: model, temperature: temp, maxTokens: maxTokens });
      window.Store.setWorkflowConfig({ systemPrompt: sysPrompt });
      if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
      alert('AI 模型与工作流配置已生效！');
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
      '  <div class="admin-hint">为龙南文旅、文化馆专员签发专属受邀令牌。超级管理员可随时监控活跃状态、暂停/恢复授权、彻底销毁，或一键撤销某个令牌录入的所有数据。</div>' +
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
      '      <button class="admin-btn-sm admin-btn-del" id="unlockAllClientsBtn">🔓 全部一键解除</button>' +
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
            ? ('https://antigravity.longnankejia-dev.pages.dev/#admin-token=' + encodeURIComponent(token))
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
            ? ('https://antigravity.longnankejia-dev.pages.dev/#admin-token=' + encodeURIComponent(token))
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
            window.Store.pauseInviteToken(id);
            renderTab();
          }
        });
      });

      list.querySelectorAll('[data-resume-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-resume-token');
          window.Store.resumeInviteToken(id);
          renderTab();
        });
      });

      list.querySelectorAll('[data-rollback-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-rollback-token');
          var name = btn.getAttribute('data-name');
          var count = btn.getAttribute('data-count');
          if (confirm('确定撤销受邀人员「' + name + '」录入的全部修改？\n将清除其录入的全部 ' + count + ' 项数据（知识库、科普卡片、方言语音）。此操作不可撤销。')) {
            var res = window.Store.rollbackTokenChanges(id);
            refreshFrontEnd();
            alert('已成功撤销该令牌录入的修改，共回滚清除 ' + res.totalRemoved + ' 项数据！');
            renderTab();
          }
        });
      });

      list.querySelectorAll('[data-revoke-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-revoke-token');
          if (confirm('确定销毁该管理员令牌？销毁后对方将永久无法登录。')) {
            window.Store.revokeInviteToken(id);
            renderTab();
          }
        });
      });

      list.querySelectorAll('[data-del-token]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-del-token');
          if (confirm('确定彻底删除该令牌记录？')) {
            window.Store.deleteInviteToken(id);
            renderTab();
          }
        });
      });
    }

    function showInspectBox(tokenId) {
      var box = $('#inspectContainer');
      if (!box) return;
      var detailed = window.Store.getTokenDetailedContributions(tokenId);
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
        '  <div class="admin-hint" style="margin-bottom:8px">逐条核对内容，对不妥当的改动点击「剔除此项」并附带理由，系统将精准剔除该项并将驳回原因通知该管理员。</div>' +
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

      box.querySelectorAll('[data-reject-id]').forEach(function (rBtn) {
        rBtn.addEventListener('click', function () {
          var itemId = rBtn.getAttribute('data-reject-id');
          var itemType = rBtn.getAttribute('data-reject-type');
          var itemTitle = rBtn.getAttribute('data-reject-title');
          var reason = prompt('确定剔除修改项「' + itemTitle + '」？\n请输入驳回原因（此消息将发送给该管理员）：', '内容考据不严谨，需核对后录入');
          if (reason !== null && reason.trim()) {
            var res = window.Store.rejectTokenItem(tokenId, itemId, itemType, reason.trim());
            if (res.ok) {
              refreshFrontEnd();
              alert('已剔除「' + itemTitle + '」，并将驳回通知发送给该管理员！');
              renderTab();
              showInspectBox(tokenId);
            } else {
              alert('剔除失败：' + (res.error || '未找到该项'));
            }
          }
        });
      });
    }

    $('#refreshAuditBtn').addEventListener('click', function () {
      renderTab();
    });

    $('#clearAuditBtn').addEventListener('click', function () {
      if (confirm('确定清空所有操作审计日志？')) {
        window.Store.clearAuditLogs();
        renderTab();
      }
    });

    $('#tokGenBtn').addEventListener('click', function () {
      var name = $('#tokName').value.trim();
      var days = Number($('#tokDays').value);
      if (!name) { alert('请输入受邀人员姓名或单位备注'); return; }
      var created = window.Store.generateInviteToken(name, days);
      var disp = $('#tokNewDisplay');
      disp.style.display = 'block';
      disp.innerHTML =
        '<div class="admin-token-success-title">🎉 令牌签发成功！请将以下专属邀请令牌发给对方：</div>' +
        '<div class="admin-token-key-row">' +
        '  <input type="text" readonly value="' + created.token + '" class="admin-input token-highlight" id="newTokBox">' +
        '  <button class="admin-btn admin-btn-primary" id="copyNewTokBtn">一键复制</button>' +
        '</div>';
      $('#copyNewTokBtn').addEventListener('click', function () {
        var box = $('#newTokBox');
        box.select();
        navigator.clipboard ? navigator.clipboard.writeText(box.value) : prompt('请复制：', box.value);
        alert('已复制专属邀请令牌！');
      });
      $('#tokName').value = '';
      renderTab();
    });

    body.querySelectorAll('[data-unlock-client]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-unlock-client');
        var ip = btn.getAttribute('data-ip');
        var cid = btn.getAttribute('data-cid');
        if (window.Store && window.Store.unlockClient) {
          window.Store.unlockClient(cid || id || ip);
        }
        showAdminToast('已手动解除客户端 [' + ip + '] 的登录封锁！');
        renderTab();
      });
    });

    var unlockAllBtn = $('#unlockAllClientsBtn');
    if (unlockAllBtn) {
      unlockAllBtn.addEventListener('click', function () {
        if (confirm('确定一键解除所有客户端的登录封锁？')) {
          if (window.Store && window.Store.unlockAllClients) {
            window.Store.unlockAllClients();
          }
          showAdminToast('已一键解除所有客户端的登录封锁！');
          renderTab();
        }
      });
    }

    var refreshLocksBtn = $('#refreshLocksBtn');
    if (refreshLocksBtn) {
      refreshLocksBtn.addEventListener('click', function () {
        refreshLocksBtn.disabled = true;
        refreshLocksBtn.textContent = '⏳ 正在刷新...';
        if (window.Store && window.Store.syncWithCloud) {
          window.Store.syncWithCloud(function (data) {
            refreshLocksBtn.disabled = false;
            refreshLocksBtn.textContent = '🔄 刷新监控';
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
    body.innerHTML =
      (isSuper ?
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">修改超级管理员主密码</div>' +
      '  <input type="password" id="newPw1" class="admin-input" placeholder="新密码">' +
      '  <input type="password" id="newPw2" class="admin-input" placeholder="确认新密码" style="margin-top:6px">' +
      '  <button class="admin-btn admin-btn-primary" id="pwSaveBtn" style="margin-top:8px">修改主密码</button>' +
      '</div>' : '') +

      '<div class="admin-form-box" style="margin-top:12px">' +
      '  <div class="admin-form-title">📦 全站数智资产包一键备份与恢复</div>' +
      '  <div class="admin-hint">将知识库、科普卡片、方言语料及AI工作流设置一并打包导出。发给技术人员可秒级合并发布至正式站。</div>' +
      '  <div class="admin-form-row" style="margin-top:8px">' +
      '    <button class="admin-btn admin-btn-primary" id="exportBundleBtn">📥 导出全站资产包 (JSON)</button>' +
      '    <button class="admin-btn" id="importBundleBtn">📤 导入全站资产包</button>' +
      '    <input type="file" id="bundleFileInput" accept=".json" style="display:none">' +
      '  </div>' +
      '  <div class="admin-form-row" style="margin-top:8px">' +
      '    <button class="admin-btn-sm" id="exportBtn">仅导出知识库</button>' +
      '    <button class="admin-btn-sm" id="importBtn">仅导入知识库</button>' +
      '    <input type="file" id="importFile" accept=".json" style="display:none">' +
      '  </div>' +
      '</div>' +

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
        if (!p1 || p1.length < 4) { alert('密码至少 4 位'); return; }
        if (p1 !== p2) { alert('两次密码不一致'); return; }
        window.Store.setAdminPassword(p1);
        alert('主密码修改成功');
      });
    }

    $('#exportBundleBtn').addEventListener('click', function () {
      var json = window.Store.exportFullBundle();
      downloadJson(json, 'longnan-heritage-bundle-' + new Date().toISOString().slice(0, 10) + '.json');
    });

    $('#importBundleBtn').addEventListener('click', function () {
      $('#bundleFileInput').click();
    });
    $('#bundleFileInput').addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        if (window.Store.importFullBundle(reader.result)) {
          alert('全站资产包恢复成功！');
          refreshFrontEnd();
          renderTab();
        } else {
          alert('资产包导入失败：格式不正确');
        }
      };
      reader.readAsText(file);
    });

    $('#exportBtn').addEventListener('click', function () {
      var json = window.Store.exportKB();
      downloadJson(json, 'heritage-kb-' + new Date().toISOString().slice(0, 10) + '.json');
    });

    $('#importBtn').addEventListener('click', function () {
      $('#importFile').click();
    });
    $('#importFile').addEventListener('change', function () {
      var file = this.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        if (window.Store.importKB(reader.result)) {
          alert('导入成功！共 ' + window.Store.getEntries().length + ' 条知识');
          if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
        } else {
          alert('导入失败：JSON 格式不正确');
        }
      };
      reader.readAsText(file);
    });

    if (isSuper && $('#resetKBBtn')) {
      $('#resetKBBtn').addEventListener('click', function () {
        if (confirm('确定重置知识库？所有自定义内容将丢失。')) {
          window.Store.resetKB();
          if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
          alert('知识库已重置');
        }
      });
    }

    if (isSuper && $('#resetApiBtn')) {
      $('#resetApiBtn').addEventListener('click', function () {
        if (confirm('确定重置 AI 设置？')) {
          window.Store.resetApi();
          if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
          alert('AI 设置已重置');
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
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function showTokenQrModal(name, token, url) {
    var oldModal = document.getElementById('tokenQrModal');
    if (oldModal) oldModal.remove();

    var isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname);
    if (!url) {
      url = isLocal
        ? ('https://antigravity.longnankejia-dev.pages.dev/#admin-token=' + encodeURIComponent(token))
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
    if (!authenticated) {
      var saved = window.Store && window.Store.getSession ? window.Store.getSession() : null;
      if (saved) {
        authenticated = true;
        currentUser = saved;
      }
    }
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

    // 检查 URL 中是否携带免密超管同步或受邀专属令牌参数
    try {
      var hash = window.location.hash || '';
      var search = window.location.search || '';
      var authSuperMatch = hash.match(/admin-auth=super/) || search.match(/admin-auth=super/);
      if (authSuperMatch) {
        var keyMatch = hash.match(/key=([^&]+)/) || search.match(/key=([^&]+)/);
        var keyParam = keyMatch ? decodeURIComponent(keyMatch[1]) : '';
        var customPw = null;
        try { customPw = localStorage.getItem('nfyj_admin_pw'); } catch (_) {}
        var validKey = false;
        if (customPw) {
          validKey = (keyParam === customPw) || (keyParam.toLowerCase() === customPw.toLowerCase());
        } else {
          var actualPw = window.Store && window.Store.getAdminPassword ? window.Store.getAdminPassword() : 'admin123';
          validKey = !keyParam || keyParam === actualPw || keyParam.toLowerCase() === actualPw.toLowerCase();
        }
        if (validKey) {
          clearLoginLockState();
          authenticated = true;
          currentUser = {
            role: 'super_admin',
            title: '超级管理员',
            name: '超级管理员'
          };
          if (window.Store && window.Store.saveSession) {
            window.Store.saveSession(currentUser);
          }
          if (window.history && window.history.replaceState) {
            var cleanH = hash.replace(/[?&]?admin-auth=[^&]+/, '').replace(/[?&]?key=[^&]+/, '');
            window.history.replaceState(null, '', window.location.pathname + cleanH);
          }
          setTimeout(function () {
            open();
            showAdminToast('📱 手机端已成功同步免密登录超级管理员工作台！');
          }, 200);
        }
      }

      var m = hash.match(/admin-token=([^&]+)/) || search.match(/admin-token=([^&]+)/);
      if (m && m[1]) {
        var tokenParam = decodeURIComponent(m[1]);
        var res = window.Store && window.Store.verifyLogin ? window.Store.verifyLogin(tokenParam) : null;
        if (res && res.ok) {
          clearLoginLockState();
          authenticated = true;
          currentUser = res;
          if (window.Store && window.Store.saveSession) {
            window.Store.saveSession(res);
          }
          if (window.history && window.history.replaceState) {
            var cleanHash = hash.replace(/[?&]?admin-token=[^&]+/, '');
            window.history.replaceState(null, '', window.location.pathname + cleanHash);
          }
          setTimeout(function () {
            open();
            showAdminToast('📱 欢迎受邀管理员「' + res.name + '」！工作台已成功就绪。');
          }, 200);
        }
      }
    } catch (_) {}

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

  window.Admin = { init: init, open: open, close: close };
})();
