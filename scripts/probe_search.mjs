/**
 * Probe whether the configured 硅基流动 key can actually do web search.
 *
 * Nothing here is assumed: each candidate is called for real and the response shape is
 * reported. The key is read from js/secrets.js and never printed.
 *
 *   node scripts/probe_search.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'js/secrets.js'), 'utf8');
const key = (src.match(/apiKey\s*:\s*['"]([^'"]+)['"]/) || [])[1] || '';
if (!key) { console.error('no apiKey in js/secrets.js'); process.exit(1); }

const BASE = 'https://api.siliconflow.cn/v1';
const MODEL = 'Qwen/Qwen2.5-7B-Instruct';
const NEEDLE = '龙南客家非遗';

const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };

async function call(label, url, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON error page */ }
    const ms = Date.now() - t0;
    const snippet = text.slice(0, 260).replace(/\s+/g, ' ');
    console.log(`\n[${label}] HTTP ${res.status} in ${ms}ms`);
    if (parsed) {
      const content = parsed?.choices?.[0]?.message?.content;
      if (typeof content === 'string') console.log('  content:', content.slice(0, 200).replace(/\n/g, ' '));
      const refs = parsed.search_result || parsed?.choices?.[0]?.message?.search_reference || parsed.references;
      if (refs) console.log('  SEARCH RESULTS PRESENT:', JSON.stringify(refs).slice(0, 300));
      else console.log('  no search_result / references field');
      if (parsed.error) console.log('  error:', JSON.stringify(parsed.error).slice(0, 200));
    } else {
      console.log('  raw:', snippet);
    }
    return { status: res.status, parsed, ms };
  } catch (err) {
    console.log(`\n[${label}] FETCH FAILED after ${Date.now() - t0}ms: ${err.message}`);
    return { status: 0, parsed: null, ms: Date.now() - t0 };
  }
}

const q = { model: MODEL, messages: [{ role: 'user', content: '今天江西龙南天气如何？' }], max_tokens: 64 };

// 1. baseline: does the key work at all?
await call('baseline chat', `${BASE}/chat/completions`, q);

// 2. OpenAI-style search augmentation flags
await call('enable_search', `${BASE}/chat/completions`, { ...q, enable_search: true, search: { enable: true } });

// 3. a model that is search-native by name, if the account has one
await call('search model by name', `${BASE}/chat/completions`,
  { model: 'Qwen/Qwen2.5-7B-Instruct-search', messages: q.messages, max_tokens: 64 });

// 4. SiliconFlow's dedicated search endpoints
await call('POST /search', `${BASE}/search`, { query: NEEDLE, count: 5 });
await call('POST /web/search', `${BASE}/web/search`, { query: NEEDLE, count: 5 });

// 5. what models does this key actually see?
try {
  const res = await fetch(`${BASE}/model/list?category=llm`, { headers });
  const t = await res.text();
  console.log(`\n[model list] HTTP ${res.status}, ${t.length} bytes`);
  const names = (t.match(/"model"\s*:\s*"[^"]+"/g) || []).map((s) => s.split('"')[3]);
  const searchy = names.filter((n) => /search|web|联网/i.test(n));
  console.log('  total models:', names.length, '| search-flavoured:', searchy.length);
  if (searchy.length) console.log('  ', searchy.slice(0, 10).join('\n   '));
} catch (e) {
  console.log('\n[model list] failed:', e.message);
}
