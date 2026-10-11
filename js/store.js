/**
 * 数据存储层 —— 邀请制权限与多模块配置层
 * ------------------------------------------------------------
 * 1. 知识库覆盖 (nfyj_kb_custom / deleted / edited)
 * 2. 科普卡片覆盖 (nfyj_kepu_custom / deleted / edited)
 * 3. 方言语音覆盖 (nfyj_dialect_custom / deleted)
 * 4. AI 模型与工作流配置 (nfyj_api_config / nfyj_workflow_config)
 * 5. 权限体系：超级管理员主口令 + 专属邀请令牌 (nfyj_admin_tokens)
 * 6. 全站数智资产包一键打包导出与恢复
 */
(function () {
  'use strict';

  var LS = {
    custom:         'nfyj_kb_custom',
    deleted:        'nfyj_kb_deleted',
    edited:         'nfyj_kb_edited',
    api:            'nfyj_api_config',
    pw:             'nfyj_admin_pw',
    tokens:         'nfyj_admin_tokens',
    kepu_custom:    'nfyj_kepu_custom',
    kepu_deleted:   'nfyj_kepu_deleted',
    kepu_edited:    'nfyj_kepu_edited',
    dialect_custom: 'nfyj_dialect_custom',
    dialect_deleted:'nfyj_dialect_deleted',
    workflow:       'nfyj_workflow_config'
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

  /* ---------- 权限与邀请令牌体系 ---------- */

  function getAdminPassword() {
    var override = null;
    try { override = localStorage.getItem(LS.pw); } catch (e) {}
    if (override) return override;
    return (window.APP_CONFIG && window.APP_CONFIG.admin && window.APP_CONFIG.admin.password) || 'admin123';
  }

  function setAdminPassword(pw) {
    try { localStorage.setItem(LS.pw, pw); } catch (e) {}
  }

  function getInviteTokens() {
    var list = read(LS.tokens, []);
    var now = Date.now();
    return list.map(function (item) {
      var isExpired = item.expiresAt && item.expiresAt > 0 && now > item.expiresAt;
      return Object.assign({}, item, {
        isExpired: isExpired,
        statusText: item.revoked ? '已撤销' : (isExpired ? '已过期' : '生效中')
      });
    });
  }

  function generateInviteToken(name, expireDays) {
    name = String(name || '受邀管理员').trim();
    var days = Number(expireDays) || 30;
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    var tokenStr = 'NFYJ-INV-' + code;
    var now = Date.now();
    var tokenObj = {
      id: 'tok-' + now + '-' + Math.floor(Math.random() * 1000),
      token: tokenStr,
      name: name,
      role: 'editor',
      createdAt: now,
      expiresAt: days > 0 ? (now + days * 86400000) : 0,
      revoked: false
    };
    var list = read(LS.tokens, []);
    list.unshift(tokenObj);
    write(LS.tokens, list);
    return tokenObj;
  }

  function revokeInviteToken(tokenId) {
    var list = read(LS.tokens, []);
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === tokenId || list[i].token === tokenId) {
        list[i].revoked = true;
        found = true;
        break;
      }
    }
    if (found) write(LS.tokens, list);
    return found;
  }

  function deleteInviteToken(tokenId) {
    var list = read(LS.tokens, []);
    var filtered = list.filter(function (t) { return t.id !== tokenId && t.token !== tokenId; });
    write(LS.tokens, filtered);
    return filtered.length < list.length;
  }

  function verifyLogin(inputStr) {
    var str = String(inputStr || '').trim();
    if (!str) {
      return { ok: false, error: '请输入密码或邀请令牌' };
    }
    // 1. 匹配超级管理员主密码
    if (str === getAdminPassword()) {
      return {
        ok: true,
        role: 'super_admin',
        title: '超级管理员',
        name: '超级管理员'
      };
    }
    // 2. 匹配邀请令牌
    var tokens = read(LS.tokens, []);
    var now = Date.now();
    for (var i = 0; i < tokens.length; i++) {
      var item = tokens[i];
      if (item.token === str) {
        if (item.revoked) {
          return { ok: false, error: '此邀请令牌已被撤销，请联系超级管理员' };
        }
        if (item.expiresAt && item.expiresAt > 0 && now > item.expiresAt) {
          return { ok: false, error: '此邀请令牌已过期，请联系超级管理员重新签发' };
        }
        return {
          ok: true,
          role: 'editor',
          title: '受邀管理员 · ' + item.name,
          name: item.name,
          tokenId: item.id
        };
      }
    }
    return { ok: false, error: '密码错误或邀请令牌无效' };
  }

  /* ---------- 知识库 ---------- */

  function getEntries() {
    var base = (window.KNOWLEDGE_BASE || []).slice();
    var deleted = read(LS.deleted, []);
    var edited  = read(LS.edited, {});
    var custom  = read(LS.custom, []);

    var merged = base
      .filter(function (e) { return deleted.indexOf(e.id) === -1; })
      .map(function (e) { return edited[e.id] || e; });

    return merged.concat(custom);
  }

  function addEntry(entry) {
    var custom = read(LS.custom, []);
    if (!entry.id) entry.id = 'custom-' + Date.now();
    custom.push(entry);
    write(LS.custom, custom);
    return entry;
  }

  function updateEntry(id, patch) {
    var custom = read(LS.custom, []);
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) {
        custom[i] = Object.assign({}, custom[i], patch, { id: id });
        write(LS.custom, custom);
        return true;
      }
    }
    var edited = read(LS.edited, {});
    var base = (window.KNOWLEDGE_BASE || []).find(function (e) { return e.id === id; });
    if (!base) return false;
    edited[id] = Object.assign({}, base, patch, { id: id });
    write(LS.edited, edited);
    return true;
  }

  function deleteEntry(id) {
    var custom = read(LS.custom, []);
    var before = custom.length;
    custom = custom.filter(function (e) { return e.id !== id; });
    if (custom.length < before) {
      write(LS.custom, custom);
      return true;
    }
    var deleted = read(LS.deleted, []);
    if (deleted.indexOf(id) === -1) {
      deleted.push(id);
      write(LS.deleted, deleted);
    }
    var edited = read(LS.edited, {});
    delete edited[id];
    write(LS.edited, edited);
    return true;
  }

  function resetKB() {
    try {
      localStorage.removeItem(LS.custom);
      localStorage.removeItem(LS.deleted);
      localStorage.removeItem(LS.edited);
    } catch (e) {}
  }

  function exportKB() {
    return JSON.stringify(getEntries(), null, 2);
  }

  function importKB(jsonStr) {
    try {
      var entries = JSON.parse(jsonStr);
      if (!Array.isArray(entries)) return false;
      var cleaned = entries.map(function (e, i) {
        return {
          id: e.id || 'imported-' + i + '-' + Date.now(),
          title: String(e.title || '未命名'),
          keywords: Array.isArray(e.keywords) ? e.keywords.map(String) : [],
          answer: String(e.answer || ''),
          topics: Array.isArray(e.topics) ? e.topics.map(String) : undefined,
          aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : undefined,
          relatedTopics: Array.isArray(e.relatedTopics) ? e.relatedTopics.map(String) : [],
          sources: Array.isArray(e.sources) ? e.sources.map(function(s) { return { title: String(s.title || ''), url: String(s.url || '') }; }) : []
        };
      });
      write(LS.custom, cleaned);
      write(LS.deleted, []);
      write(LS.edited, {});
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 科普模块卡片管理 ---------- */

  function getHeritageCards(defaultCards) {
    var base = Array.isArray(defaultCards) ? defaultCards.slice() : [];
    var deleted = read(LS.kepu_deleted, []);
    var edited = read(LS.kepu_edited, {});
    var custom = read(LS.kepu_custom, []);

    var merged = base
      .filter(function (c) { return deleted.indexOf(c.id) === -1; })
      .map(function (c) { return edited[c.id] || c; });

    return merged.concat(custom);
  }

  function addHeritageCard(card) {
    if (!card.id) card.id = 'kepu-' + Date.now();
    var custom = read(LS.kepu_custom, []);
    custom.push(card);
    write(LS.kepu_custom, custom);
    return card;
  }

  function updateHeritageCard(id, patch) {
    var custom = read(LS.kepu_custom, []);
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) {
        custom[i] = Object.assign({}, custom[i], patch, { id: id });
        write(LS.kepu_custom, custom);
        return true;
      }
    }
    var edited = read(LS.kepu_edited, {});
    edited[id] = Object.assign({}, patch, { id: id });
    write(LS.kepu_edited, edited);
    return true;
  }

  function deleteHeritageCard(id) {
    var custom = read(LS.kepu_custom, []);
    var before = custom.length;
    custom = custom.filter(function (c) { return c.id !== id; });
    if (custom.length < before) {
      write(LS.kepu_custom, custom);
      return true;
    }
    var deleted = read(LS.kepu_deleted, []);
    if (deleted.indexOf(id) === -1) {
      deleted.push(id);
      write(LS.kepu_deleted, deleted);
    }
    var edited = read(LS.kepu_edited, {});
    delete edited[id];
    write(LS.kepu_edited, edited);
    return true;
  }

  /* ---------- 方言模块管理 ---------- */

  function getCustomDialectTracks() {
    return read(LS.dialect_custom, []);
  }

  function addDialectTrack(track) {
    if (!track.id) track.id = 'dialect-' + Date.now();
    var list = read(LS.dialect_custom, []);
    list.push(track);
    write(LS.dialect_custom, list);
    return track;
  }

  function deleteDialectTrack(id) {
    var list = read(LS.dialect_custom, []);
    var filtered = list.filter(function (t) { return (t.id || t.item && t.item.name) !== id; });
    write(LS.dialect_custom, filtered);
    return filtered.length < list.length;
  }

  /* ---------- AI 模型与工作流配置 ---------- */

  function getApiOverrides() {
    return read(LS.api, {});
  }

  function setApiOverrides(patch) {
    var cur = read(LS.api, {});
    write(LS.api, Object.assign(cur, patch));
  }

  function resetApi() {
    try {
      localStorage.removeItem(LS.api);
      localStorage.removeItem(LS.workflow);
    } catch (e) {}
  }

  function getWorkflowConfig() {
    return read(LS.workflow, {
      systemPrompt: '你是龙南客家非遗数字助手的虚拟讲解员「阿蓝」。说话要亲切热情、尊重文献事实。介绍客家文化时条理清晰，遇未提及事实如实说明。',
      strictMode: true,
      minScore: 1.0,
      enableThinking: false
    });
  }

  function setWorkflowConfig(patch) {
    var cur = getWorkflowConfig();
    write(LS.workflow, Object.assign(cur, patch));
  }

  function getEffectiveAi() {
    var def = (window.APP_CONFIG && window.APP_CONFIG.ai) || {};
    var ovr = read(LS.api, {});
    var merged = Object.assign({}, def, ovr);
    if (def.api) {
      merged.api = Object.assign({}, def.api, {
        apiKey: (window.APP_SECRETS && window.APP_SECRETS.apiKey) || def.api.apiKey || ''
      });
      if (ovr.model !== undefined) merged.api.model = ovr.model;
      if (ovr.temperature !== undefined) merged.api.temperature = ovr.temperature;
      if (ovr.maxTokens !== undefined) merged.api.maxTokens = ovr.maxTokens;
    }
    return merged;
  }

  /* ---------- 全站资产一键备份与恢复 ---------- */

  function exportFullBundle() {
    var bundle = {
      app: '龙南客家非遗数字助手',
      version: 'v2-pro',
      exportedAt: new Date().toISOString(),
      knowledgeBase: getEntries(),
      heritageCardsCustom: read(LS.kepu_custom, []),
      heritageCardsEdited: read(LS.kepu_edited, {}),
      dialectTracksCustom: read(LS.dialect_custom, []),
      apiConfig: getApiOverrides(),
      workflowConfig: getWorkflowConfig()
    };
    return JSON.stringify(bundle, null, 2);
  }

  function importFullBundle(jsonStr) {
    try {
      var data = JSON.parse(jsonStr);
      if (!data || typeof data !== 'object') return false;
      if (Array.isArray(data.knowledgeBase)) {
        importKB(JSON.stringify(data.knowledgeBase));
      }
      if (Array.isArray(data.heritageCardsCustom)) {
        write(LS.kepu_custom, data.heritageCardsCustom);
      }
      if (data.heritageCardsEdited && typeof data.heritageCardsEdited === 'object') {
        write(LS.kepu_edited, data.heritageCardsEdited);
      }
      if (Array.isArray(data.dialectTracksCustom)) {
        write(LS.dialect_custom, data.dialectTracksCustom);
      }
      if (data.apiConfig) {
        write(LS.api, data.apiConfig);
      }
      if (data.workflowConfig) {
        write(LS.workflow, data.workflowConfig);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- 导出接口 ---------- */
  window.Store = {
    // 权限与邀请令牌
    getAdminPassword: getAdminPassword,
    setAdminPassword: setAdminPassword,
    getInviteTokens: getInviteTokens,
    generateInviteToken: generateInviteToken,
    revokeInviteToken: revokeInviteToken,
    deleteInviteToken: deleteInviteToken,
    verifyLogin: verifyLogin,

    // 知识库
    getEntries: getEntries,
    addEntry: addEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    resetKB: resetKB,
    exportKB: exportKB,
    importKB: importKB,

    // 科普卡片
    getHeritageCards: getHeritageCards,
    addHeritageCard: addHeritageCard,
    updateHeritageCard: updateHeritageCard,
    deleteHeritageCard: deleteHeritageCard,

    // 方言语音
    getCustomDialectTracks: getCustomDialectTracks,
    addDialectTrack: addDialectTrack,
    deleteDialectTrack: deleteDialectTrack,

    // AI 模型与工作流
    getApiOverrides: getApiOverrides,
    setApiOverrides: setApiOverrides,
    resetApi: resetApi,
    getEffectiveAi: getEffectiveAi,
    getWorkflowConfig: getWorkflowConfig,
    setWorkflowConfig: setWorkflowConfig,

    // 全站资产包
    exportFullBundle: exportFullBundle,
    importFullBundle: importFullBundle
  };
})();
