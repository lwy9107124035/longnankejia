(function () {
  'use strict';
  var pending = new WeakMap(), streams = new WeakMap(), embeds = new WeakMap(), adaptiveRuntime;

  function mediaUrl(value) {
    if (!value || !globalThis.HeritageContent.safeUrl(value, false)) return null;
    try { return new URL(value, location.href); }
    catch (error) { if (error instanceof TypeError) return null; throw error; }
  }

  function isVideoFile(value) {
    var url = mediaUrl(value);
    if (!url) return false;
    return /^\/api\/media\/[a-f0-9]{64}$/.test(url.pathname) || /\.(mp4|m4v|mov|webm|og[gv]|m3u8|mpd)$/i.test(url.pathname);
  }

  function clear(container) {
    if (pending.has(container)) { pending.get(container).abort(); pending.delete(container); }
    if (embeds.has(container)) { embeds.get(container).disconnect(); embeds.delete(container); }
    if (streams.has(container)) {
      streams.get(container).destroy().catch(function (error) { console.warn('视频清理失败:', error.name); });
      streams.delete(container);
    }
    container.querySelectorAll('video, audio').forEach(function (media) { media.pause(); });
    container.replaceChildren();
  }

  function embed(container, url, name, sandbox, minWidth) {
    var frame = document.createElement('iframe');
    frame.src = url; frame.title = (name || '展品') + '视频播放页面';
    frame.allow = 'autoplay; fullscreen; picture-in-picture'; frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    if (sandbox) frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    if (!minWidth) { container.prepend(frame); return; }
    // 窄小容器会让平台隐藏进度栏；保留完整布局，再缩放到实际宽度。
    var viewport = document.createElement('div'); viewport.className = 'media-embed-viewport';
    frame.className = 'media-embed-scaled'; frame.style.width = minWidth + 'px'; frame.style.height = minWidth * 9 / 16 + 'px';
    viewport.appendChild(frame); container.prepend(viewport);
    function resize() {
      var width = viewport.clientWidth, height = viewport.clientHeight;
      if (!width || !height) return;
      var playerWidth = Math.max(minWidth, width), playerHeight = playerWidth * 9 / 16;
      var scale = Math.min(width / playerWidth, height / playerHeight);
      frame.style.width = playerWidth + 'px'; frame.style.height = playerHeight + 'px';
      frame.style.transform = 'translate(' + (width - playerWidth * scale) / 2 + 'px,' + (height - playerHeight * scale) / 2 + 'px) scale(' + scale + ')';
    }
    var observer = new ResizeObserver(resize); observer.observe(viewport); embeds.set(container, observer); resize();
    var fullscreen = viewport.requestFullscreen || viewport.webkitRequestFullscreen;
    var exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
    if (fullscreen && exitFullscreen) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'media-fullscreen-btn'; button.textContent = '全屏播放';
      button.addEventListener('click', function () {
        var result = fullscreen.call(viewport);
        if (result && result.catch) result.catch(function () { button.textContent = '请使用播放器的全屏按钮'; });
      });
      container.appendChild(button);
      var exitButton = document.createElement('button'); exitButton.type = 'button'; exitButton.className = 'media-exit-fullscreen'; exitButton.textContent = '退出全屏';
      exitButton.addEventListener('click', function () {
        var result = exitFullscreen.call(document);
        if (result && result.catch) result.catch(function () { exitButton.textContent = '请按 Esc 退出全屏'; });
      });
      viewport.appendChild(exitButton);
    }
  }

  function loadAdaptiveRuntime() {
    if (!adaptiveRuntime) adaptiveRuntime = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'js/vendor/shaka-player.compiled.js';
      script.onload = function () { resolve(window.shaka); };
      script.onerror = function () { adaptiveRuntime = null; script.remove(); reject(new Error('Player runtime unavailable')); };
      document.head.appendChild(script);
    });
    return adaptiveRuntime;
  }

  async function loadAdaptive(container, video, url, note) {
    var controller = new AbortController(); pending.set(container, controller);
    try {
      var shaka = await loadAdaptiveRuntime();
      if (pending.get(container) !== controller) return;
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) throw new Error('Unsupported streaming format');
      var player = new shaka.Player(); streams.set(container, player);
      player.addEventListener('error', function (event) { console.warn('视频流错误:', event.detail.code); note.textContent = '视频流未能播放。请打开原页面观看，或检查链接是否有效、是否允许跨站播放。'; });
      await player.attach(video);
      if (pending.get(container) !== controller) return;
      await player.load(url);
    } catch (error) {
      console.warn('视频流加载失败:', error.code || error.message);
      if (pending.get(container) === controller) note.textContent = '视频流未能加载。可打开原页面观看；视频来源需允许跨站播放。';
    } finally { if (pending.get(container) === controller) pending.delete(container); }
  }

  async function resolveShortLink(container, video, name, note, link) {
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 10000);
    pending.set(container, controller);
    note.textContent = '正在识别视频分享链接…';
    try {
      var origin = location.hostname === 'lwy9107124035.github.io' ? 'https://longnankejia.pages.dev' : location.origin;
      var response = await fetch(origin + '/api/video-link?url=' + encodeURIComponent(video.url), { signal: controller.signal });
      var result = await response.json(), resolved = response.ok && result.ok && globalThis.HeritageVideo.bilibili(result.url);
      if (pending.get(container) !== controller) return;
      if (!resolved || resolved.short) throw new Error('Unresolved video link');
      embed(container, resolved.embed, name, false, resolved.minWidth); link.href = resolved.url;
      note.textContent = '视频由哔哩哔哩提供。若无法播放，请打开原播放页面观看。';
    } catch (error) {
      if (pending.get(container) === controller) note.textContent = '短链接暂时无法识别。可打开原页面观看，或请管理员改填完整视频链接或 BV 号。';
    } finally {
      clearTimeout(timer);
      if (pending.get(container) === controller) pending.delete(container);
    }
  }

  function mount(container, value, name) {
    clear(container);
    value = globalThis.HeritageVideo.normalize(value);
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
    var platform = globalThis.HeritageVideo.platform(value);

    if (platform) {
      link.href = platform.url;
      if (platform.short) resolveShortLink(container, platform, name, note, link);
      else {
        embed(container, platform.embed, name, platform.sandbox, platform.minWidth);
        note.textContent = '视频由' + platform.provider + '提供。若无法播放，请打开原播放页面观看。';
      }
    } else if (location.protocol === 'https:' && url.protocol === 'http:') {
      note.textContent = '该链接使用 HTTP，请打开原页面观看，或请管理员上传视频文件、更换 HTTPS 视频地址。';
    } else if (!(url.protocol === 'https:' && /(?:^|\.)hlcode\.pro$/i.test(url.hostname))) {
      var video = document.createElement('video');
      video.className = 'detail-media-video'; video.controls = true;
      video.playsInline = true; video.setAttribute('webkit-playsinline', '');
      video.preload = 'metadata'; video.setAttribute('aria-label', name || '视频讲解');
      note.textContent = '点击播放器中的播放按钮观看视频。';
      video.addEventListener('error', function () {
        if (isVideoFile(value)) note.textContent = '视频未能加载或格式不受支持。可尝试单独打开；管理员可重新上传 H.264 编码的 MP4 视频。';
        else { video.remove(); note.textContent = '该链接无法作为视频直链播放，可能是网页分享链接、已过期或受访问限制。请打开原页面观看。'; }
      });
      container.appendChild(video);
      if (/\.(?:m3u8|mpd)$/i.test(url.pathname) && !(/\.m3u8$/i.test(url.pathname) && video.canPlayType('application/vnd.apple.mpegurl')))
        loadAdaptive(container, video, url.href, note);
      else video.src = url.href;
    } else {
      embed(container, url.href, name);
      note.textContent = '若页面空白或无法播放，请打开原播放页面观看。';
    }
    container.append(note, link);
  }

  window.MediaPlayer = { isVideoFile: isVideoFile, mount: mount, clear: clear };
})();
