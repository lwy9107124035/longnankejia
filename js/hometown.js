/**
 * 「家乡」地图：点龙南的一个地方，看它用客家话怎么念、书里有没有讲它。
 *
 * 底图与点位坐标都是真实数据（来源与取数日期见 js/data-hometown.js 的注释），不是手绘示意：
 * 博物馆里把围屋画错地方就是错信息，所以生成脚本拿不到坐标时宁可少画一个点。
 *
 * 一个地方给两层内容：
 *  ① 地名本身的客家话读音 —— 复用方言模块的三层来源（书内注音 / 萌典六腔 / 原声），
 *     萌典那层是台湾客家腔，界面上照旧带着那句提醒。
 *  ② 《文化典藏》里以这个地方为出处的展品 —— 有原声的直接点开听。
 * 书里没记的地方（例如临塘乡）就明说没记，只给读音，不编内容。
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
   * 这个地方在书里对应哪些展品。必须真的写到这个名字（含去掉"镇/乡"后缀的通名，
   * 因为书里常写"汶龙"而不是"汶龙镇"）——检索的片段兜底只保证"有两个字重合"，
   * 直接用会把"太平桥"绑到只是提到"太平"的地方，那就是编关联了。
   */
  function exhibitsFor(name) {
    if (!window.Diancang || !window.Diancang.search || !name) return [];
    var words = [name];
    var core = String(name).replace(/(镇|乡|县城)$/, '');
    if (core && core !== name) words.push(core);
    var out = [];
    words.forEach(function (w) {
      window.Diancang.search(w).forEach(function (h) {
        var dup = out.some(function (x) { return x.item === h.item; });
        if (!dup && mentions(h.item, w)) out.push(h);
      });
    });
    return out.slice(0, 6);
  }

  function render() {
    var proj = projector();
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="hm-svg" role="group" '
      + 'aria-label="龙南市家乡地图，点一个地名看它的客家话读音">'];
    svg.push('<path class="hm-land" d="' + outlinePath(proj) + '"></path>');
    placeSpots(proj).forEach(function (d) {
      var p = data.places[d.idx];
      var n = exhibitsFor(p.name).length;
      svg.push('<g class="hm-place" data-i="' + d.idx + '" tabindex="0" role="button"'
        + ' aria-label="' + esc(p.name) + (n ? '，书里有 ' + n + ' 件相关展品' : '，书里没有以这里为地点的展品') + '">'
        + '<text class="hm-label" x="' + d.x.toFixed(1) + '" y="' + d.ly.toFixed(1) + '" text-anchor="middle">'
        + esc(p.name) + (n ? '<tspan class="hm-badge">' + n + '</tspan>' : '') + '</text>'
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

  function exhibitRows(list) {
    if (!list.length) {
      return '<p class="hm-note">《文化典藏》里没有以这个地方为出处的展品，所以下面只给读法，'
        + '不编内容。想听原声，点地图上带数字角标的地点。</p>';
    }
    return '<ul class="hm-items">' + list.map(function (h) {
      return '<li><button class="hm-item" type="button"'
        + ' data-name="' + esc(h.item.name) + '"'
        + (h.item.videoUrl ? ' data-url="' + esc(h.item.videoUrl) + '"' : ' disabled') + '>'
        + '<span class="hm-item-name">' + esc(h.item.name) + (h.item.videoUrl ? ' 🔊' : '') + '</span>'
        + '<span class="hm-item-sub">第 ' + esc(h.item.page) + ' 页 · ' + esc(h.chapter) + '</span>'
        + '<span class="hm-item-sent">' + esc((h.sentence || h.item.desc || '').slice(0, 74)) + '</span>'
        + '</button></li>';
    }).join('') + '</ul>';
  }

  function select(p) {
    if (!p) return;
    selected = p;
    Array.prototype.forEach.call(mapEl.querySelectorAll('.hm-place'), function (g) {
      var on = parseInt(g.getAttribute('data-i'), 10) === data.places.indexOf(p);
      g.classList.toggle('is-active', on);
    });
    var list = exhibitsFor(p.name);
    var rough = p.kind === 'site' ? '<span class="hm-rough">条目坐标只精确到约 1 公里</span>' : '';
    // 展品列表是本地数据，先画出来；读法那层要等萌典接口，慢的时候不能把整块都拖空
    textEl.innerHTML = '<div class="hm-name">' + esc(p.name) + '</div>'
      + '<div class="hm-geo">' + p.lat.toFixed(4) + '°N&nbsp;&nbsp;' + p.lon.toFixed(4) + '°E'
      + rough + '</div>'
      + '<div class="hm-loading">正在查「' + esc(p.name) + '」的客家话读法…</div>'
      + '<h4 class="hm-h">书里讲到这里的东西</h4>' + exhibitRows(list);
    bindItems();

    function paintReadings(html) {
      if (selected !== p) return;              // 连点两个地方时，旧结果不再上屏
      var box = textEl.querySelector('.hm-loading');
      var holder = document.createElement('div');
      holder.innerHTML = '<h4 class="hm-h">这里的客家话读法</h4>' + html;
      if (box && box.parentNode) box.parentNode.replaceChild(holder, box);
      bindItems();
    }

    function bindItems() {
      // 读法那层的 ▶ 按钮是 pron.js 生成的，交给它自己绑，行为与方言面板一致
      if (window.Pron && window.Pron.bindPlay) window.Pron.bindPlay(textEl);
      Array.prototype.forEach.call(textEl.querySelectorAll('.hm-item'), function (b) {
        b.addEventListener('click', function () {
          var url = b.getAttribute('data-url');
          if (url && window.Diancang) {
            window.Diancang.playVideo({ name: b.getAttribute('data-name'), videoUrl: url });
          }
        });
      });
    }

    if (window.Pron && window.Pron.layers) {
      window.Pron.layers(p.name).then(function (r) {
        paintReadings(r.html);
      }, function () {
        paintReadings('<p class="hm-note">读法没查到（萌典那一层要联网）。</p>');
      });
    } else {
      paintReadings('<p class="hm-note">读音模块没加载。</p>');
    }
    bindItems();
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
    textEl.innerHTML = '<div class="hm-lead">这是<b>龙南市</b>的行政边界图。点一个地名：'
      + '上面给它的<b>客家话读法</b>，下面列《文化典藏》里<b>以这个地方为出处</b>的展品，'
      + '带 🔊 的直接点开就能听原声；名字后面的数字就是相关展品的件数。'
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
