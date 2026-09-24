/**
 * 客家方言语音库。
 *
 * 数据全部来自文化典藏里真实存在的展品讲解页（原本要扫展品旁的二维码才能听到），
 * 这里把它们直接列成可点的曲目，不合成、不伪造方言发音。
 *
 * 「指哪打哪」：观众打一个字词，就在这些讲解的原文里逐句找，定位到说过它的那件展品，
 * 直接把那条原声切过来并标出命中的句子。匹配不到时也给出台词里最接近的说法，
 * 不回一句"没有这个词"。
 */
(function () {
  'use strict';

  var tracks = [];
  var listEl, frameEl, sentenceEl, nowIdx, nowName, nowMeta, countEl;
  var queryEl, findBtn, hintEl;
  var activeIndex = -1;
  var view = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function norm(s) {
    return String(s == null ? '' : s).replace(/[\s，。、；：！？（）()《》「」“”‘’]/g, '');
  }

  /** 按句末标点切句；不用 lookbehind，正则分词在旧内核上更稳。 */
  function sentences(text) {
    var out = [];
    var buf = '';
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      buf += s[i];
      if ('。！？；\n'.indexOf(s[i]) !== -1) { out.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(function (x) { return x.length > 1; });
  }

  function trackSentences(t) {
    var it = t.item;
    return sentences(it.text || '').concat(sentences(it.desc || ''));
  }

  /** 返回 [{ index, score, sentence }]，分数为 0 的被过滤掉。 */
  function find(query) {
    var q = norm(query);
    if (q.length < 1) return [];
    var hits = tracks.map(function (t, i) {
      var it = t.item;
      var name = norm(it.name);
      var chapter = norm(t.chapter);
      var body = norm(it.text || '') + norm(it.desc || '');
      var score = 0;

      if (name === q) score += 100;
      else if (name.indexOf(q) !== -1) score += 60;
      else if (q.indexOf(name) !== -1 && name.length >= 2) score += 45;
      if (chapter.indexOf(q) !== -1) score += 12;
      if (body.indexOf(q) !== -1) score += 30;

      // 只靠整词没中时，退到"两字以上子串"的部分重合，取最长的那段
      var bestFrag = 0;
      for (var len = Math.min(q.length, 6); len >= 2; len--) {
        for (var s = 0; s + len <= q.length; s++) {
          if (body.indexOf(q.slice(s, s + len)) !== -1) { bestFrag = Math.max(bestFrag, len); }
        }
        if (bestFrag) break;
      }
      if (!score && bestFrag) score += bestFrag * 3;

      var sentence = '';
      var list = trackSentences(t);
      for (var k = 0; k < list.length; k++) {
        if (norm(list[k]).indexOf(q) !== -1) {
          // 短句信息密度高，同分时优先给短句
          sentence = list[k];
          score += Math.max(0, 8 - Math.round(list[k].length / 24));
          break;
        }
      }
      if (!sentence && bestFrag) {
        for (var k2 = 0; k2 < list.length; k2++) {
          if (norm(list[k2]).indexOf(q.slice(0, bestFrag)) !== -1) { sentence = list[k2]; break; }
        }
      }
      return { index: i, score: score, sentence: sentence };
    }).filter(function (h) { return h.score > 0; });

    hits.sort(function (a, b) { return b.score - a.score; });
    return hits;
  }

  function markTerm(sentence, query) {
    var q = String(query || '').trim();
    if (!q) return esc(sentence);
    var at = sentence.indexOf(q);
    if (at === -1) at = sentence.indexOf(norm(q));
    if (at === -1) {
      // 逐字兜底：把命中的单个字标出来
      var out = '';
      for (var i = 0; i < sentence.length; i++) {
        var ch = sentence[i];
        out += q.indexOf(ch) > -1 ? '<mark>' + esc(ch) + '</mark>' : esc(ch);
      }
      return out;
    }
    return esc(sentence.slice(0, at)) + '<mark>' + esc(sentence.substr(at, q.length))
      + '</mark>' + esc(sentence.slice(at + q.length));
  }

  function select(i, sentence, query) {
    var t = tracks[i];
    if (!t) return;
    activeIndex = i;
    nowIdx.textContent = String(i + 1).padStart(2, '0');
    nowName.textContent = t.item.name;
    nowMeta.textContent = t.chapter + ' · 典藏第 ' + t.item.page + ' 页';
    listEl.querySelectorAll('.dl-track').forEach(function (row, k) {
      row.classList.toggle('is-active', view[k] === i);
    });
    frameEl.hidden = false;
    frameEl.innerHTML =
      '<iframe src="' + esc(t.item.videoUrl) + '" allow="autoplay; fullscreen" allowfullscreen></iframe>' +
      '<a class="dl-open" href="' + esc(t.item.videoUrl) + '" target="_blank" rel="noopener">在新窗口打开讲解页 ↗</a>';

    if (sentenceEl) {
      if (sentence) {
        sentenceEl.hidden = false;
        sentenceEl.innerHTML = '<span class="dl-sentence-tag">原声里说到这句</span>'
          + markTerm(sentence, query);
      } else {
        sentenceEl.hidden = true;
        sentenceEl.innerHTML = '';
      }
    }
  }

  /** 把检索结果渲染成列表；点任意一条都会切过去。 */
  function renderHits(hits, query) {
    view = hits.map(function (h) { return h.index; });
    if (!hits.length) {
      hintEl.textContent = '馆内 16 段讲解的台词里没找到「' + query + '」。'
        + '可以换个说法，或试试「黄元米果」「豆腐」「狮」「寿」这些确实出现在讲解里的词。';
      listEl.innerHTML = '<li class="dl-empty">没有匹配的讲解</li>';
      return null;
    }
    var best = hits[0];
    hintEl.innerHTML = '命中 <strong>' + hits.length + '</strong> 段讲解，已切到最匹配的一条：'
      + esc(tracks[best.index].item.name)
      + (hits.length > 1 ? '（下面还有 ' + (hits.length - 1) + ' 段也说到它）' : '');
    listEl.innerHTML = hits.map(function (h) {
      var t = tracks[h.index];
      return '<li>' +
        '<button class="dl-track" type="button" data-i="' + h.index + '">' +
        '  <span class="dl-track-no">' + String(tracks.indexOf(t) + 1).padStart(2, '0') + '</span>' +
        '  <span class="dl-track-main">' +
        '    <span class="dl-track-name">' + esc(t.item.name) + '</span>' +
        '    <span class="dl-track-sub">' + esc(h.sentence ? h.sentence.slice(0, 30) : t.chapter) + '…</span>' +
        '  </span>' +
        '  <span class="dl-track-play">▶</span>' +
        '</button></li>';
    }).join('');
    bindRows();
    return best;
  }

  function render() {
    view = tracks.map(function (t, i) { return i; });
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
    bindRows();
  }

  function bindRows() {
    listEl.querySelectorAll('.dl-track').forEach(function (btn) {
      btn.addEventListener('click', function () {
        select(parseInt(btn.getAttribute('data-i'), 10));
      });
    });
  }

  function run(query) {
    var hits = find(query);
    var best = renderHits(hits, String(query || '').trim());
    if (best) select(best.index, best.sentence, String(query || '').trim());
    return { count: hits.length, best: best ? best.index : -1 };
  }

  function init() {
    listEl = document.getElementById('dlTracks');
    frameEl = document.getElementById('dlFrame');
    sentenceEl = document.getElementById('dlSentence');
    nowIdx = document.getElementById('dlNowIdx');
    nowName = document.getElementById('dlNowName');
    nowMeta = document.getElementById('dlNowMeta');
    countEl = document.getElementById('dlCount');
    queryEl = document.getElementById('dlQuery');
    findBtn = document.getElementById('dlFindBtn');
    hintEl = document.getElementById('dlFindHint');
    if (!listEl) return;

    // 依赖模块没起来时别只留一个空列表，静默空白页没人看得出出了什么问题
    if (!window.Diancang || !window.Diancang.videoExhibits) {
      listEl.innerHTML = '<li class="dl-empty">讲解数据未能加载，请刷新页面重试</li>';
      return;
    }
    tracks = window.Diancang.videoExhibits();
    render();

    if (findBtn) findBtn.addEventListener('click', function () { run(queryEl.value); });
    if (queryEl) {
      queryEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') run(queryEl.value);
      });
      // 清空搜索框就回到完整曲库，别把观众困在筛选结果里
      queryEl.addEventListener('input', function () {
        if (!norm(queryEl.value)) { render(); hintEl.textContent = '试试「黄元米果」「豆腐」「狮」「寿」'; }
      });
    }
  }

  window.Dialect = {
    init: init,
    select: select,
    find: find,
    search: run,
    count: function () { return tracks.length; },
    shownCount: function () { return view.length; }
  };
})();
