/**
 * 「家乡」地图：点龙南的一个地方，看书里怎么讲它、听它的客家话原声讲解。
 *
 * 底图与点位坐标都是真实数据（来源与取数日期见 js/data-hometown.js 的注释），不是手绘示意：
 * 博物馆里把围屋画错地方就是错信息，所以生成脚本拿不到坐标的点宁可少画。
 *
 * 地图上只画《文化典藏》真的写到的地方。书里没记的乡镇（临塘乡、武当镇等）不标——
 * 点了没东西可讲的点，等于让观众白点一次；与其给一句空话，不如不画。
 * 介绍文字一律取自书中原文，不做任何补写。
 */
(function () {
  'use strict';

  var W = 720, H = 700, PAD = 34;
  var mapEl, textEl, data, selected = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 把书里提到地名的那几个字标出来，给观众一眼看到出处。 */
  function markWord(sentence, word) {
    var at = String(sentence || '').indexOf(word);
    if (!word || at === -1) return esc(sentence || '');
    return esc(sentence.slice(0, at)) + '<mark>' + esc(word) + '</mark>'
      + esc(sentence.slice(at + word.length));
  }

  /** 等距投影，经度按中纬度压缩，再整体居中——不压缩的话县界会被横向拉长。 */
  function projector() {
    var b = data.bbox;
    var k = Math.cos((b[1] + b[3]) / 2 * Math.PI / 180);
    var dx = (b[2] - b[0]) * k, dy = b[3] - b[1];
    var s = Math.min((W - 2 * PAD) / dx, (H - 2 * PAD) / dy);
    var ox = (W - dx * s) / 2, oy = (H - dy * s) / 2;
    return function (lon, lat) {
      return [ox + (lon - b[0]) * k * s, oy + (b[3] - lat) * s];
    };
  }

  function outlinePath(proj) {
    return data.outline.map(function (p, i) {
      var q = proj(p[0], p[1]);
      return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
    }).join(' ') + ' Z';
  }

  /** 点位与标签：dots 里带着原始下标，排序后仍能对回 data.places。 */
  function placeSpots(proj) {
    var dots = data.places.map(function (p, i) {
      var q = proj(p.lon, p.lat);
      return { idx: i, name: p.name, x: q[0], y: q[1], ly: q[1] - 12 };
    }).sort(function (a, b) { return a.y - b.y; });
    // 单趟"往上让"会踩到之前已经检查过的标签（龙南镇和燕翼围就是这么叠上的），
    // 所以反复扫到不再有移动为止；顶出画布的改标到点的下方。
    for (var pass = 0; pass < 6; pass++) {
      var moved = false;
      for (var i = 1; i < dots.length; i++) {
        for (var j = 0; j < i; j++) {
          if (Math.abs(dots[i].x - dots[j].x) < 48 && Math.abs(dots[i].ly - dots[j].ly) < 12) {
            dots[i].ly = Math.min(dots[i].ly, dots[j].ly) - 12;
            moved = true;
          }
        }
        if (dots[i].ly < 12) dots[i].ly = dots[i].y + 18;
      }
      if (!moved) break;
    }
    return dots;
  }

  function mentions(item, word) {
    return (String(item.name || '') + String(item.text || '') + String(item.desc || ''))
      .indexOf(word) > -1;
  }

  /**
   * 这个地方在书里对应哪些展品。必须真的写到这个名字——检索的片段兜底只保证
   * "有两个字重合"，直接用会把"太平桥"绑到只是提到"太平"的地方，那就是编关联了。
   * 书里常写通名（"汶龙"而不是"汶龙镇"），所以全名查不到时才退到去掉"镇/乡"的通名：
   * 一上来就两个都查，"龙南镇"会退成"龙南"，全县 29 处都算它头上，角标就成了噪声。
   */
  function exhibitsFor(name) {
    if (!window.Diancang || !window.Diancang.search || !name) return [];
    var words = [name];
    var core = String(name).replace(/(镇|乡|县城)$/, '');
    if (core && core !== name) words.push(core);
    for (var w = 0; w < words.length; w++) {
      var picked = [];
      window.Diancang.search(words[w]).forEach(function (h) {
        var dup = picked.some(function (x) { return x.item === h.item; });
        if (!dup && mentions(h.item, words[w])) picked.push(h);
      });
      if (picked.length) return picked;
    }
    return [];
  }

  function render() {
    var proj = projector();
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="hm-svg" role="group" '
      + 'aria-label="龙南市家乡地图，点一个地名看书里怎么讲它">'];
    svg.push('<path class="hm-land" d="' + outlinePath(proj) + '"></path>');
    placeSpots(proj).forEach(function (d) {
      var p = data.places[d.idx];
      var n = exhibitsFor(p.name).length;
      svg.push('<g class="hm-place" data-i="' + d.idx + '" tabindex="0" role="button"'
        + ' aria-label="' + esc(p.name) + '，书里有 ' + n + ' 处讲到它">'
        + '<text class="hm-label" x="' + d.x.toFixed(1) + '" y="' + d.ly.toFixed(1) + '" text-anchor="middle">'
        + esc(p.name) + '<tspan class="hm-badge">' + n + '</tspan></text>'
        + '<line class="hm-leader" x1="' + d.x.toFixed(1) + '" y1="' + (d.ly + 3).toFixed(1)
        + '" x2="' + d.x.toFixed(1) + '" y2="' + (d.y - 6).toFixed(1) + '"></line>'
        + '<circle class="hm-dot hm-kind-' + esc(p.kind) + '" cx="' + d.x.toFixed(1) + '" cy="' + d.y.toFixed(1)
        + '" r="' + (p.kind === 'seat' ? 7 : 5) + '"></circle>'
        + '</g>');
    });
    svg.push('</svg>');
    mapEl.innerHTML = svg.join('');

    Array.prototype.forEach.call(mapEl.querySelectorAll('.hm-place'), function (g) {
      var pick = function () { select(data.places[parseInt(g.getAttribute('data-i'), 10)]); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    });
  }

  /** 一处原文：展品名 + 书里页码 + 提到这个地名的那句话 + 有原声就能听。 */
  function quoteBlock(h, word) {
    var it = h.item;
    var sent = h.sentence || it.desc || '';
    var audio = it.videoUrl
      ? '<button class="hm-item hm-play" type="button" data-name="' + esc(it.name)
        + '" data-url="' + esc(it.videoUrl) + '">▶ 听这段客家话讲解</button>'
      : '';
    return '<blockquote class="hm-quote">'
      + '<p class="hm-quote-text">' + markWord(sent, word) + '</p>'
      + '<footer class="hm-quote-src">——《文化典藏》第 ' + esc(it.page) + ' 页 · '
      + esc(it.name) + '（' + esc(h.chapter) + '）' + (it.videoUrl ? ' · 有原声' : '') + '</footer>'
      + audio + '</blockquote>';
  }

  function select(p) {
    if (!p) return;
    selected = p;
    Array.prototype.forEach.call(mapEl.querySelectorAll('.hm-place'), function (g) {
      g.classList.toggle('is-active', parseInt(g.getAttribute('data-i'), 10) === data.places.indexOf(p));
    });

    var word = String(p.name).replace(/(镇|乡|县城)$/, '');
    var list = exhibitsFor(p.name);
    var withAudio = list.filter(function (h) { return h.item.videoUrl; });
    var html = '<div class="hm-name">' + esc(p.name) + '</div>'
      + '<div class="hm-geo">' + p.lat.toFixed(4) + '°N&nbsp;&nbsp;' + p.lon.toFixed(4) + '°E'
      + (p.kind === 'site' ? '<span class="hm-rough">条目坐标只精确到约 1 公里</span>' : '') + '</div>'
      + '<p class="hm-lead">《文化典藏》里有 <b>' + list.length + '</b> 处讲到这里，其中 <b>'
      + withAudio.length + '</b> 处配了客家话原声。下面这些句子都是书里的原文。</p>';

    if (!list.length) {
      // 地图上的点都该有出处；真走到这里就是数据出错，宁可明说也不要拿别处的话凑
      html += '<p class="hm-note">这一版地图上不该出现没有出处的地点：'
        + '书里没查到「' + esc(p.name) + '」，请反馈给讲解员。</p>';
    } else {
      html += list.slice(0, 5).map(function (h) {
        return quoteBlock(h, mentions(h.item, p.name) ? p.name : word);
      }).join('');
      if (list.length > 5) {
        html += '<p class="hm-note">另有 ' + (list.length - 5) + ' 处提到，可在「典藏」里搜「'
          + esc(word) + '」看全。</p>';
      }
    }
    textEl.innerHTML = html;

    Array.prototype.forEach.call(textEl.querySelectorAll('.hm-play'), function (b) {
      b.addEventListener('click', function () {
        var url = b.getAttribute('data-url');
        if (url && window.Diancang) {
          window.Diancang.playVideo({ name: b.getAttribute('data-name'), videoUrl: url });
        }
      });
    });
  }

  function init() {
    mapEl = document.getElementById('hmMap');
    textEl = document.getElementById('hmText');
    if (!mapEl || !textEl) return;
    data = window.HOMETOWN;
    if (!data || !data.places || !data.places.length) {
      mapEl.innerHTML = '<p class="hm-note">地图数据没加载（js/data-hometown.js）。</p>';
      return;
    }
    render();
    textEl.innerHTML = '<div class="hm-lead">这是龙南市的行政边界图，上面标的是'
      + '《文化典藏》<b>真的写到</b>的地方。点一个地名，下面给出书里讲到它的原句；'
      + '配了客家话录音的那段，点 ▶ 就能听。名字后面的数字是书里提到它的处数。'
      + '<br><span class="hm-src">底图：' + esc(data.source.outline)
      + '<br>坐标：' + esc(data.source.points) + '，' + esc(data.retrieved) + ' 取数</span></div>';
  }

  window.Hometown = {
    init: init,
    select: select,
    exhibitsFor: exhibitsFor,
    places: function () { return (data && data.places) || []; }
  };
})();
