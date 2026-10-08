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
    var subtitle = document.getElementById('rhymeSubtitle'), captionToggle = document.getElementById('rhymeCaptionToggle');
    var lyricList = document.getElementById('rhymeLyrics');
    var AudioContext = window.AudioContext || window.webkitAudioContext;
    var context, buffer, source, startedAt = 0, offset = 0, animation = 0;
    var cues = [], lines = [], lyricRows = [], activeLine = -1, captionState = 'loading';
    loadCaptions();
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
    function showCaption(current) {
      if (captionState !== 'ready') return;
      var cue = cues.find(function (item) { return current >= item.start && current < item.end; });
      var line = buffer && current < buffer.duration && cue ? cue.line : -1;
      if (activeLine !== line) {
        lyricRows.forEach(function (row, index) {
          row.classList.toggle('is-current', index === line);
          if (index === line) row.setAttribute('aria-current', 'true');
          else row.removeAttribute('aria-current');
        });
        activeLine = line;
      }
      var text = !buffer ? '点击播放，字幕将随录音切换。'
        : current >= buffer.duration ? '童谣播放结束。'
        : cue ? (cue.text || lines[cue.line].text) : current < cues[0].start ? '♪ 前奏'
        : current >= cues[cues.length-1].end ? '♪ 尾声' : '♪ 间奏';
      if (subtitle.textContent !== text) subtitle.textContent = text;
    }
    function loadCaptions() {
      captionState = 'loading';
      fetch('assets/audio/yueguangguang-captions.json?v=20261008-authoritative-ipa')
        .then(function (response) {
          if (!response.ok) throw new Error('Captions HTTP ' + response.status);
          return response.json();
        }).then(function (data) {
          if (!Array.isArray(data.lines) || !data.lines.length || !Array.isArray(data.cues) || !data.cues.length
              || data.lines.some(function (line) { return typeof line.text !== 'string' || typeof line.meaning !== 'string'; })
              || data.cues.some(function (cue) { return !Number.isInteger(cue.line) || !data.lines[cue.line] || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start; })) {
            throw new Error('童谣唱词和时间段不完整');
          }
          cues = data.cues; lines = data.lines;
          lyricList.innerHTML = lines.map(function (line, index) {
            return '<div class="dl-rhyme-item"><div class="dl-rhyme-item-num">' + String(index+1).padStart(2, '0')
              + '</div><div class="dl-rhyme-item-content"><div class="dl-rhyme-dialect">' + esc(line.text) + '</div>'
              + (line.ipa ? '<div class="dl-rhyme-ipa">IPA参考：' + esc(line.ipa) + '</div>' : '')
              + '<div class="dl-rhyme-mandarin">普通话释义：' + esc(line.meaning) + '</div></div></div>';
          }).join('');
          lyricRows = Array.from(lyricList.children);
          activeLine = -1;
          captionState = 'ready';
          showCaption(position());
        }).catch(function (error) {
          console.error('童谣字幕加载失败', error);
          captionState = 'error';
          subtitle.textContent = '字幕暂未加载，可继续收听录音。';
          lyricList.textContent = '唱词暂未加载，点击播放可重试。';
        });
    }
    captionToggle.addEventListener('change', function () {
      subtitle.hidden = !captionToggle.checked;
    });
    function display() {
      var current = position();
      seek.value = current;
      seek.setAttribute('aria-valuetext', clock(current) + (buffer ? '，共 ' + clock(buffer.duration) : ''));
      time.textContent = clock(current) + ' / ' + (buffer ? clock(buffer.duration) : '—');
      button.textContent = source ? 'Ⅱ 暂停' : '▶ 播放';
      button.setAttribute('aria-label', source ? '暂停童谣' : '播放童谣');
      button.setAttribute('aria-pressed', String(!!source));
      showCaption(current);
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
      if (captionState === 'error') loadCaptions();
      status.textContent = buffer ? '准备播放…' : '正在加载童谣录音…';
      try {
        if (!context) context = new AudioContext();
        await context.resume();
        if (!buffer) {
          // Decode a binary recording in memory rather than exposing a native media element
          // that download-manager extensions attach their floating controls to.
          var response = await fetch('assets/audio/yueguangguang.bin?v=20261008-no-outro');
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
      else {
        display();
        status.textContent = next >= buffer.duration ? '童谣播放结束，点击播放可重新收听。' : '已暂停，点击播放继续收听。';
      }
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
