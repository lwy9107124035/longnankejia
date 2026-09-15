/**
 * 管理员界面 —— 知识库管理 + API 配置
 * ------------------------------------------------------------
 * 从用户页面底部入口进入，密码登录后可：
 *   - 增删改查知识库条目
 *   - 切换 AI 引擎模式 / 修改模型参数
 *   - 导入导出知识库 JSON
 *   - 修改管理员密码 / 重置数据
 *
 * 所有修改存 localStorage，不影响源码文件。
 */
(function () {
  'use strict';

  var authenticated = false;
  var currentTab = 'kb';
  var editingId = null; // 正在编辑的条目 id，null = 新增

  /* ---------- DOM 工具 ---------- */
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ---------- 登录 ---------- */
  function showLogin() {
    var panel = $('#adminPanel');
    panel.innerHTML =
      '<div class="admin-login">' +
      '  <div class="admin-login-icon">🔐</div>' +
      '  <div class="admin-login-title">管理员登录</div>' +
      '  <input type="password" id="adminPwInput" placeholder="请输入管理员密码" autocomplete="off">' +
      '  <div class="admin-login-error" id="adminPwError"></div>' +
      '  <button class="admin-login-btn" id="adminLoginBtn">登 录</button>' +
      '  <button class="admin-login-cancel" id="adminCancelBtn">返回用户页面</button>' +
      '</div>';

    var input = $('#adminPwInput');
    var btn = $('#adminLoginBtn');
    var err = $('#adminPwError');

    function doLogin() {
      var pw = input.value;
      if (pw === window.Store.getAdminPassword()) {
        authenticated = true;
        showMain();
      } else {
        err.textContent = '密码错误，请重试';
        input.value = '';
        input.focus();
      }
    }

    btn.addEventListener('click', doLogin);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('#adminCancelBtn').addEventListener('click', close);
    setTimeout(function () { input.focus(); }, 100);
  }

  /* ---------- 主面板 ---------- */
  function showMain() {
    var panel = $('#adminPanel');
    panel.innerHTML =
      '<div class="admin-header">' +
      '  <div class="admin-header-title">⚙️ 管理员控制台</div>' +
      '  <button class="admin-close-btn" id="adminCloseBtn">✕ 关闭</button>' +
      '</div>' +
      '<div class="admin-tabs">' +
      '  <button class="admin-tab active" data-tab="kb">📚 知识库</button>' +
      '  <button class="admin-tab" data-tab="api">🤖 AI 设置</button>' +
      '  <button class="admin-tab" data-tab="sys">🛠 系统</button>' +
      '</div>' +
      '<div class="admin-body" id="adminBody"></div>';

    $('#adminCloseBtn').addEventListener('click', close);

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
    else if (currentTab === 'api') renderAPI(body);
    else if (currentTab === 'sys') renderSys(body);
  }

  /* ==================== 知识库 Tab ==================== */
  function renderKB(body) {
    var entries = window.Store.getEntries();
    body.innerHTML =
      '<div class="admin-kb-toolbar">' +
      '  <input type="text" id="kbSearch" placeholder="搜索条目…" class="admin-search">' +
      '  <button class="admin-btn admin-btn-primary" id="kbAddBtn">＋ 新增条目</button>' +
      '</div>' +
      '<div class="admin-kb-stats">共 ' + entries.length + ' 条知识</div>' +
      '<div class="admin-kb-form" id="kbForm" style="display:none"></div>' +
      '<div class="admin-kb-list" id="kbList"></div>';

    renderKBList(entries);

    $('#kbSearch').addEventListener('input', function () {
      var q = this.value.toLowerCase();
      var filtered = entries.filter(function (e) {
        return e.title.toLowerCase().indexOf(q) !== -1 ||
               e.keywords.join(' ').toLowerCase().indexOf(q) !== -1 ||
               e.answer.toLowerCase().indexOf(q) !== -1;
      });
      renderKBList(filtered);
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
      return '<div class="admin-kb-item" data-id="' + esc(e.id) + '">' +
        '<div class="admin-kb-item-head">' +
        '  <span class="admin-kb-item-title">' + esc(e.title) + '</span>' + badge +
        '</div>' +
        '<div class="admin-kb-item-keywords">' + esc(e.keywords.join(' / ')) + '</div>' +
        '<div class="admin-kb-item-preview">' + esc(e.answer.slice(0, 80)) + (e.answer.length > 80 ? '…' : '') + '</div>' +
        '<div class="admin-kb-item-actions">' +
        '  <button class="admin-btn-sm admin-btn-edit" data-action="edit">编辑</button>' +
        '  <button class="admin-btn-sm admin-btn-del" data-action="delete">删除</button>' +
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
    form.innerHTML =
      '<div class="admin-form-title">' + (entry ? '编辑条目' : '新增条目') + '</div>' +
      '<label class="admin-label">标题</label>' +
      '<input type="text" id="kbTitle" class="admin-input" value="' + esc(entry ? entry.title : '') + '" placeholder="例如：客家蓝染">' +
      '<label class="admin-label">关键词（逗号分隔）</label>' +
      '<input type="text" id="kbKeywords" class="admin-input" value="' + esc(entry ? entry.keywords.join(', ') : '') + '" placeholder="蓝染, 染布, 靛蓝">' +
      '<label class="admin-label">回答内容</label>' +
      '<textarea id="kbAnswer" class="admin-textarea" rows="5" placeholder="阿蓝的回答内容…">' + esc(entry ? entry.answer : '') + '</textarea>' +
      '<div class="admin-form-actions">' +
      '  <button class="admin-btn admin-btn-primary" id="kbSaveBtn">保存</button>' +
      '  <button class="admin-btn" id="kbCancelBtn">取消</button>' +
      '</div>';

    $('#kbSaveBtn').addEventListener('click', function () {
      var title = $('#kbTitle').value.trim();
      var keywords = $('#kbKeywords').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      var answer = $('#kbAnswer').value.trim();
      if (!title || !answer) { alert('标题和回答内容不能为空'); return; }
      var data = { title: title, keywords: keywords, answer: answer };
      if (editingId) {
        window.Store.updateEntry(editingId, data);
      } else {
        window.Store.addEntry(data);
      }
      renderTab();
    });
    $('#kbCancelBtn').addEventListener('click', function () {
      form.style.display = 'none';
      editingId = null;
    });

    form.scrollIntoView({ behavior: 'smooth' });
    $('#kbTitle').focus();
  }

  /* ==================== API Tab ==================== */
  function renderAPI(body) {
    var ai = window.Store.getEffectiveAi();
    var mode = ai.mode || 'rules';
    var api = ai.api || {};
    var hasKey = !!(window.APP_SECRETS && window.APP_SECRETS.apiKey);

    body.innerHTML =
      '<div class="admin-api-section">' +
      '  <div class="admin-form-title">引擎模式</div>' +
      '  <div class="admin-mode-toggle">' +
      '    <button class="admin-mode-btn ' + (mode === 'rules' ? 'active' : '') + '" data-mode="rules">📚 本地知识库</button>' +
      '    <button class="admin-mode-btn ' + (mode === 'api' ? 'active' : '') + '" data-mode="api">🤖 AI 大模型</button>' +
      '  </div>' +
      '  <div class="admin-hint">' +
      (hasKey
        ? '✅ API Key 已配置（来自 secrets.js）'
        : '⚠️ API Key 未配置，切换到 API 模式会自动回退到本地知识库') +
      '</div>' +
      '</div>' +

      '<div class="admin-api-section">' +
      '  <div class="admin-form-title">模型参数</div>' +
      '  <label class="admin-label">模型名称</label>' +
      '  <input type="text" id="apiModel" class="admin-input" value="' + esc(api.model || '') + '">' +
      '  <div class="admin-hint">推荐：Qwen/Qwen2.5-7B-Instruct（快）或 deepseek-ai/DeepSeek-V3.2（强）</div>' +
      '  <div class="admin-row">' +
      '    <div class="admin-col">' +
      '      <label class="admin-label">Temperature（0–2）</label>' +
      '      <input type="number" id="apiTemp" class="admin-input" value="' + (api.temperature || 0.7) + '" min="0" max="2" step="0.1">' +
      '    </div>' +
      '    <div class="admin-col">' +
      '      <label class="admin-label">最大 Token 数</label>' +
      '      <input type="number" id="apiMaxTok" class="admin-input" value="' + (api.maxTokens || 256) + '" min="50" max="2000" step="50">' +
      '    </div>' +
      '  </div>' +
      '  <button class="admin-btn admin-btn-primary" id="apiSaveBtn" style="margin-top:12px">保存 API 设置</button>' +
      '</div>' +

      '<div class="admin-api-section">' +
      '  <div class="admin-form-title">System Prompt（系统提示词）</div>' +
      '  <textarea id="apiSysPrompt" class="admin-textarea" rows="4">' + esc(api.systemPrompt || '') + '</textarea>' +
      '  <button class="admin-btn admin-btn-primary" id="apiPromptSaveBtn" style="margin-top:8px">保存提示词</button>' +
      '</div>';

    // 模式切换
    body.querySelectorAll('.admin-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var m = btn.getAttribute('data-mode');
        window.Store.setApiOverrides({ mode: m });
        // 清除引擎缓存，下次提问重新初始化
        window.AnswerEngine.reset();
        renderTab();
      });
    });

    $('#apiSaveBtn').addEventListener('click', function () {
      window.Store.setApiOverrides({
        model: $('#apiModel').value.trim(),
        temperature: parseFloat($('#apiTemp').value) || 0.7,
        maxTokens: parseInt($('#apiMaxTok').value, 10) || 256
      });
      window.AnswerEngine.reset();
      alert('API 设置已保存');
    });

    $('#apiPromptSaveBtn').addEventListener('click', function () {
      // systemPrompt 存在 api 覆盖里
      var sp = $('#apiSysPrompt').value.trim();
      window.Store.setApiOverrides({ systemPrompt: sp });
      window.AnswerEngine.reset();
      alert('提示词已保存');
    });
  }

  /* ==================== 系统 Tab ==================== */
  function renderSys(body) {
    var entries = window.Store.getEntries();
    var apiOvr = window.Store.getApiOverrides();

    body.innerHTML =
      '<div class="admin-api-section">' +
      '  <div class="admin-form-title">修改管理员密码</div>' +
      '  <input type="password" id="newPw1" class="admin-input" placeholder="新密码">' +
      '  <input type="password" id="newPw2" class="admin-input" placeholder="确认新密码" style="margin-top:6px">' +
      '  <button class="admin-btn admin-btn-primary" id="pwSaveBtn" style="margin-top:8px">修改密码</button>' +
      '</div>' +

      '<div class="admin-api-section">' +
      '  <div class="admin-form-title">知识库备份</div>' +
      '  <div class="admin-hint">当前共 ' + entries.length + ' 条知识。导出为 JSON 文件可备份或迁移到其他设备。</div>' +
      '  <div class="admin-row" style="gap:8px;margin-top:8px">' +
      '    <button class="admin-btn admin-btn-primary" id="exportBtn">📥 导出知识库</button>' +
      '    <button class="admin-btn" id="importBtn">📤 导入知识库</button>' +
      '    <input type="file" id="importFile" accept=".json" style="display:none">' +
      '  </div>' +
      '</div>' +

      '<div class="admin-api-section">' +
      '  <div class="admin-form-title">重置</div>' +
      '  <div class="admin-hint">清除所有管理员修改，恢复到内置默认状态。不影响 API Key。</div>' +
      '  <button class="admin-btn admin-btn-danger" id="resetKBBtn" style="margin-top:8px">重置知识库</button>' +
      '  <button class="admin-btn admin-btn-danger" id="resetApiBtn" style="margin-top:8px;margin-left:6px">重置 API 设置</button>' +
      '</div>' +

      '<div class="admin-api-section">' +
      '  <div class="admin-form-title">关于</div>' +
      '  <div class="admin-hint">' +
      '    龙南客家非遗数字助手 v' + ((window.APP_CONFIG && window.APP_CONFIG.app && window.APP_CONFIG.app.version) || '1.0') + '<br>' +
      '    所有修改保存在浏览器本地（localStorage），清除浏览器数据会丢失自定义内容。<br>' +
      '    API Key 存放在 js/secrets.js，不经过管理员界面。' +
      '  </div>' +
      '</div>';

    // 修改密码
    $('#pwSaveBtn').addEventListener('click', function () {
      var p1 = $('#newPw1').value;
      var p2 = $('#newPw2').value;
      if (!p1 || p1.length < 4) { alert('密码至少 4 位'); return; }
      if (p1 !== p2) { alert('两次密码不一致'); return; }
      window.Store.setAdminPassword(p1);
      alert('密码已修改');
    });

    // 导出
    $('#exportBtn').addEventListener('click', function () {
      var json = window.Store.exportKB();
      var blob = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'heritage-kb-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    // 导入
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
          window.AnswerEngine.reset();
        } else {
          alert('导入失败：JSON 格式不正确');
        }
      };
      reader.readAsText(file);
    });

    // 重置
    $('#resetKBBtn').addEventListener('click', function () {
      if (confirm('确定重置知识库？所有自定义内容将丢失。')) {
        window.Store.resetKB();
        window.AnswerEngine.reset();
        alert('知识库已重置');
      }
    });
    $('#resetApiBtn').addEventListener('click', function () {
      if (confirm('确定重置 API 设置？')) {
        window.Store.resetApi();
        window.AnswerEngine.reset();
        renderTab();
        alert('API 设置已重置');
      }
    });
  }

  /* ---------- 打开 / 关闭 ---------- */
  function open() {
    var mask = $('#adminMask');
    mask.hidden = false;
    if (authenticated) {
      showMain();
    } else {
      showLogin();
    }
  }

  function close() {
    $('#adminMask').hidden = true;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // 注册入口按钮
    var entry = document.getElementById('adminEntry');
    if (entry) {
      entry.addEventListener('click', open);
    }
    // 关闭遮罩点击
    var mask = document.getElementById('adminMask');
    if (mask) {
      mask.addEventListener('click', function (e) {
        if (e.target === mask) close();
      });
    }
  }

  window.Admin = { init: init, open: open, close: close };
})();
