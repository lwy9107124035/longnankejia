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

  /* ==================== 登录模块 (支持邀请制令牌) ==================== */
  function showLogin() {
    var panel = $('#adminPanel');
    panel.innerHTML =
      '<div class="admin-login">' +
      '  <div class="admin-login-icon">🔐</div>' +
      '  <div class="admin-login-title">数智管理工作台</div>' +
      '  <div class="admin-login-hint">支持超级管理员主口令或受邀专属令牌登录</div>' +
      '  <input type="password" id="adminPwInput" placeholder="请输入密码或邀请令牌" autocomplete="off">' +
      '  <div class="admin-login-error" id="adminPwError"></div>' +
      '  <button class="admin-login-btn" id="adminLoginBtn">登 录</button>' +
      '  <button class="admin-login-cancel" id="adminCancelBtn">返回用户页面</button>' +
      '</div>';

    var input = $('#adminPwInput');
    var btn = $('#adminLoginBtn');
    var err = $('#adminPwError');

    var failedAttempts = 0;
    var lockUntil = 0;

    function doLogin() {
      var now = Date.now();
      if (now < lockUntil) {
        var remainSec = Math.ceil((lockUntil - now) / 1000);
        err.textContent = '尝试次数过多，请 ' + remainSec + ' 秒后再试';
        return;
      }
      var pw = input.value.trim();
      var authResult = window.Store.verifyLogin(pw);
      if (authResult.ok) {
        failedAttempts = 0;
        authenticated = true;
        currentUser = authResult;
        if (window.Store && window.Store.saveSession) {
          window.Store.saveSession(authResult);
        }
        showMain();
      } else {
        failedAttempts++;
        if (failedAttempts >= 5) {
          lockUntil = Date.now() + 30000;
          err.textContent = '密码错误过多，系统已临时锁定 30 秒';
        } else {
          err.textContent = '密码错误或邀请令牌无效，请重试（还剩 ' + (5 - failedAttempts) + ' 次机会）';
        }
        input.value = '';
        input.focus();
      }
    }

    btn.addEventListener('click', doLogin);
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
      ? '<span class="admin-role-badge super">👑 超级管理员</span>'
      : '<span class="admin-role-badge guest">👤 受邀：' + esc(currentUser.name) + '</span>';

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
  function renderKB(body) {
    var entries = window.Store.getEntries();
    body.innerHTML =
      '<div class="admin-kb-toolbar">' +
      '  <input type="text" id="kbSearch" placeholder="搜索条目标题、关键词或正文…" class="admin-search">' +
      '  <button class="admin-btn admin-btn-primary" id="kbAddBtn">＋ 新增条目</button>' +
      '</div>' +
      '<div class="admin-filter-bar" id="kbFilterBar">' +
      '  <button class="filter-chip active" data-cat="all">全部 (' + entries.length + ')</button>' +
      '  <button class="filter-chip" data-cat="craft">手艺工艺</button>' +
      '  <button class="filter-chip" data-cat="arch">围屋建筑</button>' +
      '  <button class="filter-chip" data-cat="custom">民俗礼俗</button>' +
      '  <button class="filter-chip" data-cat="food">传统风味</button>' +
      '  <button class="filter-chip" data-cat="dialect">方言童谣</button>' +
      '</div>' +
      '<div class="admin-kb-form" id="kbForm" style="display:none"></div>' +
      '<div class="admin-kb-list" id="kbList"></div>';

    renderKBList(entries);

    var curFilter = 'all';
    function doFilter() {
      var q = ($('#kbSearch').value || '').toLowerCase().trim();
      var filtered = entries.filter(function (e) {
        var matchQ = !q || e.title.toLowerCase().indexOf(q) !== -1 ||
                     e.keywords.join(' ').toLowerCase().indexOf(q) !== -1 ||
                     e.answer.toLowerCase().indexOf(q) !== -1;
        if (!matchQ) return false;
        if (curFilter === 'all') return true;
        var text = (e.title + ' ' + (e.topics || []).join(' ') + ' ' + e.keywords.join(' ')).toLowerCase();
        if (curFilter === 'craft') return text.indexOf('染') !== -1 || text.indexOf('编') !== -1 || text.indexOf('织') !== -1 || text.indexOf('漆') !== -1;
        if (curFilter === 'arch') return text.indexOf('围') !== -1 || text.indexOf('屋') !== -1 || text.indexOf('塔') !== -1;
        if (curFilter === 'custom') return text.indexOf('俗') !== -1 || text.indexOf('寿') !== -1 || text.indexOf('节') !== -1 || text.indexOf('灯') !== -1 || text.indexOf('会') !== -1;
        if (curFilter === 'food') return text.indexOf('豆腐') !== -1 || text.indexOf('米果') !== -1 || text.indexOf('茶') !== -1 || text.indexOf('食') !== -1 || text.indexOf('珍珠') !== -1;
        if (curFilter === 'dialect') return text.indexOf('话') !== -1 || text.indexOf('歌') !== -1 || text.indexOf('谣') !== -1 || text.indexOf('音') !== -1;
        return true;
      });
      renderKBList(filtered);
    }

    $('#kbSearch').addEventListener('input', doFilter);

    $('#kbFilterBar').querySelectorAll('.filter-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('#kbFilterBar').querySelectorAll('.filter-chip').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        curFilter = btn.getAttribute('data-cat');
        doFilter();
      });
    });

    $('#kbAddBtn').addEventListener('click', function () {
      editingId = null;
      showKBForm(null);
    });
  }

  function renderKBList(entries) {
    var list = $('#kbList');
    if (!entries.length) {
      list.innerHTML = '<div class="admin-empty">没有匹配的知识条目</div>';
      return;
    }
    list.innerHTML = entries.map(function (e) {
      var isCustom = e.id && e.id.indexOf('custom-') === 0;
      var badge = isCustom ? '<span class="admin-badge admin-badge-custom">自定义</span>' :
                  '<span class="admin-badge admin-badge-default">内置</span>';
      var sourceText = (e.sources && e.sources.length) ? ' · 📖 ' + esc(e.sources[0].title) : '';
      return '<div class="admin-kb-item" data-id="' + esc(e.id) + '">' +
        '<div class="admin-kb-item-head">' +
        '  <span class="admin-kb-item-title">' + esc(e.title) + '</span>' + badge +
        '</div>' +
        '<div class="admin-kb-item-keywords">' + esc(e.keywords.join(' / ')) + '</div>' +
        '<div class="admin-kb-item-preview">' + esc(e.answer.slice(0, 95)) + (e.answer.length > 95 ? '…' : '') + '</div>' +
        '<div class="admin-kb-item-footer">' +
        '  <span class="admin-kb-item-meta">' + e.answer.length + ' 字' + sourceText + '</span>' +
        '  <div class="admin-kb-item-actions">' +
        '    <button class="admin-btn-sm admin-btn-test" data-action="test">测试提问</button>' +
        '    <button class="admin-btn-sm admin-btn-edit" data-action="edit">编辑</button>' +
        '    <button class="admin-btn-sm admin-btn-del" data-action="delete">删除</button>' +
        '  </div>' +
        '</div>' +
        '</div>';
    }).join('');

    list.querySelectorAll('.admin-kb-item').forEach(function (item) {
      var id = item.getAttribute('data-id');
      item.querySelector('[data-action="edit"]').addEventListener('click', function () {
        var entry = window.Store.getEntries().find(function (e) { return e.id === id; });
        editingId = id;
        showKBForm(entry);
      });
      item.querySelector('[data-action="test"]').addEventListener('click', function () {
        var entry = window.Store.getEntries().find(function (e) { return e.id === id; });
        if (entry && window.AnswerEngine) {
          var testQ = entry.title;
          window.AnswerEngine.ask(testQ).then(function (res) {
            alert('【阿蓝针对「' + testQ + '」的回答效果】\n\n' + (res.answer || res.text || '暂无命中') + '\n\n来源：' + (res.source || '本地资料库'));
          });
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

  function showKBForm(entry) {
    var form = $('#kbForm');
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var sourcesTitle = (entry && entry.sources && entry.sources[0]) ? entry.sources[0].title : '';

    form.innerHTML =
      '<div class="admin-form-box">' +
      '  <div class="admin-form-title">' + (entry ? '编辑条目' : '新增条目') + '</div>' +
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
  function renderKepu(body) {
    var cards = window.Store.getHeritageCards(window.Heritage ? window.Heritage.list() : []);
    body.innerHTML =
      '<div class="admin-kb-toolbar">' +
      '  <div class="admin-toolbar-tip">前台【🏮 科普】面板内容，在此增删改前台即时联动渲染</div>' +
      '  <button class="admin-btn admin-btn-primary" id="kepuAddBtn">＋ 新增科普卡片</button>' +
      '</div>' +
      '<div class="admin-kb-form" id="kepuForm" style="display:none"></div>' +
      '<div class="admin-kepu-grid" id="kepuList"></div>';

    var list = $('#kepuList');
    list.innerHTML = cards.map(function (c) {
      return '<div class="admin-kepu-card" style="border-left: 4px solid ' + (c.accent || '#2F5D50') + '">' +
        '<div class="admin-kepu-head">' +
        '  <span class="admin-kepu-icon">' + (c.icon || '🏮') + '</span>' +
        '  <span class="admin-kepu-name">' + esc(c.name) + '</span>' +
        '</div>' +
        '<div class="admin-kepu-tag">' + esc(c.tag || '') + '</div>' +
        '<div class="admin-kepu-actions">' +
        '  <button class="admin-btn-sm admin-btn-edit" data-edit-kepu="' + esc(c.id) + '">编辑</button>' +
        '  <button class="admin-btn-sm admin-btn-del" data-del-kepu="' + esc(c.id) + '">删除</button>' +
        '</div>' +
        '</div>';
    }).join('');

    $('#kepuAddBtn').addEventListener('click', function () {
      editingKepuId = null;
      showKepuForm(null);
    });

    list.querySelectorAll('[data-edit-kepu]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-edit-kepu');
        var card = cards.find(function (c) { return c.id === id; });
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
      '  <div class="admin-form-title">' + (card ? '编辑科普卡片' : '新增科普卡片') + '</div>' +
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
    body.innerHTML =
      '<div class="admin-kb-toolbar">' +
      '  <div class="admin-toolbar-tip">前台【🗣 方言】原声库与讲解视频，可增补客家音频语料</div>' +
      '  <button class="admin-btn admin-btn-primary" id="dialectAddBtn">＋ 新增方言讲解/音频</button>' +
      '</div>' +
      '<div class="admin-kb-form" id="dialectForm" style="display:none"></div>' +
      '<div class="admin-section-subtitle">自定义语料 (' + customTracks.length + ')</div>' +
      '<div class="admin-dialect-list" id="customDialectList"></div>' +
      '<div class="admin-section-subtitle" style="margin-top:14px">典藏内置原声讲解 (' + baseTracks.length + ')</div>' +
      '<div class="admin-dialect-list" id="baseDialectList"></div>';

    var cList = $('#customDialectList');
    if (!customTracks.length) {
      cList.innerHTML = '<div class="admin-empty-sm">暂无自定义语料，点击上方按钮新增</div>';
    } else {
      cList.innerHTML = customTracks.map(function (t) {
        return '<div class="admin-dialect-item">' +
          '<div class="admin-dialect-item-title">🔊 ' + esc(t.item.name) + ' (' + esc(t.chapter) + ' · 第' + esc(t.item.page) + '页)</div>' +
          '<div class="admin-dialect-item-url">' + esc(t.item.videoUrl) + '</div>' +
          '<button class="admin-btn-sm admin-btn-del" data-del-dialect="' + esc(t.id) + '">删除</button>' +
          '</div>';
      }).join('');
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

    var bList = $('#baseDialectList');
    bList.innerHTML = baseTracks.map(function (t, i) {
      return '<div class="admin-dialect-item muted">' +
        '<span>' + (i + 1) + '. ' + esc(t.item.name) + ' (' + esc(t.chapter) + ')</span>' +
        '<span class="admin-badge admin-badge-default">内置</span>' +
        '</div>';
    }).join('');

    $('#dialectAddBtn').addEventListener('click', function () {
      showDialectForm();
    });
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
      var chapter = $('#dlChapter').value.trim() || '客家方言';
      var page = Number($('#dlPage').value) || 1;
      var url = $('#dlUrl').value.trim();
      if (!name || !url) { alert('名称和音视频链接不能为空'); return; }

      window.Store.addDialectTrack({
        id: 'dl-' + Date.now(),
        chapter: chapter,
        item: { name: name, page: page, videoUrl: url }
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
      '<div class="admin-audit-box">' +
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
          '  <button class="admin-btn-sm admin-btn-copy" data-copy-token="' + esc(t.token) + '">📋 复制</button>' +
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
