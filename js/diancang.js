/**
 * 文化典藏展示模块 — 分目录浏览 + 展品详情
 */
(function () {
  'use strict';

  var data = null;
  var currentChapter = null;
  var currentItem = null;

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- 渲染章节目录 ---------- */
  function renderChapterTabs() {
    var el = $('#dcTabs');
    if (!el || !data) return;
    el.innerHTML = data.chapters.map(function (ch) {
      return '<button class="dc-tab" data-id="' + ch.id + '" type="button">' +
        '<span class="dc-tab-num">' + ch.num + '</span>' +
        '<span class="dc-tab-title">' + esc(ch.title) + '</span>' +
        '<span class="dc-tab-count">' + ch.items.length + '件</span>' +
        '</button>';
    }).join('');

    el.querySelectorAll('.dc-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        selectChapter(id);
      });
    });
  }

  function selectChapter(id) {
    currentChapter = data.chapters.find(function (c) { return c.id === id; }) || data.chapters[0];
    // 高亮 tab
    document.querySelectorAll('.dc-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-id') === currentChapter.id);
    });
    renderChapterContent();
  }

  /* ---------- 渲染当前章节内容 ---------- */
  function renderChapterContent() {
    var el = $('#dcContent');
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

    var grid = $('#dcItemsGrid');
    grid.innerHTML = ch.items.map(function (item, i) {
      return '<button class="dc-item-card" data-idx="' + i + '" type="button">' +
        '<div class="dc-item-name">' + esc(item.name) + '</div>' +
        (item.ipa ? '<div class="dc-item-ipa">' + esc(item.ipa) + '</div>' : '') +
        '<div class="dc-item-preview">' + esc(item.desc.slice(0, 60)) + '…</div>' +
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

  /* ---------- 展品详情弹层 ---------- */
  function showItemDetail(item) {
    currentItem = item;
    var mask = $('#dcDetailMask');
    var body = $('#dcDetailBody');
    body.innerHTML =
      '<div class="dc-detail-name">' + esc(item.name) + '</div>' +
      (item.ipa ? '<div class="dc-detail-ipa">' + esc(item.ipa) + '</div>' : '') +
      '<div class="dc-detail-desc">' + esc(item.desc).replace(/\n/g, '</p><p>') + '</div>' +
      '<div class="dc-detail-qr">' +
      '  <div class="dc-detail-qr-icon">📱</div>' +
      '  <div class="dc-detail-qr-text">' + esc(item.qr || '扫描二维码观看龙南方言介绍视频') + '</div>' +
      '</div>' +
      '<button class="dc-detail-ask" id="dcAskBtn" type="button">问问阿蓝关于"' + esc(item.name) + '"的更多知识</button>';
    mask.hidden = false;

    $('#dcAskBtn').addEventListener('click', function () {
      mask.hidden = true;
      if (window.App && window.App.ask) {
        window.App.ask(item.name + '是什么？');
      }
    });
  }

  /* ---------- 前言/后记 ---------- */
  function showPreface() {
    try {
      var mask = document.getElementById('dcDetailMask');
      var body = document.getElementById('dcDetailBody');
      if (!mask || !body || !data) return;
      body.innerHTML =
        '<div class="dc-detail-name">前言</div>' +
        '<div class="dc-detail-desc"><p>' + esc((data.meta && data.meta.preface) || '暂无前言内容') + '</p></div>' +
        '<div class="dc-detail-meta">' + esc((data.meta && data.meta.compiler) || '') + ' · ' + esc((data.meta && data.meta.date) || '') + '</div>';
      mask.hidden = false;
    } catch (e) { console.error('[Diancang] showPreface error:', e); }
  }

  function showEpilogue() {
    try {
      var mask = document.getElementById('dcDetailMask');
      var body = document.getElementById('dcDetailBody');
      if (!mask || !body || !data) return;
      body.innerHTML =
        '<div class="dc-detail-name">后记</div>' +
        '<div class="dc-detail-desc"><p>' + esc(data.epilogue || '暂无后记内容') + '</p></div>';
      mask.hidden = false;
    } catch (e) { console.error('[Diancang] showEpilogue error:', e); }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    try {
      data = window.DIANCANG;
      if (!data || !data.chapters) {
        console.warn('[Diancang] data not loaded');
        return;
      }

      var section = document.getElementById('diancangSection') || document.getElementById('panelDiancang');
      if (!section) {
        console.warn('[Diancang] section not found');
        return;
      }

      // 绑定前言/后记按钮
      var prefaceBtn = document.getElementById('dcPrefaceBtn');
      var epilogueBtn = document.getElementById('dcEpilogueBtn');
      if (prefaceBtn) prefaceBtn.addEventListener('click', showPreface);
      if (epilogueBtn) epilogueBtn.addEventListener('click', showEpilogue);

      // 绑定关闭
      var closeBtn = document.getElementById('dcDetailClose');
      var mask = document.getElementById('dcDetailMask');
      if (closeBtn) closeBtn.addEventListener('click', function () { mask.hidden = true; });
      if (mask) mask.addEventListener('click', function (e) { if (e.target === mask) mask.hidden = true; });

      renderChapterTabs();
      selectChapter(data.chapters[0].id);
      console.log('[Diancang] initialized,', data.chapters.length, 'chapters');
    } catch (e) {
      console.error('[Diancang] init error:', e);
    }
  }

  window.Diancang = { init: init };
})();
