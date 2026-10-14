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
    pw_hash:        'nfyj_admin_pw_hash',
    tokens:         'nfyj_admin_tokens',
    kepu_custom:    'nfyj_kepu_custom',
    kepu_deleted:   'nfyj_kepu_deleted',
    kepu_edited:    'nfyj_kepu_edited',
    dialect_custom: 'nfyj_dialect_custom',
    dialect_deleted:'nfyj_dialect_deleted',
    workflow:       'nfyj_workflow_config',
    audit_logs:     'nfyj_audit_logs',
    notifications:  'nfyj_token_notifications',
    admin_session:  'nfyj_admin_session',
    locked_clients: 'nfyj_locked_clients'
  };

  var SS = {
    admin_session:  'nfyj_tab_admin_session'
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

  function getSessionStore() {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
    } catch (_) {}
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (_) {}
    return null;
  }

  function readSession(fallback) {
    try {
      var store = getSessionStore();
      if (!store) return fallback;
      var raw = store.getItem(SS.admin_session);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  function writeSession(val) {
    try {
      var store = getSessionStore();
      if (store) store.setItem(SS.admin_session, JSON.stringify(val));
    } catch (_) {}
  }

  function removeSession() {
    try {
      var store = getSessionStore();
      if (store) store.removeItem(SS.admin_session);
    } catch (_) {}
  }

  /* ---------- 跨设备自校验令牌签名算法 ---------- */
  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function base64UrlEncode(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else if (c < 2048) {
        bytes.push((c >> 6) | 192);
        bytes.push((c & 63) | 128);
      } else {
        bytes.push((c >> 12) | 224);
        bytes.push(((c >> 6) & 63) | 128);
        bytes.push((c & 63) | 128);
      }
    }
    var res = '', j = 0;
    while (j < bytes.length) {
      var b1 = bytes[j++];
      var b2 = j < bytes.length ? bytes[j++] : null;
      var b3 = j < bytes.length ? bytes[j++] : null;
      res += B64_CHARS.charAt(b1 >> 2);
      res += B64_CHARS.charAt(((b1 & 3) << 4) | (b2 !== null ? (b2 >> 4) : 0));
      if (b2 !== null) res += B64_CHARS.charAt(((b2 & 15) << 2) | (b3 !== null ? (b3 >> 6) : 0));
      if (b3 !== null) res += B64_CHARS.charAt(b3 & 63);
    }
    return res;
  }

  function base64UrlDecode(str) {
    var bytes = [], val = 0, bits = 0;
    for (var i = 0; i < str.length; i++) {
      var idx = B64_CHARS.indexOf(str.charAt(i));
      if (idx === -1) continue;
      val = (val << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((val >> bits) & 255);
      }
    }
    var res = '', k = 0;
    while (k < bytes.length) {
      var b1 = bytes[k++];
      if (b1 < 128) {
        res += String.fromCharCode(b1);
      } else if (b1 > 191 && b1 < 224) {
        res += String.fromCharCode(((b1 & 31) << 6) | (bytes[k++] & 63));
      } else {
        res += String.fromCharCode(((b1 & 15) << 12) | ((bytes[k++] & 63) << 6) | (bytes[k++] & 63));
      }
    }
    return res;
  }

  function computeChecksum(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  function generateSignedTokenStr(name, days, id) {
    var now = Date.now();
    var exp = days > 0 ? (now + days * 86400000) : 0;
    var obj = { id: id, n: name, exp: exp, iat: now };
    try {
      var jsonStr = JSON.stringify(obj);
      var b64 = base64UrlEncode(jsonStr);
      var sig = computeChecksum(b64);
      return 'NFYJ-INV-' + b64 + '.' + sig;
    } catch (_) {
      return '';
    }
  }

  function computeShortChecksum(prefix) {
    var s = String(prefix).toUpperCase() + '_NFYJ_SALT_2026';
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var c1 = chars.charAt((h & 0x1f));
    var c2 = chars.charAt(((h >>> 5) & 0x1f));
    var c3 = chars.charAt(((h >>> 10) & 0x1f));
    return c1 + c2 + c3;
  }

  function generateCompactShortToken() {
    var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var prefix = '';
    for (var i = 0; i < 3; i++) {
      prefix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    var cs = computeShortChecksum(prefix);
    return 'NFYJ-INV-' + prefix + cs;
  }

  function isCompactShortToken(tokenStr) {
    if (!tokenStr || typeof tokenStr !== 'string') return false;
    var raw = tokenStr.trim().toUpperCase().replace(/[\s_\-]+/g, '');
    if (raw.indexOf('NFYJINV') === 0) raw = raw.slice(7);
    else if (raw.indexOf('NFINV') === 0) raw = raw.slice(5);
    else if (raw.indexOf('INV') === 0) raw = raw.slice(3);
    else if (raw.indexOf('NF') === 0 && raw.length === 8) raw = raw.slice(2);
    if (raw.length === 6) {
      var prefix = raw.slice(0, 3);
      var cs = raw.slice(3);
      if (computeShortChecksum(prefix) === cs) return true;
    }
    return false;
  }

  function parseSignedToken(tokenStr) {
    if (!tokenStr || typeof tokenStr !== 'string') return { ok: false };
    var raw = tokenStr.trim();
    if (raw.indexOf('NFYJ-INV-') !== 0) return { ok: false };
    var body = raw.slice(9);
    var parts = body.split('.');
    if (parts.length !== 2) return { ok: false };
    var b64 = parts[0];
    var sig = parts[1];
    if (computeChecksum(b64) !== sig) return { ok: false };

    try {
      var jsonStr = base64UrlDecode(b64);
      var obj = JSON.parse(jsonStr);
      if (!obj || !obj.n) return { ok: false };
      var now = Date.now();
      if (obj.exp && obj.exp > 0 && now > obj.exp) {
        return { ok: false, error: '此邀请令牌已过期，请联系超级管理员重新签发' };
      }
      return {
        ok: true,
        item: {
          id: obj.id || ('tok-' + (obj.iat || now)),
          token: raw,
          name: obj.n,
          role: 'editor',
          createdAt: obj.iat || now,
          expiresAt: obj.exp || 0,
          revoked: false,
          paused: false,
          loginCount: 0,
          lastActiveAt: 0,
          lastClient: ''
        }
      };
    } catch (_) {
      return { ok: false };
    }
  }

  /* ---------- 单二维码跨设备凭证无缝同步 ---------- */

  function buildSyncPayload() {
    var customPw = null;
    try { customPw = localStorage.getItem(LS.pw); } catch (_) {}
    var tokens = read(LS.tokens, []);
    var activeTokens = tokens.filter(function (t) { return !t.revoked; });

    if (!customPw && activeTokens.length === 0) {
      return '';
    }

    var payload = {};
    if (customPw) {
      payload.p = customPw;
    }
    if (activeTokens.length > 0) {
      payload.t = activeTokens.map(function (t) {
        return {
          i: t.id,
          k: t.token,
          s: t.shortCode || '',
          n: t.name || '受邀管理员',
          e: t.expiresAt || 0,
          p: t.paused ? 1 : 0
        };
      });
    }

    try {
      var jsonStr = JSON.stringify(payload);
      var b64 = base64UrlEncode(jsonStr);
      var sig = computeChecksum(b64);
      return 'sync=' + b64 + '.' + sig;
    } catch (_) {
      return '';
    }
  }

  function applySyncPayload(hashOrStr) {
    try {
      var h = '';
      if (typeof hashOrStr === 'string' && hashOrStr) {
        h = hashOrStr;
      } else if (typeof window !== 'undefined' && window.location && window.location.hash) {
        h = window.location.hash;
      }
      if (!h) return false;

      var match = h.match(/sync=([A-Za-z0-9_\-]+)\.([a-z0-9]+)/);
      if (!match) return false;

      var b64 = match[1];
      var sig = match[2];
      if (computeChecksum(b64) !== sig) return false;

      var jsonStr = base64UrlDecode(b64);
      var payload = JSON.parse(jsonStr);
      if (!payload || typeof payload !== 'object') return false;

      var updated = false;
      if (payload.p && typeof payload.p === 'string') {
        localStorage.setItem(LS.pw, payload.p);
        updated = true;
      }

      if (payload.t && Array.isArray(payload.t)) {
        var existing = read(LS.tokens, []);
        var now = Date.now();
        payload.t.forEach(function (t) {
          if (!t.k) return;
          var found = existing.find(function (e) { return e.id === t.i || e.token === t.k; });
          if (!found) {
            existing.unshift({
              id: t.i || ('tok-' + now),
              token: t.k,
              shortCode: t.s || '',
              name: t.n || '受邀管理员',
              role: 'editor',
              createdAt: now,
              expiresAt: t.e || 0,
              revoked: false,
              paused: !!t.p,
              loginCount: 0,
              lastActiveAt: 0,
              lastClient: '移动端扫码同步'
            });
            updated = true;
          } else {
            found.paused = !!t.p;
            if (t.e) found.expiresAt = t.e;
            if (t.n) found.name = t.n;
            updated = true;
          }
        });
        if (updated) {
          write(LS.tokens, existing);
        }
      }

      // 无论是否更新，扫码进来的设备均清除输错锁定限制，避免用户扫码后依然被封锁无法输入
      try {
        localStorage.removeItem('nfyj_login_lock_state');
      } catch (_) {}

      // 清理 URL hash 保持地址栏清爽
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        try {
          var cleanHash = (window.location.hash || '').replace(/[?&]?sync=[A-Za-z0-9_\-]+\.[a-z0-9]+/g, '');
          if (cleanHash === '#' || cleanHash === '') {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
          } else {
            window.history.replaceState(null, '', window.location.pathname + window.location.search + cleanHash);
          }
        } catch (_) {}
      }

      return updated;
    } catch (_) {
      return false;
    }
  }

  /* ---------- 全站跨设备多端云同步与客户端锁定管理 ---------- */

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
      ip: cachedIp || '127.0.0.1 (本机/局域网)',
      geo: cachedGeo || '局域网/当前网络',
      device: platform + ' · ' + browser,
      ua: ua
    };
  }

  function syncTokensToCloud(tokens) {
    if (typeof fetch === 'undefined') return;
    try {
      fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_tokens', tokens: tokens })
      }).catch(function () {});
    } catch (_) {}
  }

  function syncPasswordToCloud(pwHash) {
    if (typeof fetch === 'undefined') return;
    try {
      fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_password', pwHash: pwHash })
      }).catch(function () {});
    } catch (_) {}
  }

  function syncWithCloud(callback) {
    if (typeof fetch === 'undefined') {
      if (typeof callback === 'function') callback(null);
      return;
    }
    fetch('/api/admin/sync')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          if (typeof callback === 'function') callback(null);
          return;
        }
        if (data.clientIp) {
          try {
            sessionStorage.setItem('nfyj_client_ip', data.clientIp);
            localStorage.setItem('nfyj_client_ip', data.clientIp);
            if (data.clientGeo) {
              sessionStorage.setItem('nfyj_client_geo', data.clientGeo);
              localStorage.setItem('nfyj_client_geo', data.clientGeo);
            }
          } catch (_) {}
        }
        if (data.pwHash) {
          try { localStorage.setItem(LS.pw_hash, data.pwHash); } catch (_) {}
        }
        if (data.tokens && Array.isArray(data.tokens) && data.tokens.length > 0) {
          var localToks = read(LS.tokens, []);
          var merged = false;
          data.tokens.forEach(function (dt) {
            var found = localToks.find(function (lt) { return lt.id === dt.id || lt.token === dt.token; });
            if (!found) {
              localToks.unshift(dt);
              merged = true;
            }
          });
          if (merged) write(LS.tokens, localToks);
        }
        if (data.lockouts && Array.isArray(data.lockouts)) {
          write(LS.locked_clients, data.lockouts);
          var myIp = data.clientIp;
          var myLock = data.lockouts.find(function (l) { return l.ip === myIp; });
          if (myLock && myLock.status === 'unlocked') {
            try { localStorage.removeItem('nfyj_login_lock_state'); } catch (_) {}
          }
        }
        if (typeof callback === 'function') callback(data);
      })
      .catch(function () {
        if (typeof callback === 'function') callback(null);
      });
  }

  function getLockedClients() {
    return read(LS.locked_clients, []);
  }

  function reportClientLock(attempts, lockedUntil) {
    var info = detectClientInfo();
    var lockItem = {
      id: 'lock-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      ip: info.ip,
      geo: info.geo,
      device: info.device,
      attempts: attempts || 5,
      lockedAt: Date.now(),
      lockedUntil: lockedUntil || (Date.now() + 60000),
      status: 'locked'
    };

    var list = read(LS.locked_clients, []);
    list = [lockItem].concat(list.filter(function (l) { return l.ip !== lockItem.ip; })).slice(0, 50);
    write(LS.locked_clients, list);
    addAuditLog('系统防御', '触发锁定', '客户端 [' + lockItem.ip + ' · ' + lockItem.device + '] 连续输错 ' + (attempts || 5) + ' 次，已执行锁定拦截');

    if (typeof fetch !== 'undefined') {
      fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report_lock',
          ip: lockItem.ip,
          geo: lockItem.geo,
          device: lockItem.device,
          attempts: lockItem.attempts,
          lockedUntil: lockItem.lockedUntil
        })
      }).catch(function () {});
    }

    return lockItem;
  }

  function unlockClient(lockIdOrIp) {
    var list = read(LS.locked_clients, []);
    var target = null;
    list = list.map(function (l) {
      if (l.id === lockIdOrIp || l.ip === lockIdOrIp) {
        l.status = 'unlocked';
        l.unlockedAt = Date.now();
        l.unlockedBy = '超级管理员手动解除';
        target = l;
      }
      return l;
    });
    write(LS.locked_clients, list);

    try {
      localStorage.removeItem('nfyj_login_lock_state');
    } catch (_) {}

    if (target) {
      addAuditLog('超级管理员', '解除锁定', '超级管理员手动解除了客户端 [' + target.ip + ' · ' + target.device + '] 的登录封锁');
    }

    if (typeof fetch !== 'undefined') {
      fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unlock',
          id: target ? target.id : lockIdOrIp,
          ip: target ? target.ip : lockIdOrIp
        })
      }).catch(function () {});
    }

    return true;
  }

  function unlockAllClients() {
    var list = read(LS.locked_clients, []);
    list = list.map(function (l) {
      l.status = 'unlocked';
      l.unlockedAt = Date.now();
      l.unlockedBy = '超级管理员一键全部解除';
      return l;
    });
    write(LS.locked_clients, list);

    try {
      localStorage.removeItem('nfyj_login_lock_state');
    } catch (_) {}

    addAuditLog('超级管理员', '全部解锁', '超级管理员执行了一键解除全部客户端登录锁定');

    if (typeof fetch !== 'undefined') {
      fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock_all' })
      }).catch(function () {});
    }

    return true;
  }

  function isClientUnlocked() {
    var cachedIp = '';
    try { cachedIp = sessionStorage.getItem('nfyj_client_ip') || localStorage.getItem('nfyj_client_ip') || ''; } catch (_) {}
    if (!cachedIp) return false;
    var list = read(LS.locked_clients, []);
    var myLock = list.find(function (l) { return l.ip === cachedIp; });
    return !!(myLock && myLock.status === 'unlocked');
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
    try {
      localStorage.setItem(LS.pw, pw);
      var hash = computeChecksum(pw);
      localStorage.setItem(LS.pw_hash, hash);
      syncPasswordToCloud(hash);
    } catch (e) {}
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
    var compactCode = generateCompactShortToken();
    var now = Date.now();
    var id = 'tok-' + now + '-' + Math.floor(Math.random() * 1000);
    var signed = generateSignedTokenStr(name, days, id);
    var tokenStr = signed || compactCode;

    var tokenObj = {
      id: id,
      token: tokenStr,
      shortCode: compactCode,
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
    syncTokensToCloud(list);
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
      syncTokensToCloud(list);
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
      syncTokensToCloud(list);
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
      syncTokensToCloud(list);
      addAuditLog('超级管理员', '销毁令牌', '销毁/撤销了受邀令牌：' + found.token + ' (' + found.name + ')');
    }
    return !!found;
  }

  function deleteInviteToken(tokenId) {
    var list = read(LS.tokens, []);
    var target = list.find(function (t) { return t.id === tokenId || t.token === tokenId; });
    var filtered = list.filter(function (t) { return t.id !== tokenId && t.token !== tokenId; });
    write(LS.tokens, filtered);
    syncTokensToCloud(filtered);
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
    var str = String(inputStr || '').trim().replace(/^['"“‘]+|['"”’]+$/g, '').trim();
    if (!str) {
      return { ok: false, error: '请输入密码或邀请令牌' };
    }

    var customPw = null;
    var pwHash = null;
    try {
      customPw = localStorage.getItem(LS.pw);
      pwHash = localStorage.getItem(LS.pw_hash);
    } catch (_) {}

    var sLower = str.toLowerCase();
    var isSuper = false;

    if (customPw) {
      // 超级管理员已自定义密码：必须严格匹配自定义密码，彻底拒绝默认 admin123 与后门口令
      isSuper = (str === customPw) || (sLower === String(customPw).toLowerCase());
    } else if (pwHash) {
      // 跨设备云端下发的密码哈希（无需明文传输，任何设备输入相同密码均可瞬间通过）
      var strHash = computeChecksum(str);
      var sLowerHash = computeChecksum(sLower);
      if (strHash === pwHash || sLowerHash === pwHash) {
        isSuper = true;
        try { localStorage.setItem(LS.pw, str); } catch (_) {}
      }
    } else {
      // 未设置自定义密码时，支持系统默认密码
      var defaultPw = (window.APP_CONFIG && window.APP_CONFIG.admin && window.APP_CONFIG.admin.password) || 'admin123';
      isSuper = (str === defaultPw) || (sLower === String(defaultPw).toLowerCase());
    }

    if (isSuper) {
      addAuditLog('超级管理员', '主密登录', '超级管理员成功登录工作台');
      return {
        ok: true,
        role: 'super_admin',
        title: '超级管理员',
        name: '超级管理员'
      };
    }

    // 严禁硬编码后门通用密码（彻底杜绝 guest123 等），普通管理员只能凭有效邀请令牌/短码鉴权

    // 2. 匹配本地已知邀请令牌
    var tokens = read(LS.tokens, []);
    var now = Date.now();
    var cleanStr = str.toUpperCase().replace(/[\s_\-]+/g, '');

    for (var i = 0; i < tokens.length; i++) {
      var item = tokens[i];
      var itemTokClean = String(item.token || '').toUpperCase().replace(/[\s_\-]+/g, '');
      var itemShortClean = String(item.shortCode || '').toUpperCase().replace(/[\s_\-]+/g, '');

      var matchToken = (item.token === str) ||
                       (item.token && item.token.toLowerCase() === sLower) ||
                       (item.shortCode && item.shortCode.toLowerCase() === sLower) ||
                       (itemTokClean && cleanStr && itemTokClean === cleanStr) ||
                       (itemShortClean && cleanStr && itemShortClean === cleanStr) ||
                       (itemTokClean && cleanStr && itemTokClean.indexOf(cleanStr) !== -1 && cleanStr.length >= 4) ||
                       (itemShortClean && cleanStr && cleanStr.indexOf(itemShortClean) !== -1);

      if (matchToken) {
        if (item.revoked) {
          return { ok: false, error: '此邀请令牌已被销毁或撤销，请联系超级管理员' };
        }
        if (item.paused) {
          return { ok: false, error: '此邀请令牌已被超级管理员临时暂停使用' };
        }
        if (item.expiresAt && item.expiresAt > 0 && now > item.expiresAt) {
          return { ok: false, error: '此邀请令牌已过期，请联系超级管理员重新签发' };
        }
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

    // 3. 跨设备自校验签名令牌 (手机端扫码或外地新设备直接激活)
    var parsed = parseSignedToken(str);
    if (parsed.ok && parsed.item) {
      var newItem = parsed.item;
      newItem.loginCount = 1;
      newItem.lastActiveAt = now;
      newItem.lastClient = (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.indexOf('Windows') !== -1) ? 'Windows 电脑端' : '移动端/手机扫码';
      tokens.unshift(newItem);
      write(LS.tokens, tokens);
      addAuditLog(newItem.name + ' (' + newItem.token + ')', '自校验令牌激活', '跨设备受邀管理员激活并登录工作台');

      return {
        ok: true,
        role: 'editor',
        title: '受邀管理员 · ' + newItem.name,
        name: newItem.name,
        tokenId: newItem.id,
        token: newItem.token
      };
    } else if (parsed.error) {
      return { ok: false, error: parsed.error };
    }

    // 4. 跨设备自校验紧凑短码 (手机端手动输入 6 位简短邀请码直接激活)
    if (isCompactShortToken(str)) {
      var shortNorm = str.toUpperCase();
      if (shortNorm.indexOf('NFYJ-INV-') !== 0) {
        if (shortNorm.indexOf('INV-') === 0) shortNorm = 'NFYJ-' + shortNorm;
        else shortNorm = 'NFYJ-INV-' + shortNorm;
      }
      var shortItem = {
        id: 'tok-short-' + now,
        token: shortNorm,
        shortCode: shortNorm,
        name: '受邀协管员',
        role: 'editor',
        createdAt: now,
        expiresAt: 0,
        revoked: false,
        paused: false,
        loginCount: 1,
        lastActiveAt: now,
        lastClient: (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.indexOf('Windows') !== -1) ? 'Windows 电脑端' : '移动端/手机输入'
      };
      tokens.unshift(shortItem);
      write(LS.tokens, tokens);
      addAuditLog(shortItem.name + ' (' + shortNorm + ')', '短码令牌激活', '手机端通过简短邀请码激活工作台');

      return {
        ok: true,
        role: 'editor',
        title: '受邀管理员 · 快捷令牌',
        name: '受邀协管员',
        tokenId: shortItem.id,
        token: shortItem.token
      };
    }

    return { ok: false, error: '密码错误或邀请令牌无效' };
  }

  /* ---------- 管理员独立标签页会话管理 (SessionStorage 窗口隔离) ---------- */
  function saveSession(sessionData) {
    if (!sessionData) return;
    writeSession({
      role: sessionData.role || 'editor',
      name: sessionData.name || '管理员',
      title: sessionData.title || '',
      tokenId: sessionData.tokenId || '',
      token: sessionData.token || '',
      loginAt: Date.now()
    });
  }

  function getSession() {
    var s = readSession(null);
    if (!s || !s.role) return null;
    if (s.role === 'super_admin') return s;
    if (s.role === 'editor') {
      var tokens = read(LS.tokens, []);
      var found = tokens.find(function (t) {
        return (s.tokenId && t.id === s.tokenId) || (s.token && t.token === s.token);
      });
      if (!found && s.token) {
        var parsed = parseSignedToken(s.token);
        if (parsed.ok) found = parsed.item;
      }
      var now = Date.now();
      var isExpired = found && found.expiresAt && found.expiresAt > 0 && now > found.expiresAt;
      if (!found || found.paused || found.revoked || isExpired) {
        clearSession();
        return null;
      }
      return {
        ok: true,
        role: 'editor',
        name: found.name,
        title: found.title || ('受邀管理员 · ' + found.name),
        tokenId: found.id,
        token: found.token,
        loginAt: s.loginAt
      };
    }
    return null;
  }

  function clearSession() {
    removeSession();
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
    importFullBundle: importFullBundle,

    // 单二维码凭证同步
    buildSyncPayload: buildSyncPayload,
    applySyncPayload: applySyncPayload,

    // 全站多端云同步与客户端锁定监控
    detectClientInfo: detectClientInfo,
    getLockedClients: getLockedClients,
    reportClientLock: reportClientLock,
    unlockClient: unlockClient,
    unlockAllClients: unlockAllClients,
    isClientUnlocked: isClientUnlocked,
    syncWithCloud: syncWithCloud,
    syncTokensToCloud: syncTokensToCloud,
    syncPasswordToCloud: syncPasswordToCloud
  };

  // 页面载入时自动解析并应用单二维码凭证同步包，并与云端同步最新令牌与安全状态
  try {
    applySyncPayload();
    syncWithCloud();
  } catch (_) {}
})();
