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

  var scale = 1.0, panX = 0, panY = 0;
  var minScale = 1.0, maxScale = 8.0;

  function updateTransform(anim) {
    if (!mapEl) return;
    var vp = mapEl.querySelector('.hm-viewport');
    var tip = mapEl.querySelector('.hm-scale-tip');
    if (!vp) return;
    var maxPanX = (scale - 1) * (W / 2);
    var maxPanY = (scale - 1) * (H / 2);
    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));

    var ox = W / 2, oy = H / 2;
    var t = 'translate(' + (ox + panX).toFixed(1) + ' ' + (oy + panY).toFixed(1)
      + ') scale(' + scale.toFixed(3) + ') translate(' + (-ox) + ' ' + (-oy) + ')';
    vp.style.transition = anim ? 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)' : 'none';
    vp.setAttribute('transform', t);
    if (tip) tip.textContent = Math.round(scale * 100) + '%';
  }

  function zoomBy(delta, cx, cy) {
    var oldScale = scale;
    var newScale = Math.max(minScale, Math.min(maxScale, scale * delta));
    if (newScale === oldScale) return;
    if (cx != null && cy != null) {
      var ratio = newScale / oldScale;
      panX = cx - (cx - panX) * ratio;
      panY = cy - (cy - panY) * ratio;
    } else if (newScale === minScale) {
      panX = 0; panY = 0;
    }
    scale = newScale;
    updateTransform(true);
  }

  function resetZoom() {
    scale = 1.0; panX = 0; panY = 0;
    updateTransform(true);
  }

  function focusPlace(p) {
    if (!p) return;
    var proj = projector();
    var q = proj(p.lon, p.lat);
    scale = 1.9;
    var ox = W / 2, oy = H / 2;
    var maxPanX = (scale - 1) * ox;
    var maxPanY = (scale - 1) * oy;
    panX = Math.max(-maxPanX, Math.min(maxPanX, (ox - q[0]) * scale));
    panY = Math.max(-maxPanY, Math.min(maxPanY, (oy - q[1]) * scale));
    updateTransform(true);
  }

  function render() {
    var proj = projector();
    var spots = placeSpots(proj);

    var html = '<div class="hm-ctrl" role="toolbar" aria-label="地图缩放控制">'
      + '<button class="hm-btn hm-btn-in" type="button" title="放大地图" aria-label="放大地图">+</button>'
      + '<button class="hm-btn hm-btn-out" type="button" title="缩小地图" aria-label="缩小地图">-</button>'
      + '<button class="hm-btn hm-btn-reset" type="button" title="重置视角" aria-label="重置视角">⟲</button>'
      + '<span class="hm-scale-tip">100%</span>'
      + '</div>';

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="hm-svg" role="group" '
      + 'aria-label="龙南市家乡地图，点一个地名看书里怎么讲它">'];

    // 指南针
    svg.push('<g class="hm-compass" transform="translate(670, 50)">'
      + '<circle cx="0" cy="0" r="18" fill="var(--card)" stroke="var(--line)"></circle>'
      + '<path d="M0 -13 L4 -1 L0 0 L-4 -1 Z" fill="var(--accent)"></path>'
      + '<path d="M0 13 L4 1 L0 0 L-4 1 Z" fill="var(--muted)"></path>'
      + '<text x="0" y="-16" text-anchor="middle" font-size="10" font-weight="700" fill="var(--primary-deep)">N</text>'
      + '</g>');

    // 图例
    svg.push('<g class="hm-legend" transform="translate(34, 30)">'
      + '<circle cx="6" cy="6" r="4.5" class="hm-dot hm-kind-seat"></circle>'
      + '<text x="16" y="9.5" class="hm-legend-text">县城</text>'
      + '<circle cx="56" cy="6" r="3.5" class="hm-dot hm-kind-town"></circle>'
      + '<text x="66" y="9.5" class="hm-legend-text">乡镇</text>'
      + '<circle cx="106" cy="6" r="3.5" class="hm-dot hm-kind-site"></circle>'
      + '<text x="116" y="9.5" class="hm-legend-text">文保点</text>'
      + '</g>');

    // 比例尺
    svg.push('<g class="hm-scalebar" transform="translate(34, 665)">'
      + '<line class="hm-scalebar-line" x1="0" y1="0" x2="105" y2="0"></line>'
      + '<line class="hm-scalebar-line" x1="0" y1="-3" x2="0" y2="3"></line>'
      + '<line class="hm-scalebar-line" x1="52.5" y1="-2" x2="52.5" y2="2"></line>'
      + '<line class="hm-scalebar-line" x1="105" y1="-3" x2="105" y2="3"></line>'
      + '<text class="hm-scalebar-text" x="0" y="-5" text-anchor="middle">0</text>'
      + '<text class="hm-scalebar-text" x="52.5" y="-5" text-anchor="middle">5</text>'
      + '<text class="hm-scalebar-text" x="105" y="-5" text-anchor="middle">10 km</text>'
      + '</g>');

    svg.push('<g class="hm-viewport">');

    // 背景微网格
    svg.push('<g class="hm-grid">');
    for (var gx = 80; gx < W; gx += 80) {
      svg.push('<line x1="' + gx + '" y1="0" x2="' + gx + '" y2="' + H + '"></line>');
    }
    for (var gy = 80; gy < H; gy += 80) {
      svg.push('<line x1="0" y1="' + gy + '" x2="' + W + '" y2="' + gy + '"></line>');
    }
    svg.push('</g>');

    // 龙南行政边界
    svg.push('<path class="hm-land" d="' + outlinePath(proj) + '"></path>');

    // 桃江水系与濂江支流
    svg.push('<path class="hm-river" d="M 402 575 C 415 510 435 440 455 365 C 470 310 450 250 435 200 C 428 175 435 158 450 155 C 465 152 485 150 515 125 C 535 105 550 85 565 68"></path>');
    svg.push('<path class="hm-river-branch" d="M 450 98 C 445 120 440 138 450 155"></path>');

    // 九连山脉地势丘陵
    svg.push('<g class="hm-mountain">'
      + '<path d="M 370 595 Q 400 580 430 598 Q 455 585 480 600"></path>'
      + '<path d="M 385 580 Q 405 570 425 582 Q 445 572 465 585"></path>'
      + '</g>');

    spots.forEach(function (d) {
      var p = data.places[d.idx];
      var n = exhibitsFor(p.name).length;
      svg.push('<g class="hm-place" data-i="' + d.idx + '" tabindex="0" role="button"'
        + ' aria-label="' + esc(p.name) + '，书里有 ' + n + ' 处讲到它">'
        + '<circle class="hm-hit" cx="' + d.x.toFixed(1) + '" cy="' + d.y.toFixed(1) + '" r="34"></circle>'
        + '<circle class="hm-pulse" cx="' + d.x.toFixed(1) + '" cy="' + d.y.toFixed(1) + '" r="14"></circle>'
        + '<text class="hm-label" x="' + d.x.toFixed(1) + '" y="' + d.ly.toFixed(1) + '" text-anchor="middle">'
        + esc(p.name) + '<tspan class="hm-badge">' + n + '</tspan></text>'
        + '<line class="hm-leader" x1="' + d.x.toFixed(1) + '" y1="' + (d.ly + 3).toFixed(1)
        + '" x2="' + d.x.toFixed(1) + '" y2="' + (d.y - 6).toFixed(1) + '"></line>'
        + '<circle class="hm-dot hm-kind-' + esc(p.kind) + '" cx="' + d.x.toFixed(1) + '" cy="' + d.y.toFixed(1)
        + '" r="' + (p.kind === 'seat' ? 7 : 5) + '"></circle>'
        + '</g>');
    });

    svg.push('</g></svg>');
    mapEl.innerHTML = html + svg.join('');

    // 控制器事件
    var btnIn = mapEl.querySelector('.hm-btn-in');
    var btnOut = mapEl.querySelector('.hm-btn-out');
    var btnReset = mapEl.querySelector('.hm-btn-reset');
    if (btnIn) btnIn.addEventListener('click', function (e) { e.stopPropagation(); zoomBy(1.35); });
    if (btnOut) btnOut.addEventListener('click', function (e) { e.stopPropagation(); zoomBy(1 / 1.35); });
    if (btnReset) btnReset.addEventListener('click', function (e) { e.stopPropagation(); resetZoom(); });

    // 拖拽与触摸平移变量
    var dragging = false, didMove = false, sx = 0, sy = 0, spX = 0, spY = 0;
    var pinchDist = 0;

    if (mapEl.addEventListener && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      mapEl.addEventListener('wheel', function (e) {
        e.preventDefault();
        var rect = mapEl.getBoundingClientRect();
        var cx = ((e.clientX - rect.left) / rect.width) * W - W / 2;
        var cy = ((e.clientY - rect.top) / rect.height) * H - H / 2;
        zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy);
      }, { passive: false });

      mapEl.addEventListener('dblclick', function (e) {
        if (e.target.closest && e.target.closest('.hm-ctrl')) return;
        var rect = mapEl.getBoundingClientRect();
        var cx = ((e.clientX - rect.left) / rect.width) * W - W / 2;
        var cy = ((e.clientY - rect.top) / rect.height) * H - H / 2;
        zoomBy(1.4, cx, cy);
      });

      mapEl.addEventListener('mousedown', function (e) {
        if (e.target.closest && e.target.closest('.hm-ctrl')) return;
        dragging = true; didMove = false;
        sx = e.clientX; sy = e.clientY;
        spX = panX; spY = panY;
      });

      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        var dx = (e.clientX - sx) * (W / mapEl.clientWidth);
        var dy = (e.clientY - sy) * (H / mapEl.clientHeight);
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) didMove = true;
        if (scale > 1.0) {
          panX = spX + dx;
          panY = spY + dy;
          updateTransform(false);
        }
      });

      window.addEventListener('mouseup', function () {
        if (dragging) {
          dragging = false;
          if (scale > 1.0) updateTransform(true);
        }
      });

      // 移动端手势
      mapEl.addEventListener('touchstart', function (e) {
        if (e.target.closest && e.target.closest('.hm-ctrl')) return;
        if (e.touches && e.touches.length === 1) {
          dragging = true; didMove = false;
          sx = e.touches[0].clientX; sy = e.touches[0].clientY;
          spX = panX; spY = panY;
        } else if (e.touches && e.touches.length === 2) {
          dragging = false;
          var t1 = e.touches[0], t2 = e.touches[1];
          pinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        }
      }, { passive: true });

      mapEl.addEventListener('touchmove', function (e) {
        if (e.touches && e.touches.length === 1 && dragging) {
          var dx = (e.touches[0].clientX - sx) * (W / mapEl.clientWidth);
          var dy = (e.touches[0].clientY - sy) * (H / mapEl.clientHeight);
          if (Math.abs(dx) > 12 || Math.abs(dy) > 12) didMove = true;
          if (scale > 1.0) {
            panX = spX + dx;
            panY = spY + dy;
            updateTransform(false);
          }
        } else if (e.touches && e.touches.length === 2 && pinchDist > 0) {
          var t1 = e.touches[0], t2 = e.touches[1];
          var d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
          var delta = d / pinchDist;
          if (Math.abs(delta - 1) > 0.02) {
            didMove = true;
            zoomBy(delta > 1 ? 1.04 : 0.96);
            pinchDist = d;
          }
        }
      }, { passive: true });

      mapEl.addEventListener('touchend', function () {
        dragging = false; pinchDist = 0;
        if (scale > 1.0) updateTransform(true);
      });
    }

    // 点位点击绑定
    Array.prototype.forEach.call(mapEl.querySelectorAll('.hm-place'), function (g) {
      var pick = function () {
        if (didMove) return; // 拖拽平移时不触发误点
        var idx = parseInt(g.getAttribute('data-i'), 10);
        var p = data.places[idx];
        select(p);
      };
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
      ? '<button class="hm-play" type="button" data-name="' + esc(it.name)
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
    focusPlace(p);
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
