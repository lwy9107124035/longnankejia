import '../../js/video-links.js';

export async function resolveVideoLink(value, fetchImpl = fetch) {
  let video = globalThis.HeritageVideo.bilibili(value);
  if (!video) throw new TypeError('请填写哔哩哔哩视频链接或 BV 号。');
  const signal = AbortSignal.timeout(8000);
  for (let attempt = 0; video.short && attempt < 4; attempt++) {
    const response = await fetchImpl(video.url, { redirect: 'manual', signal });
    await response.body?.cancel();
    const location = response.headers.get('Location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new Error('短链接暂时无法识别，请改用完整视频链接或 BV 号。');
    video = globalThis.HeritageVideo.bilibili(new URL(location, video.url).href);
    if (!video) throw new Error('短链接没有指向哔哩哔哩视频。');
  }
  if (video.short) throw new Error('短链接跳转过多，请使用完整视频链接或 BV 号。');
  return video.url;
}

export async function onRequestGet({ request }) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (request.headers.get('Origin') === 'https://lwy9107124035.github.io') headers['Access-Control-Allow-Origin'] = 'https://lwy9107124035.github.io';
  const value = new URL(request.url).searchParams.get('url') || '';
  if (value.length > 2048) return Response.json({ ok: false, error: '视频链接过长。' }, { status: 400, headers });
  try { return Response.json({ ok: true, url: await resolveVideoLink(value) }, { headers }); }
  catch (error) { return Response.json({ ok: false, error: error instanceof TypeError ? '请填写哔哩哔哩视频链接或 BV 号。' : '短链接暂时无法识别，请改用完整视频链接或 BV 号。' }, { status: error instanceof TypeError ? 400 : 502, headers }); }
}
