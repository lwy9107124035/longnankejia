/**
 * 数据存储层 —— 邀请制权限与多模块配置层
 * ------------------------------------------------------------
 * 1. 知识库覆盖 (nfyj_kb_custom / deleted / edited)
 * 2. 科普卡片覆盖 (nfyj_kepu_custom / deleted / edited)
 * 3. 方言语音覆盖 (nfyj_dialect_custom / deleted)
 * 4. AI 模型与工作流配置 (nfyj_api_config / nfyj_workflow_config)
 * 5. 服务端管理员鉴权与独立标签页会话，邀请记录仅在当前页面缓存
 * 6. 全站数智资产包一键打包导出与恢复
 */
(function () {
  'use strict';

  var LS = {
    custom:         'nfyj_kb_custom',
    deleted:        'nfyj_kb_deleted',
    edited:         'nfyj_kb_edited',
    api:            'nfyj_api_config',
    tokens:         'nfyj_admin_tokens',
    kepu_custom:    'nfyj_kepu_custom',
    kepu_deleted:   'nfyj_kepu_deleted',
    kepu_edited:    'nfyj_kepu_edited',
    dialect_custom: 'nfyj_dialect_custom',
    dialect_deleted:'nfyj_dialect_deleted',
    workflow:       'nfyj_workflow_config',
    audit_logs:     'nfyj_audit_logs',
    notifications:  'nfyj_token_notifications',
    locked_clients: 'nfyj_locked_clients'
  };

  var SS = {
    admin_session:  'nfyj_tab_admin_session'
  };

  var memoryValues = {};
  function read(key, fallback) {
    if (key === LS.tokens || key === LS.locked_clients) return memoryValues[key] || fallback;
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return Object.prototype.hasOwnProperty.call(memoryValues, key) ? memoryValues[key] : fallback; }
  }

  function write(key, val) {
    memoryValues[key] = val;
    if (key === LS.tokens || key === LS.locked_clients) return;
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function remove(key) {
    delete memoryValues[key];
    try { localStorage.removeItem(key); } catch (_) {}
  }

  var memorySession = null;
  function readSession(fallback) {
    try {
      var raw = sessionStorage.getItem(SS.admin_session);
      return raw ? JSON.parse(raw) : (memorySession || fallback);
    } catch (_) { return memorySession || fallback; }
  }
  function writeSession(value) {
    memorySession = value;
    try { sessionStorage.setItem(SS.admin_session, JSON.stringify(value)); } catch (_) {}
  }
  function removeSession() {
    memorySession = null;
    try { sessionStorage.removeItem(SS.admin_session); } catch (_) {}
  }

  function normalizeAuthInput(raw) {
    return String(raw || '').replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/\u3000/g, ' ').trim();
  }
  function getSyncEndpoint() {
    var location = window.location || {};
    if (location.hostname === 'lwy9107124035.github.io') return 'https://longnankejia.pages.dev/api/admin/sync';
    return '/api/admin/sync';
  }

  function getClientId() {
    var cid = read('nfyj_memory_client_id', '');
    try {
      cid = localStorage.getItem('nfyj_client_id');
      if (!cid) {
        cid = 'cid-' + Date.now() + '-' + Math.floor(Math.random() * 1000000).toString(36);
        localStorage.setItem('nfyj_client_id', cid);
      }
    } catch (_) {
      if (!cid) cid = 'cid-temp-' + Date.now();
      memoryValues.nfyj_memory_client_id = cid;
    }
    return cid;
  }

  function detectClientInfo() {
    var ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    var platform = '电脑端';
    if (/iPhone|iPod/i.test(ua)) platform = 'iPhone 手机端';
    else if (/iPad/i.test(ua)) platform = 'iPad 平板端';
    else if (/Android/i.test(ua)) platform = 'Android 手机端';
    else if (/Windows/i.test(ua)) platform = 'Windows 电脑端';
    else if (/Mac/i.test(ua)) platform = 'Mac 电脑端';

    var browser = '浏览器';
    if (/MicroMessenger/i.test(ua)) browser = '微信内嵌浏览器';
    else if (/Chrome/i.test(ua)) browser = 'Chrome';
    else if (/Safari/i.test(ua)) browser = 'Safari';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';

    var cachedIp = '';
    var cachedGeo = '';
    try {
      cachedIp = sessionStorage.getItem('nfyj_client_ip') || localStorage.getItem('nfyj_client_ip') || '';
      cachedGeo = sessionStorage.getItem('nfyj_client_geo') || localStorage.getItem('nfyj_client_geo') || '';
    } catch (_) {}

    return {
      clientId: getClientId(),
      ip: cachedIp || '127.0.0.1 (本机/局域网)',
      geo: cachedGeo || '局域网/当前网络',
      device: platform + ' · ' + browser,
      ua: ua
    };
  }

  var CONTENT_KEYS = {
    kbCustom: LS.custom, kbEdited: LS.edited, kbDeleted: LS.deleted,
    kepuCustom: LS.kepu_custom, kepuEdited: LS.kepu_edited, kepuDeleted: LS.kepu_deleted,
    dialectCustom: LS.dialect_custom, dialectDeleted: LS.dialect_deleted,
    apiConfig: LS.api, workflowConfig: LS.workflow, auditLogs: LS.audit_logs
  };
  var OBJECT_KEYS = ['kbEdited', 'kepuEdited', 'apiConfig', 'workflowConfig'];
  var cloudRevision = read('nfyj_cloud_revision', null);
  var pending = read('nfyj_cloud_pending', false);
  var generation = 0;
  var uploadPromise = null;
  var pullPromise = null;
  var syncStatus = { status: 'idle', message: '等待连接云端' };
  // Keep pre-upgrade local edits until an authenticated upload or an explicit discard.
  if (cloudRevision === null) {
    pending = Object.keys(CONTENT_KEYS).some(function (key) {
      if (key === 'auditLogs') return false;
      return Object.keys(read(CONTENT_KEYS[key], {})).length > 0;
    });
    if (pending) { cloudRevision = 0; write('nfyj_cloud_pending', true); }
  }
  function setSyncStatus(status, message) {
    syncStatus = { status: status, message: message };
    if (window.dispatchEvent && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('admin-sync-status', { detail: syncStatus }));
    }
  }
  async function cloudRequest(body) {
    if (typeof fetch === 'undefined') throw new Error('当前环境不能连接管理服务器');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    var session = getSession();
    var headers = {};
    if (session) headers.Authorization = 'Bearer ' + session.bearer;
    if (body) headers['Content-Type'] = 'application/json';
    try {
      var response = await fetch(getSyncEndpoint(), {
        method: body ? 'POST' : 'GET', headers: headers, cache: 'no-store', signal: controller.signal,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!(response.headers.get('Content-Type') || '').includes('application/json')) {
        throw Object.assign(new Error('此网址的管理接口尚未部署，请联系网站维护人员。'), { code: 'ENDPOINT_UNAVAILABLE' });
      }
      var data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.code === 'SESSION_EXPIRED') clearSession();
        throw Object.assign(new Error(data.error || '管理服务器请求失败'), data, { status: response.status });
      }
      return data;
    } catch (error) {
      if (error.code) throw error;
      throw Object.assign(new Error('暂时连不上管理服务器，请检查网络后重试。本机编辑已保留。'), { code: 'NETWORK_ERROR' });
    } finally { clearTimeout(timer); }
  }
  function bundle() {
    var data = {};
    Object.keys(CONTENT_KEYS).forEach(function (key) {
      data[key] = read(CONTENT_KEYS[key], OBJECT_KEYS.indexOf(key) >= 0 ? {} : []);
    });
    return data;
  }
  function triggerFrontEndRefresh() {
    var h = window.Heritage || (window.UI && window.UI.Heritage);
    if (h && h.render) h.render();
    if (window.Dialect && window.Dialect.refresh) window.Dialect.refresh();
    if (window.AnswerEngine && window.AnswerEngine.reset) window.AnswerEngine.reset();
  }
  function applyCloud(data) {
    Object.keys(CONTENT_KEYS).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(data, key)) write(CONTENT_KEYS[key], data[key]);
    });
    cloudRevision = data.revision;
    write('nfyj_cloud_revision', cloudRevision);
    triggerFrontEndRefresh();
  }
  async function uploadPending() {
    if (!pending) return true;
    if (!getSession()) { setSyncStatus('pending', '本机有未同步编辑，登录后可上传云端'); return false; }
    if (syncStatus.status === 'conflict') return false;
    if (uploadPromise) return uploadPromise;
    uploadPromise = (async function () {
      try {
        while (pending) {
          var sentGeneration = generation;
          var data = await cloudRequest(Object.assign({ action: 'update_custom_bundle', revision: cloudRevision === null ? 0 : cloudRevision }, bundle()));
          cloudRevision = data.revision;
          write('nfyj_cloud_revision', cloudRevision);
          if (sentGeneration === generation) { pending = false; write('nfyj_cloud_pending', false); }
        }
        setSyncStatus('saved', '已保存到云端，其他设备可同步查看');
        return true;
      } catch (error) {
        setSyncStatus(error.code === 'SYNC_CONFLICT' ? 'conflict' : 'error', error.message);
        return false;
      } finally { uploadPromise = null; }
    })();
    return uploadPromise;
  }
  function syncCustomToCloud(callback) {
    pending = true;
    generation++;
    write('nfyj_cloud_pending', true);
    if (syncStatus.status !== 'conflict') setSyncStatus('pending', '已保存到本机，正在同步云端…');
    var result = uploadPending();
    if (typeof callback === 'function') result.then(callback);
    return result;
  }
  function syncWithCloud(callback) {
    if (!pullPromise) pullPromise = (async function () {
      try {
        if (pending && !(await uploadPending())) return null;
        var data = await cloudRequest();
        if (Array.isArray(data.tokens)) write(LS.tokens, data.tokens);
        if (Array.isArray(data.lockouts)) write(LS.locked_clients, data.lockouts);
        if (!pending && cloudRevision !== data.revision) applyCloud(data);
        setSyncStatus('saved', '已与云端同步');
        return data;
      } catch (error) {
        setSyncStatus('error', error.message);
        return null;
      } finally { pullPromise = null; }
    })();
    if (typeof callback === 'function') pullPromise.then(callback);
    return pullPromise;
  }
  async function reloadCloudContent() {
    var data = await cloudRequest();
    pending = false;
    write('nfyj_cloud_pending', false);
    applyCloud(data);
    setSyncStatus('saved', '已重新加载云端内容');
    return data;
  }
  function getLockedClients() { return read(LS.locked_clients, []); }
  async function unlockClient(id) { await cloudRequest({ action: 'unlock', id: id }); return syncWithCloud(); }
  async function unlockAllClients() { await cloudRequest({ action: 'unlock_all' }); return syncWithCloud(); }

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
    syncCustomToCloud();
  }

  /* ---------- 权限与邀请令牌体系 ---------- */

  async function setAdminPassword(password) {
    return cloudRequest({ action: 'update_password', password: normalizeAuthInput(password) });
  }

  function getInviteTokens() {
    var list = read(LS.tokens, []).filter(function (t) {
      return t && t.id && t.id.indexOf('tok-short-') !== 0 && t.name !== '受邀协管员';
    });
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

  async function generateInviteToken(name, days) {
    var data = await cloudRequest({ action: 'create_token', name: name, days: days });
    write(LS.tokens, data.tokens);
    return data.token;
  }
  async function changeInviteToken(id, operation) {
    var data = await cloudRequest({ action: 'change_token', id: id, operation: operation });
    write(LS.tokens, data.tokens);
    return true;
  }
  function pauseInviteToken(id) { return changeInviteToken(id, 'pause'); }
  function resumeInviteToken(id) { return changeInviteToken(id, 'resume'); }
  function revokeInviteToken(id) { return changeInviteToken(id, 'revoke'); }
  function deleteInviteToken(id) { return changeInviteToken(id, 'delete'); }

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
    syncCustomToCloud();

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

    syncCustomToCloud();
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

  async function verifyLogin(input) {
    try {
      var info = detectClientInfo();
      return await cloudRequest({ action: 'login', credential: normalizeAuthInput(input), clientId: info.clientId, device: info.device });
    } catch (error) {
      return { ok: false, error: error.message, code: error.code, lockedUntil: error.lockedUntil };
    }
  }
  function saveSession(data) {
    if (data && data.bearer && data.expiresAt) writeSession(data);
  }
  function getSession() {
    var data = readSession(null);
    if (!data || !data.bearer || data.expiresAt <= Date.now()) { removeSession(); return null; }
    return data;
  }
  function clearSession() {
    removeSession();
    write(LS.tokens, []);
    write(LS.locked_clients, []);
  }
  async function logout() {
    try { await cloudRequest({ action: 'logout' }); } finally { clearSession(); }
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
    syncCustomToCloud();
    return entry;
  }

  function updateEntry(id, patch, creatorInfo) {
    var custom = read(LS.custom, []);
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) {
        custom[i] = Object.assign({}, custom[i], patch, { id: id });
        write(LS.custom, custom);
        addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '更新知识', '更新了知识条目「' + custom[i].title + '」');
        syncCustomToCloud();
        return true;
      }
    }
    var edited = read(LS.edited, {});
    var base = (window.KNOWLEDGE_BASE || []).find(function (e) { return e.id === id; });
    if (!base) return false;
    edited[id] = Object.assign({}, base, patch, { id: id });
    write(LS.edited, edited);
    addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '更新知识', '编辑内置知识条目「' + edited[id].title + '」');
    syncCustomToCloud();
    return true;
  }

  function deleteEntry(id, creatorInfo) {
    var custom = read(LS.custom, []);
    var before = custom.length;
    custom = custom.filter(function (e) { return e.id !== id; });
    if (custom.length < before) {
      write(LS.custom, custom);
      addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '删除知识', '删除了自定义条目 ID:' + id);
      syncCustomToCloud();
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
    syncCustomToCloud();
    return true;
  }

  function resetKB() {
    try {
      remove(LS.custom);
      remove(LS.deleted);
      remove(LS.edited);
      syncCustomToCloud();
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
      syncCustomToCloud();
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
    syncCustomToCloud();
    return card;
  }

  function updateHeritageCard(id, patch) {
    var custom = read(LS.kepu_custom, []);
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) {
        custom[i] = Object.assign({}, custom[i], patch, { id: id });
        write(LS.kepu_custom, custom);
        syncCustomToCloud();
        return true;
      }
    }
    var edited = read(LS.kepu_edited, {});
    edited[id] = Object.assign({}, patch, { id: id });
    write(LS.kepu_edited, edited);
    syncCustomToCloud();
    return true;
  }

  function deleteHeritageCard(id, creatorInfo) {
    var custom = read(LS.kepu_custom, []);
    var before = custom.length;
    custom = custom.filter(function (c) { return c.id !== id; });
    if (custom.length < before) {
      write(LS.kepu_custom, custom);
      addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '删除科普', '删除科普卡片 ID:' + id);
      syncCustomToCloud();
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
    syncCustomToCloud();
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
    syncCustomToCloud();
    return track;
  }

  function deleteDialectTrack(id, creatorInfo) {
    var list = read(LS.dialect_custom, []);
    var filtered = list.filter(function (t) { return (t.id || t.item && t.item.name) !== id; });
    write(LS.dialect_custom, filtered);
    addAuditLog((creatorInfo && creatorInfo.name) || '超级管理员', '删除方言', '删除方言展品语音 ID:' + id);
    syncCustomToCloud();
    return filtered.length < list.length;
  }

  /* ---------- AI 模型与工作流配置 ---------- */

  function getApiOverrides() {
    return read(LS.api, {});
  }

  function setApiOverrides(patch) {
    var cur = read(LS.api, {});
    write(LS.api, Object.assign(cur, patch));
    syncCustomToCloud();
  }

  function resetApi() {
    try {
      remove(LS.api);
      remove(LS.workflow);
      syncCustomToCloud();
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
    syncCustomToCloud();
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
    var exported = {
      app: '龙南客家非遗数字助手',
      version: 'v3-cloud',
      cloudDraft: bundle(),
      exportedAt: new Date().toISOString(),
      knowledgeBase: getEntries(),
      heritageCardsCustom: read(LS.kepu_custom, []),
      heritageCardsEdited: read(LS.kepu_edited, {}),
      dialectTracksCustom: read(LS.dialect_custom, []),
      apiConfig: getApiOverrides(),
      workflowConfig: getWorkflowConfig()
    };
    return JSON.stringify(exported, null, 2);
  }

  function importFullBundle(jsonStr) {
    try {
      var data = JSON.parse(jsonStr);
      if (!data || typeof data !== 'object') return false;
      if (data.cloudDraft) {
        var draft = data.cloudDraft;
        if (!Object.keys(CONTENT_KEYS).every(function (key) {
          return OBJECT_KEYS.indexOf(key) >= 0
            ? draft[key] && typeof draft[key] === 'object' && !Array.isArray(draft[key])
            : Array.isArray(draft[key]);
        })) return false;
        Object.keys(CONTENT_KEYS).forEach(function (key) { write(CONTENT_KEYS[key], draft[key]); });
        syncCustomToCloud();
        return true;
      }
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
      syncCustomToCloud();
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- 导出接口 ---------- */
  window.Store = {
    // 权限与邀请令牌
    normalizeAuthInput: normalizeAuthInput,
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
    logout: logout,
    getSyncStatus: function () { return syncStatus; },
    reloadCloudContent: reloadCloudContent,
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
    importFullBundle: importFullBundle,

    // 全站多端云同步与客户端锁定监控
    detectClientInfo: detectClientInfo,
    getLockedClients: getLockedClients,
    unlockClient: unlockClient,
    unlockAllClients: unlockAllClients,
    syncWithCloud: syncWithCloud,
    syncCustomToCloud: syncCustomToCloud,
    triggerFrontEndRefresh: triggerFrontEndRefresh
  };

  // Remove obsolete local credentials. They cannot authenticate against the server.
  ['nfyj_admin_pw', 'nfyj_admin_pw_hash', 'nfyj_admin_session', 'nfyj_login_lock_state', 'nfyj_admin_tokens'].forEach(function (key) {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  if (typeof window.addEventListener === 'function') {
    syncWithCloud();
    window.addEventListener('focus', function () { syncWithCloud(); });
    window.addEventListener('online', function () { syncWithCloud(); });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') syncWithCloud();
    });
    setInterval(function () {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') syncWithCloud();
    }, 15000);
  }
})();
