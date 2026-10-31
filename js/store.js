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
  var conflictKeys = [];
  var editBases = {};
  var editHashes = {};
  var catalog = { model: '', pages: {}, counts: {}, summaries: [], hashes: {} };
  var lastSyncedAt = 0;
  var cloudIncomplete = false;
  var recoveryRows = [];
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
  var previousSnapshotId = '';
  var draftOwner = '';
  var recoverySource = null;
  try { previousDraftId = sessionStorage.getItem('nfyj_draft_pointer') || ''; } catch (_) {}
  function principal() { var user = getSession(); return user ? (user.tokenId || 'super_admin') : ''; }
  var legacyId = 'draft:legacy:' + Date.now() + ':' + Math.random().toString(36).slice(2);
  var legacyState = pending ? { bundle: copy(bundle()), revision: cloudRevision, base: copy(cloudBase), pending: true,
    owner: principal(), time: Date.now(), snapshotId: legacyId } : null;
  var legacyBackupSafe = !legacyState;
  function restoreState(saved) {
    if (!saved || !saved.bundle) return;
    Object.keys(CONTENT_KEYS).forEach(function (key) { memoryValues[CONTENT_KEYS[key]] = saved.bundle[key] || (OBJECT_KEYS.indexOf(key) >= 0 ? {} : []); });
    cloudRevision = saved.revision; cloudBase = saved.base; pending = saved.pending; draftOwner = saved.owner || '';
    recoverySource = saved.source || (saved === legacyState ? { id: legacyId, snapshotId: saved.snapshotId } : null);
    conflictKeys = saved.conflicts || [];
    editBases = saved.editBases || {};
    editHashes = saved.editHashes || {};
    catalog = saved.catalog || catalog;
    lastSyncedAt = saved.lastSyncedAt || 0;
    cloudIncomplete = !!saved.cloudIncomplete;
  }
  function restoreLocalSnapshot() {
    var saved = previousDraftId ? read('nfyj_' + previousDraftId, null) : null;
    previousSnapshotId = saved && saved.snapshotId || '';
    restoreState(saved && saved.pending ? saved : legacyState || saved);
  }
  function newerSnapshot(a, b) { return !a ? b : !b ? a : (b.time || 0) >= (a.time || 0) ? b : a; }
  function localSnapshots() {
    var rows = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && /^nfyj_(?:draft|editor):/.test(key)) { try { rows.push({ id: key.slice(5), saved: JSON.parse(localStorage.getItem(key)) }); } catch (_) {} }
      }
    } catch (_) { /* Blocked fallback storage must not hide IndexedDB backups. */ }
    return rows;
  }
  function clearLocalSnapshot(id, snapshotId) {
    if (!id || !snapshotId) return;
    try {
      var raw = localStorage.getItem('nfyj_' + id);
      if (raw && JSON.parse(raw).snapshotId === snapshotId) localStorage.removeItem('nfyj_' + id);
    } catch (_) { /* A blocked cleanup leaves the backup in place. */ }
  }
  // Published cache is shared; each page owns a separate unacknowledged draft snapshot.
  var storageReady = useDraftDb ? new Promise(function (resolve) {
    var request, finished = false;
    var timer = setTimeout(function () { useDraftDb = false; if (draftDb) draftDb.close(); draftDb = null; finish(); }, 4000);
    function finish() {
      if (finished) return;
      if (!draftDb && generation === 0) restoreLocalSnapshot();
      finished = true; clearTimeout(timer); resolve();
    }
    try { request = indexedDB.open('nfyj-admin-content', 1); }
    catch (_) { useDraftDb = false; finish(); return; }
    request.onupgradeneeded = function () { request.result.createObjectStore('state'); };
    request.onerror = request.onblocked = function () { useDraftDb = false; finish(); };
    request.onsuccess = function () {
      if (finished) { request.result.close(); return; }
      draftDb = request.result;
      var tx = draftDb.transaction('state', legacyState ? 'readwrite' : 'readonly'), store = tx.objectStore('state');
      var own = previousDraftId ? store.get(previousDraftId) : null;
      var cache = store.get('current');
      if (legacyState) store.put(legacyState, legacyId);
      tx.oncomplete = function () {
        if (finished) return;
        legacyBackupSafe = true;
        if (generation === 0) {
          var saved = newerSnapshot(own && own.result, previousDraftId ? read('nfyj_' + previousDraftId, null) : null);
          previousSnapshotId = saved && saved.snapshotId || '';
          restoreState(saved && saved.pending ? saved : legacyState || saved || cache.result);
        }
        triggerFrontEndRefresh(); finish();
      };
      tx.onerror = tx.onabort = function () { useDraftDb = false; draftDb = null; finish(); };
    };
  }) : Promise.resolve().then(function () {
    restoreLocalSnapshot();
  });
  var storageLoaded = false;
  storageReady.then(function () { storageLoaded = true; });
  async function persistState() {
    await storageReady;
    if (pending && !draftOwner) draftOwner = principal();
    var saved = { bundle: copy(bundle()), revision: cloudRevision, base: copy(cloudBase), pending: pending, owner: draftOwner, time: Date.now(),
      snapshotId: Date.now() + ':' + Math.random().toString(36).slice(2), source: recoverySource, conflicts: conflictKeys.slice(), editBases: copy(editBases), editHashes: copy(editHashes), catalog: copy(catalog), lastSyncedAt: lastSyncedAt, cloudIncomplete: cloudIncomplete };
    var predecessor = { id: previousDraftId, snapshotId: previousSnapshotId };
    if (draftDb) {
      durableDraft = await new Promise(function (resolve) {
        try {
          var tx = draftDb.transaction('state', 'readwrite'), store = tx.objectStore('state');
          if (legacyState && !legacyBackupSafe) store.put(legacyState, legacyId);
          if (saved.pending) store.put(saved, draftId);
          else { store.put(saved, 'current'); store.delete(draftId); }
          if (!saved.pending && recoverySource && recoverySource.snapshotId) {
            var source = store.get(recoverySource.id), acknowledged = recoverySource;
            source.onsuccess = function () {
              // The original page may have made newer edits after this snapshot was restored.
              if (source.result && source.result.snapshotId === acknowledged.snapshotId) store.delete(acknowledged.id);
            };
          }
          if (previousDraftId && previousDraftId !== draftId && previousSnapshotId) {
            var oldId = previousDraftId, oldSnapshot = previousSnapshotId, previous = store.get(oldId);
            previous.onsuccess = function () { if (previous.result && previous.result.snapshotId === oldSnapshot) store.delete(oldId); };
          }
          tx.oncomplete = function () { legacyBackupSafe = true; resolve(true); };
          tx.onerror = tx.onabort = function () { resolve(false); };
        } catch (_) { resolve(false); }
      });
      if (durableDraft && legacyBackupSafe) Object.values(CONTENT_KEYS).concat(['nfyj_cloud_base', 'nfyj_cloud_revision', 'nfyj_cloud_pending']).forEach(function (key) {
        try { localStorage.removeItem(key); } catch (_) {}
      });
    } else {
      // A per-page key also prevents snapshot replacement when IndexedDB is unavailable.
      try {
        localStorage.setItem('nfyj_' + draftId, JSON.stringify(saved));
        if (legacyState && !legacyBackupSafe) { localStorage.setItem('nfyj_' + legacyId, JSON.stringify(legacyState)); legacyBackupSafe = true; }
        if (previousDraftId && previousDraftId !== draftId && previousSnapshotId) {
          var previousRaw = localStorage.getItem('nfyj_' + previousDraftId);
          if (previousRaw && JSON.parse(previousRaw).snapshotId === previousSnapshotId) localStorage.removeItem('nfyj_' + previousDraftId);
        }
        durableDraft = true;
        Object.values(CONTENT_KEYS).concat(['nfyj_cloud_base', 'nfyj_cloud_revision', 'nfyj_cloud_pending']).forEach(function (key) { localStorage.removeItem(key); });
      } catch (_) { durableDraft = false; }
    }
    if (durableDraft) {
      if (draftDb) {
        if (predecessor.id !== draftId) clearLocalSnapshot(predecessor.id, predecessor.snapshotId);
        if (!saved.pending && saved.source) clearLocalSnapshot(saved.source.id, saved.source.snapshotId);
      }
      if (!saved.pending) recoverySource = null;
      previousDraftId = draftId;
      previousSnapshotId = saved.snapshotId;
      try { sessionStorage.setItem('nfyj_draft_pointer', draftId); } catch (_) {}
    }
    return durableDraft;
  }
  async function draftSnapshots() {
    await storageReady;
    var rows = draftDb ? await new Promise(function (resolve, reject) {
      var tx = draftDb.transaction('state', 'readonly'), store = tx.objectStore('state');
      var keys = store.getAllKeys(), rows = store.getAll();
      tx.oncomplete = function () { resolve(keys.result.map(function (key, i) { return { id: key, saved: rows.result[i] }; })); };
      tx.onerror = function () { reject(new Error('读取草稿失败，请先导出当前页面备份')); };
    }) : [];
    var combined = new Map();
    rows.concat(localSnapshots()).forEach(function (row) { combined.set(row.id, newerSnapshot(combined.get(row.id), row.saved)); });
    return Array.from(combined, function (entry) { return { id: entry[0], saved: entry[1] }; });
  }
  async function getRecoveryDrafts() {
    return (await draftSnapshots()).filter(function (row) { return row.saved && (row.saved.editor || row.saved.pending && row.id !== draftId && row.id !== previousDraftId) && (!row.saved.owner || row.saved.owner === principal() || principal() === 'super_admin'); }).map(function (row) {
      return { id: row.id, time: row.saved.time || 0, owner: row.saved.owner, editor: !!row.saved.editor, title: row.saved.editor && (row.saved.editor.value.name || row.saved.editor.value.title),
        count: row.saved.editor ? 1 : ['kbCustom', 'kepuCustom', 'dialectCustom'].reduce(function (n, key) { return n + row.saved.bundle[key].length; }, 0) };
    });
  }
  async function saveEditorDraft(editor, id) {
    await storageReady;
    var saved = { editor: copy(editor), owner: principal(), time: Date.now(), snapshotId: Date.now() + ':' + Math.random().toString(36).slice(2) };
    id = id || 'editor:' + draftId;
    if (!/^editor:/.test(id)) throw new Error('草稿标识无效');
    if (draftDb) return new Promise(function (resolve) {
      var tx = draftDb.transaction('state', 'readwrite'); tx.objectStore('state').put(saved, id);
      tx.oncomplete = function () { resolve(true); }; tx.onerror = tx.onabort = function () { resolve(false); };
    });
    try { localStorage.setItem('nfyj_' + id, JSON.stringify(saved)); return true; } catch (_) { return false; }
  }
  async function clearEditorDraft(source, id) {
    await storageReady;
    var ownId = id || 'editor:' + draftId;
    if (draftDb) {
      await new Promise(function (resolve, reject) {
        var tx = draftDb.transaction('state', 'readwrite'), store = tx.objectStore('state');
        store.delete(ownId);
        if (source && source.id !== ownId) {
          var request = store.get(source.id);
          request.onsuccess = function () { if (request.result && request.result.snapshotId === source.snapshotId) store.delete(source.id); };
        }
        tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(new Error('清除表单草稿失败')); };
      });
      if (source) clearLocalSnapshot(source.id, source.snapshotId);
      try { localStorage.removeItem('nfyj_' + ownId); } catch (_) {}
      return;
    }
    localStorage.removeItem('nfyj_' + ownId);
    if (source) { var raw = localStorage.getItem('nfyj_' + source.id), saved = raw && JSON.parse(raw); if (saved && saved.snapshotId === source.snapshotId) localStorage.removeItem('nfyj_' + source.id); }
  }
  async function restoreRecoveryDraft(id) {
    if (!(await persistState()) && pending) throw new Error('当前草稿备份失败，请先导出备份，再切换草稿。');
    var row = (await draftSnapshots()).find(function (row) { return row.id === id; });
    if (!row || !(row.saved.pending || row.saved.editor) || (row.saved.owner && row.saved.owner !== principal() && principal() !== 'super_admin')) throw new Error('未找到当前账号可恢复的草稿');
    if (row.saved.editor) return { editor: copy(row.saved.editor), source: { id: row.id, snapshotId: row.saved.snapshotId } };
    draftId = 'draft:' + Date.now() + ':' + Math.random().toString(36).slice(2);
    previousDraftId = '';
    previousSnapshotId = '';
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
    var result = (Array.isArray(records) ? records : []).filter(function (entry) {
      try {
        globalThis.HeritageContent.record(entry, type, type, false);
        if (seen.has(entry.id)) return false;
        seen.add(entry.id); return true;
      } catch (_) { return false; }
    });
    if (!window.location || window.location.hostname !== 'lwy9107124035.github.io') return result;
    return result.map(function (entry) {
      var copy = Object.assign({}, entry), prefix = 'https://longnankejia.pages.dev';
      ['image', 'imageUrl'].forEach(function (key) { if (/^\/api\/media\//.test(copy[key] || '')) copy[key] = prefix + copy[key]; });
      if (copy.item && /^\/api\/media\//.test(copy.item.imageUrl || '')) copy.item = Object.assign({}, copy.item, { imageUrl: prefix + copy.item.imageUrl });
      return copy;
    });
  }
  function setSyncStatus(status, message) {
    if (status === 'saved' && contentIssue) { status = 'error'; message = contentIssue; }
    syncStatus = { status: status, message: message };
    if (window.dispatchEvent && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('admin-sync-status', { detail: syncStatus }));
    }
  }
  async function cloudRequest(body, publicOnly, knownRevision, query) {
    if (typeof fetch === 'undefined') throw new Error('当前环境不能连接管理服务器');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 60000);
    var session = publicOnly ? null : getSession();
    var headers = {};
    var retryable = !body || ['update_content', 'store_media'].indexOf(body.action) >= 0 || (body.chunked === true && /^[a-f0-9]{64}$/.test(body.requestId || ''));
    if (session) headers.Authorization = 'Bearer ' + session.bearer;
    if (body) headers['Content-Type'] = 'application/json';
    try {
      var endpoint = getSyncEndpoint();
      if (!body) {
        var args = Object.assign({ format: 'pages' }, query || {});
        if (knownRevision !== undefined) args.revision = knownRevision;
        endpoint += '?' + Object.keys(args).map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(args[key]); }).join('&');
      }
      var response, data;
      for (var attempt = 0; attempt < 3; attempt++) {
        data = null;
        try {
          response = await fetch(endpoint, {
            method: body ? 'POST' : 'GET', headers: headers, cache: 'no-store', signal: controller.signal,
            body: body ? JSON.stringify(body) : undefined
          });
        } catch (error) {
          if (error.name !== 'TypeError' || attempt >= 2 || controller.signal.aborted || !retryable) throw error;
          await new Promise(function (resolve) { setTimeout(resolve, 300 * (attempt + 1)); });
          continue;
        }
        var jsonResponse = (response.headers.get('Content-Type') || '').includes('application/json');
        if (!body && !args.cursor && jsonResponse && response.status === 409) {
          data = await response.json();
          if (data.code === 'PAGE_CHANGED' && attempt < 2) {
            await new Promise(function (resolve) { setTimeout(resolve, 300 * (attempt + 1)); });
            continue;
          }
        }
        if (jsonResponse && response.status < 500) break;
        // Only content patches and reads are safe to retry after an ambiguous response.
        if (attempt >= 2 || !retryable) break;
        if (response.body && response.body.cancel) await response.body.cancel();
        await new Promise(function (resolve) { setTimeout(resolve, 300 * (attempt + 1)); });
      }
      if (!(response.headers.get('Content-Type') || '').includes('application/json')) {
        throw Object.assign(new Error('服务器暂未响应，请稍后重试。草稿已保留。'), { code: 'ENDPOINT_UNAVAILABLE' });
      }
      data = data || await response.json();
      if (!response.ok || !data.ok) {
        if (body && body.action === 'update_content' && data.code === 'UNKNOWN_ACTION') throw Object.assign(new Error('服务正在更新，请稍后重试。草稿已保留。'), { code: 'SERVER_UPDATING' });
        var currentSession = getSession();
        if (data.code === 'SESSION_EXPIRED' && session && currentSession && session.bearer === currentSession.bearer) clearSession();
        throw Object.assign(new Error(data.error || '管理服务器请求失败'), data, { status: response.status });
      }
      return data;
    } catch (error) {
      if (typeof error.code === 'string') throw error;
      throw Object.assign(new Error('连接失败，草稿已保留，联网后会重试。'), { code: 'NETWORK_ERROR' });
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
  async function expandCatalogSnapshot(data) {
    if (data.model !== 'records-v1' || data.unchanged || (cloudRevision !== null && data.revision < cloudRevision)) return data;
    var schema = globalThis.HeritageContent, transition = !!cloudBase && catalog.model !== 'records-v1';
    var remote = copy(transition ? schema.defaults : cloudBase || schema.defaults);
    var summaries = new Set(catalog.summaries || []), hashes = Object.assign({}, catalog.hashes), previous = schema.contentCells(cloudBase);
    function accept(row) {
      var keepFull = row.summary && hashes[row.key] === row.hash && !summaries.has(row.key) && previous.has(row.key);
      schema.setContentCell(remote, row.key, keepFull ? previous.get(row.key) : row.value);
      hashes[row.key] = row.hash;
      if (row.summary && !keepFull) summaries.add(row.key); else summaries.delete(row.key);
    }
    if (transition || cloudBase && cloudRevision !== null && data.revision > cloudRevision) {
      var cursor = '';
      do {
        var query = { format: 'records', summary: 1, cursor: cursor };
        if (!transition) query.since = cloudRevision;
        var page = await cloudRequest(null, false, undefined, query);
        if (page.revision !== data.revision) throw Object.assign(new Error('内容正在更新，请重试同步；草稿已保留'), { code: 'PAGE_CHANGED' });
        page.rows.forEach(accept); cursor = page.cursor;
      } while (cursor);
    }
    schema.contentCells(data).forEach(function (value, key) { accept({ key: key, value: value, hash: data.hashes[key], summary: data.summaryKeys.indexOf(key) >= 0 }); });
    catalog = { model: data.model, pages: data.pages, firstCursors: copy(data.pages), firstPageKeys: Array.from(schema.contentCells(data).keys()), counts: data.counts, summaries: Array.from(summaries), hashes: hashes, capabilities: data.capabilities || catalog.capabilities };
    return Object.assign({}, data, remote);
  }
  async function loadRecord(type, id) {
    var field = type.endsWith('Custom') || type.endsWith('Edited') ? type : type + (read(CONTENT_KEYS[type + 'Custom'], []).some(function (row) { return row.id === id; }) || type === 'dialect' ? 'Custom' : 'Edited');
    var key = field + '/' + id, schema = globalThis.HeritageContent;
    var local = schema.contentCells(bundle()).get(key);
    if (catalog.model !== 'records-v1' || catalog.summaries.indexOf(key) < 0) return local || null;
    var startedGeneration = generation;
    var data = await cloudRequest(null, false, undefined, { format: 'record', key: key }), row = data.rows[0];
    if (generation !== startedGeneration || data.revision < cloudRevision) throw new Error('资料已更新，请重新打开；本机草稿已保留');
    var remote = copy(cloudBase || schema.defaults); schema.setContentCell(remote, key, row.value);
    remote.revision = cloudRevision;
    catalog.hashes[key] = row.hash; catalog.summaries = catalog.summaries.filter(function (value) { return value !== key; });
    if (data.revision !== cloudRevision) { cloudIncomplete = true; lastReadSession = null; }
    await mergeCloudDraft(remote); await persistState();
    return schema.contentCells(bundle()).get(key) || null;
  }
  async function loadContentPage(field, options) {
    if (catalog.model !== 'records-v1') return null;
    options = options || {};
    var page = await cloudRequest(null, false, undefined, { format: 'records', field: field, summary: options.full ? 0 : 1, cursor: options.cursor || '', q: options.query || '', category: options.category || '', media: options.media || '' });
    if (page.revision !== cloudRevision) { await syncWithCloud(); if (page.revision !== cloudRevision) throw new Error('内容已更新，请重试'); }
    var remote = copy(cloudBase || globalThis.HeritageContent.defaults);
    page.rows.forEach(function (row) {
      var keep = row.summary && catalog.hashes[row.key] === row.hash && catalog.summaries.indexOf(row.key) < 0;
      if (!keep) globalThis.HeritageContent.setContentCell(remote, row.key, row.value);
      catalog.hashes[row.key] = row.hash;
      catalog.summaries = catalog.summaries.filter(function (key) { return key !== row.key; });
      if (row.summary && !keep) catalog.summaries.push(row.key);
    });
    remote.revision = cloudRevision;
    await mergeCloudDraft(remote);
    if (!options.query && !options.category && !options.media) catalog.pages[field] = page.cursor;
    await persistState(); return page;
  }
  async function prepareExport(fields) {
    if (catalog.model !== 'records-v1') return;
    var schema = globalThis.HeritageContent, remote = copy(cloudBase || schema.defaults), startedRevision = cloudRevision, startedGeneration = generation;
    fields = fields || Object.keys(CONTENT_KEYS);
    if (fields.every(function (field) { return !catalog.pages[field] && !catalog.summaries.some(function (key) { return key.split('/')[0] === field; }); })) return;
    var hashes = Object.assign({}, catalog.hashes), summaries = new Set(catalog.summaries);
    for (var field of fields) {
      var cursor = '';
      do {
        var page = await cloudRequest(null, false, undefined, { format: 'records', field: field, cursor: cursor });
        if (page.revision !== startedRevision || cloudRevision !== startedRevision || generation !== startedGeneration) throw new Error('读取备份期间有新内容，请同步后重新导出');
        page.rows.forEach(function (row) {
          schema.setContentCell(remote, row.key, row.value); hashes[row.key] = row.hash; summaries.delete(row.key);
        });
        cursor = page.cursor;
      } while (cursor);
    }
    catalog.hashes = hashes; catalog.summaries = Array.from(summaries); fields.forEach(function (field) { catalog.pages[field] = ''; });
    remote.revision = cloudRevision; await mergeCloudDraft(remote); await persistState();
  }
  async function searchKnowledge(query) {
    if (!catalog.model || !(catalog.counts.kbCustom || catalog.counts.kbEdited)) return;
    query = String(query || '').trim().slice(0, 500); if (!query) return;
    var data = await cloudRequest(null, false, undefined, { format: 'search', q: query });
    if (data.revision < cloudRevision) throw new Error('资料已更新，请重试');
    var remote = copy(cloudBase || globalThis.HeritageContent.defaults);
    data.rows.forEach(function (row) {
      globalThis.HeritageContent.setContentCell(remote, row.key, row.value); catalog.hashes[row.key] = row.hash;
      catalog.summaries = catalog.summaries.filter(function (key) { return key !== row.key; });
    });
    if (data.revision !== cloudRevision) { cloudIncomplete = true; lastReadSession = null; }
    remote.revision = cloudRevision; await mergeCloudDraft(remote); await persistState();
  }
  async function applyCloud(data) {
    var startedGeneration = generation;
    await globalThis.HeritageContent.prepareMediaBundle(data);
    if (generation !== startedGeneration) throw new Error('读取期间有新的编辑，已保留本机草稿，请重新同步。');
    contentIssue = '';
    try { globalThis.HeritageContent.validateBundle(data); }
    catch (error) { contentIssue = '部分历史数据格式异常，已保留原始备份：' + error.message; }
    if (Array.isArray(data.auditLogs)) write(LS.audit_logs, data.auditLogs);
    Object.keys(CONTENT_KEYS).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(data, key)) write(CONTENT_KEYS[key], data[key]);
    });
    cloudRevision = data.revision;
    cloudIncomplete = false;
    cloudBase = copy(bundle());
    lastSyncedAt = Date.now();
    publishedBundle = null;
    write('nfyj_cloud_revision', cloudRevision);
    triggerFrontEndRefresh();
  }
  function mergeBundles(base, local, remote, conflicts) {
    var schema = globalThis.HeritageContent;
    var before = schema.contentCells(base), ours = schema.contentCells(local), theirs = schema.contentCells(remote);
    var merged = copy(schema.defaults);
    Array.from(new Set(Array.from(before.keys()).concat(Array.from(ours.keys()), Array.from(theirs.keys())))).forEach(function (key) {
      var b = before.get(key), l = ours.get(key), r = theirs.get(key), value;
      if (conflictKeys.indexOf(key) >= 0 && schema.comparable(l) !== schema.comparable(r)) { conflicts.push(key); value = l; }
      else if ((!base && l === undefined) || schema.comparable(l) === schema.comparable(b)) value = r;
      else if (schema.comparable(r) === schema.comparable(b) || schema.comparable(l) === schema.comparable(r)) value = l;
      else { conflicts.push(key); value = l; }
      if (value !== undefined) schema.setContentCell(merged, key, value);
    });
    return merged;
  }
  async function mergeCloudDraft(latest, acknowledged) {
    var conflicts = [];
    var base = cloudBase;
    if (Object.keys(editBases).length || acknowledged && acknowledged.length) {
      base = copy(cloudBase || globalThis.HeritageContent.defaults);
      Object.keys(editBases).forEach(function (key) { globalThis.HeritageContent.setContentCell(base, key, editBases[key]); });
      (acknowledged || []).forEach(function (change) { globalThis.HeritageContent.setContentCell(base, change.key, change.value); delete editBases[change.key]; delete editHashes[change.key]; });
    }
    await globalThis.HeritageContent.prepareMediaBundle(base);
    await globalThis.HeritageContent.prepareMediaBundle(latest);
    var local, startedGeneration;
    do {
      startedGeneration = generation; local = bundle();
      await globalThis.HeritageContent.prepareMediaBundle(local);
    } while (generation !== startedGeneration);
    if (cloudRevision !== null && latest.revision < cloudRevision) throw new Error('资料已更新，旧响应已忽略，请重新同步');
    var merged = mergeBundles(base, local, latest, conflicts);
    Object.keys(CONTENT_KEYS).forEach(function (key) { write(CONTENT_KEYS[key], merged[key]); });
    cloudBase = copy(Object.fromEntries(Object.keys(CONTENT_KEYS).map(function (key) { return [key, latest[key] || (OBJECT_KEYS.indexOf(key) >= 0 ? {} : [])]; })));
    cloudRevision = latest.revision;
    conflictKeys = Array.from(new Set(conflicts));
    lastSyncedAt = Date.now();
    publishedBundle = null;
    triggerFrontEndRefresh();
  }
  function changedCells() {
    var schema = globalThis.HeritageContent, before = schema.contentCells(cloudBase), after = schema.contentCells(bundle());
    return Array.from(new Set(Array.from(before.keys()).concat(Array.from(after.keys())))).filter(function (key) {
      return schema.comparable(before.get(key)) !== schema.comparable(after.get(key));
    }).map(function (key) {
      var explicitBase = Object.prototype.hasOwnProperty.call(editBases, key);
      return { key: key, before: explicitBase ? editBases[key] : before.get(key),
        baseHash: editHashes[key] || (catalog.model === 'records-v1' && !explicitBase ? catalog.hashes[key] : undefined),
        value: after.get(key) === undefined ? null : after.get(key) };
    });
  }
  function savedStatus() {
    if (pending && conflictKeys.length) setSyncStatus('conflict', conflictKeys.length + ' 条草稿需核对，其余内容已同步。');
    else if (pending) setSyncStatus('pending', '有草稿待上传。');
    else setSyncStatus('saved', cloudIncomplete ? '已保存，正在更新列表…' : '已同步');
  }
  function getConflicts() {
    var schema = globalThis.HeritageContent, local = schema.contentCells(bundle()), remote = schema.contentCells(cloudBase);
    return conflictKeys.map(function (key) {
      var ours = local.get(key), theirs = remote.get(key), item = ours || theirs || {};
      return { key: key, title: item.name || item.title || item.item && item.item.name || key,
        canCopy: key.indexOf('Custom/') >= 0 && !!ours, local: ours || null, remote: theirs || null };
    });
  }
  async function resolveConflict(key, choice) {
    if (conflictKeys.indexOf(key) < 0 || ['cloud', 'copy'].indexOf(choice) < 0) throw new Error('请选择待核对的草稿');
    var schema = globalThis.HeritageContent, local = bundle(), ours = schema.contentCells(local).get(key), remote = schema.contentCells(cloudBase).get(key);
    if (choice === 'copy' && (!key.includes('Custom/') || !ours)) throw new Error('此项请先导出备份，再使用云端版本');
    if (choice === 'copy') {
      var duplicate = copy(ours), field = key.slice(0, key.indexOf('/'));
      duplicate.id = 'copy-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      ['creatorName', 'creatorTokenId', 'createdAt'].forEach(function (prop) { delete duplicate[prop]; });
      if (duplicate.name) duplicate.name += '（本机副本）';
      if (duplicate.title) duplicate.title += '（本机副本）';
      schema.setContentCell(local, field + '/' + duplicate.id, duplicate);
    }
    schema.setContentCell(local, key, remote === undefined ? null : remote);
    Object.keys(CONTENT_KEYS).forEach(function (field) { write(CONTENT_KEYS[field], local[field]); });
    conflictKeys = conflictKeys.filter(function (item) { return item !== key; });
    delete editBases[key];
    generation++; pending = changedCells().length > 0;
    await persistState(); triggerFrontEndRefresh(); savedStatus();
    if (pending) await uploadPending();
  }
  async function uploadPending() {
    if (uploadPromise) return uploadPromise;
    uploadPromise = (async function () {
      var refreshAfterUpload = false;
      try {
        await storageReady;
        if (!pending) return true;
        if (draftOwner && principal() && draftOwner !== principal()) { await persistState(); setSyncStatus('error', '本机草稿属于另一账号，请使用原账号登录或导出备份后重新加载云端。'); return false; }
        if (!getSession()) { await persistState(); setSyncStatus('pending', '本机有未上传草稿，登录后可继续上传'); return false; }
        await persistState();
        while (pending) {
          await globalThis.HeritageContent.prepareMediaBundle(cloudBase);
          await globalThis.HeritageContent.prepareMediaBundle(bundle());
          var sentGeneration = generation;
          globalThis.HeritageContent.validateBundle(bundle());
          var changed = changedCells();
          var sendable = copy(changed.filter(function (change) { return conflictKeys.indexOf(change.key) < 0; }));
          if (!sendable.length) {
            pending = changed.length > 0;
            if (!pending) { conflictKeys = []; editBases = {}; draftOwner = ''; }
            await persistState(); savedStatus(); return !pending;
          }
          var changes = [];
          var mediaCache = new Map(), requestBytes = 0;
          // Keep each request small; the library and its pictures may be much larger.
          for (var change of sendable.slice(0, 8)) {
            await uploadRecordMedia(change.before, mediaCache);
            var value = await uploadRecordMedia(change.value, mediaCache);
            var operation = { key: change.key, baseHash: change.baseHash || await globalThis.HeritageContent.cellHash(change.before), value: value };
            var bytes = new TextEncoder().encode(JSON.stringify(operation)).length;
            if (changes.length && requestBytes + bytes > 4 * 1024 * 1024) break;
            changes.push(operation); requestBytes += bytes;
          }
          var operationId = await globalThis.HeritageContent.cellHash({ revision: cloudRevision, changes: changes }, true);
          var data = await cloudRequest({ action: 'update_content', operationId: operationId, revision: cloudRevision, changes: changes });
          var acknowledged = changes.filter(function (change) { return data.accepted.indexOf(change.key) >= 0; });
          var latest = copy(cloudBase || globalThis.HeritageContent.defaults);
          if (cloudRevision === null || data.revision >= cloudRevision) {
            for (var change of acknowledged) {
              var previousValue = globalThis.HeritageContent.contentCells(latest).get(change.key);
              var receipt = data.receipts.find(function (row) { return row.key === change.key; });
              var value = change.value && typeof change.value === 'object' ? Object.assign({}, change.value, receipt.provenance) : change.value;
              globalThis.HeritageContent.setContentCell(latest, change.key, value);
              catalog.hashes[change.key] = await globalThis.HeritageContent.cellHash(value, true);
              var field = change.key.split('/')[0];
              if (catalog.counts[field] !== undefined) catalog.counts[field] += (change.value === null ? 0 : 1) - (previousValue == null ? 0 : 1);
              catalog.summaries = catalog.summaries.filter(function (key) { return key !== change.key; });
            }
            for (var update of data.updates) {
              globalThis.HeritageContent.setContentCell(latest, update.key, update.value);
              if (catalog.model === 'records-v1') {
                catalog.hashes[update.key] = await globalThis.HeritageContent.cellHash(update.value, true);
                catalog.summaries = catalog.summaries.filter(function (key) { return key !== update.key; });
              }
            }
            if (data.baseRevision !== cloudRevision) { cloudIncomplete = true; refreshAfterUpload = true; }
          }
          latest.revision = cloudIncomplete ? cloudRevision : Math.max(cloudRevision || 0, data.revision);
          await mergeCloudDraft(latest, acknowledged);
          if (data.counts) catalog.counts = data.counts;
          lastReadSession = null;
          if (data.content && Array.isArray(data.content.auditLogs)) write(LS.audit_logs, data.content.auditLogs);
          if (Array.isArray(data.auditLogs)) write(LS.audit_logs, data.auditLogs);
          if (Array.isArray(data.recovery)) recoveryRows = data.recovery;
          write('nfyj_cloud_revision', cloudRevision);
          var remaining = changedCells(); pending = remaining.length > 0;
          conflictKeys = Array.from(new Set(conflictKeys.concat(data.conflicts))).filter(function (key) { return remaining.some(function (change) { return change.key === key; }); });
          if (!pending) { draftOwner = ''; conflictKeys = []; write('nfyj_cloud_pending', false); }
          await persistState();
          if (conflictKeys.length && sentGeneration === generation) break;
        }
        publishedBundle = null;
        triggerFrontEndRefresh();
        savedStatus();
        return !pending;
      } catch (error) {
        await persistState();
        setSyncStatus(error.code === 'SYNC_CONFLICT' ? 'conflict' : 'error', error.message + (durableDraft ? '' : ' 本机存储不可用，请保持此页面打开并立即导出备份。'));
        return false;
      } finally {
        uploadPromise = null;
        if (refreshAfterUpload && typeof window.addEventListener === 'function') setTimeout(function () { syncWithCloud(); }, 0);
      }
    })();
    return uploadPromise;
  }
  function syncCustomToCloud(callback) {
    if (!pending) draftOwner = principal();
    pending = true;
    generation++;
    write('nfyj_cloud_pending', true);
    if (syncStatus.status !== 'conflict') setSyncStatus('pending', '正在保存…');
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
        var uploaded = !pending || !getSession() || await uploadPending();
        var data = await cloudRequest(null, false, !pending && !cloudIncomplete && cloudBase && lastReadSession === bearer ? cloudRevision : undefined);
        if (data.capabilities) catalog.capabilities = data.capabilities;
        data = await expandCatalogSnapshot(data);
        if (Array.isArray(data.tokens)) write(LS.tokens, data.tokens);
        if (Array.isArray(data.lockouts)) write(LS.locked_clients, data.lockouts);
        if (Array.isArray(data.notifications)) write(LS.notifications, data.notifications);
        if (Array.isArray(data.contributions)) contributionRows = data.contributions;
        if (Array.isArray(data.contributionCounts)) contributionCounts = data.contributionCounts;
        if (Array.isArray(data.recovery)) recoveryRows = data.recovery;
        if (data.unchanged) {
          if (!pending) savedStatus();
        } else if (pending && !getSession()) {
          publishedBundle = data;
          triggerFrontEndRefresh();
          setSyncStatus('pending', '已显示云端发布内容；本机未上传草稿已保留，登录后可恢复上传');
        } else if (pending && getSession() && (cloudRevision === null || data.revision >= cloudRevision)) {
          cloudIncomplete = false;
          await mergeCloudDraft(data);
          await persistState();
          if (uploaded || conflictKeys.length) savedStatus();
        } else if (!pending && (cloudRevision === null || data.revision >= cloudRevision)) {
          await applyCloud(data);
          lastReadSession = bearer;
          await persistState();
          savedStatus();
        }
        return uploaded || conflictKeys.length ? data : null;
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
    if (!(await persistState()) && pending) throw new Error('本机草稿备份失败，请先导出备份，再读取云端。');
    var data = await cloudRequest();
    data = await expandCatalogSnapshot(data);
    if (generation !== startedGeneration) {
      await persistState();
      throw new Error('重新加载期间有新的编辑，已保留本机草稿。请核对并导出备份后重试。');
    }
    if (pending) { previousDraftId = ''; draftId = 'draft:' + Date.now() + ':' + Math.random().toString(36).slice(2); }
    pending = false; draftOwner = ''; conflictKeys = []; editBases = {}; recoverySource = null;
    write('nfyj_cloud_pending', false);
    await applyCloud(data);
    await persistState();
    setSyncStatus('saved', '已重新加载云端内容');
    return data;
  }
  async function uploadRecordMedia(record, cache) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    var value = Object.assign({}, record);
    async function upload(data) {
      if (!cache.has(data)) cache.set(data, (await cloudRequest({ action: 'store_media', dataUrl: data })).url);
      return cache.get(data);
    }
    for (var field of ['image', 'imageUrl']) if (/^data:image\//i.test(value[field] || '')) value[field] = await upload(value[field]);
    if (value.item && /^data:image\//i.test(value.item.imageUrl || '')) value.item = Object.assign({}, value.item, { imageUrl: await upload(value.item.imageUrl) });
    await globalThis.HeritageContent.prepareMediaRecord(record);
    return value;
  }
  async function optimizeImageStorage() {
    if (pending && !(await uploadPending())) throw new Error('请先核对待上传草稿，再整理图片。');
    await prepareExport();
    var snapshot = catalog.model ? bundle() : await cloudRequest(), schema = globalThis.HeritageContent;
    var records = Array.from(schema.contentCells(snapshot)).filter(function (entry) {
      var item = entry[1];
      return item && typeof item === 'object' && (/^data:image\//i.test(item.imageUrl || item.image || '') || item.item && /^data:image\//i.test(item.item.imageUrl || ''));
    });
    var completed = 0, copied = 0;
    for (var entry of records) {
      var value = await uploadRecordMedia(entry[1], new Map());
      var result = await cloudRequest({ action: 'update_content', changes: [{ key: entry[0], baseHash: await schema.cellHash(entry[1]), value: value }] });
      completed += result.accepted.length;
    }
    if (catalog.capabilities && catalog.capabilities.mediaUploads) {
      var sources = catalog.capabilities.separateImageDatabase ? ['images', 'legacy'] : ['legacy'];
      for (var source of sources) {
        var cursor = '', batch;
        do { batch = await cloudRequest({ action: 'migrate_media', source: source, cursor: cursor }); copied += batch.copied; cursor = batch.cursor; } while (batch.more);
      }
    }
    await syncWithCloud(); return { completed: completed, copied: copied, total: records.length };
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
      if (catalog.model === 'records-v1') {
        var counts = contributionCounts.filter(function (row) { return row.tokenId === item.id; });
        kbCount = (counts.find(function (row) { return row.type === 'kb'; }) || {}).count || 0;
        kepuCount = (counts.find(function (row) { return row.type === 'kepu'; }) || {}).count || 0;
        dialectCount = (counts.find(function (row) { return row.type === 'dialect'; }) || {}).count || 0;
      }

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
    var chunked = catalog.model === 'records-v1' && (body.action === 'rollback_token' || body.action === 'reject_item');
    var result, removed = new Set(), skipped = new Set(), cursor = '', cutoff = Date.now(), round = 0;
    try {
      do {
        var request = body;
        if (chunked) {
          request = Object.assign({}, body, { chunked: true, cursor: cursor, cutoff: cutoff });
          request.requestId = await globalThis.HeritageContent.cellHash({ request: request, round: round++ }, true);
        }
        result = await cloudRequest(request);
        (result.removedKeys || []).forEach(function (key) { removed.add(key); });
        (result.skippedKeys || []).forEach(function (key) { skipped.add(key); });
        cursor = result.cursor || '';
      } while (chunked && result.more);
    } catch (error) {
      if (removed.size) throw new Error('已撤回 ' + removed.size + ' 项，其余未完成：' + error.message);
      throw error;
    } finally { await syncWithCloud(); }
    return chunked ? Object.assign({}, result, { totalRemoved: removed.size, skipped: skipped.size }) : result;
  }
  function rollbackTokenChanges(tokenId) {
    return moderate({ action: 'rollback_token', tokenId: tokenId });
  }
  var contributionRows = [], contributionCounts = [];
  function getTokenDetailedContributions(tokenId, rows) {
    var token = read(LS.tokens, []).find(function (t) { return t.id === tokenId; });
    return { token: token || { id: tokenId, name: '受邀管理员' }, items: (rows || contributionRows).filter(function (row) { return row.tokenId === tokenId; }).map(function (row) {
      var names = { kb: ['知识库条目', '📚 知识库'], kepu: ['科普卡片', '🏮 科普卡片'], dialect: ['方言讲解', '🗣 方言讲解'] };
      return Object.assign({}, row, { typeName: names[row.type][0], typeBadge: names[row.type][1] });
    }) };
  }
  async function loadTokenContributions(tokenId, cursor) {
    if (catalog.model !== 'records-v1') return getTokenDetailedContributions(tokenId);
    var page = await cloudRequest(null, false, undefined, { format: 'contributions', tokenId: tokenId, cursor: cursor || '' });
    return Object.assign(getTokenDetailedContributions(tokenId, page.rows), { cursor: page.cursor });
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
    contributionCounts = [];
    if (pending && cloudBase) publishedBundle = cloudBase;
  }
  async function logout() {
    var departing = getSession();
    try { await cloudRequest({ action: 'logout' }); } finally {
      var current = getSession();
      if (!current || departing && current.bearer === departing.bearer) clearSession();
    }
  }

  /* ---------- 知识库 ---------- */

  function getEntries() {
    var base = (window.KNOWLEDGE_BASE || []).slice();
    var deleted = visibleContent('kbDeleted', []);
    var edited  = visibleContent('kbEdited', {});
    var custom  = visibleContent('kbCustom', []);

    var merged = base
      .filter(function (e) { return deleted.indexOf(e.id) === -1; })
      .map(function (e) {
        var value = Object.assign({}, e, edited[e.id]);
        if (catalog.summaries.indexOf('kbEdited/' + e.id) >= 0 && !Object.prototype.hasOwnProperty.call(edited[e.id] || {}, 'answer')) delete value.answer;
        return value;
      });

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

  function updateEntry(id, patch, creatorInfo, version) {
    rememberEditVersion(version);
    var custom = read(LS.custom, []);
    if (!unambiguous(custom, id, 'kb')) return false;
    if (version && version.key === 'kbCustom/' + id && version.value && !custom.some(function (entry) { return entry.id === id; })) {
      custom.push(Object.assign({}, version.value, patch, { id: id }));
      write(LS.custom, custom); syncCustomToCloud(); return true;
    }
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

  async function resetKB() {
    if (catalog.model) await prepareExport(['kbCustom', 'kbEdited', 'kbDeleted']);
    remove(LS.custom); remove(LS.deleted); remove(LS.edited);
    write(LS.custom, []); write(LS.deleted, []); write(LS.edited, {});
    syncCustomToCloud();
  }

  function exportKB() {
    assertExportReady(['kbCustom', 'kbEdited', 'kbDeleted']);
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
      .map(function (c) {
        var value = Object.assign({}, c, edited[c.id]);
        if (catalog.summaries.indexOf('kepuEdited/' + c.id) >= 0 && !Object.prototype.hasOwnProperty.call(edited[c.id] || {}, 'detail')) delete value.detail;
        return value;
      });

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

  function updateHeritageCard(id, patch, version) {
    rememberEditVersion(version);
    var custom = read(LS.kepu_custom, []);
    if (!unambiguous(custom, id, 'kepu')) return false;
    if (version && version.key === 'kepuCustom/' + id && version.value && !custom.some(function (entry) { return entry.id === id; })) {
      custom.push(Object.assign({}, version.value, patch, { id: id }));
      write(LS.kepu_custom, custom); syncCustomToCloud(); return true;
    }
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
  function getEditVersion(type, id) {
    var custom = read(CONTENT_KEYS[type + 'Custom'], []), isCustom = custom.some(function (entry) { return entry && entry.id === id; });
    var key = type + (isCustom ? 'Custom/' : 'Edited/') + id;
    return { key: key, value: copy(globalThis.HeritageContent.contentCells(bundle()).get(key) || null), hash: catalog.hashes[key] };
  }
  function rememberEditVersion(version) {
    if (version && typeof version.key === 'string' && !Object.prototype.hasOwnProperty.call(editBases, version.key)) editBases[version.key] = copy(version.value);
    if (version && version.hash && !editHashes[version.key]) editHashes[version.key] = version.hash;
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

  function updateDialectTrack(id, patch, version) {
    rememberEditVersion(version);
    var list = read(LS.dialect_custom, []);
    if (!unambiguous(list, id, 'dialect')) return false;
    var index = list.findIndex(function (track) { return track.id === id; });
    if (index < 0) {
      if (!version || !version.value) return false;
      list.push(Object.assign({}, version.value, patch, { id: id }));
    } else list[index] = Object.assign({}, list[index], patch, { id: id });
    write(LS.dialect_custom, list); syncCustomToCloud(); return true;
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
    write(LS.api, Object.assign({}, cur, patch));
    syncCustomToCloud();
  }

  function resetApi() {
    remove(LS.api); remove(LS.workflow);
    write(LS.api, {}); write(LS.workflow, {});
    syncCustomToCloud();
  }

  function getWorkflowConfig() {
    return Object.assign({
      systemPrompt: '你是龙南客家非遗数字助手的虚拟讲解员「阿蓝」。说话要亲切热情、尊重文献事实。介绍客家文化时条理清晰，遇未提及事实如实说明。',
      strictMode: true,
      minScore: 1.0,
      enableThinking: false
    }, read(LS.workflow, {}));
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

  function assertExportReady(fields) {
    if (catalog.model === 'records-v1' && fields.some(function (field) { return catalog.pages[field] || catalog.summaries.some(function (key) { return key.split('/')[0] === field; }); })) throw new Error('请先完整读取资料再导出备份');
  }
  function exportFullBundle() {
    if (catalog.model === 'records-v1') {
      assertExportReady(Object.keys(CONTENT_KEYS));
      return JSON.stringify({ app: '龙南客家非遗数字助手', version: 'v4-records', cloudDraft: bundle(), exportedAt: new Date().toISOString() }, null, 2);
    }
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
  async function exportFullBundleWithMedia() {
    await prepareExport();
    var exported = JSON.parse(exportFullBundle()), memo = new Map();
    var mediaBytes = 0;
    async function expand(value, field) {
      if (['image', 'imageUrl'].indexOf(field) >= 0 && globalThis.HeritageContent.mediaPath(value)) {
        if (!memo.has(value)) {
          var origin = window.location.hostname === 'lwy9107124035.github.io' ? 'https://longnankejia.pages.dev' : '';
          var response = await fetch(/^https:/.test(value) ? value : origin + value, { cache: 'no-store' });
          if (!response.ok) throw new Error('备份图片读取失败，请联网后重试。草稿未改变。');
          var bytes = new Uint8Array(await response.arrayBuffer()), chunks = [];
          mediaBytes += bytes.length;
          if (mediaBytes > 64 * 1024 * 1024) throw new Error('图片总量超过浏览器单次打包预算，请使用分文件维护备份');
          for (var start = 0; start < bytes.length; start += 30000) chunks.push(String.fromCharCode.apply(null, bytes.subarray(start, start + 30000)));
          memo.set(value, 'data:' + response.headers.get('Content-Type').split(';')[0] + ';base64,' + btoa(chunks.join('')));
        }
        return memo.get(value);
      }
      if (Array.isArray(value)) { var list = []; for (var child of value) list.push(await expand(child, '')); return list; }
      if (value && typeof value === 'object') { var object = {}; for (var key of Object.keys(value)) object[key] = await expand(value[key], key); return object; }
      return value;
    }
    return JSON.stringify(await expand(exported, ''), null, 2);
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
    loadTokenContributions: loadTokenContributions,
    rejectTokenItem: rejectTokenItem,
    verifyLogin: verifyLogin,
    saveSession: saveSession,
    getSession: getSession,
    clearSession: clearSession,
    logout: logout,
    getSyncStatus: function () { return Object.assign({ pending: pending, revision: cloudRevision, cloudLoaded: !!cloudBase && !cloudIncomplete, cloudCustomCount: catalog.model ? catalog.counts.kepuCustom || 0 : cloudBase ? (cloudBase.kepuCustom || []).length : null,
      pendingCount: pending ? changedCells().length : 0, conflictCount: conflictKeys.length, lastSyncedAt: lastSyncedAt }, syncStatus); },
    isContentSaved: function (key) { return changedCells().every(function (change) { return change.key !== key; }); },
    getConflicts: getConflicts,
    resolveConflict: resolveConflict,
    getEditVersion: getEditVersion,
    loadRecord: loadRecord,
    loadContentPage: loadContentPage,
    prepareExport: prepareExport,
    searchKnowledge: searchKnowledge,
    getCatalog: function () { return copy({ model: catalog.model, pages: catalog.pages, firstCursors: catalog.firstCursors, firstPageKeys: catalog.firstPageKeys, counts: catalog.counts, summaries: catalog.summaries, capabilities: catalog.capabilities }); },
    getContentCount: function (field) {
      var value = bundle()[field], count = catalog.model ? catalog.counts[field] || 0 : Array.isArray(value) ? value.length : Object.keys(value || {}).length;
      if (catalog.model && pending) changedCells().forEach(function (change) { if (change.key.split('/')[0] === field) count += (change.value === null ? 0 : 1) - (change.before == null ? 0 : 1); });
      return count;
    },
    reloadCloudContent: reloadCloudContent,
    getRecoveryDrafts: getRecoveryDrafts,
    restoreRecoveryDraft: restoreRecoveryDraft,
    saveEditorDraft: saveEditorDraft,
    clearEditorDraft: clearEditorDraft,
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
    updateDialectTrack: updateDialectTrack,
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
    exportFullBundleWithMedia: exportFullBundleWithMedia,
    getRecoveryHistory: function () { return recoveryRows.slice(); },
    loadRecoveryHistoryPage: function (cursor) { return cloudRequest(null, false, undefined, { format: 'history', cursor: cursor || '' }); },
    restoreOperation: function (id) { return moderate({ action: 'restore_operation', operationId: id }); },
    getStorageInfo: function () { return cloudRequest({ action: 'storage_info' }); },
    archiveHistory: function () { return moderate({ action: 'archive_history' }); },
    optimizeImageStorage: optimizeImageStorage,
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
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (getSession()) syncWithCloud();
    }, 15000);
  }
})();
