/**
 * 文化典藏展示模块 — PDF图片 + 视频链接 + 跳转问答
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

  function switchToChat(question) {
    // 切换到问答 Tab
    if (window.App && window.App.switchPanel) window.App.switchPanel('panelChat');
    // 触发问答
    if (window.App && window.App.ask) {
      setTimeout(function () { window.App.ask(question); }, 200);
    }
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
      imgHtml = '<img class="dc-detail-img" src="assets/pdf-imgs/page-' + p + '.jpg" alt="' + esc(item.name) + '" onerror="this.style.display=\'none\'">';
    }

    var videoHtml = '';
    if (item.videoUrl) {
      videoHtml =
        '<div class="dc-detail-video">' +
        '  <div class="dc-detail-video-icon">🎬</div>' +
        '  <div class="dc-detail-video-title">' + esc(item.name) + ' — 客家话语音讲解</div>' +
        '  <div class="dc-detail-video-desc">来自文化典藏数字二维码的方言讲解视频</div>' +
        '  <button class="dc-video-play-btn" id="dcPlayBtn" type="button">▶ 播放讲解视频</button>' +
        '</div>';
    }

    body.innerHTML =
      '<div class="dc-detail-name">' + esc(item.name) + '</div>' +
      (item.ipa ? '<div class="dc-detail-ipa">' + esc(item.ipa) + '</div>' : '') +
      imgHtml +
      '<div class="dc-detail-desc">' + esc(item.desc) + '</div>' +
      videoHtml +
      '<button class="dc-detail-ask" id="dcAskBtn" type="button">问问阿蓝关于「' + esc(item.name) + '」的更多知识</button>';
    mask.hidden = false;

    var playBtn = document.getElementById('dcPlayBtn');
    if (playBtn && item.videoUrl) {
      playBtn.addEventListener('click', function () {
        showVideoPlayer(item);
      });
    }

    var askBtn = document.getElementById('dcAskBtn');
    if (askBtn) {
      askBtn.addEventListener('click', function () {
        mask.hidden = true;
        switchToChat(item.name + '是什么？');
      });
    }
  }

  function showVideoPlayer(item) {
    var mask = document.getElementById('videoMask');
    var title = document.getElementById('videoTitle');
    var frame = document.getElementById('videoFrame');
    var desc = document.getElementById('videoDesc');
    if (!mask) return;

    title.textContent = item.name + ' — 客家话语音讲解';
    desc.textContent = '来自文化典藏数字二维码';
    // 用 iframe 嵌入视频页面
    frame.innerHTML = '<iframe src="' + esc(item.videoUrl) + '" allow="autoplay; fullscreen" allowfullscreen></iframe>';
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
      var total = data.chapters.reduce(function(s,c){return s+c.items.length;},0);
      var withVideo = data.chapters.reduce(function(s,c){return s + c.items.filter(function(i){return i.videoUrl;}).length;},0);
      console.log('[Diancang] initialized:', data.chapters.length, 'chapters,', total, 'items,', withVideo, 'with video');
    } catch (e) {
      console.error('[Diancang] init error:', e);
    }
  }

  /**
   * 找出文本里提到的、且有客家话讲解视频的典藏展品。
   * 知识库条目大量引用这些展品名，所以问答命中后可以直接把原声挂上去。
   */
  function findRelatedVideos() {
    var hay = Array.prototype.slice.call(arguments).join(' ');
    var hits = [];
    if (!data || !hay) return hits;
    var triggers = window.VIDEO_TRIGGERS || {};
    data.chapters.forEach(function (ch) {
      (ch.items || []).forEach(function (it) {
        if (!it.videoUrl) return;
        var named = hay.indexOf(it.name) !== -1;
        var keyed = (triggers[it.name] || []).some(function (w) { return hay.indexOf(w) !== -1; });
        if (named || keyed) hits.push(it);
      });
    });
    return hits;
  }

  window.Diancang = {
    init: init,
    switchToChat: switchToChat,
    findRelatedVideos: findRelatedVideos,
    playVideo: showVideoPlayer,
    /** 所有带客家话讲解视频的展品，方言语音库用 */
    videoExhibits: function () {
      var out = [];
      if (!data) return out;
      data.chapters.forEach(function (ch) {
        (ch.items || []).forEach(function (it) {
          if (it.videoUrl) out.push({ item: it, chapter: ch.title });
        });
      });
      return out;
    }
  };
})();
