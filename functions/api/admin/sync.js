/**
 * Cloudflare Pages Function: /api/admin/sync
 * 提供跨设备全站凭证同步、登录安全防御监控与客户端 IP 锁定手动解除
 */

const REDIS_URL = 'https://fair-humpback-233231.upstash.io';
const REDIS_TOKEN = 'gQAAAAAAA48PAQIgcDE5ZTU3Y2Q4ZmEzYTk0MGUwYTdmOTJmNWFkN2VlNDcwZg';
const REDIS_KEY = 'nfyj:sync:state';

let inMemoryState = {
  pwHash: null,
  tokens: [],
  lockouts: [], // { id, clientId, ip, geo, device, attempts, lockedAt, lockedUntil, status: 'locked'|'unlocked', unlockedBy }
  allUnlockedAt: 0,
  // 全站自定义内容多端实时同步
  kbCustom: [],
  kbEdited: {},
  kbDeleted: [],
  kepuCustom: [],
  kepuEdited: {},
  kepuDeleted: [],
  dialectCustom: [],
  apiConfig: {},
  workflowConfig: {},
  auditLogs: [],
  customUpdatedAt: 0
};

async function fetchWithTimeout(url, options, timeoutMs = 4000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (_) {
    return null;
  }
}

async function loadPersistedState() {
  try {
    const res = await fetchWithTimeout(REDIS_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + REDIS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', REDIS_KEY])
    }, 4000);
    if (!res || !res.ok) return inMemoryState;
    const data = await res.json();
    if (data && data.result && typeof data.result === 'string') {
      const parsed = JSON.parse(data.result);
      if (parsed && typeof parsed === 'object') {
        if (parsed.pwHash !== undefined) inMemoryState.pwHash = parsed.pwHash;
        if (Array.isArray(parsed.tokens)) inMemoryState.tokens = parsed.tokens;
        if (Array.isArray(parsed.lockouts)) inMemoryState.lockouts = parsed.lockouts;
        if (parsed.allUnlockedAt !== undefined) inMemoryState.allUnlockedAt = parsed.allUnlockedAt;
        if (Array.isArray(parsed.kbCustom)) inMemoryState.kbCustom = parsed.kbCustom;
        if (parsed.kbEdited && typeof parsed.kbEdited === 'object') inMemoryState.kbEdited = parsed.kbEdited;
        if (Array.isArray(parsed.kbDeleted)) inMemoryState.kbDeleted = parsed.kbDeleted;
        if (Array.isArray(parsed.kepuCustom)) inMemoryState.kepuCustom = parsed.kepuCustom;
        if (parsed.kepuEdited && typeof parsed.kepuEdited === 'object') inMemoryState.kepuEdited = parsed.kepuEdited;
        if (Array.isArray(parsed.kepuDeleted)) inMemoryState.kepuDeleted = parsed.kepuDeleted;
        if (Array.isArray(parsed.dialectCustom)) inMemoryState.dialectCustom = parsed.dialectCustom;
        if (parsed.apiConfig && typeof parsed.apiConfig === 'object') inMemoryState.apiConfig = parsed.apiConfig;
        if (parsed.workflowConfig && typeof parsed.workflowConfig === 'object') inMemoryState.workflowConfig = parsed.workflowConfig;
        if (Array.isArray(parsed.auditLogs)) inMemoryState.auditLogs = parsed.auditLogs;
        if (parsed.customUpdatedAt !== undefined) inMemoryState.customUpdatedAt = parsed.customUpdatedAt;
      }
    }
  } catch (_) {}
  return inMemoryState;
}

async function savePersistedState() {
  try {
    const payload = JSON.stringify(inMemoryState);
    await fetchWithTimeout(REDIS_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + REDIS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', REDIS_KEY, payload])
    }, 4000);
  } catch (_) {}
}

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestGet({ request }) {
  await loadPersistedState();
  const clientIp = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('x-real-ip') ||
                   request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                   '127.0.0.1';
  const cf = request.cf || {};
  const clientGeo = [cf.country, cf.region, cf.city].filter(Boolean).join(' · ') || '局域网/本机';

  return json(200, {
    ok: true,
    clientIp,
    clientGeo,
    pwHash: inMemoryState.pwHash,
    tokens: inMemoryState.tokens,
    lockouts: inMemoryState.lockouts,
    allUnlockedAt: inMemoryState.allUnlockedAt,
    kbCustom: inMemoryState.kbCustom || [],
    kbEdited: inMemoryState.kbEdited || {},
    kbDeleted: inMemoryState.kbDeleted || [],
    kepuCustom: inMemoryState.kepuCustom || [],
    kepuEdited: inMemoryState.kepuEdited || {},
    kepuDeleted: inMemoryState.kepuDeleted || [],
    dialectCustom: inMemoryState.dialectCustom || [],
    apiConfig: inMemoryState.apiConfig || {},
    workflowConfig: inMemoryState.workflowConfig || {},
    auditLogs: inMemoryState.auditLogs || [],
    customUpdatedAt: inMemoryState.customUpdatedAt || 0
  });
}

export async function onRequestPost({ request }) {
  await loadPersistedState();
  const clientIp = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('x-real-ip') ||
                   request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                   '127.0.0.1';
  const cf = request.cf || {};
  const clientGeo = [cf.country, cf.region, cf.city].filter(Boolean).join(' · ') || '局域网/本机';

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  const { action } = body;

  if (action === 'update_custom_bundle') {
    if (Array.isArray(body.kbCustom)) inMemoryState.kbCustom = body.kbCustom;
    if (body.kbEdited && typeof body.kbEdited === 'object') inMemoryState.kbEdited = body.kbEdited;
    if (Array.isArray(body.kbDeleted)) inMemoryState.kbDeleted = body.kbDeleted;
    if (Array.isArray(body.kepuCustom)) inMemoryState.kepuCustom = body.kepuCustom;
    if (body.kepuEdited && typeof body.kepuEdited === 'object') inMemoryState.kepuEdited = body.kepuEdited;
    if (Array.isArray(body.kepuDeleted)) inMemoryState.kepuDeleted = body.kepuDeleted;
    if (Array.isArray(body.dialectCustom)) inMemoryState.dialectCustom = body.dialectCustom;
    if (body.apiConfig && typeof body.apiConfig === 'object') inMemoryState.apiConfig = body.apiConfig;
    if (body.workflowConfig && typeof body.workflowConfig === 'object') inMemoryState.workflowConfig = body.workflowConfig;
    if (Array.isArray(body.auditLogs)) inMemoryState.auditLogs = body.auditLogs;
    inMemoryState.customUpdatedAt = Number(body.customUpdatedAt) || Date.now();
    await savePersistedState();
    return json(200, { ok: true, customUpdatedAt: inMemoryState.customUpdatedAt });
  }

  if (action === 'update_password') {
    if (body.pwHash !== undefined) {
      inMemoryState.pwHash = body.pwHash || null;
    }
    await savePersistedState();
    return json(200, { ok: true, pwHash: inMemoryState.pwHash });
  }

  if (action === 'update_tokens') {
    if (Array.isArray(body.tokens)) {
      inMemoryState.tokens = body.tokens;
    }
    await savePersistedState();
    return json(200, { ok: true, tokens: inMemoryState.tokens });
  }

  if (action === 'report_lock') {
    const realIp = (clientIp && clientIp !== '127.0.0.1') ? clientIp : (body.ip || clientIp || '127.0.0.1');
    const realGeo = (clientGeo && clientGeo !== '局域网/本机') ? clientGeo : (body.geo || clientGeo || '局域网/当前网络');
    const now = Date.now();
    const lockItem = {
      id: body.id || ('lock-' + now + '-' + Math.floor(Math.random() * 1000)),
      clientId: body.clientId || '',
      ip: realIp,
      geo: realGeo,
      device: body.device || '移动端/未知终端',
      attempts: body.attempts || 5,
      lockedAt: now,
      lockedUntil: body.lockedUntil || (now + 60000),
      status: 'locked'
    };
    inMemoryState.lockouts = [
      lockItem,
      ...inMemoryState.lockouts.filter(l => {
        const isSameDevice = (lockItem.clientId && l.clientId === lockItem.clientId) ||
                             (lockItem.ip && l.ip === lockItem.ip);
        return !isSameDevice;
      })
    ].slice(0, 50);
    await savePersistedState();
    return json(200, { ok: true, lockouts: inMemoryState.lockouts });
  }

  if (action === 'unlock') {
    const targetId = body.id;
    const targetIp = body.ip;
    const targetCid = body.clientId;
    const now = Date.now();
    inMemoryState.lockouts = inMemoryState.lockouts.map(l => {
      if ((targetId && l.id === targetId) || (targetIp && l.ip === targetIp) || (targetCid && l.clientId === targetCid)) {
        return { ...l, status: 'unlocked', unlockedAt: now, unlockedBy: '超级管理员手动解除' };
      }
      return l;
    });
    await savePersistedState();
    return json(200, { ok: true, lockouts: inMemoryState.lockouts });
  }

  if (action === 'unlock_all') {
    const now = Date.now();
    inMemoryState.allUnlockedAt = now;
    inMemoryState.lockouts = inMemoryState.lockouts.map(l => ({
      ...l,
      status: 'unlocked',
      unlockedAt: now,
      unlockedBy: '超级管理员一键解除全部'
    }));
    await savePersistedState();
    return json(200, { ok: true, lockouts: inMemoryState.lockouts, allUnlockedAt: inMemoryState.allUnlockedAt });
  }

  return json(400, { ok: false, error: 'Unknown action' });
}
