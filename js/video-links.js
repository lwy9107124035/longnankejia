(function (root) {
  'use strict';

  function normalize(value) {
    value = String(value || '').trim();
    if (/^BV[a-zA-Z0-9]{10}$/.test(value)) return 'https://www.bilibili.com/video/' + value + '/';
    var link = value.match(/https?:\/\/[^\s<>"'，。！？；、【】「」]+/i);
    return link ? link[0].replace(/[)）.,;!]+$/, '') : value;
  }

  function bilibili(value) {
    var url;
    try { url = new URL(normalize(value)); }
    catch (error) { if (error instanceof TypeError) return null; throw error; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    if (url.hostname === 'b23.tv' && /^\/[a-zA-Z0-9_-]{1,40}\/?$/.test(url.pathname))
      return { short: true, url: 'https://b23.tv' + url.pathname, provider: '哔哩哔哩' };
    if (!['www.bilibili.com', 'm.bilibili.com', 'bilibili.com', 'player.bilibili.com'].includes(url.hostname)) return null;
    var match = url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10}|av[0-9]+)(?:\/|$)/);
    var id = match ? match[1] : url.hostname === 'player.bilibili.com' && url.pathname === '/player.html' ? url.searchParams.get('bvid') || ('av' + url.searchParams.get('aid')) : '';
    if (!/^(?:BV[a-zA-Z0-9]{10}|av[0-9]+)$/.test(id || '')) return null;
    var page = Number(url.searchParams.get('p') || url.searchParams.get('page'));
    if (!Number.isInteger(page) || page < 1 || page > 1000) page = 1;
    return { short: false, provider: '哔哩哔哩', minWidth: 480, url: 'https://www.bilibili.com/video/' + id + '/?p=' + page,
      embed: 'https://player.bilibili.com/player.html?' + (id.startsWith('BV') ? 'bvid=' + id : 'aid=' + id.slice(2)) + '&p=' + page + '&autoplay=false' };
  }

  function platform(value) {
    var known = bilibili(value);
    if (known) return known;
    var url;
    try { url = new URL(normalize(value)); }
    catch (error) { if (error instanceof TypeError) return null; throw error; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    var id, match, host = url.hostname;
    if (['v.qq.com', 'm.v.qq.com'].includes(host)) {
      match = url.pathname.match(/^\/x\/(?:page\/|cover\/[^/]+\/)([a-zA-Z0-9]{8,32})\.html$/);
      id = url.searchParams.get('vid') || (match && match[1]);
      if (/^[a-zA-Z0-9]{8,32}$/.test(id || '')) return { provider: '腾讯视频', url: 'https://v.qq.com/x/page/' + id + '.html', embed: 'https://v.qq.com/txp/iframe/player.html?vid=' + id + '&auto=0' };
    }
    if (['v.youku.com', 'player.youku.com'].includes(host)) {
      match = url.pathname.match(/^(?:\/v_show\/id_|\/embed\/)([a-zA-Z0-9=]{5,100})(?:\.html|\/|$)/);
      if (match) return { provider: '优酷', url: 'https://v.youku.com/v_show/id_' + match[1] + '.html', embed: 'https://player.youku.com/embed/' + match[1] + '?autoplay=false' };
    }
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'youtu.be'].includes(host)) {
      match = url.pathname.match(/^\/(?:embed\/|shorts\/)?([a-zA-Z0-9_-]{11})(?:\/|$)/);
      id = url.searchParams.get('v') || (match && match[1]);
      if (/^[a-zA-Z0-9_-]{11}$/.test(id || '')) return { provider: 'YouTube', url: 'https://www.youtube.com/watch?v=' + id, embed: 'https://www.youtube.com/embed/' + id + '?autoplay=0&playsinline=1' };
    }
    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
      match = url.pathname.match(/^\/(?:video\/)?([0-9]{1,15})\/?$/);
      if (match) return { provider: 'Vimeo', url: 'https://vimeo.com/' + match[1], embed: 'https://player.vimeo.com/video/' + match[1] + '?autoplay=0' };
    }
    if (url.protocol === 'https:' && /(?:\/embed\/|\/iframe\/|\/player(?:\.html|\/|$))/.test(url.pathname))
      return { provider: '原站', url: url.href, embed: url.href, sandbox: true };
    return null;
  }

  root.HeritageVideo = { normalize: normalize, bilibili: bilibili, platform: platform };
})(globalThis);
