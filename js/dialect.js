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
      listEl.innerHTML = '<li class="dl-empty">暂无讲解录音</li>';
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

  function init() {
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
