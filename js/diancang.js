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
    // 图片按 PDF 第几张命名，而 item.page 是书上的印刷页码，两者在书中段差 2~5 页。
    // 配图必须用 sheet，否则每条展品显示的都是隔壁那一页；page 仍用于给读者引用。
    var p = item.sheet || item.page;
    if (!p) return '';
    p = String(p).padStart(2, '0');
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
    var imgPage = item.sheet || item.page;
    if (imgPage) {
      var p = String(imgPage).padStart(2, '0');
      imgHtml = '<img class="dc-detail-img" src="assets/pdf-imgs/page-' + p + '.jpg" alt="' + esc(item.name) + '" onerror="this.style.display=\'none\'">' +
        '<div class="dc-detail-cite">《文化典藏》第 ' + esc(item.page) + ' 页</div>';
    }

    var videoHtml = '';
    if (item.videoUrl) {
      videoHtml =
        '<div class="dc-detail-video">' +
        '  <div class="dc-detail-video-icon">🎬</div>' +
        '  <div class="dc-detail-video-title">' + esc(item.name) + ' — 客家话语音讲解</div>' +
        '  <div class="dc-detail-video-desc">展柜旁二维码背后的原声讲解，已直接挂在下面</div>' +
        '  <button class="dc-video-play-btn" id="dcPlayBtn" type="button">▶ 播放讲解视频</button>' +
        '</div>';
    }

    // 详情展示《文化典藏》原文全文；desc 只作为列表里的短摘要
    var fullText = item.text || item.desc;
    body.innerHTML =
      '<div class="dc-detail-name">' + esc(item.name) + '</div>' +
      (item.ipa ? '<div class="dc-detail-ipa">' + esc(item.ipa) + '</div>' : '') +
      imgHtml +
      '<div class="dc-detail-desc">' + esc(fullText) + '</div>' +
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
    desc.textContent = '《文化典藏》展品原声讲解 · 第 ' + (item.page || '') + ' 页';
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

  /* ---------- 指哪打哪：输入字词 → 定位到正文里讲它的展品 ---------- */

  function norm(s) {
    return String(s == null ? '' : s).replace(/[\s，。、；：！？（）()《》「」“”‘’·、]/g, '');
  }

  /** 按句末标点切句；不用 lookbehind，旧内核更稳。 */
  function splitSentences(text) {
    var out = [], buf = '', s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      buf += s[i];
      if ('。！？；\n'.indexOf(s[i]) !== -1) { out.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(function (x) { return x.length > 1; });
  }

  function allItems() {
    var out = [];
    if (!data) return out;
    data.chapters.forEach(function (ch) {
      (ch.items || []).forEach(function (it) { out.push({ item: it, chapter: ch.title }); });
    });
    return out;
  }

  /**
   * 打分：展品名字面出现最高，其次正文出现该词，最后退到两字以上子串的部分重合。
   * 每条命中都带回"到底是哪句话说了它"，观众要的从来不是列表而是那一句。
   */
  function searchExhibits(query) {
    var q = norm(query);
    if (!q) return [];
    return allItems().map(function (rec) {
      var it = rec.item;
      var name = norm(it.name), chapter = norm(rec.chapter);
      var body = norm(it.text || '') + norm(it.desc || '') + norm(it.ipa || '');
      var score = 0;
      if (name === q) score += 100;
      else if (name.indexOf(q) !== -1) score += 60;
      else if (q.indexOf(name) !== -1 && name.length >= 2) score += 45;
      if (chapter.indexOf(q) !== -1) score += 12;
      if (body.indexOf(q) !== -1) score += 30;

      var frag = 0;
      for (var len = Math.min(q.length, 6); len >= 2 && !frag; len--) {
        for (var s = 0; s + len <= q.length; s++) {
          if (body.indexOf(q.slice(s, s + len)) !== -1) { frag = len; break; }
        }
      }
      if (!score && frag) score += frag * 3;

      var sentence = '';
      var list = splitSentences(it.text || '').concat(splitSentences(it.desc || ''));
      for (var k = 0; k < list.length; k++) {
        if (norm(list[k]).indexOf(q) !== -1) {
          sentence = list[k];
          score += Math.max(0, 8 - Math.round(list[k].length / 24));
          break;
        }
      }
      if (!sentence && frag) {
        for (var k2 = 0; k2 < list.length; k2++) {
          if (norm(list[k2]).indexOf(q.slice(0, frag)) !== -1) { sentence = list[k2]; break; }
        }
      }
      return { item: it, chapter: rec.chapter, score: score, sentence: sentence };
    }).filter(function (h) { return h.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  function markTerm(sentence, query) {
    var q = String(query || '').trim();
    if (!q) return esc(sentence);
    var at = sentence.indexOf(q);
    if (at === -1) return esc(sentence);
    return esc(sentence.slice(0, at)) + '<mark>' + esc(sentence.substr(at, q.length))
      + '</mark>' + esc(sentence.slice(at + q.length));
  }

  function runFind() {
    var input = document.getElementById('dcQuery');
    var hint = document.getElementById('dcFindHint');
    var listEl = document.getElementById('dcFindList');
    if (!input || !hint || !listEl) return;
    var q = String(input.value || '').trim();
    if (!norm(q)) {
      hint.textContent = '';
      listEl.innerHTML = '';
      return;
    }
    var hits = searchExhibits(q);
    if (!hits.length) {
      hint.textContent = '42 件展品的正文里没有「' + q + '」。换个说法，或者只打两个字试试。';
      listEl.innerHTML = '';
      return;
    }
    var audio = hits.filter(function (h) { return h.item.videoUrl; }).length;
    hint.innerHTML = '命中 <strong>' + hits.length + '</strong> 件展品'
      + (audio ? '，其中 ' + audio + ' 件有客家话原声' : '') + '，点一条直接翻到那一页。';
    listEl.innerHTML = hits.slice(0, 12).map(function (h, i) {
      return '<li><button class="dc-find-item" type="button" data-i="' + i + '">'
        + '<span class="dc-find-name">' + esc(h.item.name) + (h.item.videoUrl ? ' 🔊' : '') + '</span>'
        + '<span class="dc-find-sub">' + esc(h.chapter) + ' · 第 ' + esc(h.item.page) + ' 页</span>'
        + '<span class="dc-find-sent">' + (h.sentence ? markTerm(h.sentence, q) : esc(h.item.desc || '')) + '</span>'
        + '</button></li>';
    }).join('');
    listEl.querySelectorAll('.dc-find-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showItemDetail(hits[parseInt(btn.getAttribute('data-i'), 10)].item);
      });
    });
  }

  function bindFind() {
    var btn = document.getElementById('dcFindBtn');
    var input = document.getElementById('dcQuery');
    if (btn) btn.addEventListener('click', runFind);
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') runFind();
    });
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
      bindFind();
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
    search: searchExhibits,
    searchFrom: runFind,
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
