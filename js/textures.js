/**
 * 程序化纹理生成器
 * ------------------------------------------------------------
 * 用 Canvas 2D 生成各种材质贴图（布料、刺绣、木纹等），
 * 作为 Three.js 材质的 map / roughnessMap / bumpMap 使用。
 */
(function () {
  'use strict';

  function createCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { canvas: c, ctx: c.getContext('2d') };
  }

  /* ---------- 红色织物纹理 ---------- */
  function redFabric() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    // 底色
    ctx.fillStyle = '#B8452A';
    ctx.fillRect(0, 0, 512, 512);

    // 布纹（细密经纬线）
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    for (var i = 0; i < 512; i += 2) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }
    // 粗纹理
    ctx.strokeStyle = 'rgba(0,0,0,0.03)';
    ctx.lineWidth = 1;
    for (var j = 0; j < 512; j += 8) {
      ctx.beginPath(); ctx.moveTo(j, 0); ctx.lineTo(j, 512); ctx.stroke();
    }

    // 噪点（织物颗粒感）
    var imgData = ctx.getImageData(0, 0, 512, 512);
    var d = imgData.data;
    for (var p = 0; p < d.length; p += 4) {
      var n = (Math.random() - 0.5) * 16;
      d[p] += n; d[p + 1] += n; d[p + 2] += n;
    }
    ctx.putImageData(imgData, 0, 0);

    return t.canvas;
  }

  /* ---------- 虎脸刺绣纹理 ---------- */
  function tigerFaceTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    // 白色底（脸部）
    ctx.fillStyle = '#F5EDE0';
    ctx.fillRect(0, 0, 512, 512);

    // 织物纹理叠加
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 0.5;
    for (var i = 0; i < 512; i += 3) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }

    // 虎脸轮廓（粗黑线刺绣效果）
    ctx.strokeStyle = '#2A1A10';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    // 脸部轮廓
    ctx.beginPath();
    ctx.ellipse(256, 280, 180, 160, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 王字纹（额头）
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#2A1A10';
    // 横
    ctx.beginPath(); ctx.moveTo(196, 130); ctx.lineTo(316, 130); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(186, 165); ctx.lineTo(326, 165); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(196, 200); ctx.lineTo(316, 200); ctx.stroke();
    // 竖
    ctx.beginPath(); ctx.moveTo(256, 110); ctx.lineTo(256, 220); ctx.stroke();

    // 眼睛
    // 左眼白
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(190, 260, 42, 35, -0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2A1A10'; ctx.lineWidth = 3; ctx.stroke();
    // 左眼珠
    ctx.fillStyle = '#1A1008';
    ctx.beginPath(); ctx.ellipse(195, 262, 18, 20, 0, 0, Math.PI * 2); ctx.fill();
    // 左眼高光
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(200, 255, 6, 5, 0, 0, Math.PI * 2); ctx.fill();

    // 右眼白
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(322, 260, 42, 35, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2A1A10'; ctx.lineWidth = 3; ctx.stroke();
    // 右眼珠
    ctx.fillStyle = '#1A1008';
    ctx.beginPath(); ctx.ellipse(317, 262, 18, 20, 0, 0, Math.PI * 2); ctx.fill();
    // 右眼高光
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(322, 255, 6, 5, 0, 0, Math.PI * 2); ctx.fill();

    // 鼻子
    ctx.fillStyle = '#E8A0A0';
    ctx.beginPath();
    ctx.moveTo(256, 310);
    ctx.lineTo(236, 340);
    ctx.lineTo(276, 340);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2A1A10'; ctx.lineWidth = 2.5; ctx.stroke();

    // 嘴巴
    ctx.strokeStyle = '#2A1A10';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(256, 340);
    ctx.lineTo(256, 365);
    ctx.stroke();
    // 左嘴角
    ctx.beginPath();
    ctx.moveTo(256, 365);
    ctx.quadraticCurveTo(230, 385, 200, 370);
    ctx.stroke();
    // 右嘴角
    ctx.beginPath();
    ctx.moveTo(256, 365);
    ctx.quadraticCurveTo(282, 385, 312, 370);
    ctx.stroke();

    // 胡须（左右各三根）
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2A1A10';
    var whiskers = [
      [150, 330, 80, 310], [148, 350, 75, 350], [150, 370, 80, 390],
      [362, 330, 432, 310], [364, 350, 437, 350], [362, 370, 432, 390]
    ];
    whiskers.forEach(function (w) {
      ctx.beginPath();
      ctx.moveTo(w[0], w[1]);
      ctx.quadraticCurveTo((w[0] + w[2]) / 2, w[1] + (Math.random() - 0.5) * 10, w[2], w[3]);
      ctx.stroke();
    });

    // 腮红
    ctx.fillStyle = 'rgba(232, 160, 160, 0.35)';
    ctx.beginPath(); ctx.ellipse(155, 320, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(357, 320, 30, 18, 0, 0, Math.PI * 2); ctx.fill();

    // 额头花纹装饰（金色小花）
    ctx.fillStyle = '#D4A843';
    for (var f = 0; f < 5; f++) {
      var fx = 170 + f * 44;
      var fy = 95;
      // 花瓣
      for (var petal = 0; petal < 5; petal++) {
        var pa = (petal / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(pa) * 8, fy + Math.sin(pa) * 8, 5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#B8860B';
      ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#D4A843';
    }

    return t.canvas;
  }

  /* ---------- 蓝染布纹理 ---------- */
  function landyeTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    // 深蓝底色（渐变）
    var grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1A3A30');
    grad.addColorStop(0.5, '#2F5D50');
    grad.addColorStop(1, '#1E4538');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 扎染圆圈图案
    var circles = [
      { x: 128, y: 128, r: 60 }, { x: 384, y: 128, r: 45 },
      { x: 256, y: 256, r: 80 }, { x: 128, y: 384, r: 50 },
      { x: 384, y: 384, r: 55 }, { x: 64, y: 256, r: 35 },
      { x: 448, y: 256, r: 40 }
    ];
    circles.forEach(function (c) {
      // 外圈渐变（扎染扩散效果）
      for (var ring = 5; ring >= 0; ring--) {
        var alpha = 0.08 * (6 - ring);
        var radius = c.r + ring * 6;
        ctx.fillStyle = 'rgba(200, 220, 210, ' + alpha + ')';
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      // 中心白点
      ctx.fillStyle = 'rgba(230, 240, 235, 0.5)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    });

    // 蜡染裂纹效果
    ctx.strokeStyle = 'rgba(200, 220, 210, 0.12)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 30; i++) {
      ctx.beginPath();
      var sx = Math.random() * 512, sy = Math.random() * 512;
      ctx.moveTo(sx, sy);
      for (var seg = 0; seg < 5; seg++) {
        sx += (Math.random() - 0.5) * 80;
        sy += (Math.random() - 0.5) * 80;
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // 布纹
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    for (var w = 0; w < 512; w += 3) {
      ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(w, 512); ctx.stroke();
    }

    return t.canvas;
  }

  /* ---------- 土墙纹理（围屋） ---------- */
  function wallTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    ctx.fillStyle = '#C4A882';
    ctx.fillRect(0, 0, 512, 512);

    // 夯土层纹理
    for (var layer = 0; layer < 16; layer++) {
      var y = layer * 32;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.02 + Math.random() * 0.04) + ')';
      ctx.fillRect(0, y, 512, 32);
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }

    // 斑驳效果
    var imgData = ctx.getImageData(0, 0, 512, 512);
    var d = imgData.data;
    for (var p = 0; p < d.length; p += 4) {
      var n = (Math.random() - 0.5) * 20;
      d[p] += n; d[p + 1] += n * 0.8; d[p + 2] += n * 0.5;
    }
    ctx.putImageData(imgData, 0, 0);

    // 小石子
    for (var s = 0; s < 80; s++) {
      var sx = Math.random() * 512, sy = Math.random() * 512;
      var sr = 1 + Math.random() * 3;
      ctx.fillStyle = 'rgba(160, 140, 110, ' + (0.3 + Math.random() * 0.3) + ')';
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }

    return t.canvas;
  }

  /* ---------- 瓦片屋顶纹理 ---------- */
  function roofTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    ctx.fillStyle = '#4A3828';
    ctx.fillRect(0, 0, 512, 512);

    // 瓦片（鱼鳞状排列）
    var tileW = 32, tileH = 20;
    for (var row = 0; row < 28; row++) {
      var offset = (row % 2) * tileW / 2;
      for (var col = -1; col < 18; col++) {
        var x = col * tileW + offset;
        var y = row * tileH;
        // 瓦片形状
        ctx.fillStyle = 'rgba(90, 70, 50, ' + (0.6 + Math.random() * 0.2) + ')';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + tileW / 2, y + tileH * 1.4, x + tileW, y);
        ctx.lineTo(x + tileW, y + tileH * 0.3);
        ctx.quadraticCurveTo(x + tileW / 2, y + tileH * 1.6, x, y + tileH * 0.3);
        ctx.closePath();
        ctx.fill();
        // 瓦片高光
        ctx.strokeStyle = 'rgba(120, 100, 70, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    return t.canvas;
  }

  /* ---------- 环境贴图（简易 HDR 模拟） ---------- */
  function envMap() {
    var t = createCanvas(256, 256);
    var ctx = t.ctx;

    // 天空渐变
    var skyGrad = ctx.createLinearGradient(0, 0, 0, 256);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(0.4, '#B0D4E8');
    skyGrad.addColorStop(0.5, '#D4C4A0');
    skyGrad.addColorStop(1, '#8B7355');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 256, 256);

    // 太阳光斑
    var sunGrad = ctx.createRadialGradient(200, 40, 0, 200, 40, 60);
    sunGrad.addColorStop(0, 'rgba(255,255,240,0.9)');
    sunGrad.addColorStop(0.3, 'rgba(255,250,220,0.3)');
    sunGrad.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(140, 0, 120, 100);

    return t.canvas;
  }

  /* ---------- 竹编：经纬交错的篾片 ---------- */
  function bambooWeave() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    ctx.fillStyle = '#B98A4E';
    ctx.fillRect(0, 0, 512, 512);
    var cell = 32;
    for (var y = 0; y < 512 / cell; y++) {
      for (var x = 0; x < 512 / cell; x++) {
        // 一压一挑：奇偶格决定谁在上面，露出的那截颜色略深形成阴影
        var over = (x + y) % 2 === 0;
        var gx = x * cell, gy = y * cell;
        if (over) {
          ctx.fillStyle = '#C79A5C';
          ctx.fillRect(gx, gy + 3, cell, cell - 6);
          ctx.strokeStyle = 'rgba(90,60,25,0.35)';
          ctx.beginPath(); ctx.moveTo(gx, gy + 3); ctx.lineTo(gx + cell, gy + 3);
          ctx.moveTo(gx, gy + cell - 3); ctx.lineTo(gx + cell, gy + cell - 3); ctx.stroke();
        } else {
          ctx.fillStyle = '#AE7F43';
          ctx.fillRect(gx + 3, gy, cell - 6, cell);
          ctx.strokeStyle = 'rgba(90,60,25,0.3)';
          ctx.beginPath(); ctx.moveTo(gx + 3, gy); ctx.lineTo(gx + 3, gy + cell);
          ctx.moveTo(gx + cell - 3, gy); ctx.lineTo(gx + cell - 3, gy + cell); ctx.stroke();
        }
      }
    }
    // 篾青的丝缕
    ctx.globalAlpha = 0.12;
    for (var i = 0; i < 900; i++) {
      ctx.strokeStyle = Math.random() > 0.5 ? '#8A5F2C' : '#E0BC86';
      var lx = Math.random() * 512, ly = Math.random() * 512, len = 6 + Math.random() * 16;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + len, ly + (Math.random() - 0.5) * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return s.canvas;
  }

  /* ---------- 客家织带：靛底上的菱形与锯齿纹 ---------- */
  function wovenBelt() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    ctx.fillStyle = '#243B55';
    ctx.fillRect(0, 0, 512, 512);
    var palette = ['#C0392B', '#E0A93C', '#F2E8D5', '#7BA89B'];
    // 横向分区，每区一种纹样，模拟织带的分段构图
    var bands = [[0, 70], [70, 150], [150, 200], [200, 320], [320, 370], [370, 450], [450, 512]];
    bands.forEach(function (b, bi) {
      var y0 = b[0], y1 = b[1], h = y1 - y0;
      if (bi % 2 === 0) {
        // 菱形串
        var step = 46;
        for (var x = step / 2; x < 512; x += step) {
          ctx.fillStyle = palette[(bi + Math.floor(x / step)) % palette.length];
          ctx.beginPath();
          ctx.moveTo(x, y0 + h * 0.12); ctx.lineTo(x + step * 0.34, y0 + h / 2);
          ctx.lineTo(x, y1 - h * 0.12); ctx.lineTo(x - step * 0.34, y0 + h / 2);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#F2E8D5'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      } else {
        // 锯齿纹
        ctx.strokeStyle = palette[bi % palette.length];
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (var sx = 0, up = true; sx <= 512; sx += 24) {
          var sy = up ? y0 + h * 0.25 : y1 - h * 0.25;
          if (sx === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          up = !up;
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(242,232,213,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y1 - 1); ctx.lineTo(512, y1 - 1); ctx.stroke();
    });
    // 纬线质感
    ctx.globalAlpha = 0.10;
    for (var yy = 0; yy < 512; yy += 3) {
      ctx.strokeStyle = '#000'; ctx.beginPath();
      ctx.moveTo(0, yy); ctx.lineTo(512, yy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return s.canvas;
  }

  /* ---------- 酱釉陶：米酒坛的釉面 ---------- */
  function glazeJar() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    var grd = ctx.createLinearGradient(0, 0, 512, 0);
    grd.addColorStop(0, '#4A2B18'); grd.addColorStop(0.35, '#8C5528');
    grd.addColorStop(0.55, '#A9682F'); grd.addColorStop(0.75, '#7A451F');
    grd.addColorStop(1, '#3E2414');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 512, 512);
    // 釉垂流痕
    for (var i = 0; i < 40; i++) {
      var x = Math.random() * 512;
      ctx.strokeStyle = 'rgba(30,15,8,' + (0.05 + Math.random() * 0.14) + ')';
      ctx.lineWidth = 2 + Math.random() * 7;
      ctx.beginPath(); ctx.moveTo(x, Math.random() * 120);
      ctx.lineTo(x + (Math.random() - 0.5) * 12, 260 + Math.random() * 250); ctx.stroke();
    }
    // 铁质斑点与开片
    for (var k = 0; k < 700; k++) {
      ctx.fillStyle = 'rgba(24,12,6,' + (0.10 + Math.random() * 0.3) + ')';
      var r = Math.random() * 2.2;
      ctx.beginPath(); ctx.arc(Math.random() * 512, Math.random() * 512, r, 0, 6.284); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,235,205,0.10)'; ctx.lineWidth = 1;
    for (var c = 0; c < 26; c++) {
      ctx.beginPath();
      var cx0 = Math.random() * 512, cy0 = Math.random() * 512;
      ctx.moveTo(cx0, cy0);
      ctx.lineTo(cx0 + (Math.random() - 0.5) * 90, cy0 + (Math.random() - 0.5) * 90);
      ctx.stroke();
    }
    return s.canvas;
  }

  /* ---------- 凉帽垂布：靛蓝棉麻 ---------- */
  function hatCloth() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    ctx.fillStyle = '#2F4858'; ctx.fillRect(0, 0, 512, 512);
    for (var y = 0; y < 512; y += 4) {
      ctx.strokeStyle = y % 8 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }
    for (var x = 0; x < 512; x += 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
    }
    // 蓝染不匀的晕色
    for (var i = 0; i < 60; i++) {
      var r = 30 + Math.random() * 90;
      var g2 = ctx.createRadialGradient(Math.random() * 512, Math.random() * 512, 0,
        Math.random() * 512, Math.random() * 512, r);
      g2.addColorStop(0, 'rgba(120,160,180,0.07)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, 512, 512);
    }
    return s.canvas;
  }

  window.Textures = {
    redFabric: redFabric,
    tigerFace: tigerFaceTexture,
    landye: landyeTexture,
    wall: wallTexture,
    roof: roofTexture,
    envMap: envMap,
    bambooWeave: bambooWeave,
    wovenBelt: wovenBelt,
    glazeJar: glazeJar,
    hatCloth: hatCloth
  };
})();
