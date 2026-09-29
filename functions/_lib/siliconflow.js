const CHAT_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const AUDIO_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const CHAT_LIMIT = 64 * 1024;
const AUDIO_LIMIT = 8 * 1024 * 1024;
const CHAT_MODELS = new Set([
  'Qwen/Qwen2.5-7B-Instruct',
  'deepseek-ai/DeepSeek-V3.2',
]);
const AUDIO_MODELS = new Set([
  'Qwen/Qwen3-ASR-1.7B',
  'FunAudioLLM/SenseVoiceSmall',
]);
const PRODUCTION_HOSTS = new Map([
  ['main', new Set(['longnankejia.pages.dev'])],
  ['qcode', new Set(['qcode.longnankejia-dev.pages.dev'])],
  ['codex', new Set(['codex.longnankejia-dev.pages.dev'])],
  ['doubao', new Set(['longnankejia-dev.pages.dev', 'doubao.longnankejia-dev.pages.dev'])],
  ['antigravity', new Set(['antigravity.longnankejia-dev.pages.dev'])],
  ['opus', new Set(['opus.longnankejia-dev.pages.dev'])],
]);
const GITHUB_PAGES_ORIGIN = 'https://lwy9107124035.github.io';
const MAIN_PAGES_HOST = 'longnankejia.pages.dev';

// This is only a best-effort per-isolate guard. Cloudflare may run several isolates
// and they do not share this map, so it is not a global quota or abuse-control system.
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function localHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function originAllowed(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (!origin) return false;

  // Each production branch is pinned to its exact Pages host and same-origin value.
  const productionHosts = PRODUCTION_HOSTS.get(env.CF_PAGES_BRANCH);
  if (productionHosts && url.protocol === 'https:' && productionHosts.has(url.host) &&
      request.headers.get('Host') === url.host && origin === `https://${url.host}`) {
    return true;
  }

  // The GitHub Pages mirror may call only the main branch's exact Pages host.
  if (env.CF_PAGES_BRANCH === 'main' && url.protocol === 'https:' &&
      url.host === MAIN_PAGES_HOST && request.headers.get('Host') === MAIN_PAGES_HOST &&
      origin === GITHUB_PAGES_ORIGIN) {
    return true;
  }

  // Wrangler Pages dev can use either loopback name, but only for same-origin calls.
  if (localHost(url.hostname) && url.origin === origin &&
      (!request.headers.get('Host') || request.headers.get('Host') === url.host)) {
    return true;
  }
  return false;
}

function isGithubMainRequest(request, env) {
  const url = new URL(request.url);
  return env.CF_PAGES_BRANCH === 'main' && url.protocol === 'https:' &&
    url.host === MAIN_PAGES_HOST && request.headers.get('Host') === MAIN_PAGES_HOST &&
    request.headers.get('Origin') === GITHUB_PAGES_ORIGIN;
}

function addCors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  const vary = new Set((headers.get('Vary') || '').split(',').map((value) => value.trim()).filter(Boolean));
  vary.add('Origin');
  headers.set('Vary', [...vary].join(', '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function preflight(request) {
  const requestedMethod = request.headers.get('Access-Control-Request-Method');
  const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
  });
  if (requestedMethod !== 'POST' || requestedHeaders.some((header) => header !== 'content-type')) {
    return addCors(new Response(JSON.stringify({ error: '预检请求不受支持' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      },
    }), GITHUB_PAGES_ORIGIN);
  }
  return addCors(new Response(null, { status: 204, headers }), GITHUB_PAGES_ORIGIN);
}

function rateLimited(request) {
  const now = Date.now();
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  let bucket = rateBuckets.get(address);
  if (!bucket || now - bucket.started >= RATE_WINDOW_MS) {
    bucket = { started: now, count: 0 };
    rateBuckets.set(address, bucket);
  }
  bucket.count++;
  if (rateBuckets.size > 2048) {
    for (const [key, value] of rateBuckets) {
      if (now - value.started >= RATE_WINDOW_MS) rateBuckets.delete(key);
    }
  }
  return bucket.count > RATE_LIMIT;
}

async function readLimited(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RangeError('too_large');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RangeError('too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validChatBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = new Set(['model', 'messages', 'temperature', 'max_tokens', 'top_p', 'stream']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (!CHAT_MODELS.has(value.model) || !Array.isArray(value.messages) ||
      value.messages.length < 1 || value.messages.length > 32) return false;
  if (value.stream !== undefined && value.stream !== false) return false;
  if (value.temperature !== undefined &&
      (typeof value.temperature !== 'number' || value.temperature < 0 || value.temperature > 2)) return false;
  if (value.top_p !== undefined &&
      (typeof value.top_p !== 'number' || value.top_p <= 0 || value.top_p > 1)) return false;
  if (value.max_tokens !== undefined &&
      (!Number.isInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 2000)) return false;
  return value.messages.every((message) => message && typeof message === 'object' &&
    !Array.isArray(message) && Object.keys(message).every((key) => key === 'role' || key === 'content') &&
    ['system', 'user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' && message.content.length <= 20_000);
}

async function safeUpstreamResponse(upstream, secret) {
  if (!upstream.ok) {
    const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
    try { await upstream.body?.cancel(); } catch { /* no sensitive upstream details are exposed */ }
    return json(status, { error: 'AI 服务暂时不可用' });
  }
  try {
    const bytes = await readLimited(upstream, 1024 * 1024);
    const text = new TextDecoder().decode(bytes);
    if (secret && text.includes(secret)) return json(502, { error: 'AI 服务暂时不可用' });
    JSON.parse(text);
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    try { await upstream.body?.cancel(); } catch { /* ignore upstream body */ }
    return json(502, { error: 'AI 服务返回了无效响应' });
  }
}

async function proxyAuthorized(request, context, endpoint) {
  const env = context.env || {};
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST 请求' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Allow: 'POST' },
    });
  }
  if (rateLimited(request)) return json(429, { error: '请求过于频繁，请稍后再试' });
  const key = env.SILICONFLOW_API_KEY;
  if (typeof key !== 'string' || !key.trim()) return json(503, { error: 'AI 服务尚未配置' });

  try {
    let body;
    let headers;
    if (endpoint === 'chat') {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
        return json(415, { error: '请求格式不支持' });
      }
      const bytes = await readLimited(request, CHAT_LIMIT);
      let parsed;
      try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return json(400, { error: '请求内容无效' }); }
      if (!validChatBody(parsed)) return json(400, { error: '请求字段或模型不受支持' });
      body = JSON.stringify(parsed);
      headers = { 'Content-Type': 'application/json' };
    } else {
      if (!/^multipart\/form-data\s*;/i.test(request.headers.get('Content-Type') || '')) {
        return json(415, { error: '请求格式不支持' });
      }
      const bytes = await readLimited(request, AUDIO_LIMIT);
      const contentType = request.headers.get('Content-Type');
      let form;
      try { form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }).formData(); }
      catch { return json(400, { error: '音频表单无效' }); }
      const entries = [...form.entries()];
      if (entries.some(([name]) => !['file', 'model', 'language'].includes(name)) ||
          entries.filter(([name]) => name === 'file').length !== 1 ||
          entries.some(([name, value]) => name !== 'file' && typeof value !== 'string')) {
        return json(400, { error: '音频表单字段不受支持' });
      }
      const file = form.get('file');
      const model = form.get('model');
      const language = form.get('language');
      if (!(file instanceof File) || file.size === 0 || file.size > AUDIO_LIMIT ||
          typeof model !== 'string' || !AUDIO_MODELS.has(model) ||
          (language !== null && (typeof language !== 'string' || language.length > 16))) {
        return json(400, { error: '音频表单字段无效' });
      }
      const sanitized = new FormData();
      sanitized.set('file', file, file.name || 'recording.webm');
      sanitized.set('model', model);
      if (language !== null) sanitized.set('language', language);
      body = sanitized;
      headers = {};
    }

    const upstream = await fetch(endpoint === 'chat' ? CHAT_URL : AUDIO_URL, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${key}` },
      body,
      redirect: 'manual',
    });
    return await safeUpstreamResponse(upstream, key);
  } catch (error) {
    if (error instanceof RangeError && error.message === 'too_large') {
      return json(413, { error: '请求内容过大' });
    }
    return json(502, { error: 'AI 服务暂时不可用' });
  }
}

async function proxy(request, context, endpoint) {
  const env = context.env || {};
  if (!originAllowed(request, env)) return json(403, { error: '请求来源不允许' });
  const githubMain = isGithubMainRequest(request, env);
  if (githubMain && request.method === 'OPTIONS') return preflight(request);
  const response = await proxyAuthorized(request, context, endpoint);
  return githubMain ? addCors(response, GITHUB_PAGES_ORIGIN) : response;
}

export function onChat(request, context) {
  return proxy(request, context, 'chat');
}

export function onAudio(request, context) {
  return proxy(request, context, 'audio');
}
