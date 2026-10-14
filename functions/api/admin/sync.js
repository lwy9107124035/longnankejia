/**
 * Cloudflare Pages Function: /api/admin/sync
 * 提供跨设备全站凭证同步、登录安全防御监控与客户端 IP 锁定手动解除
 */

let inMemoryState = {
  pwHash: null,
  tokens: [],
  lockouts: [] // { id, ip, geo, device, attempts, lockedAt, lockedUntil, status: 'locked'|'unlocked', unlockedBy }
};

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
    lockouts: inMemoryState.lockouts
  });
}

export async function onRequestPost({ request }) {
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

  if (action === 'update_password') {
    if (body.pwHash && typeof body.pwHash === 'string') {
      inMemoryState.pwHash = body.pwHash;
    }
    return json(200, { ok: true, pwHash: inMemoryState.pwHash });
  }

  if (action === 'update_tokens') {
    if (Array.isArray(body.tokens)) {
      inMemoryState.tokens = body.tokens;
    }
    return json(200, { ok: true, tokens: inMemoryState.tokens });
  }

  if (action === 'report_lock') {
    const lockItem = {
      id: 'lock-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      ip: body.ip || clientIp,
      geo: body.geo || clientGeo,
      device: body.device || '移动端/未知终端',
      attempts: body.attempts || 5,
      lockedAt: Date.now(),
      lockedUntil: body.lockedUntil || (Date.now() + 60000),
      status: 'locked'
    };
    inMemoryState.lockouts = [lockItem, ...inMemoryState.lockouts.filter(l => l.ip !== lockItem.ip)].slice(0, 50);
    return json(200, { ok: true, lockouts: inMemoryState.lockouts });
  }

  if (action === 'unlock') {
    const targetId = body.id;
    const targetIp = body.ip;
    inMemoryState.lockouts = inMemoryState.lockouts.map(l => {
      if ((targetId && l.id === targetId) || (targetIp && l.ip === targetIp)) {
        return { ...l, status: 'unlocked', unlockedAt: Date.now(), unlockedBy: '超级管理员手动解除' };
      }
      return l;
    });
    return json(200, { ok: true, lockouts: inMemoryState.lockouts });
  }

  if (action === 'unlock_all') {
    inMemoryState.lockouts = inMemoryState.lockouts.map(l => ({
      ...l,
      status: 'unlocked',
      unlockedAt: Date.now(),
      unlockedBy: '超级管理员一键解除全部'
    }));
    return json(200, { ok: true, lockouts: inMemoryState.lockouts });
  }

  return json(400, { ok: false, error: 'Unknown action' });
}
