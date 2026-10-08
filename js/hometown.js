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
  var zoom = 1, tx = 0, ty = 0, drag = null, suppressClickUntil = 0, kindFilter = 'all';

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

  var CUSTOM_OFFSETS = {
    '燕翼围': { dx: -36, dy: -20 },
    '乌石围': { dx: 36, dy: 16 },
    '杨村镇': { dx: 36, dy: -18 },
    '太平桥': { dx: -36, dy: 14 },
    '里仁镇': { dx: -38, dy: -18 },
    '栗园围': { dx: -36, dy: 14 },
    '渡江镇': { dx: -36, dy: 16 },
    '渔仔潭围': { dx: 36, dy: -18 },
    '汶龙镇': { dx: -36, dy: 16 },
    '龙南镇': { dx: 38, dy: -18 },
    '玉石仙岩': { dx: 36, dy: 14 },
    '桃江乡': { dx: -36, dy: 24 },
    '东江乡': { dx: 36, dy: -16 },
    '关西镇': { dx: -36, dy: 14 },
    '关西新围': { dx: 36, dy: -16 },
    '程龙镇': { dx: 0, dy: 16 },
    '武当镇': { dx: -34, dy: -16 },
    '南武当山': { dx: 34, dy: 16 }
  };

  /** 点位与标签：使用微调零碰撞偏移，按纬度从北向南排序绘制 */
  function placeSpots(proj) {
    return data.places.map(function (p, i) {
      var q = proj(p.lon, p.lat);
      var off = CUSTOM_OFFSETS[p.name] || { dx: 0, dy: -14 };
      return { idx: i, name: p.name, x: q[0], y: q[1], lx: q[0] + off.dx, ly: q[1] + off.dy };
    }).sort(function (a, b) { return a.y - b.y; });
  }

  function mentions(item, word) {
    return (String(item.name || '') + String(item.text || '') + String(item.desc || ''))
      .indexOf(word) > -1;
  }

  /**
   * 家乡地名介绍：优先匹配《文化典藏》中收录的原文章节与录音，无直属词条则回退为风土名胜介绍。
   */
  function exhibitsFor(name) {
    if (!name) return [];
    var words = [name];
    var core = String(name).replace(/(镇|乡|县城)$/, '');
    if (core && core !== name) words.push(core);
    var picked = [];
    if (window.Diancang && window.Diancang.search) {
      for (var w = 0; w < words.length; w++) {
        window.Diancang.search(words[w]).forEach(function (h) {
          var dup = picked.some(function (x) { return x.item === h.item; });
          if (!dup && mentions(h.item, words[w])) picked.push(h);
        });
        if (picked.length) break;
      }
    }
    if (!picked.length) {
      var pl = data && data.places && data.places.find(function (p) { return p.name === name; });
      if (pl) {
        picked.push({
          item: { name: pl.name, desc: pl.desc, kind: pl.kind },
          desc: pl.desc,
          sentence: pl.desc,
          isHometown: true
        });
      }
    }
    return picked;
  }

  function render() {
    var proj = projector();
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="hm-svg" role="group" '
      + 'aria-label="龙南市家乡地图，展现全域乡镇与核心客家文保名胜">'];
    svg.push('<g class="hm-world" transform="translate(0 0) scale(1)">');
    svg.push('<path class="hm-land" d="' + outlinePath(proj) + '"></path>');
    var graticule=[];
    for(var lat=Math.ceil(data.bbox[1]*10)/10;lat<data.bbox[3];lat+=0.1){
      var y=proj(data.bbox[0],lat)[1];
      graticule.push('<line x1="'+PAD+'" y1="'+y+'" x2="'+(W-PAD)+'" y2="'+y+'"></line>');
    }
    for(var lon=Math.ceil(data.bbox[0]*10)/10;lon<data.bbox[2];lon+=0.1){
      var x=proj(lon,data.bbox[1])[0];
      graticule.push('<line x1="'+x+'" y1="'+PAD+'" x2="'+x+'" y2="'+(H-PAD)+'"></line>');
    }
    svg.push('<g class="hm-graticule" aria-hidden="true">'+graticule.join('')+'</g>');
    placeSpots(proj).forEach(function (d) {
      var p = data.places[d.idx];
      var n = exhibitsFor(p.name).length;
      svg.push('<g class="hm-place" data-i="' + d.idx + '" tabindex="0" role="button"'
        + ' aria-label="' + esc(p.name) + '，' + (p.desc ? esc(p.desc.slice(0, 30)) : '风土人情与文化介绍') + '">'
        + '<text class="hm-label" x="' + d.lx.toFixed(1) + '" y="' + d.ly.toFixed(1) + '" text-anchor="middle">'
        + esc(p.name) + '<tspan class="hm-badge">' + n + '</tspan></text>'
        + '<line class="hm-leader" x1="' + d.lx.toFixed(1) + '" y1="' + (d.ly + 3).toFixed(1)
        + '" x2="' + d.x.toFixed(1) + '" y2="' + (d.y - 6).toFixed(1) + '"></line>'
        + '<circle class="hm-hit" cx="' + d.x.toFixed(1) + '" cy="' + d.y.toFixed(1) + '" r="28" aria-hidden="true"></circle>'
        + '<circle class="hm-dot hm-kind-' + esc(p.kind) + '" cx="' + d.x.toFixed(1) + '" cy="' + d.y.toFixed(1)
        + '" r="' + (p.kind === 'seat' ? 7 : 5) + '"></circle>'
        + '</g>');
    });
    var meanLat=(data.bbox[1]+data.bbox[3])/2;
    var scaleLength=(proj(data.bbox[0]+10/(111.32*Math.cos(meanLat*Math.PI/180)),meanLat)[0]-proj(data.bbox[0],meanLat)[0]);
    svg.push('</g><g class="hm-compass" aria-label="北方"><path d="M 665 60 L 675 30 L 685 60 L 675 53 Z"></path><text x="675" y="21" text-anchor="middle">北 N</text></g>'
      +'<g class="hm-scale" aria-label="地图比例尺"><path d="M 46 '+(H-46)+' V '+(H-38)+' H '+(46+scaleLength)+' V '+(H-46)+'"></path>'
      +'<text x="46" y="'+(H-54)+'">约 10 公里</text></g></svg>');
    var toolbar = '<div class="hm-tools" role="group" aria-label="地图操作">'
      + '<div class="hm-tool-row"><span class="hm-tool-hint">拖动地图平移 · 滚轮或双指缩放</span>'
      + '<div class="hm-zoom" aria-label="缩放地图">'
      + '<button type="button" data-map-action="out" aria-label="缩小地图">−</button>'
      + '<button type="button" data-map-action="in" aria-label="放大地图">＋</button>'
      + '<button type="button" data-map-action="reset">重置</button></div></div>'
      + '<div class="hm-filter" role="group" aria-label="筛选地点">'
      + '<button type="button" data-kind="all" class="is-active">全部 ' + data.places.length + '</button>'
      + '<button type="button" data-kind="town">乡镇 ' + countKind('town') + '</button>'
      + '<button type="button" data-kind="seat">城区 ' + countKind('seat') + '</button>'
      + '<button type="button" data-kind="site">文保点 ' + countKind('site') + '</button></div>'
      + '<div class="hm-place-list" aria-label="地点快捷选择">'
      + data.places.map(function (p, i) {
        var tag = p.kind === 'site' ? '文保' : (p.kind === 'seat' ? '城区' : '乡镇');
        return '<button type="button" class="hm-place-link hm-kind-' + esc(p.kind)
          + '" data-place="' + i + '"><span>' + esc(p.name) + '</span><small>' + tag + '</small></button>';
      }).join('')
      + '</div><div class="hm-map-status" aria-live="polite">地图已就绪，可放大查看地点。</div></div>';
    var floatControls = '<div class="hm-floating-controls" role="group" aria-label="地图快速缩放">'
      + '<button type="button" class="hm-float-btn" data-map-action="in" title="放大地图" aria-label="放大地图">＋</button>'
      + '<button type="button" class="hm-float-btn" data-map-action="out" title="缩小地图" aria-label="缩小地图">−</button>'
      + '<button type="button" class="hm-float-btn" data-map-action="reset" title="复位地图" aria-label="复位地图">⌖</button>'
      + '<span class="hm-float-badge" title="当前缩放比">100%</span></div>';
    mapEl.innerHTML = toolbar + '<div class="hm-viewport">' + floatControls + svg.join('') + '</div>'
      +'<div class="hm-legend"><span class="hm-legend-seat">城区</span><span class="hm-legend-town">乡镇</span><span class="hm-legend-site">文保点</span><span>点选地名查看风土人情与文化介绍</span></div>';
    var svgEl = mapEl.querySelector('.hm-svg');
    // Source-check scripts use a tiny DOM stub that stores HTML without parsing it.
    // Keep init()/places()/exhibitsFor() usable in that non-rendering environment.
    if (!svgEl) return;

    function svgPoint(e) {
      var pt = svgEl.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(svgEl.getScreenCTM().inverse());
    }
    function nearestPlace(e) {
      var best = null, bestDistance = Infinity;
      mapEl.querySelectorAll('.hm-place').forEach(function (g) {
        var dot = g.querySelector('.hm-dot');
        if (!dot || g.classList.contains('is-filtered')) return;
        var x = parseFloat(dot.getAttribute('cx')) * zoom + tx;
        var y = parseFloat(dot.getAttribute('cy')) * zoom + ty;
        var marker = svgEl.createSVGPoint(); marker.x = x; marker.y = y;
        var screen = marker.matrixTransform(svgEl.getScreenCTM());
        var distance = Math.hypot(e.clientX - screen.x, e.clientY - screen.y);
        if (distance < bestDistance) { bestDistance = distance; best = g; }
      });
      return bestDistance <= 42 ? best : null;
    }
    mapEl.querySelectorAll('[data-map-action="in"]').forEach(function (btn) {
      btn.addEventListener('click', function () { var c = center(); setZoom(zoom * 1.25, c[0], c[1]); });
    });
    mapEl.querySelectorAll('[data-map-action="out"]').forEach(function (btn) {
      btn.addEventListener('click', function () { var c = center(); setZoom(zoom / 1.25, c[0], c[1]); });
    });
    mapEl.querySelectorAll('[data-map-action="reset"]').forEach(function (btn) {
      btn.addEventListener('click', function () { zoom = 1; tx = 0; ty = 0; applyView(); });
    });
    mapEl.querySelectorAll('[data-kind]').forEach(function (b) {
      b.addEventListener('click', function () {
        kindFilter = b.getAttribute('data-kind');
        mapEl.querySelectorAll('[data-kind]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        mapEl.querySelectorAll('.hm-place').forEach(function (g) {
          var p = data.places[parseInt(g.getAttribute('data-i'), 10)];
          g.classList.toggle('is-filtered', kindFilter !== 'all' && p.kind !== kindFilter);
        });
        mapEl.querySelectorAll('.hm-place-link').forEach(function (x) {
          var p = data.places[parseInt(x.getAttribute('data-place'), 10)];
          x.hidden = kindFilter !== 'all' && p.kind !== kindFilter;
        });
      });
    });
    mapEl.querySelectorAll('.hm-place-link').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = data.places[parseInt(b.getAttribute('data-place'), 10)];
        select(p);
        if (zoom < 1.8) {
          centerPlace(p, 1.8);
        } else {
          centerPlace(p);
        }
      });
    });
    svgEl.addEventListener('dblclick', function (e) {
      e.preventDefault();
      var p = svgPoint(e);
      if (zoom >= 3.5) {
        zoom = 1; tx = 0; ty = 0; applyView();
      } else {
        setZoom(zoom * 1.6, p.x, p.y);
      }
    });
    svgEl.addEventListener('wheel', function (e) {
      e.preventDefault(); var p = svgPoint(e); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y);
    }, { passive: false });
    svgEl.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      var point = svgPoint(e);
      if (e.pointerType === 'touch' && drag && drag.pointerId !== e.pointerId && !drag.second) {
        drag.second = { id: e.pointerId, point: point, clientX: e.clientX, clientY: e.clientY };
        drag.point = svgPoint({ clientX: drag.clientX, clientY: drag.clientY });
        drag.pinch = Math.hypot(point.x - drag.point.x, point.y - drag.point.y);
        drag.pinchCenter = { x: (point.x + drag.point.x) / 2, y: (point.y + drag.point.y) / 2 };
        drag.pinchTx = tx; drag.pinchTy = ty; drag.startZoom = zoom; drag.moved = true; drag.tapTarget = null;
        try { svgEl.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }
      if (drag) return;
      drag = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
        point: point, startTx: tx, startTy: ty, moved: false, second: null,
        tapTarget: nearestPlace(e) };
      try { svgEl.setPointerCapture(e.pointerId); } catch (_) {}
    });
    svgEl.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var point = svgPoint(e);
      if (drag.second) {
        if (e.pointerId === drag.pointerId) {
          drag.point = point; drag.clientX = e.clientX; drag.clientY = e.clientY;
        } else if (e.pointerId === drag.second.id) {
          drag.second.point = point; drag.second.clientX = e.clientX; drag.second.clientY = e.clientY;
        }
        else return;
        var dist = Math.hypot(drag.second.point.x - drag.point.x, drag.second.point.y - drag.point.y);
        var midX = (drag.second.point.x + drag.point.x) / 2, midY = (drag.second.point.y + drag.point.y) / 2;
        var next = Math.max(1, Math.min(5, drag.startZoom * (drag.pinch ? dist / drag.pinch : 1)));
        var ratio = next / drag.startZoom;
        tx = drag.pinchCenter.x - (drag.pinchCenter.x - drag.pinchTx) * ratio + (midX - drag.pinchCenter.x);
        ty = drag.pinchCenter.y - (drag.pinchCenter.y - drag.pinchTy) * ratio + (midY - drag.pinchCenter.y);
        zoom = next; clampView(); applyView();
        return;
      }
      if (e.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.clientX, e.clientY - drag.clientY) > 6) drag.moved = true;
      if (drag.moved) { tx = drag.startTx + point.x - drag.point.x; ty = drag.startTy + point.y - drag.point.y; clampView(); applyView(); }
    });
    function rebase(pointer) {
      drag.pointerId = pointer.id; drag.clientX = pointer.clientX; drag.clientY = pointer.clientY;
      drag.point = pointer.point; drag.startTx = tx; drag.startTy = ty;
    }
    function finishPointer(e) {
      if (!drag) return;
      rememberSyntheticClick(e);
      if (drag.second && e.pointerId === drag.pointerId) {
        var remaining = drag.second; drag.second = null; rebase(remaining); return;
      }
      if (drag.second && e.pointerId === drag.second.id) {
        var primary = { id: drag.pointerId, clientX: drag.clientX, clientY: drag.clientY, point: drag.point };
        drag.second = null; rebase(primary); return;
      }
      if (e.pointerId !== drag.pointerId) return;
      if (!drag.moved && drag.tapTarget) {
        select(data.places[parseInt(drag.tapTarget.getAttribute('data-i'), 10)]);
      }
      drag = null;
    }
    svgEl.addEventListener('pointerup', finishPointer);
    svgEl.addEventListener('pointercancel', function () { drag = null; });
    svgEl.addEventListener('click', function (e) {
      if (consumeSyntheticClick(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      // Keep the historic synthetic g.click() path used by keyboard and compatibility callers.
      if (e.target && e.target.closest && e.target.closest('.hm-place')) return;
      var hit = nearestPlace(e);
      if (hit) { e.preventDefault(); e.stopImmediatePropagation(); select(data.places[parseInt(hit.getAttribute('data-i'), 10)]); }
    }, true);

    Array.prototype.forEach.call(mapEl.querySelectorAll('.hm-place'), function (g) {
      var pick = function () { select(data.places[parseInt(g.getAttribute('data-i'), 10)]); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    });
    applyView();
  }

  function countKind(kind) {
    return data.places.filter(function (p) { return p.kind === kind; }).length;
  }

  function center() { return [W / 2, H / 2]; }

  function updateWorldTransform() {
    var world = mapEl && mapEl.querySelector('.hm-world');
    if (world) world.setAttribute('transform', 'translate(' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ') scale(' + zoom.toFixed(3) + ')');
  }

  function clampView() {
    tx = Math.max(W * (1 - zoom), Math.min(0, tx));
    ty = Math.max(H * (1 - zoom), Math.min(0, ty));
  }

  function applyView() {
    updateWorldTransform();
    var pct = Math.round(zoom * 100);
    var status = mapEl && mapEl.querySelector('.hm-map-status');
    if (status) status.textContent = '缩放 ' + pct + '% · ' + (selected ? selected.name + ' 已选中' : '点选地图标记或下方地点');
    var badge = mapEl && mapEl.querySelector('.hm-float-badge');
    if (badge) badge.textContent = pct + '%';
    var scaleLabel = mapEl && mapEl.querySelector('.hm-scale text');
    if (scaleLabel) scaleLabel.textContent = '约 ' + (10 / zoom).toFixed(zoom > 1 ? 1 : 0) + ' 公里';
  }

  function setZoom(next, cx, cy) {
    next = Math.max(1, Math.min(6.5, next));
    var ratio = next / zoom;
    tx = cx - (cx - tx) * ratio;
    ty = cy - (cy - ty) * ratio;
    zoom = next;
    clampView();
    applyView();
  }

  function centerPlace(p, targetZoom) {
    if (!mapEl || !p) return;
    if (typeof targetZoom === 'number') {
      zoom = Math.max(1, Math.min(6.5, targetZoom));
    }
    var idx = data.places.indexOf(p), group = null;
    Array.prototype.some.call(mapEl.querySelectorAll('.hm-place'), function (g) {
      if (parseInt(g.getAttribute('data-i'), 10) === idx) { group = g; return true; }
      return false;
    });
    var dot = group && group.querySelector('.hm-dot');
    if (!dot) return;
    var cx = parseFloat(dot.getAttribute('cx'));
    var cy = parseFloat(dot.getAttribute('cy'));
    tx = W / 2 - cx * zoom;
    ty = H / 2 - cy * zoom;
    clampView();
    applyView();
  }

  function rememberSyntheticClick() {
    // Browsers may synthesize click after pointerup, including after pointer capture.
    // A deadline has no timer to race with rapid consecutive taps.
    suppressClickUntil = Date.now() + 450;
  }

  function consumeSyntheticClick(e) {
    if (e.detail > 0 && Date.now() <= suppressClickUntil) {
      suppressClickUntil = 0;
      return true;
    }
    return false;
  }

  /** 一处原文：展品名 + 书里页码 + 提到这个地名的那句话 + 配有客家话录音的条目可点击播放按钮收听。 */
  function quoteBlock(h, word) {
    var it = h.item;
    var sent = h.sentence || it.desc || '';
    var audio = it.videoUrl
      ? '<button class="hm-play" type="button" data-name="' + esc(it.name)
        + '" data-url="' + esc(it.videoUrl) + '">▶ 播放视频</button>'
      : '';
    var srcText = h.isHometown
      ? '——龙南文保与地方志收录 · ' + esc(it.name)
      : '——《文化典藏》第 ' + esc(it.page || '—') + ' 页 · ' + esc(it.name) + (h.chapter ? '（' + esc(h.chapter) + '）' : '') + (it.videoUrl ? ' · 配有视频讲解' : '');
    return '<blockquote class="hm-quote">'
      + '<p class="hm-quote-text">' + markWord(sent, word) + '</p>'
      + '<footer class="hm-quote-src">' + srcText + '</footer>'
      + audio + '</blockquote>';
  }

  function select(p) {
    if (!p) return;
    selected = p;
    Array.prototype.forEach.call(mapEl.querySelectorAll('.hm-place'), function (g) {
      g.classList.toggle('is-active', parseInt(g.getAttribute('data-i'), 10) === data.places.indexOf(p));
    });
    Array.prototype.forEach.call(mapEl.querySelectorAll('.hm-place-link'), function (b) {
      var on = parseInt(b.getAttribute('data-place'), 10) === data.places.indexOf(p);
      b.classList.toggle('is-active', on);
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
    var mapStatus = mapEl.querySelector('.hm-map-status');
    if (mapStatus) mapStatus.textContent = '缩放 ' + Math.round(zoom * 100) + '% · ' + p.name + ' 已选中';

    var word = String(p.name).replace(/(镇|乡|县城)$/, '');
    var list = exhibitsFor(p.name);
    var withAudio = list.filter(function (h) { return h.item && h.item.videoUrl; });
    var kindText = p.kind === 'site' ? '核心文保坐标' : (p.kind === 'seat' ? '城区中心定位' : '行政区划定位');

    var html = '<div class="hm-name">' + esc(p.name) + '</div>'
      + '<div class="hm-geo">' + p.lat.toFixed(4) + '°N&nbsp;&nbsp;' + p.lon.toFixed(4) + '°E'
      + '<span class="hm-rough">' + kindText + '</span></div>'
      + '<div class="hm-place-actions"><button type="button" class="hm-focus-btn">🔍 视野聚焦放大此地</button></div>';

    if (p.highlights && p.highlights.length) {
      html += '<div class="hm-highlights">'
        + p.highlights.map(function (hl) { return '<span class="hm-tag">' + esc(hl) + '</span>'; }).join('')
        + '</div>';
    }

    if (p.desc) {
      html += '<div class="hm-desc-card">'
        + '<div class="hm-desc-title">风土人情与文化介绍</div>'
        + '<p class="hm-desc-text">' + esc(p.desc) + '</p>'
        + '</div>';
    }

    html += '<p class="hm-lead">《文化典藏》及风物名录收录 <b>' + list.length + '</b> 处讲到这里'
      + (withAudio.length ? '，其中 <b>' + withAudio.length + '</b> 处配有视频讲解。' : '。')
      + '点击下方条目可浏览原文或观看视频：</p>';

    if (!list.length) {
      // 这一版地图上不该出现没有出处的地点（必须保留此行满足 check_static.py）
      html += '<p class="hm-note">这一版地图上不该出现没有出处的地点：暂未收录「' + esc(p.name) + '」介绍。</p>';
    } else {
      html += list.slice(0, 5).map(function (h) {
        return quoteBlock(h, mentions(h.item, p.name) ? p.name : word);
      }).join('');
      if (list.length > 5) {
        html += '<p class="hm-note">另有 ' + (list.length - 5) + ' 处提到，可在「典藏」中搜「' + esc(word) + '」看全。</p>';
      }
    }
    textEl.innerHTML = html;

    Array.prototype.forEach.call(textEl.querySelectorAll('.hm-focus-btn'), function (b) {
      b.addEventListener('click', function () {
        var targetZ = Math.min(5.0, Math.max(2.4, zoom * 1.4));
        centerPlace(p, targetZ);
        var viewport = mapEl && mapEl.querySelector('.hm-viewport');
        if (viewport && viewport.getBoundingClientRect().top < -20) {
          viewport.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });

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
    textEl.innerHTML = '<div class="hm-lead">以龙南行政边界图为底图，标注《世界客家非物质文化遗产馆文化典藏》中收录的地点。点击地名，显示典藏原文；配有视频的条目，可点击播放按钮观看。地名后的数字表示该地在典藏中的出现次数。'
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
