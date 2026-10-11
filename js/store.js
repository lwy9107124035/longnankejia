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
    workflow:       'nfyj_workflow_config',
    audit_logs:     'nfyj_audit_logs',
    notifications:  'nfyj_token_notifications',
    admin_session:  'nfyj_admin_session'
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

  /* ---------- 操作审计日志 ---------- */

  function addAuditLog(actor, action, detail) {
    try {
      var logs = read(LS.audit_logs, []);
      var now = Date.now();
      logs.unshift({
        id: 'log-' + now + '-' + Math.floor(Math.random() * 1000),
        time: now,
        actor: String(actor || '超级管理员'),
        action: String(action || '操作'),
        detail: String(detail || '')
      });
      if (logs.length > 200) logs = logs.slice(0, 200);
      write(LS.audit_logs, logs);
    } catch (e) {}
  }

  function getAuditLogs() {
    return read(LS.audit_logs, []);
  }

  function clearAuditLogs() {
    write(LS.audit_logs, []);
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
    var customKb = read(LS.custom, []);
    var customKepu = read(LS.kepu_custom, []);
    var customDialect = read(LS.dialect_custom, []);

    return list.map(function (item) {
      var isExpired = item.expiresAt && item.expiresAt > 0 && now > item.expiresAt;
      var isRevoked = !!item.revoked;
      var isPaused = !!item.paused && !isRevoked;
      var statusCode = isRevoked ? 'revoked' : (isPaused ? 'paused' : (isExpired ? 'expired' : 'active'));
      var statusText = isRevoked ? '已销毁' : (isPaused ? '已暂停' : (isExpired ? '已过期' : '生效中'));

      var kbCount = customKb.filter(function (e) {
        return e.creatorTokenId === item.id || e.creatorTokenId === item.token;
      }).length;
      var kepuCount = customKepu.filter(function (c) {
        return c.creatorTokenId === item.id || c.creatorTokenId === item.token;
      }).length;
      var dialectCount = customDialect.filter(function (d) {
        return d.creatorTokenId === item.id || d.creatorTokenId === item.token;
      }).length;

      return Object.assign({}, item, {
        isExpired: isExpired,
        isPaused: isPaused,
        isRevoked: isRevoked,
        statusCode: statusCode,
        statusText: statusText,
        loginCount: item.loginCount || 0,
        lastActiveAt: item.lastActiveAt || 0,
        lastClient: item.lastClient || '',
        kbCount: kbCount,
        kepuCount: kepuCount,
        dialectCount: dialectCount,
        totalContributions: kbCount + kepuCount + dialectCount
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
      revoked: false,
      paused: false,
      loginCount: 0,
      lastActiveAt: 0,
      lastClient: ''
    };
    var list = read(LS.tokens, []);
    list.unshift(tokenObj);
    write(LS.tokens, list);
    addAuditLog('超级管理员', '签发令牌', '签发新邀请令牌：' + tokenStr + ' (' + name + ')');
    return tokenObj;
  }

  function pauseInviteToken(tokenId) {
    var list = read(LS.tokens, []);
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === tokenId || list[i].token === tokenId) {
        list[i].paused = true;
        found = list[i];
        break;
      }
    }
    if (found) {
      write(LS.tokens, list);
      addAuditLog('超级管理员', '暂停令牌', '暂停了受邀令牌：' + found.token + ' (' + found.name + ')');
    }
    return !!found;
  }

  function resumeInviteToken(tokenId) {
    var list = read(LS.tokens, []);
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === tokenId || list[i].token === tokenId) {
        list[i].paused = false;
        found = list[i];
        break;
      }
    }
    if (found) {
      write(LS.tokens, list);
      addAuditLog('超级管理员', '恢复令牌', '恢复了受邀令牌：' + found.token + ' (' + found.name + ')');
    }
    return !!found;
  }

  function revokeInviteToken(tokenId) {
    var list = read(LS.tokens, []);
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === tokenId || list[i].token === tokenId) {
        list[i].revoked = true;
        found = list[i];
        break;
      }
    }
    if (found) {
      write(LS.tokens, list);
      addAuditLog('超级管理员', '销毁令牌', '销毁/撤销了受邀令牌：' + found.token + ' (' + found.name + ')');
    }
    return !!found;
  }

  function deleteInviteToken(tokenId) {
    var list = read(LS.tokens, []);
    var target = list.find(function (t) { return t.id === tokenId || t.token === tokenId; });
    var filtered = list.filter(function (t) { return t.id !== tokenId && t.token !== tokenId; });
    write(LS.tokens, filtered);
    if (target) {
      addAuditLog('超级管理员', '删除令牌', '删除了令牌记录：' + target.token + ' (' + target.name + ')');
    }
    return filtered.length < list.length;
  }

  function rollbackTokenChanges(tokenIdOrStr) {
    var tokens = read(LS.tokens, []);
    var tokObj = tokens.find(function (t) { return t.id === tokenIdOrStr || t.token === tokenIdOrStr; });
    var tokId = tokObj ? tokObj.id : tokenIdOrStr;
    var tokCode = tokObj ? tokObj.token : tokenIdOrStr;
    var tokName = tokObj ? tokObj.name : '受邀管理员';

    var customKb = read(LS.custom, []);
    var beforeKb = customKb.length;
    customKb = customKb.filter(function (e) {
      return e.creatorTokenId !== tokId && e.creatorTokenId !== tokCode;
    });
    var removedKb = beforeKb - customKb.length;
    write(LS.custom, customKb);

    var customKepu = read(LS.kepu_custom, []);
    var beforeKepu = customKepu.length;
    customKepu = customKepu.filter(function (c) {
      return c.creatorTokenId !== tokId && c.creatorTokenId !== tokCode;
    });
    var removedKepu = beforeKepu - customKepu.length;
    write(LS.kepu_custom, customKepu);

    var customDialect = read(LS.dialect_custom, []);
    var beforeDialect = customDialect.length;
    customDialect = customDialect.filter(function (d) {
      return d.creatorTokenId !== tokId && d.creatorTokenId !== tokCode;
    });
    var removedDialect = beforeDialect - customDialect.length;
    write(LS.dialect_custom, customDialect);

    var totalRemoved = removedKb + removedKepu + removedDialect;
    addAuditLog('超级管理员', '撤销修改', '回滚撤销了令牌 [' + tokCode + ' · ' + tokName + '] 录入的全部内容，共清除 ' + totalRemoved + ' 项数据');

    // 发送全量撤回通知至该令牌
    if (totalRemoved > 0) {
      addTokenNotification(tokId, {
        targetType: 'all',
        targetTypeName: '全部修改数据',
        targetTitle: '批量录入内容（共 ' + totalRemoved + ' 项）',
        reason: '超级管理员已执行全量回滚，所录入内容已全部撤回'
      });
      if (tokCode && tokCode !== tokId) {
        addTokenNotification(tokCode, {
          targetType: 'all',
          targetTypeName: '全部修改数据',
          targetTitle: '批量录入内容（共 ' + totalRemoved + ' 项）',
          reason: '超级管理员已执行全量回滚，所录入内容已全部撤回'
        });
      }
    }

    return {
      ok: true,
      totalRemoved: totalRemoved,
      removedKb: removedKb,
      removedKepu: removedKepu,
      removedDialect: removedDialect,
      tokenName: tokName,
      tokenCode: tokCode
    };
  }

  /* ---------- 令牌改动明细审查与单项剔除 ---------- */

  function getTokenDetailedContributions(tokenIdOrStr) {
    var tokens = read(LS.tokens, []);
    var tokObj = tokens.find(function (t) { return t.id === tokenIdOrStr || t.token === tokenIdOrStr; });
    var tokId = tokObj ? tokObj.id : tokenIdOrStr;
    var tokCode = tokObj ? tokObj.token : tokenIdOrStr;
    var tokName = tokObj ? tokObj.name : '受邀管理员';

    var customKb = read(LS.custom, []);
    var customKepu = read(LS.kepu_custom, []);
    var customDialect = read(LS.dialect_custom, []);

    var items = [];

    customKb.forEach(function (e) {
      if (e.creatorTokenId === tokId || e.creatorTokenId === tokCode) {
        items.push({
          id: e.id,
          type: 'kb',
          typeName: '知识库条目',
          typeBadge: '📚 知识库',
          title: e.title,
          preview: (e.answer || '').slice(0, 90) + (e.answer && e.answer.length > 90 ? '…' : ''),
          createdAt: e.createdAt || 0,
          raw: e
        });
      }
    });

    customKepu.forEach(function (c) {
      if (c.creatorTokenId === tokId || c.creatorTokenId === tokCode) {
        items.push({
          id: c.id,
          type: 'kepu',
          typeName: '科普卡片',
          typeBadge: '🏮 科普卡片',
          title: c.name,
          preview: (c.detail || c.tag || '').slice(0, 90),
          createdAt: c.createdAt || 0,
          raw: c
        });
      }
    });

    customDialect.forEach(function (d) {
      if (d.creatorTokenId === tokId || d.creatorTokenId === tokCode) {
        var tName = (d.item && d.item.name) || d.name || '方言展品';
        var tUrl = (d.item && d.item.videoUrl) || d.url || '';
        items.push({
          id: d.id,
          type: 'dialect',
          typeName: '方言讲解',
          typeBadge: '🗣 方言讲解',
          title: tName,
          preview: tUrl,
          createdAt: d.createdAt || 0,
          raw: d
        });
      }
    });

    // 默认按创建时间倒序排列
    items.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    return {
      token: tokObj || { id: tokId, token: tokCode, name: tokName },
      items: items
    };
  }

  function rejectTokenItem(tokenIdOrStr, itemId, itemType, reason) {
    reason = String(reason || '内容审核未通过，已被超级管理员剔除').trim();
    var tokens = read(LS.tokens, []);
    var tokObj = tokens.find(function (t) { return t.id === tokenIdOrStr || t.token === tokenIdOrStr; });
    var tokId = tokObj ? tokObj.id : tokenIdOrStr;
    var tokCode = tokObj ? tokObj.token : tokenIdOrStr;
    var tokName = tokObj ? tokObj.name : '受邀管理员';

    var itemTitle = '';
    var typeName = '';

    if (itemType === 'kb') {
      var customKb = read(LS.custom, []);
      var targetKb = customKb.find(function (e) { return e.id === itemId; });
      if (targetKb) {
        itemTitle = targetKb.title;
        typeName = '知识库条目';
        customKb = customKb.filter(function (e) { return e.id !== itemId; });
        write(LS.custom, customKb);
      }
    } else if (itemType === 'kepu') {
      var customKepu = read(LS.kepu_custom, []);
      var targetKepu = customKepu.find(function (c) { return c.id === itemId; });
      if (targetKepu) {
        itemTitle = targetKepu.name;
        typeName = '科普卡片';
        customKepu = customKepu.filter(function (c) { return c.id !== itemId; });
        write(LS.kepu_custom, customKepu);
      }
    } else if (itemType === 'dialect') {
      var customDialect = read(LS.dialect_custom, []);
      var targetDialect = customDialect.find(function (d) { return d.id === itemId; });
      if (targetDialect) {
        itemTitle = (targetDialect.item && targetDialect.item.name) || targetDialect.name || '方言讲解';
        typeName = '方言讲解';
        customDialect = customDialect.filter(function (d) { return d.id !== itemId; });
        write(LS.dialect_custom, customDialect);
      }
    }

    if (!itemTitle) return { ok: false, error: '未找到对应修改条目' };

    // 1. 记入审计流水
    addAuditLog('超级管理员', '剔除修改', '剔除了令牌 [' + tokCode + ' · ' + tokName + '] 录入的' + typeName + '「' + itemTitle + '」，原因：' + reason);

    // 2. 将消息精准派发至该受邀管理员的消息中心
    addTokenNotification(tokId, {
      targetType: itemType,
      targetTypeName: typeName,
      targetTitle: itemTitle,
      reason: reason
    });
    if (tokCode && tokCode !== tokId) {
      addTokenNotification(tokCode, {
        targetType: itemType,
        targetTypeName: typeName,
        targetTitle: itemTitle,
        reason: reason
      });
    }

    return {
      ok: true,
      itemTitle: itemTitle,
      typeName: typeName,
      tokenName: tokName
    };
  }

  /* ---------- 消息通知中心（面向受邀管理员） ---------- */

  function addTokenNotification(tokenIdOrStr, notif) {
    try {
      var list = read(LS.notifications, []);
      var item = {
        id: 'notif-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        tokenId: String(tokenIdOrStr),
        targetType: notif.targetType || 'kb',
        targetTypeName: notif.targetTypeName || '非遗内容',
        targetTitle: notif.targetTitle || '未命名条目',
        reason: notif.reason || '审核未通过',
        time: Date.now(),
        read: false
      };
      list.unshift(item);
      if (list.length > 100) list = list.slice(0, 100);
      write(LS.notifications, list);
      return item;
    } catch (e) { return null; }
  }

  function getTokenNotifications(tokenIdOrStr) {
    var list = read(LS.notifications, []);
    if (!tokenIdOrStr) return list;
    var str = String(tokenIdOrStr);
    return list.filter(function (n) {
      return n.tokenId === str;
    });
  }

  function markTokenNotificationRead(notifId) {
    var list = read(LS.notifications, []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === notifId) {
        list[i].read = true;
        break;
      }
    }
    write(LS.notifications, list);
  }

  function clearTokenNotifications(tokenIdOrStr) {
    var list = read(LS.notifications, []);
    if (!tokenIdOrStr) {
      write(LS.notifications, []);
    } else {
      var str = String(tokenIdOrStr);
      var filtered = list.filter(function (n) { return n.tokenId !== str; });
      write(LS.notifications, filtered);
    }
  }

  function verifyLogin(inputStr) {
    var str = String(inputStr || '').trim();
    if (!str) {
      return { ok: false, error: '请输入密码或邀请令牌' };
    }
    // 1. 匹配超级管理员主密码
    if (str === getAdminPassword()) {
      addAuditLog('超级管理员', '主密登录', '超级管理员成功登录工作台');
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
          return { ok: false, error: '此邀请令牌已被销毁或撤销，请联系超级管理员' };
        }
        if (item.paused) {
          return { ok: false, error: '此邀请令牌已被超级管理员临时暂停使用' };
        }
        if (item.expiresAt && item.expiresAt > 0 && now > item.expiresAt) {
          return { ok: false, error: '此邀请令牌已过期，请联系超级管理员重新签发' };
        }
        // 更新活跃信息
        item.loginCount = (item.loginCount || 0) + 1;
        item.lastActiveAt = now;
        item.lastClient = (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.indexOf('Windows') !== -1) ? 'Windows 电脑端' : '移动端/其它';
        write(LS.tokens, tokens);
        addAuditLog(item.name + ' (' + item.token + ')', '令牌登录', '受邀管理员登录工作台');

        return {
          ok: true,
          role: 'editor',
          title: '受邀管理员 · ' + item.name,
          name: item.name,
          tokenId: item.id,
          token: item.token
        };
      }
    }
    return { ok: false, error: '密码错误或邀请令牌无效' };
  }

  /* ---------- 管理员持久登录会话管理 ---------- */
  function saveSession(sessionData) {
    if (!sessionData) return;
    write(LS.admin_session, {
      role: sessionData.role || 'editor',
      name: sessionData.name || '管理员',
      title: sessionData.title || '',
      tokenId: sessionData.tokenId || '',
      token: sessionData.token || '',
      loginAt: Date.now()
    });
  }

  function getSession() {
    var s = read(LS.admin_session, null);
    if (!s || !s.role) return null;
    if (s.role === 'super_admin') return s;
    if (s.role === 'editor') {
      var tokens = getTokens();
      var found = tokens.find(function (t) {
        return (s.tokenId && t.id === s.tokenId) || (s.token && t.token === s.token);
      });
      if (!found || found.status !== 'active') {
        clearSession();
        return null;
      }
      return {
        role: 'editor',
        name: found.name,
        title: found.title,
        tokenId: found.id,
        token: found.token,
        loginAt: s.loginAt
      };
    }
    return null;
  }

  function clearSession() {
    try {
      localStorage.removeItem(LS.admin_session);
    } catch (_) {}
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

  function addEntry(entry, creatorInfo) {
    var custom = read(LS.custom, []);
    if (!entry.id) entry.id = 'custom-' + Date.now();
    if (creatorInfo) {
      entry.creatorName = creatorInfo.name || '受邀管理员';
      entry.creatorTokenId = creatorInfo.tokenId || creatorInfo.token || '';
    } else {
      entry.creatorName = '超级管理员';
    }
    entry.createdAt = Date.now();
    custom.push(entry);
    write(LS.custom, custom);
    addAuditLog(entry.creatorName, '新增知识', '新增知识条目「' + entry.title + '」');
    return entry;
  }

  function updateEntry(id, patch, creatorInfo) {
    var custom = read(LS.custom, []);
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) {
        custom[i] = Object.assign({}, custom[i], patch, { id: id });
        write(LS.custom, custom);
        addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '更新知识', '更新了知识条目「' + custom[i].title + '」');
        return true;
      }
    }
    var edited = read(LS.edited, {});
    var base = (window.KNOWLEDGE_BASE || []).find(function (e) { return e.id === id; });
    if (!base) return false;
    edited[id] = Object.assign({}, base, patch, { id: id });
    write(LS.edited, edited);
    addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '更新知识', '编辑内置知识条目「' + edited[id].title + '」');
    return true;
  }

  function deleteEntry(id, creatorInfo) {
    var custom = read(LS.custom, []);
    var before = custom.length;
    custom = custom.filter(function (e) { return e.id !== id; });
    if (custom.length < before) {
      write(LS.custom, custom);
      addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '删除知识', '删除了自定义条目 ID:' + id);
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
    addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '删除知识', '删除了内置条目 ID:' + id);
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

  function addHeritageCard(card, creatorInfo) {
    if (!card.id) card.id = 'kepu-' + Date.now();
    if (creatorInfo) {
      card.creatorName = creatorInfo.name || '受邀管理员';
      card.creatorTokenId = creatorInfo.tokenId || creatorInfo.token || '';
    } else {
      card.creatorName = '超级管理员';
    }
    card.createdAt = Date.now();
    var custom = read(LS.kepu_custom, []);
    custom.push(card);
    write(LS.kepu_custom, custom);
    addAuditLog(card.creatorName, '新增科普', '新增非遗卡片「' + card.name + '」');
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

  function deleteHeritageCard(id, creatorInfo) {
    var custom = read(LS.kepu_custom, []);
    var before = custom.length;
    custom = custom.filter(function (c) { return c.id !== id; });
    if (custom.length < before) {
      write(LS.kepu_custom, custom);
      addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '删除科普', '删除科普卡片 ID:' + id);
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
    addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '删除科普', '删除科普卡片 ID:' + id);
    return true;
  }

  /* ---------- 方言模块管理 ---------- */

  function getCustomDialectTracks() {
    return read(LS.dialect_custom, []);
  }

  function addDialectTrack(track, creatorInfo) {
    if (!track.id) track.id = 'dialect-' + Date.now();
    if (creatorInfo) {
      track.creatorName = creatorInfo.name || '受邀管理员';
      track.creatorTokenId = creatorInfo.tokenId || creatorInfo.token || '';
    } else {
      track.creatorName = '超级管理员';
    }
    track.createdAt = Date.now();
    var list = read(LS.dialect_custom, []);
    list.push(track);
    write(LS.dialect_custom, list);
    var trackName = (track.item && track.item.name) || track.name || '';
    addAuditLog(track.creatorName, '新增方言', '新增客家方言讲解「' + trackName + '」');
    return track;
  }

  function deleteDialectTrack(id, creatorInfo) {
    var list = read(LS.dialect_custom, []);
    var filtered = list.filter(function (t) { return (t.id || t.item && t.item.name) !== id; });
    write(LS.dialect_custom, filtered);
    addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '删除方言', '删除方言展品语音 ID:' + id);
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
    pauseInviteToken: pauseInviteToken,
    resumeInviteToken: resumeInviteToken,
    revokeInviteToken: revokeInviteToken,
    deleteInviteToken: deleteInviteToken,
    rollbackTokenChanges: rollbackTokenChanges,
    getTokenDetailedContributions: getTokenDetailedContributions,
    rejectTokenItem: rejectTokenItem,
    verifyLogin: verifyLogin,
    saveSession: saveSession,
    getSession: getSession,
    clearSession: clearSession,
    getAuditLogs: getAuditLogs,
    clearAuditLogs: clearAuditLogs,
    addAuditLog: addAuditLog,

    // 消息通知中心
    getTokenNotifications: getTokenNotifications,
    addTokenNotification: addTokenNotification,
    markTokenNotificationRead: markTokenNotificationRead,
    clearTokenNotifications: clearTokenNotifications,

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
