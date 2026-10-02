import test from 'node:test';
import assert from 'node:assert/strict';
import { onChat } from '../functions/_lib/siliconflow.js';
import { onAudio } from '../functions/_lib/siliconflow.js';

const PROD = 'https://codex.longnankejia-dev.pages.dev';
const DUMMY_KEY = 'test-only-dummy-key-never-a-real-secret';
const env = { CF_PAGES_BRANCH: 'codex', SILICONFLOW_API_KEY: DUMMY_KEY };
const PRODUCTION_MAPPINGS = [
  ['main', 'longnankejia.pages.dev'],
  ['qcode', 'qcode.longnankejia-dev.pages.dev'],
  ['codex', 'codex.longnankejia-dev.pages.dev'],
  ['doubao', 'longnankejia-dev.pages.dev'],
];
const chatPayload = {
  model: 'Qwen/Qwen2.5-7B-Instruct',
  messages: [{ role: 'user', content: '你好' }],
  temperature: 0.7,
  max_tokens: 256,
};

function request(path, { origin = PROD, host = 'codex.longnankejia-dev.pages.dev', ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (origin !== null) headers.set('Origin', origin);
  headers.set('Host', host);
  return new Request(PROD + path, { ...options, headers });
}

async function withFakeFetch(fake, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await run(); }
  finally { globalThis.fetch = original; }
}

test('allows each configured production branch only on its exact host and origin', async () => {
  await withFakeFetch(async () => Response.json({ ok: true }), async () => {
    for (const [branch, host] of PRODUCTION_MAPPINGS) {
      const base = `https://${host}`;
      const req = new Request(`${base}/api/ai/chat/completions`, {
        method: 'POST',
        headers: { Origin: base, Host: host, 'Content-Type': 'application/json' },
        body: JSON.stringify(chatPayload),
      });
      const response = await onChat(req, { env: { ...env, CF_PAGES_BRANCH: branch } });
      assert.equal(response.status, 200, `${branch} should map to ${host}`);
    }
  });
});

test('allows GitHub Pages CORS only from the exact origin to main and handles preflight', async () => {
  const githubOrigin = 'https://lwy9107124035.github.io';
  const mainHost = 'longnankejia.pages.dev';
  await withFakeFetch(async (url) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/chat/completions');
    return Response.json({ choices: [{ message: { content: 'mirror ok' } }] });
  }, async () => {
    const preflight = await onChat(new Request(`https://${mainHost}/api/ai/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        Origin: githubOrigin,
        Host: mainHost,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    }), { env: { ...env, CF_PAGES_BRANCH: 'main' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), githubOrigin);
    assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
    assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
    assert.match(preflight.headers.get('Vary'), /(?:^|,\s*)Origin(?:,|$)/i);
    assert.equal(preflight.headers.get('Cache-Control'), 'no-store');

    const actual = await onChat(new Request(`https://${mainHost}/api/ai/chat/completions`, {
      method: 'POST',
      headers: { Origin: githubOrigin, Host: mainHost, 'Content-Type': 'application/json' },
      body: JSON.stringify(chatPayload),
    }), { env: { ...env, CF_PAGES_BRANCH: 'main' } });
    assert.equal(actual.status, 200);
    assert.equal(actual.headers.get('Access-Control-Allow-Origin'), githubOrigin);
    assert.match(actual.headers.get('Vary'), /(?:^|,\s*)Origin(?:,|$)/i);
  });
});

test('rejects GitHub Pages CORS for unlisted origins, hosts, and branches', async () => {
  const calls = [];
  const githubOrigin = 'https://lwy9107124035.github.io';
  await withFakeFetch((...args) => { calls.push(args); throw new Error('unexpected upstream call'); }, async () => {
    const cases = [
      [new Request('https://longnankejia.pages.dev/api/ai/chat/completions', { method: 'POST', headers: { Origin: 'https://other.github.io', Host: 'longnankejia.pages.dev', 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload) }), { ...env, CF_PAGES_BRANCH: 'main' }],
      [new Request('https://qcode.longnankejia-dev.pages.dev/api/ai/chat/completions', { method: 'POST', headers: { Origin: githubOrigin, Host: 'qcode.longnankejia-dev.pages.dev', 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload) }), { ...env, CF_PAGES_BRANCH: 'qcode' }],
      [new Request('https://longnankejia.pages.dev/api/ai/chat/completions', { method: 'POST', headers: { Origin: githubOrigin, Host: 'longnankejia.pages.dev', 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload) }), { ...env, CF_PAGES_BRANCH: 'qcode' }],
      [new Request('https://codex.longnankejia-dev.pages.dev/api/ai/chat/completions', { method: 'POST', headers: { Origin: githubOrigin, Host: 'codex.longnankejia-dev.pages.dev', 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload) }), { ...env, CF_PAGES_BRANCH: 'main' }],
    ];
    for (const [req, requestEnv] of cases) {
      const response = await onChat(req, { env: requestEnv });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    const wrongPreflight = await onChat(new Request('https://longnankejia.pages.dev/api/ai/chat/completions', {
      method: 'OPTIONS',
      headers: { Origin: githubOrigin, Host: 'longnankejia.pages.dev', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' },
    }), { env: { ...env, CF_PAGES_BRANCH: 'main' } });
    assert.equal(wrongPreflight.status, 403);
    assert.equal(wrongPreflight.headers.get('Access-Control-Allow-Origin'), githubOrigin);
    assert.equal(calls.length, 0);
  });
});

test('rejects production requests outside the branch/host/origin mapping', async () => {
  const calls = [];
  await withFakeFetch((...args) => { calls.push(args); throw new Error('unexpected upstream call'); }, async () => {
    const body = JSON.stringify(chatPayload);
    for (const [req, requestEnv] of [
      [request('/api/ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), { ...env, CF_PAGES_BRANCH: 'feature' }],
      [request('/api/ai/chat/completions', { origin: 'https://attacker.example', method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), env],
      [request('/api/ai/chat/completions', { host: 'attacker.example', method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), env],
      [request('/api/ai/chat/completions', { origin: null, method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), env],
      [new Request('https://longnankejia.pages.dev/api/ai/chat/completions', { method: 'POST', headers: { Origin: 'https://longnankejia.pages.dev', Host: 'longnankejia.pages.dev', 'Content-Type': 'application/json' }, body }), { ...env, CF_PAGES_BRANCH: 'qcode' }],
      [new Request('https://longnankejia-dev.pages.dev/api/ai/chat/completions', { method: 'POST', headers: { Origin: 'https://codex.longnankejia-dev.pages.dev', Host: 'longnankejia-dev.pages.dev', 'Content-Type': 'application/json' }, body }), { ...env, CF_PAGES_BRANCH: 'doubao' }],
    ]) {
      const response = await onChat(req, { env: requestEnv });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal((await response.json()).error, '请求来源不允许');
    }
  });
  assert.equal(calls.length, 0);
});

test('allows same-origin localhost Pages dev requests on non-codex branches', async () => {
  await withFakeFetch(async (url, init) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/chat/completions');
    assert.equal(init.headers.Authorization, `Bearer ${DUMMY_KEY}`);
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  }, async () => {
    const req = new Request('http://localhost:8788/api/ai/chat/completions', {
      method: 'POST', headers: { Origin: 'http://localhost:8788', 'Content-Type': 'application/json' },
      body: JSON.stringify(chatPayload),
    });
    const response = await onChat(req, { env: { CF_PAGES_BRANCH: 'feature', SILICONFLOW_API_KEY: DUMMY_KEY } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });
});

test('rejects wrong method, content type, fields, model and oversized chat bodies', async () => {
  await withFakeFetch(() => { throw new Error('unexpected upstream call'); }, async () => {
    const get = await onChat(request('/api/ai/chat/completions', { method: 'GET' }), { env });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('Cache-Control'), 'no-store');
    const wrongType = await onChat(request('/api/ai/chat/completions', { method: 'POST', body: '{}' }), { env });
    assert.equal(wrongType.status, 415);
    const fields = await onChat(request('/api/ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...chatPayload, user: 'injected' }) }), { env });
    assert.equal(fields.status, 400);
    const model = await onChat(request('/api/ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...chatPayload, model: 'attacker/model' }) }), { env });
    assert.equal(model.status, 400);
    const large = await onChat(request('/api/ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(64 * 1024 + 1) }), { env });
    assert.equal(large.status, 413);
  });
});

test('requires the secret and never includes its value in success or error responses', async () => {
  const missing = await onChat(request('/api/ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload) }), { env: { CF_PAGES_BRANCH: 'codex' } });
  assert.equal(missing.status, 503);
  await withFakeFetch(async (_url, init) => {
    assert.equal(init.headers.Authorization, `Bearer ${DUMMY_KEY}`);
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  }, async () => {
    const ok = await onChat(request('/api/ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-token' }, body: JSON.stringify(chatPayload) }), { env });
    assert.equal(ok.status, 200);
    assert.doesNotMatch(await ok.clone().text(), new RegExp(DUMMY_KEY));
    assert.doesNotMatch(await ok.clone().text(), /browser-token/);
  });
  await withFakeFetch(async () => new Response(JSON.stringify({ error: DUMMY_KEY }), { status: 401, headers: { 'X-Secret': DUMMY_KEY } }), async () => {
    const failed = await onChat(request('/api/ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload) }), { env });
    const body = await failed.text();
    assert.equal(failed.status, 401);
    assert.doesNotMatch(body, new RegExp(DUMMY_KEY));
    assert.equal(failed.headers.get('X-Secret'), null);
    assert.equal(failed.headers.get('Cache-Control'), 'no-store');
  });
  await withFakeFetch(async () => Response.json({ unexpected: DUMMY_KEY }), async () => {
    const echoed = await onChat(request('/api/ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatPayload) }), { env });
    assert.equal(echoed.status, 502);
    assert.doesNotMatch(await echoed.text(), new RegExp(DUMMY_KEY));
  });
});

test('forwards only a sanitized chat payload to the fixed upstream endpoint', async () => {
  await withFakeFetch(async (url, init) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, `Bearer ${DUMMY_KEY}`);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(Object.hasOwn(init.headers, 'X-User-Header'), false);
    assert.deepEqual(JSON.parse(init.body), chatPayload);
    return Response.json({ choices: [{ message: { content: '您好' } }] });
  }, async () => {
    const response = await onChat(request('/api/ai/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer client-secret', 'X-User-Header': 'no-forward' },
      body: JSON.stringify(chatPayload),
    }), { env });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).choices[0].message.content, '您好');
  });
});

test('validates audio form fields and body size before forwarding', async () => {
  await withFakeFetch(() => { throw new Error('unexpected upstream call'); }, async () => {
    const extra = new FormData();
    extra.set('file', new Blob(['audio']), 'clip.webm');
    extra.set('model', 'Qwen/Qwen3-ASR-1.7B');
    extra.set('unexpected', 'no');
    const badFields = await onAudio(request('/api/ai/audio/transcriptions', { method: 'POST', body: extra }), { env });
    assert.equal(badFields.status, 400);
    const largeBody = new Request(PROD + '/api/ai/audio/transcriptions', {
      method: 'POST', headers: { Origin: PROD, Host: 'codex.longnankejia-dev.pages.dev', 'Content-Type': 'multipart/form-data; boundary=unused', 'Content-Length': String(8 * 1024 * 1024 + 1) },
      body: 'x'.repeat(8 * 1024 * 1024 + 1),
    });
    const tooLarge = await onAudio(largeBody, { env });
    assert.equal(tooLarge.status, 413);
  });
});

test('forwards only allowed audio fields to the fixed transcription endpoint', async () => {
  await withFakeFetch(async (url, init) => {
    assert.equal(url, 'https://api.siliconflow.cn/v1/audio/transcriptions');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, `Bearer ${DUMMY_KEY}`);
    assert.equal(init.headers['Content-Type'], undefined);
    const forwarded = await new Response(init.body).formData();
    assert.deepEqual([...forwarded.keys()].sort(), ['file', 'language', 'model']);
    assert.equal(forwarded.get('model'), 'Qwen/Qwen3-ASR-1.7B');
    assert.equal(forwarded.get('language'), 'zh');
    assert.equal(forwarded.get('file').name, 'clip.webm');
    return Response.json({ text: '客家山歌' });
  }, async () => {
    const form = new FormData();
    form.set('file', new Blob(['fake audio bytes'], { type: 'audio/webm' }), 'clip.webm');
    form.set('model', 'Qwen/Qwen3-ASR-1.7B');
    form.set('language', 'zh');
    const response = await onAudio(request('/api/ai/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer browser-token' }, body: form }), { env });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).text, '客家山歌');
  });
});

test('DeepSeek final-answer mode is enforced upstream without allowing arbitrary browser fields',async()=>{
 await withFakeFetch(async(_url,init)=>{
  const body=JSON.parse(init.body);assert.equal(body.model,'deepseek-ai/DeepSeek-V3.2');assert.equal(body.enable_thinking,false);
  return Response.json({choices:[{message:{content:'已核对资料。'}}]});
 },async()=>{
  const res=await onChat(request('/api/ai/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...chatPayload,model:'deepseek-ai/DeepSeek-V3.2'})}),{env});
  assert.equal(res.status,200);
 });
});
test('the grounded Qwen3 instruction model is accepted with the same restricted request fields',async()=>{
 await withFakeFetch(async(_url,init)=>{
  const body=JSON.parse(init.body);assert.equal(body.model,'Qwen/Qwen3-30B-A3B-Instruct-2507');
  assert.equal(body.enable_thinking,undefined);
  return Response.json({choices:[{message:{content:'资料中的工序没有列明。'}}]});
 },async()=>{
  const res=await onChat(request('/api/ai/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...chatPayload,model:'Qwen/Qwen3-30B-A3B-Instruct-2507'})}),{env});
  assert.equal(res.status,200);
 });
});
