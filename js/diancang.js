/**
 * 文化典藏展示模块 — PDF图片 + 视频播放 + 分目录浏览
 */
(function () {
  'use strict';

  var data = null;
  var currentChapter = null;

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pageImg(item) {
    if (!item.page) return '';
    var p = String(item.page).padStart(2, '0');
    return '<img class="dc-item-thumb" src="assets/pdf-imgs/page-' + p + '.jpg" alt="' + esc(item.name) + '" loading="lazy" onerror="this.style.display=\'none\'">';
  }

  function renderChapterTabs() {
    var el = document.getElementById('dcTabs');
    if (!el || !data) return;
    el.innerHTML = data.chapters.map(function (ch) {
      return '<button class="dc-tab" data-id="' + ch.id + '" type="button">' +
        '<span class="dc-tab-num">' + ch.num + '</span>' +
        '<span class="dc-tab-title">' + esc(ch.title) + '</span>' +
        '<span class="dc-tab-count">' + ch.items.length + '件</span>' +
        '</button>';
    }).join('');
    el.querySelectorAll('.dc-tab').forEach(function (btn) {
      btn.addEventListener('click', function () { selectChapter(btn.getAttribute('data-id')); });
    });
  }

  function selectChapter(id) {
    currentChapter = data.chapters.find(function (c) { return c.id === id; }) || data.chapters[0];
    document.querySelectorAll('.dc-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-id') === currentChapter.id);
    });
    renderChapterContent();
  }

  function renderChapterContent() {
    var el = document.getElementById('dcContent');
    if (!el || !currentChapter) return;
    var ch = currentChapter;
    el.innerHTML =
      '<div class="dc-chapter-header">' +
      '  <div class="dc-chapter-num">' + ch.num + '</div>' +
      '  <div class="dc-chapter-info">' +
      '    <div class="dc-chapter-name">' + esc(ch.title) + '</div>' +
      '    <div class="dc-chapter-intro">' + esc(ch.intro) + '</div>' +
      '  </div>' +
      '</div>' +
      '<div class="dc-items-grid" id="dcItemsGrid"></div>';

    var grid = document.getElementById('dcItemsGrid');
    grid.innerHTML = ch.items.map(function (item, i) {
      return '<button class="dc-item-card" data-idx="' + i + '" type="button">' +
        pageImg(item) +
        '<div class="dc-item-name">' + esc(item.name) + '</div>' +
        (item.ipa ? '<div class="dc-item-ipa">' + esc(item.ipa) + '</div>' : '') +
        '<div class="dc-item-preview">' + esc(item.desc.slice(0, 50)) + '…</div>' +
        '<div class="dc-item-more">查看详情 →</div>' +
        '</button>';
    }).join('');

    grid.querySelectorAll('.dc-item-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var idx = parseInt(card.getAttribute('data-idx'), 10);
        showItemDetail(ch.items[idx]);
      });
    });
  }

  function showItemDetail(item) {
    var mask = document.getElementById('dcDetailMask');
    var body = document.getElementById('dcDetailBody');
    if (!mask || !body) return;

    var imgHtml = '';
    if (item.page) {
      var p = String(item.page).padStart(2, '0');
      imgHtml = '<img class="dc-detail-img" src="assets/pdf-imgs/page-' + p + '.jpg" alt="' + esc(item.name) + ' 典藏原页" onerror="this.style.display=\'none\'">';
    }

    var videoHtml = '';
    if (item.video) {
      videoHtml =
        '<div class="dc-detail-video">' +
        '  <div class="dc-detail-video-icon">🎬</div>' +
        '  <div class="dc-detail-video-title">方言语音讲解</div>' +
        '  <div class="dc-detail-video-desc">' + esc(item.qr) + '</div>' +
        '  <button class="dc-video-play-btn" id="dcPlayBtn" type="button">▶ 播放讲解视频</button>' +
        '</div>';
    }

    body.innerHTML =
      '<div class="dc-detail-name">' + esc(item.name) + '</div>' +
      (item.ipa ? '<div class="dc-detail-ipa">' + esc(item.ipa) + '</div>' : '') +
      imgHtml +
      '<div class="dc-detail-desc">' + esc(item.desc) + '</div>' +
      videoHtml +
      '<div class="dc-detail-qr">' +
      '  <div class="dc-detail-qr-icon">📱</div>' +
      '  <div class="dc-detail-qr-text">' + esc(item.qr) + '</div>' +
      '</div>' +
      '<button class="dc-detail-ask" id="dcAskBtn" type="button">问问阿蓝关于「' + esc(item.name) + '」的更多知识</button>';
    mask.hidden = false;

    var playBtn = document.getElementById('dcPlayBtn');
    if (playBtn) {
      playBtn.addEventListener('click', function () { showVideoPlayer(item); });
    }

    var askBtn = document.getElementById('dcAskBtn');
    if (askBtn) {
      askBtn.addEventListener('click', function () {
        mask.hidden = true;
        if (window.App && window.App.ask) window.App.ask(item.name + '是什么？');
      });
    }
  }

  function showVideoPlayer(item) {
    var mask = document.getElementById('videoMask');
    var title = document.getElementById('videoTitle');
    var frame = document.getElementById('videoFrame');
    var desc = document.getElementById('videoDesc');
    if (!mask) return;

    title.textContent = item.name + ' — 方言语音讲解';
    desc.textContent = item.qr;
    frame.innerHTML =
      '<div style="text-align:center;padding:20px;">' +
      '  <div style="font-size:36px;margin-bottom:8px;">🎬</div>' +
      '  <div style="font-size:12px;opacity:0.7;">视频内容来自文化典藏二维码</div>' +
      '  <div style="font-size:11px;opacity:0.5;margin-top:4px;">实际部署时将接入团队拍摄的客家话讲解视频</div>' +
      '</div>';
    mask.hidden = false;
  }

  function showPreface() {
    var mask = document.getElementById('dcDetailMask');
    var body = document.getElementById('dcDetailBody');
    if (!mask || !body || !data) return;
    body.innerHTML =
      '<div class="dc-detail-name">前言</div>' +
      '<img class="dc-detail-img" src="assets/pdf-imgs/page-02.jpg" alt="前言" onerror="this.style.display=\'none\'">' +
      '<div class="dc-detail-desc"><p>' + esc((data.meta && data.meta.preface) || '') + '</p></div>' +
      '<div class="dc-detail-meta">' + esc((data.meta && data.meta.compiler) || '') + ' · ' + esc((data.meta && data.meta.date) || '') + '</div>';
    mask.hidden = false;
  }

  function showEpilogue() {
    var mask = document.getElementById('dcDetailMask');
    var body = document.getElementById('dcDetailBody');
    if (!mask || !body || !data) return;
    body.innerHTML =
      '<div class="dc-detail-name">后记</div>' +
      '<img class="dc-detail-img" src="assets/pdf-imgs/page-67.jpg" alt="后记" onerror="this.style.display=\'none\'">' +
      '<div class="dc-detail-desc"><p>' + esc(data.epilogue || '') + '</p></div>';
    mask.hidden = false;
  }

  function init() {
    try {
      data = window.DIANCANG;
      if (!data || !data.chapters) { console.warn('[Diancang] data not loaded'); return; }

      var prefaceBtn = document.getElementById('dcPrefaceBtn');
      var epilogueBtn = document.getElementById('dcEpilogueBtn');
      if (prefaceBtn) prefaceBtn.addEventListener('click', showPreface);
      if (epilogueBtn) epilogueBtn.addEventListener('click', showEpilogue);

      var closeBtn = document.getElementById('dcDetailClose');
      var mask = document.getElementById('dcDetailMask');
      if (closeBtn) closeBtn.addEventListener('click', function () { mask.hidden = true; });
      if (mask) mask.addEventListener('click', function (e) { if (e.target === mask) mask.hidden = true; });

      var videoClose = document.getElementById('videoClose');
      var videoMask = document.getElementById('videoMask');
      if (videoClose) videoClose.addEventListener('click', function () { videoMask.hidden = true; });
      if (videoMask) videoMask.addEventListener('click', function (e) { if (e.target === videoMask) videoMask.hidden = true; });

      renderChapterTabs();
      selectChapter(data.chapters[0].id);
      console.log('[Diancang] initialized,', data.chapters.length, 'chapters,', data.chapters.reduce(function(s,c){return s+c.items.length;},0), 'items');
    } catch (e) {
      console.error('[Diancang] init error:', e);
    }
  }

  window.Diancang = { init: init };
})();
