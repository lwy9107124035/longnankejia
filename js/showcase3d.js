/**
 * 3D 非遗器物展示模块 v4 — 精细重构版
 * 虎头帽（黑底刺绣）/ 客家围屋（方形堡垒）/ 蓝染布（水墨晕染）
 */
(function () {
  'use strict';

  var THREE = null;
  var currentModel = null;
  var renderer, scene, camera, animationId;
  var isDragging = false, dragMode = 'rotate', prevMouse = { x: 0, y: 0 };
  var rotX = 0.25, rotY = 0.4, targetRotX = 0.25, targetRotY = 0.4;
  var zoom = 4.5, targetZoom = 4.5;
  var panX = 0, panY = 0, targetPanX = 0, targetPanY = 0;
  var autoRotate = true, idleTimer = null, textures = {};
  var touchMode = null, pinchDist = 0, pinchMidX = 0, pinchMidY = 0;
  // 引擎 603KB + 贴图约 13MB 只在观众真的点开 3D 时才拉，见 init()/boot() 的分工
  var booted = false, booting = null, pendingShow = null;

  var ITEMS = [
    { id: 'hutoumao', name: '虎头帽', subtitle: '定南客家童帽', icon: '\u{1F42F}', zoom: 4.2,
      desc: '黑底多层棉布基底，以红、黄、蓝、白、绿真丝线手工刺绣。前幅覆盖夸张虎头纹样，带立体凸起的刺绣眼睛、鼻子、眉毛和胡须，对称结构，两侧护耳，后方小披风，边缘饰有穗子和花边。' },
    { id: 'weiwu', name: '客家围屋', subtitle: '龙南关西新围', icon: '\u{1F3EF}', zoom: 7.8,
      desc: '经典客家方形围屋，国字形布局，高耸夯土墙，深灰色瓦顶，四角炮楼，墙面分布梅花形枪眼。条石铺砌前院，中轴对称，突出防御性堡垒特征与客家建筑秩序。' },
    { id: 'landye', name: '蓝染布', subtitle: '客家草木染', icon: '\u{1F9F5}', zoom: 4.8,
      desc: '折叠的分层布料，深邃靛蓝色带白色防染图案，含植物纹样与几何纹样。粗糙手工棉麻材质，天然板蓝根染料呈现从出缸绿到氧化蓝的水墨晕染渐变效果。' },
    { id: 'liangmao', name: '客家凉帽', subtitle: '宁龙片妇女首服', icon: '\u{1F3A9}', zoom: 3.4,
      desc: '竹篾编成扁平帽檐，顶覆蓝布，檐缘垂一圈靛蓝褶布遮面遮阳，是龙南及赣南客家妇女田间劳作的标志性首服，与蓝染、竹编两项技艺直接相关。' },
    { id: 'boji', name: '竹编簸箕', subtitle: '客家农具', icon: '\u{1F9FA}', zoom: 2.7,
      desc: '浅口圆形竹编器，篾片一压一挑编成，圈口缠竹皮收边，底设三足。用于扬去谷物糠秕、晾晒米果与茶叶，是龙南客家日常最具代表性的竹编活计。' },
    { id: 'zhidai', name: '客家织带', subtitle: '彩织腰带', icon: '\u{1F9F3}', zoom: 3.4,
      desc: '靛蓝为底，以红、黄、白、绿丝线织出菱形与锯齿纹，分段构图，末端留流苏。旧时作腰带、绑腿与福袋系带，纹样寓意吉祥连绵。' },
    { id: 'mijiutan', name: '客家米酒坛', subtitle: '龙南米酒', icon: '\u{1F3FA}', zoom: 3.0,
      desc: '酱釉陶坛，肩部弦纹，坛口覆红纸以绳扎封。龙南家家酿米酒，冬头帕与米酒同为待客与月子滋补之物，坛身釉色因铁质析出而深浅不匀。' }
  ];

  function loadThree() {
    return new Promise(function (resolve, reject) {
      if (THREE) { resolve(THREE); return; }
      // 优先加载本地文件，CDN 作备份
      var sources = [
        'js/vendor/three.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
      ];
      var idx = 0;
      function tryLoad() {
        if (idx >= sources.length) { reject(new Error('Three.js load failed')); return; }
        var s = document.createElement('script');
        s.src = sources[idx];
        s.onload = function () {
          if (window.THREE) { THREE = window.THREE; resolve(THREE); }
          else { idx++; tryLoad(); }
        };
        s.onerror = function () { idx++; tryLoad(); };
        document.head.appendChild(s);
      }
      tryLoad();
    });
  }

  function loadTextures() {
    return new Promise(function (resolve) {
      if (!THREE) { resolve(); return; }
      var loader = new THREE.TextureLoader();
      var files = {
        blackCotton: 'assets/textures/black-cotton.png',
        tigerEmb: 'assets/textures/tiger-embroidery.png',
        rammedEarth: 'assets/textures/rammed-earth.png',
        roofTiles: 'assets/textures/roof-tiles.png',
        stonePaving: 'assets/textures/stone-paving.png',
        landyeFinal: 'assets/textures/landye-final.png',
        embroidery: 'assets/textures/embroidery-pattern.png'
      };
      var loaded = 0, total = Object.keys(files).length;
      function done() { loaded++; if (loaded >= total) resolve(); }
      Object.keys(files).forEach(function (key) {
        loader.load(files[key], function (tex) {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          textures[key] = tex;
          done();
        }, undefined, done);
      });
    });
  }

  /* ================================================================
     虎头帽 — 黑底棉布 + 真丝刺绣 + 立体虎头 + 护耳 + 披风 + 穗子
     ================================================================ */
  function buildHutoumao() {
    var g = new THREE.Group();

    // ---- 材质 ----
    var matBlack = textures.blackCotton
      ? new THREE.MeshStandardMaterial({ map: textures.blackCotton, roughness: 0.88, metalness: 0.0 })
      : new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.88 });

    var matRed = new THREE.MeshStandardMaterial({ color: 0xCC2222, roughness: 0.45, metalness: 0.05 });
    var matYellow = new THREE.MeshStandardMaterial({ color: 0xE8B830, roughness: 0.4, metalness: 0.1 });
    var matBlue = new THREE.MeshStandardMaterial({ color: 0x2255AA, roughness: 0.45, metalness: 0.05 });
    var matWhite = new THREE.MeshStandardMaterial({ color: 0xF5F0E8, roughness: 0.5 });
    var matGreen = new THREE.MeshStandardMaterial({ color: 0x2D7A3A, roughness: 0.45 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.3, metalness: 0.55 });
    var matPink = new THREE.MeshStandardMaterial({ color: 0xE8889A, roughness: 0.5 });
    var matDark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85 });

    // ---- 帽身（黑棉布半球） ----
    var bodyGeo = new THREE.SphereGeometry(1, 48, 28, 0, Math.PI * 2, 0, Math.PI * 0.55);
    var body = new THREE.Mesh(bodyGeo, matBlack);
    body.position.y = 0.1;
    body.castShadow = true;
    g.add(body);

    // 内衬
    var inner = new THREE.Mesh(new THREE.SphereGeometry(0.93, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: 0x2A2020, roughness: 0.9, side: THREE.BackSide }));
    inner.position.y = 0.1;
    g.add(inner);

    // ---- 帽檐（黑色厚边 + 金色滚边） ----
    var brim = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.13, 12, 48), matBlack);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.06;
    brim.castShadow = true;
    g.add(brim);
    var brimTrim = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.035, 8, 48), matGold);
    brimTrim.rotation.x = Math.PI / 2;
    brimTrim.position.y = -0.04;
    g.add(brimTrim);

    // ---- 前幅虎头刺绣（纹理曲面） ----
    if (textures.tigerEmb) {
      var faceGeo = new THREE.PlaneGeometry(1.2, 1.2, 20, 20);
      var fp = faceGeo.attributes.position;
      for (var fi = 0; fi < fp.count; fi++) {
        var fx = fp.getX(fi), fy = fp.getY(fi);
        fp.setZ(fi, Math.max(0, 1 - Math.sqrt(fx * fx + fy * fy) * 0.75) * 0.18);
      }
      faceGeo.computeVertexNormals();
      var faceMesh = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({
        map: textures.tigerEmb, roughness: 0.55, metalness: 0.03,
        transparent: true, alphaTest: 0.08
      }));
      faceMesh.position.set(0, 0.5, 0.8);
      faceMesh.castShadow = true;
      g.add(faceMesh);
    }

    // ---- 立体刺绣眼睛（凸起） ----
    [-0.22, 0.22].forEach(function (ex) {
      // 眼眶（金色线迹）
      var socket = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 16), matGold);
      socket.position.set(ex, 0.55, 0.92);
      g.add(socket);
      // 眼白
      var sclera = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), matWhite);
      sclera.position.set(ex, 0.55, 0.92);
      sclera.scale.z = 0.6;
      g.add(sclera);
      // 瞳孔
      var pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), matDark);
      pupil.position.set(ex, 0.55, 0.96);
      g.add(pupil);
      // 高光
      var hl = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), matWhite);
      hl.position.set(ex + 0.02, 0.57, 0.98);
      g.add(hl);
    });

    // ---- 立体刺绣眉毛 ----
    [-0.22, 0.22].forEach(function (ex) {
      var browCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ex - 0.1, 0.65, 0.9),
        new THREE.Vector3(ex, 0.7, 0.92),
        new THREE.Vector3(ex + 0.1, 0.65, 0.9)
      ]);
      var brow = new THREE.Mesh(new THREE.TubeGeometry(browCurve, 8, 0.018, 6, false), matYellow);
      g.add(brow);
    });

    // ---- 立体刺绣鼻子 ----
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), matPink);
    nose.position.set(0, 0.42, 0.95);
    nose.scale.set(1.2, 0.9, 0.8);
    g.add(nose);
    // 鼻梁
    var bridge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.03), matRed);
    bridge.position.set(0, 0.48, 0.92);
    g.add(bridge);

    // ---- 立体胡须 ----
    [-1, 1].forEach(function (side) {
      for (var wi = 0; wi < 3; wi++) {
        var wCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.12, 0.38 - wi * 0.02, 0.92),
          new THREE.Vector3(side * 0.25, 0.36 - wi * 0.03, 0.88),
          new THREE.Vector3(side * 0.38, 0.34 - wi * 0.04, 0.82)
        ]);
        var whisker = new THREE.Mesh(new THREE.TubeGeometry(wCurve, 6, 0.006, 4, false), matWhite);
        g.add(whisker);
      }
    });

    // ---- 嘴部（张开的虎口） ----
    var mouth = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12, Math.PI), matRed);
    mouth.position.set(0, 0.32, 0.9);
    mouth.rotation.x = Math.PI;
    g.add(mouth);
    // 牙齿
    for (var ti = 0; ti < 4; ti++) {
      var tooth = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.04, 4), matWhite);
      tooth.position.set(-0.06 + ti * 0.04, 0.3, 0.92);
      tooth.rotation.x = Math.PI;
      g.add(tooth);
    }

    // ---- 王字纹（额头） ----
    var wangMat = matYellow;
    // 三横
    [0.78, 0.82, 0.86].forEach(function (wy) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.015), wangMat);
      bar.position.set(0, wy, 0.88);
      g.add(bar);
    });
    // 一竖
    var vBar = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.1, 0.015), wangMat);
    vBar.position.set(0, 0.82, 0.88);
    g.add(vBar);

    // ---- 护耳（两侧） ----
    function makeEarFlap(side) {
      var flap = new THREE.Group();
      // 主体（黑色棉布）
      var main = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12, 0, Math.PI), matBlack);
      main.scale.set(0.7, 1, 0.35);
      flap.add(main);
      // 内衬（红色丝绸）
      var lining = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0xAA2222, roughness: 0.4, side: THREE.BackSide }));
      lining.scale.set(0.7, 1, 0.3);
      lining.position.z = 0.02;
      flap.add(lining);
      // 刺绣花纹（金色装饰）
      var deco = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 12), matGold);
      deco.position.set(0, 0.05, 0.12);
      flap.add(deco);
      flap.position.set(side * 0.72, 0.35, 0.15);
      flap.rotation.z = side * -0.25;
      flap.rotation.y = side * 0.3;
      return flap;
    }
    g.add(makeEarFlap(-1));
    g.add(makeEarFlap(1));

    // ---- 后方小披风 ----
    var capeGeo = new THREE.PlaneGeometry(0.7, 0.5, 8, 6);
    var cp = capeGeo.attributes.position;
    for (var ci = 0; ci < cp.count; ci++) {
      var cx = cp.getX(ci), cy = cp.getY(ci);
      cp.setZ(ci, Math.sin(cx * 4) * 0.03 + (cy < 0 ? 0.02 : 0));
    }
    capeGeo.computeVertexNormals();
    var cape = new THREE.Mesh(capeGeo, new THREE.MeshStandardMaterial({
      map: textures.embroidery || null,
      color: textures.embroidery ? 0xffffff : 0xCC2222,
      roughness: 0.5, side: THREE.DoubleSide
    }));
    cape.position.set(0, 0.15, -0.85);
    cape.rotation.x = 0.3;
    cape.castShadow = true;
    g.add(cape);

    // ---- 顶部元宝绣片 ----
    var yb = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.07, 8), matGold);
    yb.position.y = 1.05;
    g.add(yb);
    for (var pi = 0; pi < 6; pi++) {
      var pa = (pi / 6) * Math.PI * 2;
      var petal = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), matYellow);
      petal.position.set(Math.cos(pa) * 0.07, 1.09, Math.sin(pa) * 0.07);
      g.add(petal);
    }
    var centerFlower = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), matRed);
    centerFlower.position.y = 1.09;
    g.add(centerFlower);

    // ---- 边缘穗子 ----
    for (var si = 0; si < 16; si++) {
      var sa = (si / 16) * Math.PI * 2;
      var sx = Math.sin(sa) * 0.97, sz = Math.cos(sa) * 0.97;
      // 穗子杆
      var tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.003, 0.12, 4), matGold);
      tassel.position.set(sx, -0.02, sz);
      g.add(tassel);
      // 穗子头
      var tHead = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4),
        si % 3 === 0 ? matRed : (si % 3 === 1 ? matYellow : matBlue));
      tHead.position.set(sx, -0.08, sz);
      g.add(tHead);
    }

    // ---- 装饰花纹点缀（散布） ----
    var decoColors = [matRed, matYellow, matBlue, matGreen, matWhite];
    var decoPositions = [
      [-0.45, 0.72, 0.48], [0.45, 0.72, 0.48],
      [-0.58, 0.52, -0.25], [0.58, 0.52, -0.25],
      [0, 0.92, -0.42], [-0.32, 0.78, 0.55], [0.32, 0.78, 0.55],
      [-0.5, 0.6, 0.35], [0.5, 0.6, 0.35]
    ];
    decoPositions.forEach(function (p, i) {
      var d = new THREE.Mesh(new THREE.SphereGeometry(0.03 + (i % 3) * 0.008, 8, 6), decoColors[i % 5]);
      d.position.set(p[0], p[1], p[2]);
      g.add(d);
    });

    return g;
  }

  /* ================================================================
     客家围屋 — 方形堡垒 + 夯土墙 + 四角炮楼 + 梅花枪眼 + 石板院
     ================================================================ */
  function buildWeiwu() {
    var g = new THREE.Group();

    var matWall = textures.rammedEarth
      ? new THREE.MeshStandardMaterial({ map: textures.rammedEarth, roughness: 0.92, metalness: 0.01 })
      : new THREE.MeshStandardMaterial({ color: 0xA0907A, roughness: 0.92 });
    var matRoof = textures.roofTiles
      ? new THREE.MeshStandardMaterial({ map: textures.roofTiles, roughness: 0.78 })
      : new THREE.MeshStandardMaterial({ color: 0x3A3530, roughness: 0.78 });
    var matStone = textures.stonePaving
      ? new THREE.MeshStandardMaterial({ map: textures.stonePaving, roughness: 0.88 })
      : new THREE.MeshStandardMaterial({ color: 0x8A8580, roughness: 0.88 });
    var matWood = new THREE.MeshStandardMaterial({ color: 0x5C3A1E, roughness: 0.65 });
    var matDoor = new THREE.MeshStandardMaterial({ color: 0x2A1A0A, roughness: 0.55 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.3, metalness: 0.5 });
    var matInner = new THREE.MeshStandardMaterial({ color: 0xB0A090, roughness: 0.85 });
    var matHole = new THREE.MeshStandardMaterial({ color: 0x1A1510, roughness: 0.9 });

    if (textures.rammedEarth) textures.rammedEarth.repeat.set(3, 1.5);
    if (textures.roofTiles) textures.roofTiles.repeat.set(4, 4);
    if (textures.stonePaving) textures.stonePaving.repeat.set(3, 3);

    // ===== 尺寸参数 =====
    var W = 2.2, H = 1.5, T = 0.14; // 宽、高、墙厚
    var roofH = 0.55;

    // ===== 外墙（四面） =====
    // 前墙（带门洞，分三段：左、门楣、右）
    var segW = (W - 0.45) / 2;
    [-1, 1].forEach(function (s) {
      var seg = new THREE.Mesh(new THREE.BoxGeometry(segW, H, T), matWall);
      seg.position.set(s * (0.225 + segW / 2), H / 2, W / 2);
      seg.castShadow = true;
      g.add(seg);
    });
    // 门楣
    var lintel = new THREE.Mesh(new THREE.BoxGeometry(0.45, H * 0.28, T), matWall);
    lintel.position.set(0, H * 0.86, W / 2);
    g.add(lintel);

    // 后墙
    var back = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), matWall);
    back.position.set(0, H / 2, -W / 2);
    back.castShadow = true;
    g.add(back);

    // 左右墙
    [-1, 1].forEach(function (s) {
      var side = new THREE.Mesh(new THREE.BoxGeometry(T, H, W), matWall);
      side.position.set(s * W / 2, H / 2, 0);
      side.castShadow = true;
      g.add(side);
    });

    // ===== 基座 =====
    var base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.16, W + 0.4), matStone);
    base.position.y = 0.08;
    base.receiveShadow = true;
    g.add(base);

    // ===== 条石铺砌前院 =====
    var courtyard = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.04, W * 0.35), matStone);
    courtyard.position.set(0, 0.18, W * 0.35);
    courtyard.receiveShadow = true;
    g.add(courtyard);

    // ===== 屋顶（四坡水） =====
    var rv = new Float32Array([
      -W/2-0.2, H, W/2+0.2,   W/2+0.2, H, W/2+0.2,   0, H+roofH, 0,
      W/2+0.2, H, -W/2-0.2,  -W/2-0.2, H, -W/2-0.2,  0, H+roofH, 0,
      -W/2-0.2, H, -W/2-0.2, -W/2-0.2, H, W/2+0.2,   0, H+roofH, 0,
      W/2+0.2, H, W/2+0.2,   W/2+0.2, H, -W/2-0.2,  0, H+roofH, 0,
    ]);
    var roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.BufferAttribute(rv, 3));
    roofGeo.computeVertexNormals();
    var roof = new THREE.Mesh(roofGeo, matRoof);
    roof.castShadow = true;
    g.add(roof);

    // 屋脊装饰
    var ridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.1), matWood);
    ridge.position.y = H + roofH;
    g.add(ridge);
    // 屋脊两端翘角
    [-1, 1].forEach(function (s) {
      var horn = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), matRoof);
      horn.position.set(s * 0.06, H + roofH + 0.06, 0);
      horn.rotation.z = s * 0.3;
      g.add(horn);
    });

    // ===== 梅花形枪眼（墙面） =====
    function addGunHole(x, y, z, ry) {
      // 十字形枪眼
      var h1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.02), matHole);
      var h2 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.02), matHole);
      h1.position.set(x, y, z);
      h2.position.set(x, y, z);
      h1.rotation.y = ry;
      h2.rotation.y = ry;
      g.add(h1);
      g.add(h2);
      // 外圈（梅花形简化为小圆）
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 8), matHole);
      ring.position.set(x, y, z);
      ring.rotation.y = ry;
      g.add(ring);
    }

    // 前墙枪眼（两层）
    for (var r1 = 0; r1 < 2; r1++) {
      for (var c1 = 0; c1 < 5; c1++) {
        var gx = -0.7 + c1 * 0.35;
        if (Math.abs(gx) < 0.25) continue; // 跳过门洞
        addGunHole(gx, 0.5 + r1 * 0.5, W / 2 + 0.01, 0);
      }
    }
    // 侧墙枪眼
    [-1, 1].forEach(function (s) {
      for (var r2 = 0; r2 < 2; r2++) {
        for (var c2 = 0; c2 < 4; c2++) {
          addGunHole(s * (W / 2 + 0.01), 0.5 + r2 * 0.5, -0.6 + c2 * 0.4, Math.PI / 2);
        }
      }
    });

    // ===== 大门 =====
    var doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.06), matWood);
    doorFrame.position.set(0, 0.42, W / 2 + 0.02);
    g.add(doorFrame);
    // 门扇（两扇）
    [-1, 1].forEach(function (s) {
      var door = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.04), matDoor);
      door.position.set(s * 0.1, 0.38, W / 2 + 0.05);
      g.add(door);
      // 门钉
      for (var dr = 0; dr < 3; dr++) {
        for (var dc = 0; dc < 2; dc++) {
          var nail = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), matGold);
          nail.position.set(s * 0.1 + (dc - 0.5) * 0.08, 0.22 + dr * 0.16, W / 2 + 0.07);
          g.add(nail);
        }
      }
    });
    // 门匾
    var plaque = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.03), matWood);
    plaque.position.set(0, 0.82, W / 2 + 0.07);
    g.add(plaque);
    // 门匾金字
    var plaqueText = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.01), matGold);
    plaqueText.position.set(0, 0.82, W / 2 + 0.09);
    g.add(plaqueText);

    // ===== 四角炮楼 =====
    var corners = [[-W/2, -W/2], [W/2, -W/2], [-W/2, W/2], [W/2, W/2]];
    corners.forEach(function (c) {
      var cx = c[0], cz = c[1];
      // 炮楼主体（比主墙高 40%）
      var twH = H * 1.4;
      var tw = new THREE.Mesh(new THREE.BoxGeometry(0.35, twH, 0.35), matWall);
      tw.position.set(cx, twH / 2, cz);
      tw.castShadow = true;
      g.add(tw);
      // 炮楼顶（四坡小顶）
      var trv = new Float32Array([
        cx-0.25, twH, cz+0.25,  cx+0.25, twH, cz+0.25,  cx, twH+0.25, cz,
        cx+0.25, twH, cz-0.25,  cx-0.25, twH, cz-0.25,  cx, twH+0.25, cz,
        cx-0.25, twH, cz-0.25,  cx-0.25, twH, cz+0.25,  cx, twH+0.25, cz,
        cx+0.25, twH, cz+0.25,  cx+0.25, twH, cz-0.25,  cx, twH+0.25, cz,
      ]);
      var trGeo = new THREE.BufferGeometry();
      trGeo.setAttribute('position', new THREE.BufferAttribute(trv, 3));
      trGeo.computeVertexNormals();
      var tr = new THREE.Mesh(trGeo, matRoof);
      g.add(tr);
      // 炮楼枪眼（每面2个）
      [[0, 0.18], [0, -0.18], [0.18, 0], [-0.18, 0]].forEach(function (off) {
        var isX = Math.abs(off[0]) > 0;
        var hx = cx + off[0], hz = cz + off[1];
        var h1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.015), matHole);
        var h2 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.015), matHole);
        h1.position.set(hx, twH * 0.65, hz);
        h2.position.set(hx, twH * 0.65, hz);
        if (isX) { h1.rotation.y = Math.PI / 2; h2.rotation.y = Math.PI / 2; }
        g.add(h1);
        g.add(h2);
      });
    });

    // ===== 内院 =====
    var courtInner = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.04, W * 0.5), matStone);
    courtInner.position.y = 0.2;
    courtInner.receiveShadow = true;
    g.add(courtInner);

    // 内墙（围合，留天井）
    var iw = W * 0.45, ih = 0.65;
    [[0, iw/2, iw, T], [0, -iw/2, iw, T], [-iw/2, 0, T, iw], [iw/2, 0, T, iw]].forEach(function (s) {
      var ws = new THREE.Mesh(new THREE.BoxGeometry(s[2], ih, s[3]), matWall);
      ws.position.set(s[0], 0.22 + ih / 2, s[1]);
      g.add(ws);
    });

    // 天井（中央开口 + 排水沟）
    var sky = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x7A8A6A, roughness: 0.8 }));
    sky.position.y = 0.22;
    g.add(sky);

    // 中轴线祠堂（后进，简化为一个较高的内部建筑）
    var hall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.4), matWood);
    hall.position.set(0, 0.6, -W * 0.25);
    g.add(hall);
    var hallRoof = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.48), matRoof);
    hallRoof.position.set(0, 1.02, -W * 0.25);
    g.add(hallRoof);

    return g;
  }

  /* ================================================================
     蓝染布 — 折叠布料 + 水墨晕染 + 染缸 + 板蓝根
     ================================================================ */
  function buildLandye() {
    var g = new THREE.Group();

    // ---- 挂杆 ----
    var rodY = 1.35;
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x7A6550, roughness: 0.75 }));
    rod.rotation.z = Math.PI / 2;
    rod.position.y = rodY;
    rod.castShadow = true;
    g.add(rod);

    // ---- 主布料（褶皱 + 垂坠） ----
    var clothW = 1.7, clothH = 1.65;
    var clothGeo = new THREE.PlaneGeometry(clothW, clothH, 32, 32);
    var cp = clothGeo.attributes.position;
    for (var i = 0; i < cp.count; i++) {
      var x = cp.getX(i), y = cp.getY(i);
      // 多层褶皱：大波浪 + 细褶 + 底部收拢
      var wave1 = Math.sin(x * 4 + 0.3) * 0.06;
      var wave2 = Math.sin(x * 9 + y * 2) * 0.025;
      var wave3 = Math.cos(y * 3 + x) * 0.03;
      var sag = -Math.abs(x) * 0.02 * (1 - (y + clothH / 2) / clothH);
      cp.setZ(i, wave1 + wave2 + wave3 + sag);
    }
    clothGeo.computeVertexNormals();

    var clothMat;
    if (textures.landyeFinal) {
      var lt = textures.landyeFinal.clone();
      lt.repeat.set(1.3, 1.3);
      lt.needsUpdate = true;
      clothMat = new THREE.MeshStandardMaterial({ map: lt, roughness: 0.88, side: THREE.DoubleSide });
    } else {
      clothMat = new THREE.MeshStandardMaterial({ color: 0x1A3A5C, roughness: 0.88, side: THREE.DoubleSide });
    }
    var cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.set(0, rodY - clothH / 2, 0);
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    g.add(cloth);

    // ---- 挂钩 ----
    [-0.55, -0.2, 0.2, 0.55].forEach(function (hx) {
      var hook = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6, roughness: 0.4 }));
      hook.position.set(hx, rodY - 0.035, 0);
      hook.rotation.x = Math.PI / 2;
      g.add(hook);
    });

    // ---- 染缸 ----
    var vatY = -0.65;
    var vatMat = new THREE.MeshStandardMaterial({ color: 0x4A3528, roughness: 0.9 });
    var vat = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.5, 16), vatMat);
    vat.position.set(0, vatY, -0.4);
    vat.castShadow = true;
    g.add(vat);
    var vatRim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.022, 8, 16), vatMat);
    vatRim.rotation.x = Math.PI / 2;
    vatRim.position.set(0, vatY + 0.25, -0.4);
    g.add(vatRim);
    // 染液（深靛蓝）
    var liq = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: 0x0A1E30, roughness: 0.1, metalness: 0.05 }));
    liq.position.set(0, vatY + 0.18, -0.4);
    g.add(liq);

    // ---- 板蓝根植物 ----
    var groundY = -1.0;
    var stemMat = new THREE.MeshStandardMaterial({ color: 0x3D6B2E, roughness: 0.7 });
    var leafMat = new THREE.MeshStandardMaterial({ color: 0x2D5A22, roughness: 0.65, side: THREE.DoubleSide });
    var px = 0.9, pz = 0.25;
    var stemH = 0.5;
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, stemH, 6), stemMat);
    stem.position.set(px, groundY + stemH / 2, pz);
    g.add(stem);
    for (var li = 0; li < 5; li++) {
      var leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.065), leafMat);
      var la = (li / 5) * Math.PI * 2;
      leaf.position.set(
        px + Math.cos(la) * 0.06,
        groundY + stemH * 0.35 + li * 0.07,
        pz + Math.sin(la) * 0.06
      );
      leaf.rotation.y = la;
      leaf.rotation.x = -0.35;
      g.add(leaf);
    }

    return g;
  }

  /**
   * 程序化贴图：直接吃 js/textures.js 画的 canvas。
   * 新增物件一律走这条路，不引入任何外部图片，因此不存在生成平台角标，
   * 也不受 AI 内容标识义务约束。
   */
  function canvasTex(gen, repeatX, repeatY) {
    if (!window.Textures || !window.Textures[gen]) return null;
    var tex = new THREE.CanvasTexture(window.Textures[gen]());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX || 1, repeatY || 1);
    tex.anisotropy = 4;
    return tex;
  }

  /* ================================================================
     客家凉帽 —— 竹编帽檐 + 一圈垂布
     ================================================================ */
  function buildLiangmao() {
    var g = new THREE.Group();
    var weave = canvasTex('bambooWeave', 3, 3);
    var cloth = canvasTex('hatCloth', 4, 1);

    var R = 0.95;
    var crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.38, 0.20, 28),
      new THREE.MeshStandardMaterial({ map: weave, color: 0xD8B57E, roughness: 0.85 })
    );
    crown.position.y = 0.34;
    crown.castShadow = true;
    g.add(crown);

    // 帽檐：扁平竹篾编的圆盘
    var brim = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.035, 48),
      new THREE.MeshStandardMaterial({ map: weave, color: 0xD8B57E, roughness: 0.85, side: THREE.DoubleSide })
    );
    brim.position.y = 0.22;
    brim.castShadow = true;
    g.add(brim);

    // 垂布：绕帽檐一圈，带褶
    var skirtH = 0.52;
    var skirtGeo = new THREE.CylinderGeometry(R * 1.01, R * 1.06, skirtH, 64, 6, true);
    var sp = skirtGeo.attributes.position;
    for (var i = 0; i < sp.count; i++) {
      var x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      var ang = Math.atan2(z, x);
      // 褶量随高度增大，下摆更松散
      var t = (y + skirtH / 2) / skirtH;
      var pleat = Math.sin(ang * 18) * 0.022 * (1.15 - t);
      var rr = Math.sqrt(x * x + z * z) + pleat;
      sp.setX(i, Math.cos(ang) * rr);
      sp.setZ(i, Math.sin(ang) * rr);
      sp.setY(i, y - Math.abs(pleat) * 0.4);
    }
    skirtGeo.computeVertexNormals();
    var skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({
      map: cloth, color: 0x8FB3C4, roughness: 0.92, side: THREE.DoubleSide
    }));
    skirt.position.y = 0.22 - skirtH / 2 + 0.02;
    skirt.castShadow = true;
    g.add(skirt);

    // 帽顶红布结与系带
    var knot = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xB03A28, roughness: 0.7 })
    );
    knot.position.y = 0.47;
    g.add(knot);

    var strapMat = new THREE.MeshStandardMaterial({ color: 0xC9C2B0, roughness: 0.9 });
    [-1, 1].forEach(function (s) {
      var strap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.55, 8), strapMat);
      strap.position.set(s * 0.30, -0.28, 0.16);
      strap.rotation.z = s * 0.28;
      g.add(strap);
    });

    g.position.y = 0.35;
    return g;
  }

  /* ================================================================
     竹编簸箕 —— 浅口圆簸箕，三足
     ================================================================ */
  function buildBoji() {
    var g = new THREE.Group();
    var weave = canvasTex('bambooWeave', 4, 2);
    var mat = new THREE.MeshStandardMaterial({
      map: weave, color: 0xD9B77E, roughness: 0.86, side: THREE.DoubleSide
    });

    var R = 1.0;
    // 底面略微下凹的圆盘
    var base = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 48), mat);
    base.rotation.x = -Math.PI / 2;
    base.receiveShadow = true;
    g.add(base);

    // 侧壁：向外敞开的浅口
    var wallGeo = new THREE.CylinderGeometry(R * 0.96, R, 0.20, 48, 3, true);
    var wp = wallGeo.attributes.position;
    for (var i = 0; i < wp.count; i++) {
      var y = wp.getY(i);
      var t = (y + 0.10) / 0.20;
      var ang = Math.atan2(wp.getZ(i), wp.getX(i));
      var rr = Math.sqrt(wp.getX(i) * wp.getX(i) + wp.getZ(i) * wp.getZ(i));
      rr += Math.sin(ang * 26) * 0.006 * t;   // 边沿的细密编痕
      wp.setX(i, Math.cos(ang) * rr);
      wp.setZ(i, Math.sin(ang) * rr);
    }
    wallGeo.computeVertexNormals();
    var wall = new THREE.Mesh(wallGeo, mat);
    wall.position.y = 0.10;
    wall.castShadow = true;
    g.add(wall);

    // 缠竹皮的圈口
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.028, 10, 56),
      new THREE.MeshStandardMaterial({ color: 0x9C6B33, roughness: 0.72 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.20;
    rim.castShadow = true;
    g.add(rim);

    // 三足
    var footMat = new THREE.MeshStandardMaterial({ color: 0x7A5228, roughness: 0.8 });
    for (var f = 0; f < 3; f++) {
      var a = (f / 3) * Math.PI * 2 + 0.4;
      var foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.12, 10), footMat);
      foot.position.set(Math.cos(a) * R * 0.62, -0.06, Math.sin(a) * R * 0.62);
      g.add(foot);
    }

    // 簸箕里摊一点谷粒，说明用途
    var grainMat = new THREE.MeshStandardMaterial({ color: 0xC8A24A, roughness: 0.65 });
    var grain = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 6, 5), grainMat, 90);
    var m4 = new THREE.Matrix4();
    for (var k = 0; k < 90; k++) {
      var ra = Math.sqrt(Math.random()) * R * 0.72;
      var ta = Math.random() * Math.PI * 2;
      m4.makeScale(1, 0.6, 1);
      m4.setPosition(Math.cos(ta) * ra, 0.02, Math.sin(ta) * ra);
      grain.setMatrixAt(k, m4);
    }
    grain.instanceMatrix.needsUpdate = true;
    g.add(grain);

    g.position.y = 0.12;
    return g;
  }

  /* ================================================================
     客家织带 —— 搭在横杆上的一条织带，末端有穗
     ================================================================ */
  function buildZhidai() {
    var g = new THREE.Group();
    var belt = canvasTex('wovenBelt', 1, 3);

    var rodY = 1.15;
    var rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 2.0, 12),
      new THREE.MeshStandardMaterial({ color: 0x6E563C, roughness: 0.8 })
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.y = rodY;
    rod.castShadow = true;
    g.add(rod);
    [-0.95, 0.95].forEach(function (x) {
      var post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.04, rodY, 10),
        new THREE.MeshStandardMaterial({ color: 0x5C472F, roughness: 0.85 })
      );
      post.position.set(x, rodY / 2, 0);
      g.add(post);
    });

    // 绕过横杆自然垂下的两条带子，带面有轻微扭转
    var mat = new THREE.MeshStandardMaterial({
      map: belt, color: 0xffffff, roughness: 0.82, side: THREE.DoubleSide
    });
    [-1, 1].forEach(function (side) {
      var w = 0.20, len = 0.92;
      var geo = new THREE.PlaneGeometry(w, len, 6, 26);
      var p = geo.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i);
        var t = (y + len / 2) / len;                 // 0 在上端
        var twist = Math.sin(t * 4.2) * 0.05 * t;    // 下摆扭转越大
        p.setZ(i, twist + Math.sin(x * 9 + t * 5) * 0.012);
        p.setX(i, x * (1 - 0.06 * t));               // 越往下越收
      }
      geo.computeVertexNormals();
      var strip = new THREE.Mesh(geo, mat);
      strip.position.set(side * 0.30, rodY - len / 2 - 0.02, 0.02);
      strip.rotation.y = side * 0.12;
      strip.castShadow = true;
      g.add(strip);

      // 末端流苏
      var fringeMat = new THREE.MeshStandardMaterial({ color: 0xE4D6B8, roughness: 0.9 });
      for (var f = 0; f < 9; f++) {
        var fr = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.003, 0.13, 5), fringeMat);
        fr.position.set(side * 0.30 + (f - 4) * 0.021, rodY - len - 0.08, 0.02);
        fr.rotation.z = (f - 4) * 0.035;
        g.add(fr);
      }
    });

    // 相机注视点在 y≈0.15，架子本身高 1.15，不压低就会顶出画面
    g.position.y = -0.44;
    return g;
  }

  /* ================================================================
     米酒坛 —— 酱釉陶坛 + 红纸封口
     ================================================================ */
  function buildMijiutan() {
    var g = new THREE.Group();
    var glaze = canvasTex('glazeJar', 2, 1);

    // 坛身：一条轮廓线旋转成型
    var profile = [
      [0.00, 0.00], [0.30, 0.00], [0.34, 0.04], [0.42, 0.16],
      [0.50, 0.34], [0.53, 0.52], [0.50, 0.70], [0.42, 0.86],
      [0.32, 0.96], [0.27, 1.02], [0.28, 1.08], [0.31, 1.12], [0.29, 1.15]
    ].map(function (v) { return new THREE.Vector2(v[0], v[1]); });

    var body = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 48),
      new THREE.MeshStandardMaterial({ map: glaze, color: 0xC98A52, roughness: 0.42, metalness: 0.06 })
    );
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // 肩部的弦纹
    [0.62, 0.70].forEach(function (y) {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.50, 0.010, 6, 40),
        new THREE.MeshStandardMaterial({ color: 0x3B2213, roughness: 0.6 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
    });

    // 红纸封口 + 扎绳
    var cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.30, 0.07, 28),
      new THREE.MeshStandardMaterial({ color: 0xB2352A, roughness: 0.78 })
    );
    cap.position.y = 1.18;
    cap.castShadow = true;
    g.add(cap);
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4),
      new THREE.MeshStandardMaterial({ color: 0x9E2C22, roughness: 0.8 })
    );
    dome.position.y = 1.21;
    g.add(dome);
    var cord = new THREE.Mesh(
      new THREE.TorusGeometry(0.315, 0.014, 6, 30),
      new THREE.MeshStandardMaterial({ color: 0x4A3A22, roughness: 0.9 })
    );
    cord.rotation.x = Math.PI / 2;
    cord.position.y = 1.155;
    g.add(cord);

    // 坛前一只酒盏
    var cupProfile = [
      [0.00, 0.00], [0.10, 0.00], [0.12, 0.02], [0.14, 0.07], [0.13, 0.08], [0.10, 0.05]
    ].map(function (v) { return new THREE.Vector2(v[0], v[1]); });
    var cup = new THREE.Mesh(
      new THREE.LatheGeometry(cupProfile, 24),
      new THREE.MeshStandardMaterial({ color: 0xE8E0CC, roughness: 0.5, side: THREE.DoubleSide })
    );
    cup.position.set(0.62, 0.0, 0.42);
    cup.castShadow = true;
    g.add(cup);

    // 坛子连封口高约 1.28，压低才不会把红纸坛帽裁掉
    g.position.y = -0.58;
    return g;
  }

  /* ================================================================
     场景管理
     ================================================================ */
  function initScene(container) {
    var w = container.clientWidth || 360, h = 300;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEDE8DC);
    scene.fog = new THREE.Fog(0xEDE8DC, 7, 14);
    camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    camera.position.set(0, 0.4, zoom);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xfff5e6, 0.5));
    var main = new THREE.DirectionalLight(0xffeedd, 0.95);
    main.position.set(4, 6, 3);
    main.castShadow = true;
    main.shadow.mapSize.set(1024, 1024);
    scene.add(main);
    var fill = new THREE.DirectionalLight(0xd0e8ff, 0.35);
    fill.position.set(-3, 2, -2);
    scene.add(fill);
    var bounce = new THREE.DirectionalLight(0xfff0dd, 0.12);
    bounce.position.set(0, -2, 1);
    scene.add(bounce);

    var ground = new THREE.Mesh(new THREE.CircleGeometry(5, 32),
      new THREE.MeshStandardMaterial({ color: 0xD8D0C0, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.15;
    ground.receiveShadow = true;
    scene.add(ground);

    bindControls(renderer.domElement);
  }

  function bindControls(canvas) {
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    function stopAuto() {
      autoRotate = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { autoRotate = true; }, 6000);
    }

    // 桌面
    canvas.addEventListener('mousedown', function (e) {
      isDragging = true;
      stopAuto();
      dragMode = (e.button === 2 || e.button === 1) ? 'pan' : 'rotate';
      prevMouse.x = e.clientX;
      prevMouse.y = e.clientY;
    });
    window.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      var dx = e.clientX - prevMouse.x, dy = e.clientY - prevMouse.y;
      if (dragMode === 'pan') {
        targetPanX = Math.max(-2, Math.min(2, targetPanX + dx * 0.005));
        targetPanY = Math.max(-1.5, Math.min(1.5, targetPanY - dy * 0.005));
      } else {
        targetRotY += dx * 0.008;
        targetRotX = Math.max(-1, Math.min(1, targetRotX + dy * 0.006));
      }
      prevMouse.x = e.clientX;
      prevMouse.y = e.clientY;
    });
    window.addEventListener('mouseup', function () { isDragging = false; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      stopAuto();
      targetZoom = Math.max(2.5, Math.min(9, targetZoom + e.deltaY * 0.003));
    }, { passive: false });

    // 移动端
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation(); stopAuto();
      if (e.touches.length === 1) {
        touchMode = 'rotate'; isDragging = true;
        prevMouse.x = e.touches[0].clientX;
        prevMouse.y = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        touchMode = 'pan'; isDragging = true;
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDist = Math.hypot(dx, dy);
        pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (!isDragging) return;
      if (touchMode === 'rotate' && e.touches.length === 1) {
        var dx = e.touches[0].clientX - prevMouse.x;
        var dy = e.touches[0].clientY - prevMouse.y;
        targetRotY += dx * 0.008;
        targetRotX = Math.max(-1, Math.min(1, targetRotX + dy * 0.006));
        prevMouse.x = e.touches[0].clientX;
        prevMouse.y = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var nd = Math.hypot(dx, dy);
        var nmx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var nmy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (pinchDist > 0) targetZoom = Math.max(2.5, Math.min(9, targetZoom * pinchDist / nd));
        targetPanX = Math.max(-2, Math.min(2, targetPanX + (nmx - pinchMidX) * 0.005));
        targetPanY = Math.max(-1.5, Math.min(1.5, targetPanY - (nmy - pinchMidY) * 0.005));
        pinchDist = nd; pinchMidX = nmx; pinchMidY = nmy;
      }
    }, { passive: false });

    canvas.addEventListener('touchend', function (e) {
      if (e.touches.length === 0) { isDragging = false; touchMode = null; }
      else if (e.touches.length === 1) {
        touchMode = 'rotate';
        prevMouse.x = e.touches[0].clientX;
        prevMouse.y = e.touches[0].clientY;
      }
    });
  }

  function showModel(id) {
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.traverse(function (c) {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(function (m) { m.dispose(); });
          else c.material.dispose();
        }
      });
      currentModel = null;
    }
    switch (id) {
      case 'hutoumao': currentModel = buildHutoumao(); break;
      case 'weiwu': currentModel = buildWeiwu(); break;
      case 'landye': currentModel = buildLandye(); break;
      case 'liangmao': currentModel = buildLiangmao(); break;
      case 'boji': currentModel = buildBoji(); break;
      case 'zhidai': currentModel = buildZhidai(); break;
      case 'mijiutan': currentModel = buildMijiutan(); break;
      default: currentModel = buildHutoumao();
    }
    scene.add(currentModel);
    // 小件器物要拉近才看得清编织与釉面，按条目给的取景距离走
    var spec = ITEMS.filter(function (it) { return it.id === id; })[0];
    targetRotX = 0.25;
    // Return to the canonical view by the shortest arc. Assigning 0.4 outright left
    // rotY at whatever the auto-rotation had accumulated, so the lerp unwound tens of
    // radians in a second — the violent spin on switching models.
    targetRotY = rotY + shortestTurnTo(rotY, 0.4);
    targetPanX = 0; targetPanY = 0;
    targetZoom = (spec && spec.zoom) || 4.2;
  }

  /** Signed delta from `from` to `to` taking the short way round. */
  function shortestTurnTo(from, to) {
    var d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Keep both angles in (-PI, PI] so a long idle session cannot drift to huge values. */
  function wrapAngles() {
    if (targetRotY > Math.PI || targetRotY < -Math.PI) {
      var w = targetRotY - Math.round(targetRotY / (Math.PI * 2)) * Math.PI * 2;
      rotY += w - targetRotY;   // shift both equally: no visual jump
      targetRotY = w;
    }
  }

  function animate() {
    animationId = requestAnimationFrame(animate);
    if (autoRotate && !isDragging) targetRotY += 0.003;
    wrapAngles();
    rotX += (targetRotX - rotX) * 0.08;
    rotY += (targetRotY - rotY) * 0.08;
    zoom += (targetZoom - zoom) * 0.08;
    panX += (targetPanX - panX) * 0.1;
    panY += (targetPanY - panY) * 0.1;
    if (currentModel) { currentModel.rotation.x = rotX; currentModel.rotation.y = rotY; }
    camera.position.set(panX, 0.4 + panY, zoom);
    camera.lookAt(panX, 0.15 + panY, 0);
    renderer.render(scene, camera);
  }

  function stop() { if (animationId) cancelAnimationFrame(animationId); animationId = null; }

  function renderItemList(container) {
    container.innerHTML = ITEMS.map(function (item) {
      return '<button class="c3d-item" data-id="' + item.id + '" type="button">' +
        '<div class="c3d-item-icon">' + item.icon + '</div>' +
        '<div class="c3d-item-name">' + item.name + '</div>' +
        '<div class="c3d-item-sub">' + item.subtitle + '</div></button>';
    }).join('');
    container.querySelectorAll('.c3d-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        container.querySelectorAll('.c3d-item').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        showModel(id);
        var item = ITEMS.find(function (i) { return i.id === id; });
        if (item) {
          var ne = document.getElementById('c3dName'), de = document.getElementById('c3dDesc');
          if (ne) ne.textContent = item.name + ' \u00b7 ' + item.subtitle;
          if (de) de.textContent = item.desc;
        }
      });
    });
  }

  /** 首屏只做不依赖 WebGL 的部分：列表、名称、说明。引擎与贴图留给 boot()。 */
  function init() {
    var section = document.getElementById('panel3d') || document.getElementById('showcase3dSection');
    if (!section) return;
    var list = document.getElementById('c3dList');
    var viewport = document.getElementById('c3dViewport');
    renderItemList(list);
    var first = list.querySelector('.c3d-item');
    if (first) first.classList.add('active');
    var item0 = ITEMS[0];
    var ne = document.getElementById('c3dName'), de = document.getElementById('c3dDesc');
    if (ne) ne.textContent = item0.name + ' \u00b7 ' + item0.subtitle;
    if (de) de.textContent = item0.desc;
    if (viewport && !booted) {
      viewport.innerHTML = '<div class="c3d-loading">3D 引擎与贴图在点开本视图时加载</div>';
    }
  }

  function setProgress(msg) {
    var viewport = document.getElementById('c3dViewport');
    if (viewport) viewport.innerHTML = '<div class="c3d-loading">' + msg + '</div>';
  }

  /** 真正拉起 three.js + 贴图 + 场景。reveal() 与 show() 都走这里，且只跑一次。 */
  function boot() {
    if (booted) return Promise.resolve();
    if (booting) return booting;
    var viewport = document.getElementById('c3dViewport');
    if (!viewport) return Promise.reject(new Error('缺少 #c3dViewport'));

    booting = new Promise(function (resolve, reject) {
      var settled = false;
      // 30秒超时保护
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        booting = null;
        setProgress('加载超时，请检查网络后刷新页面');
        reject(new Error('3D 资源加载超时'));
      }, 30000);

      setProgress('加载 3D 引擎…');
      loadThree().then(function () {
        if (settled) return;
        setProgress('加载纹理资源…（约 13MB，首次加载需等待）');
        return loadTextures();
      }).then(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        setProgress('构建 3D 场景…');
        initScene(viewport);
        showModel(ITEMS[0].id);
        animate();
        booted = true;
        booting = null;
        console.log('[3D] Scene ready');
        resolve();
      }).catch(function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        booting = null;
        console.error('[3D]', err);
        viewport.innerHTML = '<div class="c3d-error">3D 加载失败：' + (err.message || err)
          + '<br><br>请刷新页面重试</div>';
        reject(err);
      });
    });
    return booting;
  }

  function reveal() { return boot(); }

  /** 未启动时先启动再切换；已启动时保持原来的同步行为（测试依赖这一点）。 */
  function show(id) {
    if (booted) { showModel(id); return; }
    pendingShow = id;
    boot().then(function () {
      if (pendingShow) { showModel(pendingShow); pendingShow = null; }
    }).catch(function () { pendingShow = null; });
  }

  /** 只读状态，供 tests/ 断言自动旋转角度不会无上限累加 */
  window.Showcase3D = {
    init: init,
    reveal: reveal,
    stop: stop,
    show: show,
    booted: function () { return booted; },
    items: function () { return ITEMS.map(function (it) { return { id: it.id, name: it.name }; }); },
    debugState: function () {
      return { rotX: rotX, rotY: rotY, targetRotX: targetRotX, targetRotY: targetRotY, autoRotate: autoRotate };
    },
    debugModel: function () { return currentModel; },
    debugCamera: function () { return camera; }
  };
})();
