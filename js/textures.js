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

  /* ---------- 虎脸刺绣纹理（非遗传统堆绣与盘金神韵） ---------- */
  function tigerFaceTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    // 象牙白优质织锦底色（脸部贴布基底）
    ctx.fillStyle = '#F7EFE2';
    ctx.fillRect(0, 0, 512, 512);

    // 经纬细密蚕丝底织纹
    ctx.strokeStyle = 'rgba(180, 150, 120, 0.08)';
    ctx.lineWidth = 0.6;
    for (var i = 0; i < 512; i += 2) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }

    // 脸部外轮廓（传统大红绒线与黑线双道锁边）
    ctx.strokeStyle = '#991B1B';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(256, 280, 184, 164, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#D4A843';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(256, 280, 180, 160, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 额头如意祥云托底（金丝飞云）
    [-1, 1].forEach(function (dir) {
      var cx = 256 + dir * 85, cy = 100;
      ctx.fillStyle = '#D97706';
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.arc(cx + dir * 14, cy + 6, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#D4A843';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // 额头“王”字（盘金丝刺绣重工，两端出尖如意头）
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#991B1B';
    ctx.lineWidth = 14;
    // 粗底红线衬底
    ctx.beginPath(); ctx.moveTo(188, 125); ctx.lineTo(324, 125); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(178, 162); ctx.lineTo(334, 162); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(186, 202); ctx.lineTo(326, 202); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(256, 105); ctx.lineTo(256, 222); ctx.stroke();

    // 表层金丝绣线
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(190, 125); ctx.lineTo(322, 125); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(180, 162); ctx.lineTo(332, 162); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(188, 202); ctx.lineTo(324, 202); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(256, 107); ctx.lineTo(256, 220); ctx.stroke();

    // 金线高光芯
    ctx.strokeStyle = '#FFFBEB';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(194, 124); ctx.lineTo(318, 124); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(184, 161); ctx.lineTo(328, 161); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(192, 201); ctx.lineTo(320, 201); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(255, 110); ctx.lineTo(255, 218); ctx.stroke();

    // 祥云卷云飞眉（红黄双色渐变与羽状针脚）
    [-1, 1].forEach(function (dir) {
      var bx = 256 + dir * 65;
      ctx.fillStyle = '#B91C1C';
      ctx.beginPath();
      ctx.moveTo(bx, 216);
      ctx.quadraticCurveTo(bx + dir * 40, 196, bx + dir * 85, 218);
      ctx.quadraticCurveTo(bx + dir * 55, 228, bx, 216);
      ctx.fill();
      ctx.strokeStyle = '#D4A843';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // 眉梢卷云纹
      ctx.beginPath();
      ctx.arc(bx + dir * 85, 216, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#F59E0B';
      ctx.fill();
      ctx.stroke();
    });

    // 灵动刺绣大眼（层叠如意眼圈 + 黑曜石瞳孔 + 双点星芒高光）
    [-1, 1].forEach(function (dir) {
      var ex = 256 + dir * 68, ey = 265;
      // 外层金丝如意环
      ctx.strokeStyle = '#D4A843';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(ex, ey, 48, 40, dir * 0.08, 0, Math.PI * 2);
      ctx.stroke();

      // 红色衬底
      ctx.fillStyle = '#991B1B';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 45, 37, dir * 0.08, 0, Math.PI * 2);
      ctx.fill();

      // 纯白眼白
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 40, 32, dir * 0.08, 0, Math.PI * 2);
      ctx.fill();

      // 黑瞳孔
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.ellipse(ex + dir * 3, ey + 1, 20, 24, 0, 0, Math.PI * 2);
      ctx.fill();

      // 瞳孔外围暗金丝圈
      ctx.strokeStyle = '#854D0E';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ex + dir * 3, ey + 1, 19, 0, Math.PI * 2);
      ctx.stroke();

      // 星芒高光（大高光 + 小星点）
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.ellipse(ex + dir * 9, ey - 7, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + dir * 2, ey + 8, 3.5, 0, Math.PI * 2); ctx.fill();
    });

    // 蒜头小红鼻（立体倒三角缎面绣）
    ctx.fillStyle = '#DC2626';
    ctx.beginPath();
    ctx.moveTo(256, 312);
    ctx.lineTo(232, 344);
    ctx.lineTo(280, 344);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#7F1D1D';
    ctx.lineWidth = 3;
    ctx.stroke();
    // 鼻梁金色中脊
    ctx.strokeStyle = '#FDE68A';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(256, 314); ctx.lineTo(256, 342); ctx.stroke();
    // 双鼻孔黑色刺绣
    ctx.fillStyle = '#1E1B18';
    ctx.beginPath(); ctx.ellipse(244, 340, 4, 3, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(268, 340, 4, 3, 0.2, 0, Math.PI * 2); ctx.fill();

    // 俏皮客家红唇微笑与利齿
    ctx.strokeStyle = '#991B1B';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(256, 344); ctx.lineTo(256, 362); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(206, 366);
    ctx.quadraticCurveTo(256, 386, 306, 366);
    ctx.stroke();

    // 白玉小虎牙（上下排立体米粒白牙）
    ctx.fillStyle = '#FFFFFF';
    [-36, -20, -6, 8, 22, 38].forEach(function (tx) {
      ctx.beginPath();
      ctx.moveTo(256 + tx - 4, 368);
      ctx.lineTo(256 + tx + 4, 368);
      ctx.lineTo(256 + tx, 377);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#4B5563';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

    // 腮红与牡丹如意团花
    [-1, 1].forEach(function (dir) {
      var fx = 256 + dir * 115, fy = 330;
      // 胭脂红腮
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.beginPath(); ctx.ellipse(fx, fy, 32, 22, 0, 0, Math.PI * 2); ctx.fill();

      // 金色五瓣吉庆梅花
      for (var p = 0; p < 5; p++) {
        var ang = (p / 5) * Math.PI * 2;
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(ang) * 11, fy + Math.sin(ang) * 11, 7, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#B45309';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.fillStyle = '#991B1B';
      ctx.beginPath(); ctx.arc(fx, fy, 5, 0, Math.PI * 2); ctx.fill();
    });

    // 挺立神采白胡须（金丝根部 + 洁白长须）
    var whiskers = [
      [150, 332, 75, 310], [148, 350, 68, 348], [150, 368, 76, 388], [155, 384, 90, 420],
      [362, 332, 437, 310], [364, 350, 444, 348], [362, 368, 436, 388], [357, 384, 422, 420]
    ];
    whiskers.forEach(function (w) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(w[0], w[1]);
      ctx.quadraticCurveTo((w[0] + w[2]) / 2, w[1] + (Math.random() - 0.5) * 8, w[2], w[3]);
      ctx.stroke();
      // 根部金色刺绣固定点
      ctx.fillStyle = '#D4A843';
      ctx.beginPath(); ctx.arc(w[0], w[1], 3.2, 0, Math.PI * 2); ctx.fill();
    });

    return t.canvas;
  }

  /* ---------- 蓝染布纹理（古法板蓝根草木染 + 冰裂纹 + 扎染团花） ---------- */
  function landyeTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    // 深邃多层天然靛蓝渐变（从初染微青到深沉青蓝）
    var grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#102A45');
    grad.addColorStop(0.35, '#1B3E63');
    grad.addColorStop(0.7, '#132C4A');
    grad.addColorStop(1, '#0C1B2E');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 传统粗纺棉麻经纬纤维线
    for (var l = 0; l < 512; l += 3) {
      ctx.strokeStyle = l % 6 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(l, 0); ctx.lineTo(l, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, l); ctx.lineTo(512, l); ctx.stroke();
    }

    // 客家经典扎染团花（层层防染白晕圆与星芒绽放）
    var medallions = [
      { x: 128, y: 128, r: 52 }, { x: 384, y: 128, r: 48 },
      { x: 256, y: 256, r: 68 },
      { x: 128, y: 384, r: 46 }, { x: 384, y: 384, r: 50 },
      { x: 64, y: 256, r: 36 }, { x: 448, y: 256, r: 36 }
    ];
    medallions.forEach(function (m) {
      // 扩散波纹晕染
      for (var ring = 7; ring >= 1; ring--) {
        var alpha = 0.06 * (8 - ring);
        ctx.fillStyle = 'rgba(215, 235, 245, ' + alpha + ')';
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * (ring / 7), 0, Math.PI * 2);
        ctx.fill();
      }
      // 中心纯白扎结花蕊
      ctx.fillStyle = 'rgba(250, 252, 255, 0.82)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * 0.22, 0, Math.PI * 2);
      ctx.fill();

      // 放射状手工针扎防染星芒
      ctx.strokeStyle = 'rgba(235, 245, 255, 0.45)';
      ctx.lineWidth = 1.5;
      for (var a = 0; a < 8; a++) {
        var ray = (a / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(m.x + Math.cos(ray) * m.r * 0.25, m.y + Math.sin(ray) * m.r * 0.25);
        ctx.lineTo(m.x + Math.cos(ray) * m.r * 0.85, m.y + Math.sin(ray) * m.r * 0.85);
        ctx.stroke();
      }
    });

    // 传统蜡染冰裂纹（犹如天然冰纹与叶脉）
    ctx.strokeStyle = 'rgba(215, 235, 250, 0.22)';
    ctx.lineWidth = 1.2;
    for (var crack = 0; crack < 42; crack++) {
      ctx.beginPath();
      var cx = Math.random() * 512, cy = Math.random() * 512;
      ctx.moveTo(cx, cy);
      for (var seg = 0; seg < 6; seg++) {
        cx += (Math.random() - 0.5) * 65;
        cy += (Math.random() - 0.5) * 65;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
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

  /* ---------- 竹编：杨村竹编一挑一压与经纬篾片肌理 ---------- */
  function bambooWeave() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    // 优质老黄竹篾青底色
    ctx.fillStyle = '#B88B4E';
    ctx.fillRect(0, 0, 512, 512);

    var cell = 20;
    var cols = Math.ceil(512 / cell), rows = Math.ceil(512 / cell);
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var over = (x + y) % 2 === 0;
        var gx = x * cell, gy = y * cell;
        if (over) {
          // 横向篾片（中心微弧高光，两端投影）
          var grdH = ctx.createLinearGradient(gx, gy, gx, gy + cell);
          grdH.addColorStop(0, '#A8783D');
          grdH.addColorStop(0.2, '#D2A665');
          grdH.addColorStop(0.5, '#E5BD7E');
          grdH.addColorStop(0.8, '#D2A665');
          grdH.addColorStop(1, '#9B6C32');
          ctx.fillStyle = grdH;
          ctx.fillRect(gx, gy + 1.5, cell, cell - 3);

          // 边缘阴影切线
          ctx.strokeStyle = 'rgba(70, 42, 16, 0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(gx, gy + 1.5); ctx.lineTo(gx + cell, gy + 1.5);
          ctx.moveTo(gx, gy + cell - 1.5); ctx.lineTo(gx + cell, gy + cell - 1.5);
          ctx.stroke();
        } else {
          // 纵向篾片（中心微弧高光，两端投影）
          var grdV = ctx.createLinearGradient(gx, gy, gx + cell, gy);
          grdV.addColorStop(0, '#986B33');
          grdV.addColorStop(0.2, '#C49856');
          grdV.addColorStop(0.5, '#DBB270');
          grdV.addColorStop(0.8, '#C49856');
          grdV.addColorStop(1, '#8C5E28');
          ctx.fillStyle = grdV;
          ctx.fillRect(gx + 1.5, gy, cell - 3, cell);

          // 边缘阴影切线
          ctx.strokeStyle = 'rgba(70, 42, 16, 0.42)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(gx + 1.5, gy); ctx.lineTo(gx + 1.5, gy + cell);
          ctx.moveTo(gx + cell - 1.5, gy); ctx.lineTo(gx + cell - 1.5, gy + cell);
          ctx.stroke();
        }
      }
    }

    // 篾青表面天然竹丝纹理（细韧丝缕）
    ctx.globalAlpha = 0.15;
    for (var i = 0; i < 1200; i++) {
      ctx.strokeStyle = Math.random() > 0.5 ? '#6E451B' : '#FFF0D0';
      var lx = Math.random() * 512, ly = Math.random() * 512;
      var len = 8 + Math.random() * 22;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      if (Math.random() > 0.5) {
        ctx.moveTo(lx, ly); ctx.lineTo(lx + len, ly + (Math.random() - 0.5) * 1.5);
      } else {
        ctx.moveTo(lx, ly); ctx.lineTo(lx + (Math.random() - 0.5) * 1.5, ly + len);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    return s.canvas;
  }

  /* ---------- 客家织带：靛蓝底色 + 万字纹/菱格八卦锦/锯齿牙子挑花 ---------- */
  function wovenBelt() {
    var W = 512, H = 1024;
    var s = createCanvas(W, H), ctx = s.ctx;

    // 靛青基底（深邃天然草木染底色）
    ctx.fillStyle = '#142236';
    ctx.fillRect(0, 0, W, H);

    // 双侧边栏经线（客家织带传统红、黄、白包边经线）
    var edgeWidth = 44;
    function drawEdge(x0, x1, flip) {
      // 外侧朱红粗经条
      ctx.fillStyle = '#B22222';
      ctx.fillRect(flip ? x1 - 16 : x0, 0, 16, H);
      // 金黄细经条
      ctx.fillStyle = '#E5B134';
      ctx.fillRect(flip ? x1 - 24 : x0 + 16, 0, 8, H);
      // 靛蓝窄隔离带
      ctx.fillStyle = '#182C47';
      ctx.fillRect(flip ? x1 - 36 : x0 + 24, 0, 12, H);
      // 牙白细亮经线
      ctx.fillStyle = '#F5EFE1';
      ctx.fillRect(flip ? x1 - 42 : x0 + 36, 0, 6, H);
    }
    drawEdge(0, edgeWidth, false);
    drawEdge(W - edgeWidth, W, true);

    // 中间织花区域
    var cx0 = edgeWidth, cx1 = W - edgeWidth, cw = cx1 - cx0, midX = W / 2;

    // 分区循环绘制客家四大经典挑花图案（256px 一个大循环，共 4 段）
    var sectionH = 256;
    for (var sec = 0; sec < 4; sec++) {
      var yBase = sec * sectionH;

      if (sec === 0) {
        // 第一段：客家连绵万字如意纹 (Swastika / Meander key)
        ctx.fillStyle = '#101B2B';
        ctx.fillRect(cx0, yBase, cw, sectionH);

        // 万字几何挑花拐子
        ctx.lineWidth = 7;
        ctx.lineCap = 'square';
        var stepY = 64;
        for (var py = yBase + 16; py < yBase + sectionH; py += stepY) {
          [-1, 1].forEach(function (dir) {
            var mx = midX + dir * 65;
            ctx.strokeStyle = dir === 1 ? '#DDA82C' : '#C43328';
            ctx.beginPath();
            ctx.moveTo(mx, py);
            ctx.lineTo(mx + dir * 55, py);
            ctx.lineTo(mx + dir * 55, py + 26);
            ctx.lineTo(mx + dir * 25, py + 26);
            ctx.lineTo(mx + dir * 25, py + 12);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(mx, py + 52);
            ctx.lineTo(mx - dir * 55, py + 52);
            ctx.lineTo(mx - dir * 55, py + 26);
            ctx.lineTo(mx - dir * 25, py + 26);
            ctx.lineTo(mx - dir * 25, py + 40);
            ctx.stroke();
          });

          // 核心骨结
          ctx.fillStyle = '#F5EFE1';
          ctx.beginPath();
          ctx.arc(midX, py + 26, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (sec === 1) {
        // 第二段：双重嵌套菱形八卦锦 (Nested Lozenge Diamond with center star)
        var dStep = 85;
        for (var dy = yBase; dy < yBase + sectionH; dy += dStep) {
          var cy = dy + dStep / 2;
          // 外层朱红大菱形
          ctx.fillStyle = '#BA2727';
          ctx.beginPath();
          ctx.moveTo(midX, cy - 38);
          ctx.lineTo(midX + 75, cy);
          ctx.lineTo(midX, cy + 38);
          ctx.lineTo(midX - 75, cy);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#F5EFE1';
          ctx.lineWidth = 3;
          ctx.stroke();

          // 中层金黄菱格
          ctx.fillStyle = '#E5B134';
          ctx.beginPath();
          ctx.moveTo(midX, cy - 24);
          ctx.lineTo(midX + 48, cy);
          ctx.lineTo(midX, cy + 24);
          ctx.lineTo(midX - 48, cy);
          ctx.closePath();
          ctx.fill();

          // 内层靛青芯
          ctx.fillStyle = '#142236';
          ctx.beginPath();
          ctx.moveTo(midX, cy - 13);
          ctx.lineTo(midX + 26, cy);
          ctx.lineTo(midX, cy + 13);
          ctx.lineTo(midX - 26, cy);
          ctx.closePath();
          ctx.fill();

          // 中心白丝四出花星
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(midX, cy, 5, 0, Math.PI * 2);
          ctx.fill();

          // 菱格外侧连接三角牙
          [-1, 1].forEach(function (side) {
            ctx.fillStyle = '#2A8F76';
            ctx.beginPath();
            ctx.moveTo(midX + side * 85, cy);
            ctx.lineTo(midX + side * 115, cy - 18);
            ctx.lineTo(midX + side * 115, cy + 18);
            ctx.closePath();
            ctx.fill();
          });
        }
      } else if (sec === 2) {
        // 第三段：客家挑花几何福喜纹与回字格
        var gStep = 64;
        for (var gy = yBase + 12; gy < yBase + sectionH; gy += gStep) {
          [-1, 1].forEach(function (side) {
            var gx = midX + side * 90;
            ctx.strokeStyle = '#DDA82C';
            ctx.lineWidth = 5;
            ctx.strokeRect(gx - 26, gy, 52, 40);
            ctx.fillStyle = '#B22222';
            ctx.fillRect(gx - 13, gy + 10, 26, 20);
          });
          ctx.fillStyle = '#BA2727';
          ctx.fillRect(midX - 22, gy + 6, 44, 28);
          ctx.strokeStyle = '#F5EFE1';
          ctx.lineWidth = 3;
          ctx.strokeRect(midX - 22, gy + 6, 44, 28);
          ctx.strokeStyle = '#E5B134';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(midX - 22, gy + 6); ctx.lineTo(midX + 22, gy + 34);
          ctx.moveTo(midX + 22, gy + 6); ctx.lineTo(midX - 22, gy + 34);
          ctx.stroke();
        }
      } else {
        // 第四段：连续锯齿牙子纹与连珠锦
        var toothStep = 32;
        ctx.strokeStyle = '#C43328';
        ctx.lineWidth = 6;
        for (var ty = yBase; ty < yBase + sectionH; ty += toothStep) {
          ctx.beginPath();
          ctx.moveTo(cx0 + 20, ty + 16);
          ctx.lineTo(midX, ty);
          ctx.lineTo(cx1 - 20, ty + 16);
          ctx.stroke();

          ctx.fillStyle = '#F5EFE1';
          for (var dotX = cx0 + 35; dotX < cx1 - 20; dotX += 30) {
            ctx.beginPath();
            ctx.arc(dotX, ty + 24, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 每段之间的分界金银红横拦带
      var divY = yBase + sectionH - 4;
      ctx.fillStyle = '#E5B134';
      ctx.fillRect(cx0, divY - 4, cw, 3);
      ctx.fillStyle = '#BA2727';
      ctx.fillRect(cx0, divY - 1, cw, 3);
      ctx.fillStyle = '#F5EFE1';
      ctx.fillRect(cx0, divY + 2, cw, 2);
    }

    // 经密纬疏的手工织物横向肌理（浮线与阴影）
    for (var yy = 0; yy < H; yy += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(0, yy, W, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, yy + 1, W, 1);
    }
    // 纵向丝线纤维微光
    for (var xx = 0; xx < W; xx += 4) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(xx, 0, 1, H);
    }

    return s.canvas;
  }

  /* ---------- 酱釉陶：客家米酒坛的古法酱褐釉面 ---------- */
  function glazeJar() {
    var s = createCanvas(512, 512), ctx = s.ctx;

    // 酱褐老陶底色渐变（铁质氧化呈现由深褐到焦糖琥珀的过渡）
    var grd = ctx.createLinearGradient(0, 0, 512, 512);
    grd.addColorStop(0, '#361D0F');
    grd.addColorStop(0.25, '#5C341A');
    grd.addColorStop(0.55, '#854D27');
    grd.addColorStop(0.8, '#522E17');
    grd.addColorStop(1, '#2E180B');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 512, 512);

    // 手工慢轮拉坯形成的水平微凸旋纹（泥痕与微光）
    for (var r = 0; r < 512; r += 6) {
      ctx.fillStyle = r % 18 === 0 ? 'rgba(255, 230, 200, 0.05)' : 'rgba(20, 10, 5, 0.12)';
      ctx.fillRect(0, r, 512, 2.5);
    }

    // 窑内高温流釉形成的垂流泪痕（深浅浓淡错落）
    for (var i = 0; i < 65; i++) {
      var x = Math.random() * 512;
      var y0 = Math.random() * 80;
      var y1 = y0 + 160 + Math.random() * 260;
      var w = 3 + Math.random() * 8;
      var dripGrad = ctx.createLinearGradient(x, y0, x, y1);
      dripGrad.addColorStop(0, 'rgba(35, 18, 8, 0.1)');
      dripGrad.addColorStop(0.7, 'rgba(40, 20, 10, 0.35)');
      dripGrad.addColorStop(1, 'rgba(25, 12, 5, 0.6)');
      ctx.fillStyle = dripGrad;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y0);
      ctx.lineTo(x + w / 2, y0);
      ctx.quadraticCurveTo(x + w * 0.7, y1 - 10, x + w * 0.5, y1);
      ctx.arc(x, y1, w * 0.5, 0, Math.PI);
      ctx.quadraticCurveTo(x - w * 0.7, y1 - 10, x - w / 2, y0);
      ctx.fill();
    }

    // 铁质结晶斑点与金色析出小晶粒
    for (var k = 0; k < 900; k++) {
      var isGold = Math.random() < 0.25;
      ctx.fillStyle = isGold
        ? 'rgba(212, 168, 67, ' + (0.3 + Math.random() * 0.4) + ')'
        : 'rgba(25, 12, 6, ' + (0.2 + Math.random() * 0.4) + ')';
      var rad = Math.random() * 2.5;
      ctx.beginPath();
      ctx.arc(Math.random() * 512, Math.random() * 512, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // 胎体与釉层微细开片纹
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.12)';
    ctx.lineWidth = 1;
    for (var c = 0; c < 35; c++) {
      ctx.beginPath();
      var cx0 = Math.random() * 512, cy0 = Math.random() * 512;
      ctx.moveTo(cx0, cy0);
      for (var seg = 0; seg < 4; seg++) {
        cx0 += (Math.random() - 0.5) * 60;
        cy0 += (Math.random() - 0.5) * 60;
        ctx.lineTo(cx0, cy0);
      }
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

  /* ---------- 客家大襟衫：深靛蓝棉麻布面与彩织挑花滚边 ---------- */
  function dajinshanCloth() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    // 传统植物靛青老土布底色
    var bg = ctx.createLinearGradient(0, 0, 512, 512);
    bg.addColorStop(0, '#1E3A5F');
    bg.addColorStop(0.5, '#172E4C');
    bg.addColorStop(1, '#112239');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 512);

    // 经纬麻线微细交织感
    ctx.lineWidth = 0.8;
    for (var x = 0; x < 512; x += 3) {
      ctx.strokeStyle = x % 6 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
    }
    for (var y = 0; y < 512; y += 3) {
      ctx.strokeStyle = y % 6 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.10)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }

    // 草木浸染形成的微妙自然色晕
    for (var i = 0; i < 40; i++) {
      var rx = Math.random() * 512, ry = Math.random() * 512, rr = 40 + Math.random() * 80;
      var rad = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
      rad.addColorStop(0, 'rgba(40, 85, 130, 0.08)');
      rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, 512, 512);
    }

    // 大襟与领边标志性镶滚彩织挑花织带（红地万字纹与绿白锦边）
    var borderW = 56;
    ctx.fillStyle = '#B91C1C';
    ctx.fillRect(0, 0, borderW, 512);
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 0, borderW - 4, 512);

    // 挑花几何菱格与万字骨架
    for (var py = 8; py < 512; py += 32) {
      // 白色细金线菱形
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(borderW / 2, py);
      ctx.lineTo(borderW - 8, py + 16);
      ctx.lineTo(borderW / 2, py + 32);
      ctx.lineTo(8, py + 16);
      ctx.closePath();
      ctx.stroke();

      // 内嵌金色十字吉祥纹
      ctx.fillStyle = '#FBBF24';
      ctx.fillRect(borderW / 2 - 2, py + 10, 4, 12);
      ctx.fillRect(borderW / 2 - 6, py + 14, 12, 4);

      // 青绿挑线点缀
      ctx.fillStyle = '#10B981';
      ctx.beginPath();
      ctx.arc(borderW / 2, py + 16, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 细窄第二道黑白滚边
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(borderW, 0, 8, 512);
    ctx.fillStyle = '#E2E8F0';
    for (var dy = 0; dy < 512; dy += 8) {
      ctx.fillRect(borderW + 2, dy, 4, 4);
    }

    return s.canvas;
  }

  /* ---------- 客家冬头帕：黑缎暗纹与护额垂带边饰 ---------- */
  function dongtoupaFabric() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    // 沉稳黑绸缎底色
    ctx.fillStyle = '#141418';
    ctx.fillRect(0, 0, 512, 512);

    // 细密竖向织锦暗纹（提花暗条纹质感）
    for (var x = 0; x < 512; x += 4) {
      ctx.strokeStyle = x % 16 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
    }

    // 护额前沿大红锦缎镶边与彩色挑花带条饰
    ctx.fillStyle = '#991B1B';
    ctx.fillRect(0, 440, 512, 72);

    ctx.strokeStyle = '#D4A843';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 440); ctx.lineTo(512, 440); ctx.stroke();

    // 连续回纹与回环如意纹
    for (var rx = 10; rx < 512; rx += 28) {
      ctx.strokeStyle = '#FEF08A';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(rx, 452, 18, 18);
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(rx + 4, 456, 10, 10);
    }

    // 丝绸细腻高光
    var hl = ctx.createLinearGradient(0, 0, 512, 0);
    hl.addColorStop(0, 'rgba(255,255,255,0)');
    hl.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, 512, 440);

    return s.canvas;
  }

  /* ---------- 客家绣花脖围：黑丝绒底如意云肩刺绣 ---------- */
  function cloudShoulderVelvet() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    // 华贵深黑天鹅绒底色
    ctx.fillStyle = '#0F0F14';
    ctx.fillRect(0, 0, 512, 512);

    // 天鹅绒细腻起绒微粒
    var imgData = ctx.getImageData(0, 0, 512, 512);
    var d = imgData.data;
    for (var p = 0; p < d.length; p += 4) {
      var n = (Math.random() - 0.5) * 12;
      d[p] += n; d[p + 1] += n; d[p + 2] += n + 2;
    }
    ctx.putImageData(imgData, 0, 0);

    // 金线盘绣双如意云头大轮廓
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.arc(256, 256, 210, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(256, 256, 196, 0, Math.PI * 2);
    ctx.stroke();

    // 八瓣如意云肩花瓣内部工笔彩绣（牡丹、祥蝠、瑞草）
    for (var petal = 0; petal < 8; petal++) {
      var ang = (petal / 8) * Math.PI * 2;
      var px = 256 + Math.cos(ang) * 135;
      var py = 256 + Math.sin(ang) * 135;

      // 牡丹花头（洋红与朱砂渐变）
      ctx.fillStyle = petal % 2 === 0 ? '#E11D48' : '#EA580C';
      ctx.beginPath();
      ctx.arc(px, py, 26, 0, Math.PI * 2);
      ctx.fill();

      // 花瓣层次
      for (var f = 0; f < 5; f++) {
        var fa = (f / 5) * Math.PI * 2;
        ctx.fillStyle = '#FDA4AF';
        ctx.beginPath();
        ctx.arc(px + Math.cos(fa) * 12, py + Math.sin(fa) * 12, 10, 0, Math.PI * 2);
        ctx.fill();
      }

      // 金色花蕊
      ctx.fillStyle = '#FDE047';
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();

      // 翠绿羽状丝叶
      [-0.4, 0.4].forEach(function (off) {
        var lx = px + Math.cos(ang + off) * 36;
        var ly = py + Math.sin(ang + off) * 36;
        ctx.fillStyle = '#059669';
        ctx.beginPath();
        ctx.ellipse(lx, ly, 14, 7, ang + off, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#A7F3D0';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    // 边缘钉缀圆形银徽牌底位（八颗银扣位）
    for (var bi = 0; bi < 8; bi++) {
      var ba = (bi / 8) * Math.PI * 2 + Math.PI / 8;
      var bx = 256 + Math.cos(ba) * 206;
      var by = 256 + Math.sin(ba) * 206;
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 2; ctx.stroke();
    }

    return s.canvas;
  }

  /* ---------- 银饰浮雕：纯银八仙、银牌与银铃浮雕质感 ---------- */
  function silverEngraving() {
    var s = createCanvas(256, 256), ctx = s.ctx;
    // 银光微冷高光金属底
    var grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, '#FFFFFF');
    grad.addColorStop(0.35, '#E2E8F0');
    grad.addColorStop(0.7, '#CBD5E1');
    grad.addColorStop(1, '#94A3B8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    // 外圈连珠纹（客家錾银经典边缘）
    for (var i = 0; i < 32; i++) {
      var a = (i / 32) * Math.PI * 2;
      var x = 128 + Math.cos(a) * 110;
      var y = 128 + Math.sin(a) * 110;
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 1; ctx.stroke();
    }

    // 内圈凹槽轮廓
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(128, 128, 96, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(128, 128, 93, 0, Math.PI * 2); ctx.stroke();

    // 中央浮雕神像与“长命富贵”吉祥铭文
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 36px "Songti SC", "SimSun", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('富贵', 128, 115);
    ctx.fillText('长命', 128, 155);

    // 錾花阴影与高光拉丝线
    ctx.fillStyle = '#F8FAFC';
    ctx.fillText('富贵', 126, 113);
    ctx.fillText('长命', 126, 153);

    return s.canvas;
  }

  /* ---------- 高精客家织带：黑底多色真丝经纬挑花带 ---------- */
  function zhidaiHighRes() {
    var s = createCanvas(512, 1024), ctx = s.ctx;
    // 纯黑棉纱打底（客家织带经典黑色经线地）
    ctx.fillStyle = '#111317';
    ctx.fillRect(0, 0, 512, 1024);

    // 经线网格密集纵向排列（11根白线与双侧分色线）
    for (var x = 0; x < 512; x += 4) {
      ctx.strokeStyle = (x >= 200 && x <= 312) ? 'rgba(255,255,255,0.08)' : 'rgba(180,30,30,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1024); ctx.stroke();
    }

    // 两侧挑花滚边（红、白、黑相间回纹带）
    [-1, 1].forEach(function (dir) {
      var bx = dir === -1 ? 0 : 448;
      ctx.fillStyle = '#B91C1C';
      ctx.fillRect(bx, 0, 64, 1024);
      for (var y = 0; y < 1024; y += 32) {
        ctx.fillStyle = '#FBBF24';
        ctx.beginPath();
        ctx.moveTo(bx + 16, y);
        ctx.lineTo(bx + 48, y + 16);
        ctx.lineTo(bx + 16, y + 32);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(bx + 28, y + 12, 8, 8);
      }
    });

    // 织带中央织出的客家经典吉祥铭文与连环万字纹
    var words = ['如', '意', '吉', '祥', '福', '寿', '万', '代'];
    ctx.font = 'bold 54px "Kaiti SC", "KaiTi", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var wi = 0; wi < words.length; wi++) {
      var cy = 70 + wi * 120;

      // 菱形锦地框架
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(256, cy - 54);
      ctx.lineTo(390, cy);
      ctx.lineTo(256, cy + 54);
      ctx.lineTo(122, cy);
      ctx.closePath();
      ctx.stroke();

      // 内层朱红衬线
      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(256, cy - 48);
      ctx.lineTo(378, cy);
      ctx.lineTo(256, cy + 48);
      ctx.lineTo(134, cy);
      ctx.closePath();
      ctx.stroke();

      // 铭文字样（白线挑花，金边点缀）
      ctx.fillStyle = '#DC2626';
      ctx.fillText(words[wi], 258, cy + 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(words[wi], 256, cy);

      // 角落万字挑线点
      ctx.fillStyle = '#10B981';
      ctx.fillRect(256 - 4, cy - 38, 8, 8);
      ctx.fillRect(256 - 4, cy + 30, 8, 8);
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
    hatCloth: hatCloth,
    dajinshanCloth: dajinshanCloth,
    dongtoupaFabric: dongtoupaFabric,
    cloudShoulderVelvet: cloudShoulderVelvet,
    silverEngraving: silverEngraving,
    zhidaiHighRes: zhidaiHighRes
  };
})();

