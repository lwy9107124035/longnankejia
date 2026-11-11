(function () {
  'use strict';

  function mediaUrl(value) {
    if (!value || !globalThis.HeritageContent.safeUrl(value, false)) return null;
    try { return new URL(value, location.href); }
    catch (error) { if (error instanceof TypeError) return null; throw error; }
  }

  function isVideoFile(value) {
    var url = mediaUrl(value);
    if (!url) return false;
    return /^\/api\/media\/[a-f0-9]{64}$/.test(url.pathname) || /\.(mp4|m4v|webm|og[gv])$/i.test(url.pathname);
  }

  function clear(container) {
    container.querySelectorAll('video, audio').forEach(function (media) { media.pause(); });
    container.replaceChildren();
  }

  function mount(container, value, name) {
    clear(container);
    var url = mediaUrl(value);
    if (!url) {
      container.textContent = '媒体链接格式不正确，请联系管理员修正。';
      return;
    }
    var link = document.createElement('a');
    link.className = 'media-source-link'; link.href = url.href;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = isVideoFile(value) ? '单独打开视频 ↗' : '打开原播放页面 ↗';
    var note = document.createElement('p');
    note.className = 'media-player-status'; note.setAttribute('role', 'status');

    if (location.protocol === 'https:' && url.protocol === 'http:') {
      note.textContent = '该链接使用 HTTP，请打开原页面观看，或请管理员上传视频文件、更换 HTTPS 视频地址。';
    } else if (isVideoFile(value)) {
      var video = document.createElement('video');
      video.className = 'detail-media-video'; video.controls = true;
      video.playsInline = true; video.setAttribute('webkit-playsinline', '');
      video.preload = 'metadata'; video.setAttribute('aria-label', name || '视频讲解');
      note.textContent = '点击播放器中的播放按钮观看视频。';
      video.addEventListener('error', function () {
        note.textContent = '视频未能加载或格式不受支持。可尝试单独打开；管理员可重新上传 H.264 编码的 MP4 视频。';
      });
      video.src = url.href;
      container.appendChild(video);
    } else if (url.protocol === 'https:' && /(?:^|\.)hlcode\.pro$/i.test(url.hostname)) {
      var frame = document.createElement('iframe');
      frame.src = url.href; frame.title = (name || '展品') + '视频播放页面';
      frame.allow = 'autoplay; fullscreen'; frame.allowFullscreen = true;
      container.appendChild(frame);
      note.textContent = '若页面空白或无法播放，请打开原播放页面观看。';
    } else {
      note.textContent = '这是外部网页链接，请打开原页面观看。要在本站播放，请上传视频文件或填写 MP4、WebM 视频直链。';
    }
    container.append(note, link);
  }

  window.MediaPlayer = { isVideoFile: isVideoFile, mount: mount, clear: clear };
})();
