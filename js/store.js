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
  var useDraftDb = typeof indexedDB !== 'undefined';
  function read(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(memoryValues, key)) return memoryValues[key];
    if ([LS.tokens, LS.locked_clients, LS.audit_logs, LS.notifications].indexOf(key) >= 0) return fallback;
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      memoryValues[key] = JSON.parse(raw);
      return memoryValues[key];
    } catch (e) { return Object.prototype.hasOwnProperty.call(memoryValues, key) ? memoryValues[key] : fallback; }
  }

  function write(key, val) {
    memoryValues[key] = val;
    if ([LS.tokens, LS.locked_clients, LS.audit_logs, LS.notifications].indexOf(key) >= 0) return;
    if (Object.values(CONTENT_KEYS || {}).indexOf(key) >= 0 || /^nfyj_cloud_/.test(key)) return;
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  function remove(key) {
    delete memoryValues[key];
    try { localStorage.removeItem(key); } catch (_) {}
  }

  var memorySession;
  function readSession(fallback) {
    if (memorySession !== undefined) return memorySession || fallback;
    try {
      var raw = sessionStorage.getItem(SS.admin_session);
      memorySession = raw ? JSON.parse(raw) : null;
      return memorySession || fallback;
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
    apiConfig: LS.api, workflowConfig: LS.workflow
  };
  var OBJECT_KEYS = ['kbEdited', 'kepuEdited', 'apiConfig', 'workflowConfig'];
  var cloudRevision = read('nfyj_cloud_revision', null);
  var pending = read('nfyj_cloud_pending', false);
  var generation = 0;
  var uploadPromise = null;
  var pullPromise = null;
  var pullSession = '';
  var lastReadSession = null;
  var syncStatus = { status: 'idle', message: '等待连接云端' };
  var cloudBase = read('nfyj_cloud_base', null);
  var publishedBundle = null;
  var contentIssue = '';
  var draftDb = null;
  var durableDraft = true;
  // Keep pre-upgrade local edits until an authenticated upload or an explicit discard.
  if (cloudRevision === null) {
    pending = Object.keys(CONTENT_KEYS).some(function (key) {
      if (key === 'auditLogs') return false;
      return Object.keys(read(CONTENT_KEYS[key], {})).length > 0;
    });
    if (pending) { cloudRevision = 0; write('nfyj_cloud_pending', true); }
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  var draftId = 'draft:' + Date.now() + ':' + Math.random().toString(36).slice(2);
  var previousDraftId = '';
  var draftOwner = '';
  var recoverySource = null;
  try { previousDraftId = sessionStorage.getItem('nfyj_draft_pointer') || ''; } catch (_) {}
  function principal() { var user = getSession(); return user ? (user.tokenId || 'super_admin') : ''; }
  function restoreState(saved) {
    if (!saved || !saved.bundle) return;
    Object.keys(CONTENT_KEYS).forEach(function (key) { memoryValues[CONTENT_KEYS[key]] = saved.bundle[key] || (OBJECT_KEYS.indexOf(key) >= 0 ? {} : []); });
    cloudRevision = saved.revision; cloudBase = saved.base; pending = saved.pending; draftOwner = saved.owner || '';
    recoverySource = saved.source || null;
  }
  // Published cache is shared; each page owns a separate unacknowledged draft snapshot.
  var storageReady = useDraftDb ? new Promise(function (resolve) {
    var request, finished = false;
    var timer = setTimeout(function () { useDraftDb = false; finish(); }, 4000);
    function finish() { finished = true; clearTimeout(timer); resolve(); }
    try { request = indexedDB.open('nfyj-admin-content', 1); }
    catch (_) { useDraftDb = false; finish(); return; }
    request.onupgradeneeded = function () { request.result.createObjectStore('state'); };
    request.onerror = request.onblocked = function () { useDraftDb = false; finish(); };
    request.onsuccess = function () {
      if (finished) { request.result.close(); return; }
      draftDb = request.result;
      var tx = draftDb.transaction('state', 'readonly'), store = tx.objectStore('state');
      var own = previousDraftId ? store.get(previousDraftId) : null;
      var cache = store.get('current');
      tx.oncomplete = function () {
        if (generation === 0) restoreState((own && own.result) || cache.result);
        triggerFrontEndRefresh(); finish();
      };
      tx.onerror = tx.onabort = function () { useDraftDb = false; draftDb = null; finish(); };
    };
  }) : Promise.resolve().then(function () {
    if (previousDraftId) restoreState(read('nfyj_' + previousDraftId, null));
  });
  var storageLoaded = false;
  storageReady.then(function () { storageLoaded = true; });
  async function persistState() {
    await storageReady;
    if (pending && !draftOwner) draftOwner = principal();
    var saved = { bundle: copy(bundle()), revision: cloudRevision, base: copy(cloudBase), pending: pending, owner: draftOwner, time: Date.now(),
      snapshotId: Date.now() + ':' + Math.random().toString(36).slice(2), source: recoverySource };
    if (draftDb) {
      durableDraft = await new Promise(function (resolve) {
        try {
          var tx = draftDb.transaction('state', 'readwrite'), store = tx.objectStore('state');
          if (saved.pending) store.put(saved, draftId);
          else { store.put(saved, 'current'); store.delete(draftId); }
          if (!saved.pending && recoverySource && recoverySource.snapshotId) {
            var source = store.get(recoverySource.id), acknowledged = recoverySource;
            source.onsuccess = function () {
              // The original page may have made newer edits after this snapshot was restored.
              if (source.result && source.result.snapshotId === acknowledged.snapshotId) store.delete(acknowledged.id);
            };
          }
          if (previousDraftId && previousDraftId !== draftId) store.delete(previousDraftId);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = tx.onabort = function () { resolve(false); };
        } catch (_) { resolve(false); }
      });
      if (durableDraft) Object.values(CONTENT_KEYS).concat(['nfyj_cloud_base', 'nfyj_cloud_revision', 'nfyj_cloud_pending']).forEach(function (key) {
        try { localStorage.removeItem(key); } catch (_) {}
      });
    } else {
      // A per-page key also prevents snapshot replacement when IndexedDB is unavailable.
      try {
        localStorage.setItem('nfyj_' + draftId, JSON.stringify(saved));
        if (previousDraftId && previousDraftId !== draftId) localStorage.removeItem('nfyj_' + previousDraftId);
        durableDraft = true;
        Object.values(CONTENT_KEYS).concat(['nfyj_cloud_base', 'nfyj_cloud_revision', 'nfyj_cloud_pending']).forEach(function (key) { localStorage.removeItem(key); });
      } catch (_) { durableDraft = false; }
    }
    if (durableDraft) {
      if (!saved.pending) recoverySource = null;
      previousDraftId = draftId;
      try { sessionStorage.setItem('nfyj_draft_pointer', draftId); } catch (_) {}
    }
    return durableDraft;
  }
  async function draftSnapshots() {
    await storageReady;
    if (draftDb) return new Promise(function (resolve, reject) {
      var tx = draftDb.transaction('state', 'readonly'), store = tx.objectStore('state');
      var keys = store.getAllKeys(), rows = store.getAll();
      tx.oncomplete = function () { resolve(keys.result.map(function (key, i) { return { id: key, saved: rows.result[i] }; })); };
      tx.onerror = function () { reject(new Error('读取草稿失败，请先导出当前页面备份')); };
    });
    var rows = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf('nfyj_draft:') === 0) rows.push({ id: key.slice(5), saved: read(key, null) });
    }
    return rows;
  }
  async function getRecoveryDrafts() {
    return (await draftSnapshots()).filter(function (row) { return row.saved && row.saved.pending && row.id !== draftId && row.id !== previousDraftId && (!row.saved.owner || row.saved.owner === principal() || principal() === 'super_admin'); }).map(function (row) {
      return { id: row.id, time: row.saved.time || 0, owner: row.saved.owner, count: ['kbCustom', 'kepuCustom', 'dialectCustom'].reduce(function (n, key) { return n + row.saved.bundle[key].length; }, 0) };
    });
  }
  async function restoreRecoveryDraft(id) {
    await persistState();
    var row = (await draftSnapshots()).find(function (row) { return row.id === id; });
    if (!row || !row.saved.pending || (row.saved.owner && row.saved.owner !== principal() && principal() !== 'super_admin')) throw new Error('未找到当前账号可恢复的草稿');
    draftId = 'draft:' + Date.now() + ':' + Math.random().toString(36).slice(2);
    previousDraftId = '';
    restoreState(row.saved); generation++;
    recoverySource = { id: row.id, snapshotId: row.saved.snapshotId };
    if (principal() === 'super_admin') draftOwner = principal();
    await persistState();
    triggerFrontEndRefresh();
    setSyncStatus('pending', '已恢复所选草稿，原页面草稿仍单独保留。请核对后点击同步上传。');
  }
  function visibleContent(key, fallback) {
    var value = publishedBundle && !getSession() ? publishedBundle[key] : read(CONTENT_KEYS[key], fallback);
    return Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback)
      : (value && typeof value === 'object' && !Array.isArray(value) ? value : fallback);
  }
  function displayRecords(records, type) {
    var seen = new Set();
    return (Array.isArray(records) ? records : []).filter(function (entry) {
      try {
        globalThis.HeritageContent.record(entry, type, type, false);
        if (seen.has(entry.id)) return false;
        seen.add(entry.id); return true;
      } catch (_) { return false; }
    });
  }
  function setSyncStatus(status, message) {
    if (status === 'saved' && contentIssue) { status = 'error'; message = contentIssue; }
    syncStatus = { status: status, message: message };
    if (window.dispatchEvent && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('admin-sync-status', { detail: syncStatus }));
    }
  }
  async function cloudRequest(body, publicOnly, knownRevision) {
    if (typeof fetch === 'undefined') throw new Error('当前环境不能连接管理服务器');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 60000);
    var session = publicOnly ? null : getSession();
    var headers = {};
    if (session) headers.Authorization = 'Bearer ' + session.bearer;
    if (body) headers['Content-Type'] = 'application/json';
    try {
      var endpoint = getSyncEndpoint();
      if (!body && knownRevision !== undefined) endpoint += '?revision=' + encodeURIComponent(knownRevision);
      var response = await fetch(endpoint, {
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
      if (typeof error.code === 'string') throw error;
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
    contentIssue = '';
    try { globalThis.HeritageContent.validateBundle(data); }
    catch (error) { contentIssue = '云端历史数据存在格式问题，异常条目已隔离显示；请导出备份并修复：' + error.message; }
    if (Array.isArray(data.auditLogs)) write(LS.audit_logs, data.auditLogs);
    Object.keys(CONTENT_KEYS).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(data, key)) write(CONTENT_KEYS[key], data[key]);
    });
    cloudRevision = data.revision;
    cloudBase = copy(bundle());
    publishedBundle = null;
    write('nfyj_cloud_revision', cloudRevision);
    triggerFrontEndRefresh();
  }
  function mergeBundles(base, local, remote) {
    function comparable(value) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        value = Object.assign({}, value);
        ['creatorName', 'creatorTokenId', 'createdAt'].forEach(function (key) { delete value[key]; });
      }
      return globalThis.HeritageContent.canonical(value);
    }
    var merged = {};
    Object.keys(CONTENT_KEYS).forEach(function (key) {
      var isArray = OBJECT_KEYS.indexOf(key) < 0;
      function indexed(value) {
        if (!isArray) return value || {};
        var map = Object.create(null);
        (value || []).forEach(function (item) { map[typeof item === 'object' ? item.id : item] = item; });
        return map;
      }
      var before = indexed(base && base[key]);
      var ours = indexed(local[key]);
      var theirs = indexed(remote[key]);
      var result = Object.create(null);
      Array.from(new Set(Object.keys(theirs).concat(Object.keys(ours), Object.keys(before)))).forEach(function (id) {
        var b = before[id], l = ours[id], r = theirs[id];
        var value;
        if ((!base && l === undefined) || comparable(l) === comparable(b)) value = r;
        else if (comparable(r) === comparable(b) || comparable(l) === comparable(r)) value = l;
        else throw Object.assign(new Error('同一条内容在不同设备被修改，本机草稿已保留。请导出备份后核对，避免覆盖老师的内容。'), { code: 'SYNC_CONFLICT' });
        if (value !== undefined) result[id] = value;
      });
      merged[key] = isArray ? Object.values(result) : result;
    });
    return merged;
  }
  async function rebasePending() {
    var latest = await cloudRequest();
    var merged = mergeBundles(cloudBase, bundle(), latest);
    Object.keys(CONTENT_KEYS).forEach(function (key) { write(CONTENT_KEYS[key], merged[key]); });
    cloudBase = copy(Object.fromEntries(Object.keys(CONTENT_KEYS).map(function (key) { return [key, latest[key] || (OBJECT_KEYS.indexOf(key) >= 0 ? {} : [])]; })));
    cloudRevision = latest.revision;
    publishedBundle = null;
    await persistState();
    triggerFrontEndRefresh();
  }
  async function uploadPending() {
    if (uploadPromise) return uploadPromise;
    uploadPromise = (async function () {
      try {
        await storageReady;
        if (!pending) return true;
        if (draftOwner && principal() && draftOwner !== principal()) { await persistState(); setSyncStatus('error', '本机草稿属于另一账号，请使用原账号登录或导出备份后重新加载云端。'); return false; }
        if (!getSession()) { await persistState(); setSyncStatus('pending', '本机有未上传草稿，登录后可继续上传'); return false; }
        if (syncStatus.status === 'conflict') return false;
        await persistState();
        if (!cloudBase) await rebasePending();
        var retries = 0;
        while (pending) {
          var sentGeneration = generation;
          var sent = copy(bundle());
          globalThis.HeritageContent.validateBundle(sent);
          var data;
          try {
            data = await cloudRequest(Object.assign({ action: 'update_custom_bundle', revision: cloudRevision === null ? 0 : cloudRevision }, sent));
          } catch (error) {
            if (error.code !== 'SYNC_CONFLICT' || retries++ >= 3) throw error;
            await rebasePending();
            continue;
          }
          cloudRevision = data.revision;
          cloudBase = data.content || sent;
          lastReadSession = null;
          if (data.content && Array.isArray(data.content.auditLogs)) write(LS.audit_logs, data.content.auditLogs);
          if (sentGeneration === generation && data.content) {
            Object.keys(CONTENT_KEYS).forEach(function (key) { write(CONTENT_KEYS[key], data.content[key]); });
          }
          write('nfyj_cloud_revision', cloudRevision);
          if (sentGeneration === generation) { pending = false; draftOwner = ''; write('nfyj_cloud_pending', false); }
          await persistState();
        }
        publishedBundle = null;
        triggerFrontEndRefresh();
        setSyncStatus('saved', '已保存到云端，其他设备可同步查看');
        return true;
      } catch (error) {
        await persistState();
        setSyncStatus(error.code === 'SYNC_CONFLICT' ? 'conflict' : 'error', error.message + (durableDraft ? '' : ' 本机存储不可用，请保持此页面打开并立即导出备份。'));
        return false;
      } finally { uploadPromise = null; }
    })();
    return uploadPromise;
  }
  function syncCustomToCloud(callback) {
    if (!pending) draftOwner = principal();
    pending = true;
    generation++;
    write('nfyj_cloud_pending', true);
    if (syncStatus.status !== 'conflict') setSyncStatus('pending', '正在保存草稿并上传云端，请勿关闭页面…');
    var result = uploadPending();
    if (typeof callback === 'function') result.then(callback);
    return result;
  }
  function syncWithCloud(callback) {
    var active = getSession();
    var bearer = active ? active.bearer : '';
    if (pullPromise && pullSession !== bearer) return pullPromise.then(function () { return syncWithCloud(callback); });
    if (!pullPromise) pullSession = bearer;
    if (!pullPromise) pullPromise = (async function () {
      try {
        await storageReady;
        if (pending && getSession() && !(await uploadPending())) return null;
        var data = await cloudRequest(null, false, !pending && cloudBase && lastReadSession === bearer ? cloudRevision : undefined);
        if (Array.isArray(data.tokens)) write(LS.tokens, data.tokens);
        if (Array.isArray(data.lockouts)) write(LS.locked_clients, data.lockouts);
        if (Array.isArray(data.notifications)) write(LS.notifications, data.notifications);
        if (Array.isArray(data.contributions)) contributionRows = data.contributions;
        if (data.unchanged) {
          if (!pending) setSyncStatus('saved', '已与云端同步');
        } else if (pending && !getSession()) {
          publishedBundle = data;
          triggerFrontEndRefresh();
          setSyncStatus('pending', '已显示云端发布内容；本机未上传草稿已保留，登录后可恢复上传');
        } else if (!pending && (cloudRevision === null || data.revision >= cloudRevision)) {
          applyCloud(data);
          lastReadSession = bearer;
          await persistState();
          setSyncStatus('saved', '已与云端同步');
        }
        return data;
      } catch (error) {
        if (error.code === 'SESSION_EXPIRED') {
          try { publishedBundle = await cloudRequest(null, true); triggerFrontEndRefresh(); } catch (_) {}
        }
        setSyncStatus('error', error.message);
        return null;
      } finally { pullPromise = null; }
    })();
    if (typeof callback === 'function') pullPromise.then(callback);
    return pullPromise;
  }
  async function reloadCloudContent() {
    var startedGeneration = generation;
    await storageReady;
    if (uploadPromise) await uploadPromise;
    await persistState();
    var data = await cloudRequest();
    if (generation !== startedGeneration) {
      await persistState();
      throw new Error('重新加载期间有新的编辑，已保留本机草稿。请核对并导出备份后重试。');
    }
    pending = false; draftOwner = '';
    write('nfyj_cloud_pending', false);
    applyCloud(data);
    await persistState();
    setSyncStatus('saved', '已重新加载云端内容');
    return data;
  }
  function getLockedClients() { return read(LS.locked_clients, []); }
  async function unlockClient(id) { await cloudRequest({ action: 'unlock', id: id }); return syncWithCloud(); }
  async function unlockAllClients() { await cloudRequest({ action: 'unlock_all' }); return syncWithCloud(); }

  /* ---------- 操作审计日志 ---------- */

  function getAuditLogs() {
    return read(LS.audit_logs, []);
  }

  async function clearAuditLogs() {
    await cloudRequest({ action: 'clear_audit_logs' });
    return syncWithCloud();
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
    return list.map(function (item) {
      var isExpired = item.expiresAt && item.expiresAt > 0 && now > item.expiresAt;
      var isRevoked = !!item.revoked;
      var isPaused = !!item.paused && !isRevoked;
      var statusCode = isRevoked ? 'revoked' : (isPaused ? 'paused' : (isExpired ? 'expired' : 'active'));
      var statusText = isRevoked ? '已销毁' : (isPaused ? '已暂停' : (isExpired ? '已过期' : '生效中'));

      var rows = contributionRows.filter(function (row) { return row.tokenId === item.id; });
      var kbCount = rows.filter(function (row) { return row.type === 'kb'; }).length;
      var kepuCount = rows.filter(function (row) { return row.type === 'kepu'; }).length;
      var dialectCount = rows.filter(function (row) { return row.type === 'dialect'; }).length;

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

  async function moderate(body) {
    if (pending && !(await uploadPending())) throw new Error('请先上传或处理本机草稿：' + syncStatus.message);
    var result = await cloudRequest(body);
    await syncWithCloud();
    return result;
  }
  function rollbackTokenChanges(tokenId) {
    return moderate({ action: 'rollback_token', tokenId: tokenId });
  }
  var contributionRows = [];
  function getTokenDetailedContributions(tokenId) {
    var token = read(LS.tokens, []).find(function (t) { return t.id === tokenId; });
    return { token: token || { id: tokenId, name: '受邀管理员' }, items: contributionRows.filter(function (row) { return row.tokenId === tokenId; }).map(function (row) {
      var names = { kb: ['知识库条目', '📚 知识库'], kepu: ['科普卡片', '🏮 科普卡片'], dialect: ['方言讲解', '🗣 方言讲解'] };
      return Object.assign({}, row, { typeName: names[row.type][0], typeBadge: names[row.type][1] });
    }) };
  }
  function rejectTokenItem(tokenId, itemId, itemType, reason) {
    return moderate({ action: 'reject_item', tokenId: tokenId, itemId: itemId, itemType: itemType, reason: reason });
  }
  function getTokenNotifications(tokenId) {
    return read(LS.notifications, []).filter(function (n) { return !n.read && (!tokenId || n.tokenId === tokenId); });
  }
  async function markTokenNotificationRead(id) {
    await cloudRequest({ action: 'read_notifications', id: id });
    return syncWithCloud();
  }
  function clearTokenNotifications() { return markTokenNotificationRead(); }

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
    write(LS.notifications, []);
    write(LS.audit_logs, []);
    contributionRows = [];
    if (pending && cloudBase) publishedBundle = cloudBase;
  }
  async function logout() {
    try { await cloudRequest({ action: 'logout' }); } finally { clearSession(); }
  }

  /* ---------- 知识库 ---------- */

  function getEntries() {
    var base = (window.KNOWLEDGE_BASE || []).slice();
    var deleted = visibleContent('kbDeleted', []);
    var edited  = visibleContent('kbEdited', {});
    var custom  = visibleContent('kbCustom', []);

    var merged = base
      .filter(function (e) { return deleted.indexOf(e.id) === -1; })
      .map(function (e) { return Object.assign({}, e, edited[e.id]); });

    return displayRecords(merged.concat(custom), 'kb');
  }

  function addEntry(entry, creatorInfo) {
    var custom = read(LS.custom, []);
    if (!entry.id) entry.id = 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    if (creatorInfo) {
      entry.creatorName = creatorInfo.name || '受邀管理员';
      entry.creatorTokenId = creatorInfo.tokenId || creatorInfo.token || '';
    } else {
      entry.creatorName = '超级管理员';
    }
    entry.createdAt = Date.now();
    checkNewRecord(entry, 'kb', custom);
    custom.push(entry);
    write(LS.custom, custom);
    syncCustomToCloud();
    return entry;
  }

  function updateEntry(id, patch, creatorInfo) {
    var custom = read(LS.custom, []);
    if (!unambiguous(custom, id, 'kb')) return false;
    for (var i = 0; i < custom.length; i++) {
      if (custom[i].id === id) {
        custom[i] = Object.assign({}, custom[i], patch, { id: id });
        write(LS.custom, custom);
        syncCustomToCloud();
        return true;
      }
    }
    var edited = read(LS.edited, {});
    var base = (window.KNOWLEDGE_BASE || []).find(function (e) { return e.id === id; });
    if (!base) return false;
    edited[id] = Object.assign({}, base, patch, { id: id });
    write(LS.edited, edited);
    syncCustomToCloud();
    return true;
  }

  function deleteEntry(id, creatorInfo) {
    var custom = read(LS.custom, []);
    if (!unambiguous(custom, id, 'kb')) return false;
    var before = custom.length;
    custom = custom.filter(function (e) { return e.id !== id; });
    if (custom.length < before) {
      write(LS.custom, custom);
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

  function kbImportPatch(entries) {
    if (!Array.isArray(entries)) throw new Error('知识库必须是数组');
    var base = window.KNOWLEDGE_BASE || [], ids = new Set(base.map(function (e) { return e.id; }));
    var custom = [], edited = {}, seen = new Set();
    entries.forEach(function (entry) {
      globalThis.HeritageContent.record(entry, 'kb', 'knowledgeBase', false);
      if (seen.has(entry.id)) throw new Error('导入包含重复 ID：' + entry.id);
      seen.add(entry.id);
      if (ids.has(entry.id)) edited[entry.id] = entry; else custom.push(entry);
    });
    return { kbCustom: custom, kbEdited: edited, kbDeleted: base.filter(function (e) { return !seen.has(e.id); }).map(function (e) { return e.id; }) };
  }
  function importKB(jsonStr) {
    try {
      var candidate = Object.assign(bundle(), kbImportPatch(JSON.parse(jsonStr)));
      globalThis.HeritageContent.validateBundle(candidate);
      ['kbCustom', 'kbEdited', 'kbDeleted'].forEach(function (key) { write(CONTENT_KEYS[key], candidate[key]); });
      syncCustomToCloud(); return true;
    } catch (e) { setSyncStatus('error', e.message); return false; }
  }
  function checkNewRecord(entry, type, records) {
    globalThis.HeritageContent.record(entry, type, type, false);
    if (records.some(function (other) { return other && other.id === entry.id; }) || (globalThis.HeritageContent.reserved[type] || []).includes(entry.id)) throw new Error('ID 已存在，请重新创建或更换导入记录的 ID：' + entry.id);
  }
  function unambiguous(records, id, type) {
    var matches = records.filter(function (record) { return record && record.id === id; });
    if (matches.length > 1 || (matches.length && (globalThis.HeritageContent.reserved[type] || []).includes(id))) {
      setSyncStatus('error', '该 ID 存在历史重复或内置冲突，已停止修改和删除。请先导出备份，修正重复 ID 后整体导入。');
      return false;
    }
    return true;
  }

  /* ---------- 科普模块卡片管理 ---------- */

  function getHeritageCards(defaultCards) {
    var base = Array.isArray(defaultCards) ? defaultCards.slice() : [];
    var deleted = visibleContent('kepuDeleted', []);
    var edited = visibleContent('kepuEdited', {});
    var custom = visibleContent('kepuCustom', []);

    var merged = base
      .filter(function (c) { return deleted.indexOf(c.id) === -1; })
      .map(function (c) { return Object.assign({}, c, edited[c.id]); });

    return displayRecords(merged.concat(custom), 'kepu');
  }

  function addHeritageCard(card, creatorInfo) {
    if (!card.id) card.id = 'kepu-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    if (creatorInfo) {
      card.creatorName = creatorInfo.name || '受邀管理员';
      card.creatorTokenId = creatorInfo.tokenId || creatorInfo.token || '';
    } else {
      card.creatorName = '超级管理员';
    }
    card.createdAt = Date.now();
    var custom = read(LS.kepu_custom, []);
    checkNewRecord(card, 'kepu', custom);
    custom.push(card);
    write(LS.kepu_custom, custom);
    syncCustomToCloud();
    return card;
  }

  function updateHeritageCard(id, patch) {
    var custom = read(LS.kepu_custom, []);
    if (!unambiguous(custom, id, 'kepu')) return false;
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
    if (!unambiguous(custom, id, 'kepu')) return false;
    var before = custom.length;
    custom = custom.filter(function (c) { return c.id !== id; });
    if (custom.length < before) {
      write(LS.kepu_custom, custom);
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
    syncCustomToCloud();
    return true;
  }

  /* ---------- 方言模块管理 ---------- */

  function getCustomDialectTracks() {
    return displayRecords(visibleContent('dialectCustom', []), 'dialect');
  }

  function addDialectTrack(track, creatorInfo) {
    if (!track.id) track.id = 'dialect-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    if (creatorInfo) {
      track.creatorName = creatorInfo.name || '受邀管理员';
      track.creatorTokenId = creatorInfo.tokenId || creatorInfo.token || '';
    } else {
      track.creatorName = '超级管理员';
    }
    track.createdAt = Date.now();
    var list = read(LS.dialect_custom, []);
    checkNewRecord(track, 'dialect', list);
    list.push(track);
    write(LS.dialect_custom, list);
    syncCustomToCloud();
    return track;
  }

  function deleteDialectTrack(id, creatorInfo) {
    var list = read(LS.dialect_custom, []);
    if (!unambiguous(list, id, 'dialect')) return false;
    var filtered = list.filter(function (t) { return (t.id || t.item && t.item.name) !== id; });
    write(LS.dialect_custom, filtered);
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
      if (!data || Array.isArray(data) || typeof data !== 'object') return false;
      var candidate = data.cloudDraft ? copy(data.cloudDraft) : Object.assign(bundle(), Array.isArray(data.knowledgeBase) ? kbImportPatch(data.knowledgeBase) : {});
      if (!data.cloudDraft) {
        var legacy = { heritageCardsCustom: 'kepuCustom', heritageCardsEdited: 'kepuEdited', dialectTracksCustom: 'dialectCustom', apiConfig: 'apiConfig', workflowConfig: 'workflowConfig' };
        Object.keys(legacy).forEach(function (key) { if (data[key] !== undefined) candidate[legacy[key]] = data[key]; });
      }
      globalThis.HeritageContent.validateBundle(candidate);
      Object.keys(CONTENT_KEYS).forEach(function (key) { if (key !== 'auditLogs') write(CONTENT_KEYS[key], candidate[key]); });
      syncCustomToCloud(); return true;
    } catch (e) { setSyncStatus('error', e.message); return false; }
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
    getSyncStatus: function () { return Object.assign({ pending: pending, revision: cloudRevision }, syncStatus); },
    reloadCloudContent: reloadCloudContent,
    getRecoveryDrafts: getRecoveryDrafts,
    restoreRecoveryDraft: restoreRecoveryDraft,
    getAuditLogs: getAuditLogs,
    clearAuditLogs: clearAuditLogs,

    // 消息通知中心
    getTokenNotifications: getTokenNotifications,
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
    flushPending: uploadPending,
    ready: storageReady,
    isReady: function () { return storageLoaded; },
    triggerFrontEndRefresh: triggerFrontEndRefresh
  };

  // Remove obsolete local credentials. They cannot authenticate against the server.
  ['nfyj_admin_pw', 'nfyj_admin_pw_hash', 'nfyj_admin_session', 'nfyj_login_lock_state', 'nfyj_admin_tokens', 'nfyj_audit_logs', 'nfyj_token_notifications'].forEach(function (key) {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  if (typeof window.addEventListener === 'function') {
    syncWithCloud();
    window.addEventListener('focus', function () { syncWithCloud(); });
    window.addEventListener('online', function () { syncWithCloud(); });
    window.addEventListener('beforeunload', function (event) {
      if (pending) { event.preventDefault(); event.returnValue = ''; }
    });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') syncWithCloud();
    });
    setInterval(function () {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') syncWithCloud();
    }, 15000);
  }
})();
