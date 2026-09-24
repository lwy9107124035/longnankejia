/**
 * 客家话读音查询：输入任意字词，给出读音，来源逐层标清。
 *
 * 三层，按可信度排序，缺哪层就明说缺哪层：
 *  1. 本馆龙南注音 —— 典藏 42 件展品自带的国际音标（《文化典藏》原书标注），
 *     这是唯一名正言顺的「龙南（宁龙片）」读音，但只覆盖书里出现过的词。
 *  2. 萌典客家语 —— www.moedict.tw 的 /h/ 端点（教育部数据，开了 CORS），
 *     给四县/海陆/大埔/饶平/诏安/南四县六腔拼音。⚠ 那是**台湾客家腔，不是龙南腔**，
 *     所以界面上必须带这句提醒，不能让观众误以为是本地发音。
 *     该接口只认繁体字形（/h/寿 404，/h/壽 才有），所以查之前先用 data-s2t.js
 *     把简体转成繁体候选再试一轮 —— 不转字的话「寿」「蓝」会被误报成"查不到"。
 *  3. 原声 —— 该字若出现在 16 段讲解台词里，给到能点的那段录音。
 *
 * 没有客家话语音合成模型可用（详见 scripts/probe_search.mjs 与 README），
 * 所以这里不合成、不假装能念：给不了音频就给注音，给不了注音就说明缺口。
 */
(function () {
  'use strict';

  var MOEDICT = 'https://www.moedict.tw/h/';
  var DIALECTS = { '四': '四县', '海': '海陆', '大': '大埔', '平': '饶平', '安': '诏安', '南': '南四县' };
  var MAX_FETCH = 12;    // 一次查询最多打多少次接口：宁可少查几个字，不要把面板变成压测
  var cache = {};
  var inputEl, btnEl, outEl, statusEl;
  var seq = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function chars(q) {
    // Array.from 才能正确切开生僻字与代理对
    return Array.from(String(q || '')).filter(function (c) { return /\S/.test(c); });
  }

  /**
   * 简体 → 繁体候选。整词一次生成，候选位对齐：第 k 轮里每个字取自己的第 k 个
   * 繁体候选，缺位就退回该字的第 1 个候选。这样 4 轮就能覆盖"多对一"的绝大多数情况，
   * 又不会做笛卡尔积（六个字各 4 个候选就是 4096 次请求）。
   */
  function variants(word) {
    var T = window.S2T || {};
    var cs = Array.from(String(word || ''));
    var maps = cs.map(function (c) { return T[c] ? Array.from(T[c]) : []; });
    var out = [String(word || '')];
    var depth = 0;
    maps.forEach(function (m) { if (m.length > depth) depth = m.length; });
    for (var k = 0; k < Math.min(depth, 4); k++) {
      var v = cs.map(function (c, i) {
        return maps[i][k] || maps[i][0] || c;
      }).join('');
      if (out.indexOf(v) === -1) out.push(v);
    }
    return out;
  }

  /** 要查的词形：整词及其繁体候选 + 单字及其繁体候选，去重截断。 */
  function queries(q) {
    var seen = [];
    function add(w) { if (w && seen.indexOf(w) === -1 && seen.length < MAX_FETCH) seen.push(w); }
    variants(q).forEach(add);
    if (q.length > 1) {
      chars(q).slice(0, 6).forEach(function (c) { variants(c).forEach(add); });
    }
    return seen;
  }

  /** 第一层：本馆书内注音。 */
  function localReadings(q) {
    var out = [];
    if (!window.Diancang || !window.Diancang.search) return out;
    window.Diancang.search(q).forEach(function (h) {
      if (h.item.ipa) {
        out.push({ name: h.item.name, ipa: h.item.ipa, page: h.item.page,
                   chapter: h.chapter, videoUrl: h.item.videoUrl || '' });
      }
    });
    return out.slice(0, 6);
  }

  /** 第三层：这个词在哪几段原声里被说过。 */
  function audioHits(q) {
    if (!window.Diancang || !window.Diancang.search) return [];
    return window.Diancang.search(q).filter(function (h) {
      return h.item.videoUrl && h.sentence;
    }).slice(0, 4);
  }

  /**
   * 解析萌典的 p 字段。真实长相：`四hag² 海hag⁵`白~ 大kag²¹ …`
   *   是 U+20DE 组合符，`x~ 是萌典的分词标记（白/文 = 白读/文读），
   *  上标声调（U+2070-209F 之外还有 ¹²³ 这类普通上标点）要原样保留。
   */
  function parseReadings(p) {
    var clean = String(p || '')
      .replace(/[\u0300-\u036f\u20d0-\u20f0\ufe20-\ufe2f\ufff9-\ufffb]/g, '')
      .replace(/`([^`]*)~/g, '$1');
    return clean.split(/\s+/).map(function (tok) {
      var d = DIALECTS[tok.charAt(0)];
      if (!d) return null;
      var r = tok.slice(1).trim();
      var reg = '';
      if (/[白文]$/.test(r)) { reg = r.slice(-1) === '白' ? '白读' : '文读'; r = r.slice(0, -1); }
      return r ? { dialect: d, reading: r, register: reg } : null;
    }).filter(function (x) { return x; });
  }

  function fetchMoedict(word) {
    if (cache[word] !== undefined) return Promise.resolve(cache[word]);
    return fetch(MOEDICT + encodeURIComponent(word), { signal: AbortSignal.timeout(8000) })
      .then(function (r) {
        if (!r.ok) return { ok: false, why: 'no-entry' };
        return r.json().then(function (d) {
          var entries = (d && d.h) || [];
          var readings = [];
          entries.forEach(function (e) {
            parseReadings(e.p).forEach(function (x) { readings.push(x); });
          });
          return { ok: readings.length > 0, readings: readings, why: readings.length ? '' : 'no-reading' };
        });
      })
      .catch(function (e) { return { ok: false, why: 'network', err: String(e && e.message || e) }; })
      .then(function (res) { cache[word] = res; return res; });
  }

  function renderLocal(list) {
    if (!list.length) return '';
    return '<section class="pr-layer pr-local">'
      + '<h4>① 本馆书内注音 · 龙南（宁龙片）</h4>'
      + list.map(function (x) {
          return '<div class="pr-row"><b>' + esc(x.name) + '</b>'
            + '<code>' + esc(x.ipa) + '</code>'
            + '<span class="pr-src">典藏第 ' + esc(x.page) + ' 页 · ' + esc(x.chapter) + '</span></div>';
        }).join('')
      + '<p class="pr-note">音标取自《世界客家非物质文化遗产展示馆文化典藏》原书标注，'
      + '是龙南本地（客家语宁龙片）口音。</p>'
      + '</section>';
  }

  function renderMoedict(word, res, asked) {
    if (!res || !res.ok) {
      var why = res && res.why === 'network'
        ? '萌典暂时连不上（这一层需要联网）'
        : '萌典客家语库里没有「' + esc(asked || word) + '」这个条目';
      return '<section class="pr-layer pr-moe"><h4>② 萌典客家语 · 台湾六县腔</h4>'
        + '<p class="pr-note pr-miss">' + why + '。</p></section>';
    }
    var byDialect = {};
    res.readings.forEach(function (x) {
      if (!byDialect[x.dialect]) byDialect[x.dialect] = [];
      var shown = x.reading + (x.register ? '（' + x.register + '）' : '');
      if (byDialect[x.dialect].indexOf(shown) === -1) byDialect[x.dialect].push(shown);
    });
    // 命中词形和观众打的不一样时（简体打「寿」、书里是「壽」），必须说清楚
    var note = word !== asked ? '<span class="pr-src">繁体字形「' + esc(word) + '」条目</span>' : '';
    return '<section class="pr-layer pr-moe"><h4>② 萌典客家语 · 台湾六县腔 ' + esc(asked || word) + note + '</h4>'
      + Object.keys(byDialect).map(function (d) {
          return '<div class="pr-row"><b>' + esc(d) + '</b><code>' + esc(byDialect[d].join(' / ')) + '</code></div>';
        }).join('')
      + '<p class="pr-note pr-warn">⚠ 这是<b>台湾客家语</b>（四县/海陆等腔）的读音，'
      + '与龙南本地的宁龙片腔调不同，只作参照，不要当成龙南话。</p>'
      + '</section>';
  }

  function renderAudio(list) {
    if (!list.length) return '';
    return '<section class="pr-layer pr-audio"><h4>③ 原声里说到它的地方</h4>'
      + list.map(function (h) {
          return '<div class="pr-row"><button class="pr-play" type="button" data-url="'
            + esc(h.item.videoUrl) + '" data-name="' + esc(h.item.name) + '">▶ '
            + esc(h.item.name) + '</button>'
            + '<span class="pr-sent">' + esc(h.sentence.slice(0, 60)) + (h.sentence.length > 60 ? '…' : '') + '</span></div>';
        }).join('')
      + '</section>';
  }

  /**
   * 三层来源拼成一段 HTML，返回 {html, 各层命中数}。
   * 方言面板用它渲染，家乡地图直接复用同一段——两处看到的读法必须一模一样。
   */
  function layers(q) {
    q = String(q || '').trim();
    if (!q) {
      return Promise.resolve({ html: '', local: 0, moedict: 0, audio: 0, layers: 0, queried: 0 });
    }
    var local = localReadings(q);
    var audio = audioHits(q);

    return Promise.all(queries(q).map(function (w) {
      return fetchMoedict(w).then(function (r) { return { word: w, res: r }; });
    })).then(function (moe) {
      var got = moe.filter(function (m) { return m.res.ok; });
      var html = '';
      if (got.length) {
        html += got.map(function (m) {
          return '<h4 class="pr-word">' + esc(m.word) + '</h4>' + renderMoedict(m.word, m.res, q);
        }).join('');
      } else {
        var net = moe.filter(function (m) { return m.res.why === 'network'; }).length;
        html += renderMoedict(q, net ? { ok: false, why: 'network' } : { ok: false, why: 'no-entry' }, q);
      }
      // 本馆注音与原声层放在萌典之后：它们才是龙南自己的东西，但命中时更该被先看到
      html = renderLocal(local) + html + renderAudio(audio);
      if (!local.length && !audio.length && !got.length) {
        html += '<p class="pr-note pr-miss">三层都没命中：书内注音没有这个词、萌典查不到（含繁体字形转换）、'
          + '16 段讲解里也没说过。可以只打一个字试试。</p>';
      }
      return { html: html, local: local.length, moedict: got.length, audio: audio.length,
               layers: (local.length ? 1 : 0) + (got.length ? 1 : 0) + (audio.length ? 1 : 0),
               queried: moe.length };
    });
  }

  function bindPlay(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.pr-play'), function (b) {
      b.addEventListener('click', function () {
        if (window.Diancang && window.Diancang.playVideo) {
          window.Diancang.playVideo({ name: b.getAttribute('data-name'),
                                      videoUrl: b.getAttribute('data-url') });
        }
      });
    });
  }

  function lookup(q) {
    q = String(q || '').trim();
    if (!q) { statusEl.textContent = '先打个字或词。'; return Promise.resolve(null); }
    var myTask = ++seq;
    statusEl.textContent = '查「' + q + '」…';
    return layers(q).then(function (r) {
      if (myTask !== seq) return { stale: true };   // 用户已经改词，旧结果不再上屏
      outEl.innerHTML = r.html;
      bindPlay(outEl);
      statusEl.textContent = '「' + q + '」：本馆注音 ' + r.local + ' 条 · 萌典 '
        + r.moedict + ' 项 · 原声 ' + r.audio + ' 段';
      return r;
    });
  }

  function init() {
    inputEl = document.getElementById('prQuery');
    btnEl = document.getElementById('prBtn');
    outEl = document.getElementById('prOut');
    statusEl = document.getElementById('prStatus');
    if (!inputEl || !outEl || !statusEl) return;
    if (btnEl) btnEl.addEventListener('click', function () { lookup(inputEl.value); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') lookup(inputEl.value);
    });
    statusEl.textContent = '打一个字或词试试，比如「客」「豆腐」「寿」。';
  }

  window.Pron = { init: init, lookup: lookup, layers: layers, bindPlay: bindPlay,
                  parseReadings: parseReadings, variants: variants, queries: queries };
})();
