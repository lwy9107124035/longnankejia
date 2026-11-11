import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/video-links.js';
import { resolveVideoLink, onRequestGet } from '../functions/api/video-link.js';

const { normalize, platform } = globalThis.HeritageVideo;

test('share text, tracking links and BV IDs normalize without keeping pasted markup', () => {
  assert.equal(normalize('【围屋介绍】 https://b23.tv/AbC123，复制后打开'), 'https://b23.tv/AbC123');
  assert.equal(normalize('BV1B7411m7LV'), 'https://www.bilibili.com/video/BV1B7411m7LV/');
  assert.equal(platform('https://m.bilibili.com/video/BV1B7411m7LV?p=2&share=abc').embed,
    'https://player.bilibili.com/player.html?bvid=BV1B7411m7LV&p=2&autoplay=false');
  assert.equal(normalize('/assets/my-video.mp4'), '/assets/my-video.mp4');
});

test('common video pages use their platform embed player and preserve a playable source link', () => {
  const cases = [
    ['https://v.qq.com/x/page/v3270e4uem9.html', 'v.qq.com', 'vid=v3270e4uem9'],
    ['https://v.qq.com/x/cover/7ce5noezvafma27/a00269ix3l8.html', 'v.qq.com', 'vid=a00269ix3l8'],
    ['https://v.youku.com/v_show/id_XMzg0MTE2NjAxNg==.html', 'player.youku.com', 'XMzg0MTE2NjAxNg=='],
    ['https://youtu.be/M7lc1UVf-VE', 'www.youtube.com', '/embed/M7lc1UVf-VE'],
    ['https://www.youtube.com/watch?v=M7lc1UVf-VE', 'www.youtube.com', '/embed/M7lc1UVf-VE'],
    ['https://vimeo.com/123456789', 'player.vimeo.com', '/video/123456789'],
  ];
  for (const [source, host, fragment] of cases) {
    const result = platform(source);
    assert.equal(new URL(result.embed).hostname, host);
    assert.ok(result.embed.includes(fragment));
    assert.ok(result.url.startsWith('https://'));
  }
});

test('generic HTTPS embed links are sandboxed while unrelated pages and lookalike hosts are not trusted players', () => {
  assert.equal(platform('https://video.example.org/embed/intro').sandbox, true);
  for (const value of ['javascript:alert(1)', 'https://www.bilibili.com.evil.test/video/BV1B7411m7LV',
    'https://user:secret@www.bilibili.com/video/BV1B7411m7LV', 'https://baike.baidu.com/item/123', 'https://'])
    assert.equal(platform(value), null);
});

test('short links resolve only within the video provider and never fetch their redirect target', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, redirect: options.redirect });
    return new Response(null, { status: 302, headers: { Location: 'https://www.bilibili.com/video/BV1B7411m7LV?spm_id_from=123' } });
  };
  assert.equal(await resolveVideoLink('https://b23.tv/AbC123', fetchImpl), 'https://www.bilibili.com/video/BV1B7411m7LV/?p=1');
  assert.deepEqual(requests, [{ url: 'https://b23.tv/AbC123', redirect: 'manual' }]);
  await assert.rejects(resolveVideoLink('https://b23.tv/AbC123', async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } })), /没有指向/);
  await assert.rejects(resolveVideoLink('https://example.com/video', fetchImpl), TypeError);
  let attempts = 0;
  await assert.rejects(resolveVideoLink('https://b23.tv/AbC123', async () => { attempts++; return new Response(null, { status: 302, headers: { Location: '/Another' } }); }), /跳转过多/);
  assert.equal(attempts, 4);
});

test('complete links require no network access and invalid public resolver requests are rejected', async () => {
  assert.equal(await resolveVideoLink('BV1B7411m7LV', () => { throw Error('must not fetch'); }), 'https://www.bilibili.com/video/BV1B7411m7LV/?p=1');
  const response = await onRequestGet({ request: new Request('https://example.test/api/video-link?url=http://127.0.0.1/private') });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
