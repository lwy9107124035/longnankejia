/**
 * 客家方言语音库。
 *
 * 数据全部来自文化典藏里真实存在的展品讲解页（原本要扫展品旁的二维码才能听到），
 * 这里把它们直接列成可点的曲目，不合成、不伪造方言发音。
 *
 * 「哪个展品讲了这个词」是典藏的问题，检索在 js/diancang.js 的 search 里；
 * 本模块只列原声，不做字词读音查询：馆方没有客家话语音合成，拼音也不是本地读法。
 */
(function () {
  'use strict';

  var tracks = [];
  var listEl, frameEl, nowIdx, nowName, nowMeta, countEl;
  var activeIndex = -1;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function select(i) {
    var t = tracks[i];
    if (!t) return;
    activeIndex = i;
    nowIdx.textContent = String(i + 1).padStart(2, '0');
    nowName.textContent = t.item.name;
    nowMeta.textContent = t.chapter + ' · 典藏第 ' + t.item.page + ' 页';
    listEl.querySelectorAll('.dl-track').forEach(function (row, k) {
      row.classList.toggle('is-active', k === i);
    });
    frameEl.hidden = false;
    frameEl.innerHTML =
      '<iframe src="' + esc(t.item.videoUrl) + '" allow="autoplay; fullscreen" allowfullscreen></iframe>' +
      '<a class="dl-open" href="' + esc(t.item.videoUrl) + '" target="_blank" rel="noopener">在新窗口打开讲解页 ↗</a>';
  }

  function render() {
    if (!tracks.length) {
      listEl.innerHTML = '<li class="dl-empty">暂无讲解视频</li>';
      return;
    }
    countEl.textContent = tracks.length;
    listEl.innerHTML = tracks.map(function (t, i) {
      return '<li>' +
        '<button class="dl-track" type="button" data-i="' + i + '">' +
        '  <span class="dl-track-no">' + String(i + 1).padStart(2, '0') + '</span>' +
        '  <span class="dl-track-main">' +
        '    <span class="dl-track-name">' + esc(t.item.name) + '</span>' +
        '    <span class="dl-track-sub">' + esc(t.chapter) + ' · 第 ' + esc(t.item.page) + ' 页</span>' +
        '  </span>' +
        '  <span class="dl-track-play">▶</span>' +
        '</button></li>';
    }).join('');
    listEl.querySelectorAll('.dl-track').forEach(function (btn) {
      btn.addEventListener('click', function () {
        select(parseInt(btn.getAttribute('data-i'), 10));
      });
    });
  }

  function initRhyme() {
    var button = document.getElementById('rhymePlay'), seek = document.getElementById('rhymeSeek');
    var time = document.getElementById('rhymeTime'), status = document.getElementById('rhymeAudioStatus');
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    var context, buffer, source, startedAt = 0, offset = 0, animation = 0;
    if (!AudioContext) {
      button.disabled = true;
      status.textContent = '当前浏览器不支持童谣播放，请使用新版浏览器。';
      return;
    }
    function clock(seconds) {
      return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
    }
    function position() {
      return source ? Math.min(buffer.duration, offset + context.currentTime - startedAt) : offset;
    }
    function display() {
      var current = position();
      seek.value = current;
      seek.setAttribute('aria-valuetext', clock(current) + (buffer ? '，共 ' + clock(buffer.duration) : ''));
      time.textContent = clock(current) + ' / ' + (buffer ? clock(buffer.duration) : '—');
      button.textContent = source ? 'Ⅱ 暂停' : '▶ 播放';
      button.setAttribute('aria-label', source ? '暂停童谣' : '播放童谣');
      button.setAttribute('aria-pressed', String(!!source));
    }
    function tick() {
      display();
      if (source) animation = requestAnimationFrame(tick);
    }
    function stop() {
      offset = position();
      if (source) {
        source.onended = null;
        source.stop();
        source.disconnect();
        source = null;
      }
      cancelAnimationFrame(animation);
      display();
    }
    function start() {
      if (offset >= buffer.duration) offset = 0;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = function () {
        source.disconnect();
        source = null;
        offset = buffer.duration;
        cancelAnimationFrame(animation);
        display();
        status.textContent = '童谣播放结束，点击播放可重新收听。';
      };
      startedAt = context.currentTime;
      source.start(0, offset);
      status.textContent = '正在播放《月光光》。';
      tick();
    }
    button.addEventListener('click', async function () {
      if (source) {
        stop();
        status.textContent = '已暂停，点击播放继续收听。';
        return;
      }
      button.disabled = true;
      status.textContent = buffer ? '准备播放…' : '正在加载童谣录音…';
      try {
        if (!context) context = new AudioContext();
        await context.resume();
        if (!buffer) {
          // Decode a binary recording in memory rather than exposing a native media element
          // that download-manager extensions attach their floating controls to.
          var response = await fetch('assets/audio/yueguangguang.bin');
          if (!response.ok) throw new Error('Audio HTTP ' + response.status);
          buffer = await context.decodeAudioData(await response.arrayBuffer());
          seek.max = buffer.duration;
          seek.disabled = false;
        }
        start();
      } catch (error) {
        console.error('童谣播放失败', error);
        status.textContent = '童谣未能播放，请检查网络后再次点击播放。';
      } finally {
        button.disabled = false;
        display();
      }
    });
    seek.addEventListener('input', function () {
      var next = Number(seek.value), wasPlaying = !!source;
      stop();
      offset = next;
      if (wasPlaying && next < buffer.duration) start();
      else display();
    });
  }

  function init() {
    initRhyme();
    listEl = document.getElementById('dlTracks');
    frameEl = document.getElementById('dlFrame');
    nowIdx = document.getElementById('dlNowIdx');
    nowName = document.getElementById('dlNowName');
    nowMeta = document.getElementById('dlNowMeta');
    countEl = document.getElementById('dlCount');
    if (!listEl) return;

    // 依赖模块没起来时别只留一个空列表，静默空白页没人看得出出了什么问题
    if (!window.Diancang || !window.Diancang.videoExhibits) {
      listEl.innerHTML = '<li class="dl-empty">讲解数据未能加载，请刷新页面重试</li>';
      return;
    }
    tracks = window.Diancang.videoExhibits();
    render();
  }

  window.Dialect = {
    init: init,
    select: select,
    count: function () { return tracks.length; },
    tracks: function () { return tracks; }
  };
})();
