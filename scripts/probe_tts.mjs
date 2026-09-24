// 探明这个 key 到底能不能做客家话语音合成（TTS）。
//
// 之前探过搜索：enable_search 被静默忽略、95 个模型无一带搜索。这次探 TTS：
// 列 /v1/models 里所有语音类模型，并对候选逐个试合成一个词，看返回的是不是真音频。
// 只打印模型名与结果元信息，不打印密钥。
//
//   node scripts/probe_tts.mjs
import fs from 'node:fs';

const src = fs.readFileSync('js/secrets.js', 'utf8');
const key = (src.match(/apiKey:\s*"([^"]+)"/) || [])[1] || '';
if (!key) {
  console.log('没有可用密钥（js/secrets.js 是占位模板？）');
  process.exit(1);
}
const BASE = 'https://api.siliconflow.cn/v1';
const H = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };

const r = await fetch(BASE + '/models?page_size=200', { headers: H });
const j = await r.json();
const all = j.data || [];
const tts = all.filter((m) => /tts|speech|voice|audio|cosy|sense/i.test(m.id));
console.log(`模型总数 ${all.length}，疑似语音类 ${tts.length}`);
tts.slice(0, 20).forEach((m) => console.log('  ', m.id));

const tries = ['FunAudioLLM/CosyVoice2-0.5B', 'fishaudio/fish-speech-1.5', 'OpenAI-TTS/gpt-4o-mini-tts'];
for (const model of tries) {
  const body = { model, input: '客家话测试', voice: model.includes('fish') ? 'fish' : 'default',
    response_format: 'mp3', speed: 1 };
  try {
    const res = await fetch(BASE + '/audio/speech', {
      method: 'POST', headers: H, body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const isAudio = buf.slice(0, 3).toString('hex') !== '' && !String(buf.slice(0, 1)).startsWith('{');
    console.log(`  ${model} -> HTTP ${res.status}  ${buf.length}B  像音频=${res.headers.get('content-type')}`);
  } catch (e) {
    console.log(`  ${model} -> 失败 ${e.message}`);
  }
}
