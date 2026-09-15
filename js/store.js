/**
 * 数据存储层 —— localStorage 覆盖层
 * ------------------------------------------------------------
 * 管理员在界面上对知识库/API 的修改存这里，
 * 运行时与内置默认数据合并，不影响源码文件。
 *
 * 存储结构（localStorage）：
 *   nfyj_kb_custom   : 管理员新增的知识条目 JSON 数组
 *   nfyj_kb_deleted  : 被删除的内置条目 id 数组
 *   nfyj_kb_edited   : 被编辑的内置条目 { id: entry } 映射
 *   nfyj_api_config  : 管理员修改的 API 配置 { mode?, model?, temperature?, maxTokens? }
 *   nfyj_admin_pw    : 管理员密码（覆盖 config 默认值）
 */
(function () {
  'use strict';

  var LS = {
    custom:  'nfyj_kb_custom',
    deleted: 'nfyj_kb_deleted',
    edited:  'nfyj_kb_edited',
    api:     'nfyj_api_config',
    pw:      'nfyj_admin_pw'
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  /* ---------- 知识库 ---------- */

  /** 合并后的完整知识库（默认 + 管理员修改） */
  function getEntries() {
    var base = (window.KNOWLEDGE_BASE || []).slice();
    var deleted = read(LS.deleted, []);
    var edited  = read(LS.edited, {});
    var custom  = read(LS.custom, []);

    // 过滤被删除的、应用编辑
    var merged = base
      .filter(function (e) { return deleted.indexOf(e.id) === -1; })
      .map(function (e) { return edited[e.id] || e; });

    // 追加自定义条目
    return merged.concat(custom);
  }

  function addEntry(entry) {
    var custom = read(LS.custom, []);
    // 确保 id 唯一
    if (!entry.id) entry.id = 'custom-' + Date.now();
    custom.push(entry);
    write(LS.custom, custom);
    return entry;
  }

  function updateEntry(id, patch) {
    // 先看是否是自定义条目
    var custom = read(LS.custom, []);
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) {
        custom[i] = Object.assign({}, custom[i], patch, { id: id });
        write(LS.custom, custom);
        return true;
      }
    }
    // 否则是内置条目 → 存编辑覆盖
    var edited = read(LS.edited, {});
    var base = (window.KNOWLEDGE_BASE || []).find(function (e) { return e.id === id; });
    if (!base) return false;
    edited[id] = Object.assign({}, base, patch, { id: id });
    write(LS.edited, edited);
    return true;
  }

  function deleteEntry(id) {
    // 自定义条目 → 直接移除
    var custom = read(LS.custom, []);
    var before = custom.length;
    custom = custom.filter(function (e) { return e.id !== id; });
    if (custom.length < before) {
      write(LS.custom, custom);
      return true;
    }
    // 内置条目 → 标记删除
    var deleted = read(LS.deleted, []);
    if (deleted.indexOf(id) === -1) {
      deleted.push(id);
      write(LS.deleted, deleted);
    }
    // 同时清掉可能存在的编辑
    var edited = read(LS.edited, {});
    delete edited[id];
    write(LS.edited, edited);
    return true;
  }

  /** 恢复全部默认知识库（清空管理员修改） */
  function resetKB() {
    try {
      localStorage.removeItem(LS.custom);
      localStorage.removeItem(LS.deleted);
      localStorage.removeItem(LS.edited);
    } catch (e) {}
  }

  /** 导出知识库为 JSON（用于备份/迁移） */
  function exportKB() {
    return JSON.stringify(getEntries(), null, 2);
  }

  /** 从 JSON 导入知识库（替换全部自定义内容） */
  function importKB(jsonStr) {
    try {
      var entries = JSON.parse(jsonStr);
      if (!Array.isArray(entries)) return false;
      // 只保留能识别的字段
      var cleaned = entries.map(function (e, i) {
        return {
          id: e.id || 'imported-' + i + '-' + Date.now(),
          title: String(e.title || '未命名'),
          keywords: Array.isArray(e.keywords) ? e.keywords.map(String) : [],
          answer: String(e.answer || '')
        };
      });
      write(LS.custom, cleaned);
      write(LS.deleted, []);
      write(LS.edited, {});
      return true;
    } catch (e) { return false; }
  }

  /* ---------- API 配置 ---------- */

  function getApiOverrides() {
    return read(LS.api, {});
  }

  function setApiOverrides(patch) {
    var cur = read(LS.api, {});
    write(LS.api, Object.assign(cur, patch));
  }

  function resetApi() {
    try { localStorage.removeItem(LS.api); } catch (e) {}
  }

  /** 合并默认配置 + 管理员覆盖 → 最终生效的 AI 配置 */
  function getEffectiveAi() {
    var def = (window.APP_CONFIG && window.APP_CONFIG.ai) || {};
    var ovr = read(LS.api, {});
    var merged = Object.assign({}, def, ovr);
    // apiKey 始终从 secrets.js 读（不走 localStorage，避免泄露）
    if (def.api) {
      merged.api = Object.assign({}, def.api, {
        apiKey: (window.APP_SECRETS && window.APP_SECRETS.apiKey) || def.api.apiKey || ''
      });
      // model/temperature/maxTokens/systemPrompt 允许覆盖
      if (ovr.model !== undefined) merged.api.model = ovr.model;
      if (ovr.temperature !== undefined) merged.api.temperature = ovr.temperature;
      if (ovr.maxTokens !== undefined) merged.api.maxTokens = ovr.maxTokens;
      if (ovr.systemPrompt !== undefined) merged.api.systemPrompt = ovr.systemPrompt;
    }
    return merged;
  }

  /* ---------- 管理员密码 ---------- */

  function getAdminPassword() {
    var override = null;
    try { override = localStorage.getItem(LS.pw); } catch (e) {}
    if (override) return override;
    return (window.APP_CONFIG && window.APP_CONFIG.admin && window.APP_CONFIG.admin.password) || 'admin123';
  }

  function setAdminPassword(pw) {
    try { localStorage.setItem(LS.pw, pw); } catch (e) {}
  }

  /* ---------- 导出 ---------- */
  window.Store = {
    getEntries: getEntries,
    addEntry: addEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    resetKB: resetKB,
    exportKB: exportKB,
    importKB: importKB,
    getApiOverrides: getApiOverrides,
    setApiOverrides: setApiOverrides,
    resetApi: resetApi,
    getEffectiveAi: getEffectiveAi,
    getAdminPassword: getAdminPassword,
    setAdminPassword: setAdminPassword
  };
})();
