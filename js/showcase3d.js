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

    // ---- 挺拔立体双虎耳（立耳 + 红色绒衬 + 白绒毛球 + 金铃） ----
    [-0.42, 0.42].forEach(function (ex) {
      var earGroup = new THREE.Group();
      // 外耳廓
      var earOuter = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.32, 16), matBlack);
      earOuter.scale.set(1.0, 1.0, 0.5);
      earGroup.add(earOuter);
      // 内耳红绒
      var earInner = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 12), matRed);
      earInner.scale.set(1.0, 1.0, 0.4);
      earInner.position.set(0, -0.01, 0.04);
      earGroup.add(earInner);
      // 白绒毛球
      var pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), matWhite);
      pom.position.set(0, -0.06, 0.07);
      earGroup.add(pom);
      // 耳尖小金铃
      var bell = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), matGold);
      bell.position.set(0, 0.17, 0);
      earGroup.add(bell);

      earGroup.position.set(ex, 0.96, 0.22);
      earGroup.rotation.z = (ex > 0 ? -1 : 1) * 0.22;
      earGroup.rotation.x = -0.15;
      g.add(earGroup);
    });

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
      : new THREE.MeshStandardMaterial({ color: 0xA8957C, roughness: 0.92 });
    var matRoof = textures.roofTiles
      ? new THREE.MeshStandardMaterial({ map: textures.roofTiles, roughness: 0.78 })
      : new THREE.MeshStandardMaterial({ color: 0x36322E, roughness: 0.78 });
    var matStone = textures.stonePaving
      ? new THREE.MeshStandardMaterial({ map: textures.stonePaving, roughness: 0.88 })
      : new THREE.MeshStandardMaterial({ color: 0x827D78, roughness: 0.88 });
    var matDarkStone = new THREE.MeshStandardMaterial({ color: 0x5C5650, roughness: 0.85 });
    var matWood = new THREE.MeshStandardMaterial({ color: 0x5C3A1E, roughness: 0.65 });
    var matDarkWood = new THREE.MeshStandardMaterial({ color: 0x382212, roughness: 0.7 });
    var matDoor = new THREE.MeshStandardMaterial({ color: 0x24160A, roughness: 0.55 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.3, metalness: 0.5 });
    var matRed = new THREE.MeshStandardMaterial({ color: 0xB82424, roughness: 0.5 });
    var matHole = new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 0.92 });
    var matPond = new THREE.MeshStandardMaterial({ color: 0x264648, roughness: 0.18, metalness: 0.35 });

    if (textures.rammedEarth) textures.rammedEarth.repeat.set(3, 1.5);
    if (textures.roofTiles) textures.roofTiles.repeat.set(4, 4);
    if (textures.stonePaving) textures.stonePaving.repeat.set(3, 3);

    // ===== 尺寸参数 =====
    var W = 2.2, H = 1.45, T = 0.14; // 宽、高、墙厚
    var stoneBaseH = 0.38;          // 下石上土：底部青石基高度
    var roofH = 0.50;

    // ===== 1. 基座（大条石地台 + 禾坪） =====
    var basePlinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.35, 0.16, W + 0.35), matDarkStone);
    basePlinth.position.set(0, 0.08, 0);
    basePlinth.receiveShadow = true;
    g.add(basePlinth);

    // 前方延伸的青石禾坪（晒谷场与宗族活动外坪）
    var heping = new THREE.Mesh(new THREE.BoxGeometry(W + 0.25, 0.14, 0.75), matStone);
    heping.position.set(0, 0.07, W / 2 + 0.50);
    heping.receiveShadow = true;
    g.add(heping);

    // 门前环抱的半月风水池塘（客家月池，防火蓄水、聚财纳福）
    var pondGeo = new THREE.CircleGeometry(0.55, 32, 0, Math.PI);
    var pond = new THREE.Mesh(pondGeo, matPond);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(0, 0.145, W / 2 + 0.85);
    g.add(pond);

    // 半月池石驳坎护岸（青石砌沿）
    var curbGeo = new THREE.TorusGeometry(0.55, 0.025, 6, 32, Math.PI);
    var curb = new THREE.Mesh(curbGeo, matDarkStone);
    curb.rotation.x = Math.PI / 2;
    curb.position.set(0, 0.15, W / 2 + 0.85);
    g.add(curb);

    // 禾坪两端的功名旗杆石（客家崇文重教的石夹旗杆石）
    [-0.75, 0.75].forEach(function (fx) {
      var poleBase = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.07), matDarkStone);
      poleBase.position.set(fx, 0.20, W / 2 + 0.42);
      g.add(poleBase);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.45, 8), matWood);
      pole.position.set(fx, 0.48, W / 2 + 0.42);
      g.add(pole);
    });

    // ===== 2. 外墙（下石上土坚固防御体系） =====
    // 基础青石勒脚（四周环绕）
    [-W/2, W/2].forEach(function (sx) {
      var sidePlinth = new THREE.Mesh(new THREE.BoxGeometry(T + 0.03, stoneBaseH, W + 0.03), matDarkStone);
      sidePlinth.position.set(sx, 0.16 + stoneBaseH / 2, 0);
      g.add(sidePlinth);
    });
    var backPlinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, stoneBaseH, T + 0.03), matDarkStone);
    backPlinth.position.set(0, 0.16 + stoneBaseH / 2, -W / 2);
    g.add(backPlinth);

    // 前墙青石勒脚（留出大门洞）
    var frontPlinthW = (W - 0.52) / 2;
    [-1, 1].forEach(function (s) {
      var fp = new THREE.Mesh(new THREE.BoxGeometry(frontPlinthW, stoneBaseH, T + 0.03), matDarkStone);
      fp.position.set(s * (0.26 + frontPlinthW / 2), 0.16 + stoneBaseH / 2, W / 2);
      g.add(fp);
    });

    // 上部生土夯土墙
    var rammedH = H - stoneBaseH;
    var rammedY = 0.16 + stoneBaseH + rammedH / 2;

    // 前墙夯土段（左、门楣、右）
    [-1, 1].forEach(function (s) {
      var seg = new THREE.Mesh(new THREE.BoxGeometry(frontPlinthW, rammedH, T), matWall);
      seg.position.set(s * (0.26 + frontPlinthW / 2), rammedY, W / 2);
      seg.castShadow = true;
      g.add(seg);
    });
    var lintel = new THREE.Mesh(new THREE.BoxGeometry(0.52, rammedH * 0.45, T), matWall);
    lintel.position.set(0, 0.16 + stoneBaseH + rammedH * 0.775, W / 2);
    g.add(lintel);

    // 后墙夯土
    var back = new THREE.Mesh(new THREE.BoxGeometry(W, rammedH, T), matWall);
    back.position.set(0, rammedY, -W / 2);
    back.castShadow = true;
    g.add(back);

    // 左右墙夯土
    [-1, 1].forEach(function (s) {
      var side = new THREE.Mesh(new THREE.BoxGeometry(T, rammedH, W), matWall);
      side.position.set(s * W / 2, rammedY, 0);
      side.castShadow = true;
      g.add(side);
    });

    // ===== 3. 大门防卫与礼制门楼（关西新围门厅式样） =====
    var doorStoneFrame = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.82, 0.08), matDarkStone);
    doorStoneFrame.position.set(0, 0.49, W / 2 + 0.03);
    g.add(doorStoneFrame);

    // 门前三级青条石台阶
    for (var st = 0; st < 3; st++) {
      var stepMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.68 - st * 0.06, 0.04, 0.08),
        matStone
      );
      stepMesh.position.set(0, 0.18 + (2 - st) * 0.04, W / 2 + 0.12 + st * 0.07);
      g.add(stepMesh);
    }

    // 门前一对精雕青石抱鼓石（门枕石）
    [-0.26, 0.26].forEach(function (bx) {
      var bBase = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.10), matDarkStone);
      bBase.position.set(bx, 0.22, W / 2 + 0.13);
      g.add(bBase);
      var bDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 16), matStone);
      bDrum.rotation.z = Math.PI / 2;
      bDrum.position.set(bx, 0.31, W / 2 + 0.13);
      g.add(bDrum);
    });

    // 门扇（两扇黑漆铁皮木门）
    [-1, 1].forEach(function (s) {
      var door = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.68, 0.04), matDoor);
      door.position.set(s * 0.11, 0.46, W / 2 + 0.05);
      g.add(door);

      for (var dr = 0; dr < 4; dr++) {
        for (var dc = 0; dc < 2; dc++) {
          var nail = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), matGold);
          nail.position.set(s * 0.11 + (dc - 0.5) * 0.09, 0.24 + dr * 0.14, W / 2 + 0.075);
          g.add(nail);
        }
      }
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 12), matGold);
      ring.position.set(s * 0.11 + (s > 0 ? -0.04 : 0.04), 0.46, W / 2 + 0.08);
      g.add(ring);
    });

    // 门楣上方砖雕出挑小门罩（歇山小雨檐）
    var hoodGeo = new THREE.BoxGeometry(0.64, 0.04, 0.16);
    var hood = new THREE.Mesh(hoodGeo, matRoof);
    hood.position.set(0, 0.92, W / 2 + 0.09);
    g.add(hood);

    // 堂号匾额（黑漆金字匾额）
    var plaque = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.10, 0.03), matDarkWood);
    plaque.position.set(0, 0.84, W / 2 + 0.08);
    g.add(plaque);
    var plaqueGold = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.01), matGold);
    plaqueGold.position.set(0, 0.84, W / 2 + 0.10);
    g.add(plaqueGold);

    // 门头两侧悬挂一对喜庆客家大红灯笼
    [-0.32, 0.32].forEach(function (lx) {
      var lantern = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 10), matRed);
      lantern.scale.set(1, 1.15, 1);
      lantern.position.set(lx, 0.78, W / 2 + 0.16);
      g.add(lantern);

      [0.06, -0.06].forEach(function (dy) {
        var lRing = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 14), matGold);
        lRing.rotation.x = Math.PI / 2;
        lRing.position.set(lx, 0.78 + dy, W / 2 + 0.16);
        g.add(lRing);
      });

      var tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.002, 0.09, 6), matGold);
      tassel.position.set(lx, 0.66, W / 2 + 0.16);
      g.add(tassel);
    });

    // ===== 4. 四角防御碉楼（高耸炮楼 + 出挑腰檐 + 了望窗） =====
    var corners = [[-W/2, -W/2], [W/2, -W/2], [-W/2, W/2], [W/2, W/2]];
    var twH = H * 1.36;
    corners.forEach(function (c) {
      var cx = c[0], cz = c[1];

      var twStone = new THREE.Mesh(new THREE.BoxGeometry(0.42, stoneBaseH, 0.42), matDarkStone);
      twStone.position.set(cx, 0.16 + stoneBaseH / 2, cz);
      g.add(twStone);

      var twRammedH = twH - stoneBaseH;
      var tw = new THREE.Mesh(new THREE.BoxGeometry(0.38, twRammedH, 0.38), matWall);
      tw.position.set(cx, 0.16 + stoneBaseH + twRammedH / 2, cz);
      tw.castShadow = true;
      g.add(tw);

      var cornice = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.48), matDarkWood);
      cornice.position.set(cx, 0.16 + twH - 0.02, cz);
      g.add(cornice);

      // 走马廊出挑木挑梁
      [-0.14, 0.14].forEach(function (bx) {
        var b1 = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.032, 0.46), matDarkWood);
        b1.position.set(cx + bx, 0.16 + twH - 0.045, cz);
        g.add(b1);
        var b2 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.032, 0.024), matDarkWood);
        b2.position.set(cx, 0.16 + twH - 0.045, cz + bx);
        g.add(b2);
      });

      var trv = new Float32Array([
        cx-0.28, 0.16+twH, cz+0.28,  cx+0.28, 0.16+twH, cz+0.28,  cx, 0.16+twH+0.24, cz,
        cx+0.28, 0.16+twH, cz-0.28,  cx-0.28, 0.16+twH, cz-0.28,  cx, 0.16+twH+0.24, cz,
        cx-0.28, 0.16+twH, cz-0.28,  cx-0.28, 0.16+twH, cz+0.28,  cx, 0.16+twH+0.24, cz,
        cx+0.28, 0.16+twH, cz+0.28,  cx+0.28, 0.16+twH, cz-0.28,  cx, 0.16+twH+0.24, cz,
      ]);
      var trGeo = new THREE.BufferGeometry();
      trGeo.setAttribute('position', new THREE.BufferAttribute(trv, 3));
      trGeo.computeVertexNormals();
      var tr = new THREE.Mesh(trGeo, matRoof);
      g.add(tr);

      var fin = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), matGold);
      fin.position.set(cx, 0.16 + twH + 0.25, cz);
      g.add(fin);

      [[0, 0.20], [0, -0.20], [0.20, 0], [-0.20, 0]].forEach(function (off) {
        var isX = Math.abs(off[0]) > 0;
        var hx = cx + off[0], hz = cz + off[1];
        var winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), matDarkWood);
        winFrame.position.set(hx, 0.16 + twH * 0.78, hz);
        if (isX) winFrame.rotation.y = Math.PI / 2;
        g.add(winFrame);
        var winHole = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.025), matHole);
        winHole.position.set(hx, 0.16 + twH * 0.78, hz);
        if (isX) winHole.rotation.y = Math.PI / 2;
        g.add(winHole);
      });

      [[0, 0.20], [0, -0.20], [0.20, 0], [-0.20, 0]].forEach(function (off) {
        var isX = Math.abs(off[0]) > 0;
        var hx = cx + off[0], hz = cz + off[1];
        var sh1 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.02), matHole);
        var sh2 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.02), matHole);
        sh1.position.set(hx, 0.16 + twH * 0.52, hz);
        sh2.position.set(hx, 0.16 + twH * 0.52, hz);
        if (isX) { sh1.rotation.y = Math.PI / 2; sh2.rotation.y = Math.PI / 2; }
        g.add(sh1);
        g.add(sh2);
      });
    });

    // ===== 5. 墙面梅花形与十字形枪眼 =====
    function addWallGunHole(x, y, z, ry) {
      var h1 = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.014, 0.02), matHole);
      var h2 = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.038, 0.02), matHole);
      h1.position.set(x, y, z);
      h2.position.set(x, y, z);
      h1.rotation.y = ry;
      h2.rotation.y = ry;
      g.add(h1);
      g.add(h2);
    }
    for (var r1 = 0; r1 < 2; r1++) {
      for (var c1 = 0; c1 < 5; c1++) {
        var gx = -0.72 + c1 * 0.36;
        if (Math.abs(gx) < 0.28) continue;
        addWallGunHole(gx, 0.65 + r1 * 0.45, W / 2 + 0.01, 0);
      }
    }
    [-1, 1].forEach(function (s) {
      for (var r2 = 0; r2 < 2; r2++) {
        for (var c2 = 0; c2 < 4; c2++) {
          addWallGunHole(s * (W / 2 + 0.01), 0.65 + r2 * 0.45, -0.6 + c2 * 0.4, Math.PI / 2);
        }
      }
    });

    // ===== 6. 大屋顶（四坡黛瓦 + 檐下挑枋 + 飞檐翘脊） =====
    var rv = new Float32Array([
      -W/2-0.22, 0.16+H, W/2+0.22,   W/2+0.22, 0.16+H, W/2+0.22,   0, 0.16+H+roofH, 0,
      W/2+0.22, 0.16+H, -W/2-0.22,  -W/2-0.22, 0.16+H, -W/2-0.22,  0, 0.16+H+roofH, 0,
      -W/2-0.22, 0.16+H, -W/2-0.22, -W/2-0.22, 0.16+H, W/2+0.22,   0, 0.16+H+roofH, 0,
      W/2+0.22, 0.16+H, W/2+0.22,   W/2+0.22, 0.16+H, -W/2-0.22,  0, 0.16+H+roofH, 0,
    ]);
    var roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.BufferAttribute(rv, 3));
    roofGeo.computeVertexNormals();
    var roof = new THREE.Mesh(roofGeo, matRoof);
    roof.castShadow = true;
    g.add(roof);

    [-1, 1].forEach(function (s) {
      var eaveFront = new THREE.Mesh(new THREE.BoxGeometry(W + 0.38, 0.035, 0.06), matDarkWood);
      eaveFront.position.set(0, 0.16 + H - 0.01, s * (W / 2 + 0.18));
      g.add(eaveFront);
      var eaveSide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, W + 0.38), matDarkWood);
      eaveSide.position.set(s * (W / 2 + 0.18), 0.16 + H - 0.01, 0);
      g.add(eaveSide);
    });

    var ridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.12), matDarkWood);
    ridge.position.y = 0.16 + H + roofH;
    g.add(ridge);
    [-1, 1].forEach(function (s) {
      var horn = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 4), matRoof);
      horn.position.set(s * 0.08, 0.16 + H + roofH + 0.06, 0);
      horn.rotation.z = s * 0.35;
      g.add(horn);
    });

    // ===== 7. 内部院落与核心祖堂（九栋十八厅神髓） =====
    var courtInner = new THREE.Mesh(new THREE.BoxGeometry(W * 0.58, 0.03, W * 0.58), matStone);
    courtInner.position.y = 0.18;
    courtInner.receiveShadow = true;
    g.add(courtInner);

    var pondTianjing = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.02, 0.38), matPond);
    pondTianjing.position.set(0, 0.19, 0.08);
    g.add(pondTianjing);
    var tianjingCurb = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.03, 0.42),
      matDarkStone
    );
    tianjingCurb.position.set(0, 0.19, 0.08);
    g.add(tianjingCurb);

    var hall = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.46), matWood);
    hall.position.set(0, 0.54, -W * 0.24);
    g.add(hall);

    var hallRoof = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 0.56), matRoof);
    hallRoof.position.set(0, 0.92, -W * 0.24);
    g.add(hallRoof);

    [-0.24, 0.24].forEach(function (cx) {
      var col = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.70, 8), matRed);
      col.position.set(cx, 0.53, -W * 0.24 + 0.24);
      g.add(col);
    });

    return g;
  }

  /* ================================================================
     蓝染布 — 双层榫卯晾布高架 + 三匹垂挂布料 + 古法双耳粗陶大染缸 + 蓝草捆
     ================================================================ */
  function buildLandye() {
    var g = new THREE.Group();

    var matWood = new THREE.MeshStandardMaterial({ color: 0x6E5136, roughness: 0.72 });
    var matDarkWood = new THREE.MeshStandardMaterial({ color: 0x483220, roughness: 0.8 });
    var matBamboo = new THREE.MeshStandardMaterial({ color: 0xBA9858, roughness: 0.62 });
    var matVat = new THREE.MeshStandardMaterial({ color: 0x3E291C, roughness: 0.88 });
    var matLiquor = new THREE.MeshStandardMaterial({ color: 0x091C2E, roughness: 0.12, metalness: 0.15 });
    var matFoam = new THREE.MeshStandardMaterial({ color: 0x4B79A1, roughness: 0.6 });
    var matHerb = new THREE.MeshStandardMaterial({ color: 0x3D5A2C, roughness: 0.85 });
    var matStraw = new THREE.MeshStandardMaterial({ color: 0x9B8756, roughness: 0.9 });
    var matStonePaving = textures.stonePaving
      ? new THREE.MeshStandardMaterial({ map: textures.stonePaving, roughness: 0.85 })
      : new THREE.MeshStandardMaterial({ color: 0x5C544C, roughness: 0.85 });

    var landyeTex = textures.landyeFinal || canvasTex('landye', 1.2, 1.2);
    var beltTex = canvasTex('wovenBelt', 1, 2.5);

    var matMainCloth = new THREE.MeshStandardMaterial({
      map: landyeTex, color: 0xffffff, roughness: 0.84, side: THREE.DoubleSide
    });
    var matGradCloth = new THREE.MeshStandardMaterial({
      color: 0x1E3C58, roughness: 0.86, side: THREE.DoubleSide
    });
    var matBeltCloth = new THREE.MeshStandardMaterial({
      map: beltTex, color: 0xffffff, roughness: 0.80, side: THREE.DoubleSide
    });

    var rackH = 1.38;

    // ===== 1. 地面青砖铺地 =====
    var ground = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 1.2), matStonePaving);
    ground.position.set(0, -0.92, -0.05);
    ground.receiveShadow = true;
    g.add(ground);

    // ===== 2. 双柱四足客家榫卯晒布高架 =====
    [-0.85, 0.85].forEach(function (rx) {
      // 柱脚石础
      var shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.42), matDarkWood);
      shoe.position.set(rx, -0.87, 0);
      g.add(shoe);

      // 双立柱
      [-0.14, 0.14].forEach(function (rz) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.030, rackH, 12), matWood);
        post.position.set(rx, -0.87 + rackH / 2, rz);
        post.castShadow = true;
        g.add(post);
      });

      // 侧向人字斜撑
      var strut = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.32), matWood);
      strut.position.set(rx, -0.55, 0);
      g.add(strut);

      var topTie = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.04, 0.38), matDarkWood);
      topTie.position.set(rx, -0.87 + rackH, 0);
      g.add(topTie);
    });

    // 上层高竹晾杆（主杆）
    var topPole = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 2.1, 16), matBamboo);
    topPole.rotation.z = Math.PI / 2;
    topPole.position.set(0, -0.87 + rackH + 0.02, 0.14);
    topPole.castShadow = true;
    g.add(topPole);

    // 后层高竹晾杆（复染悬挂杆）
    var rearPole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.1, 14), matBamboo);
    rearPole.rotation.z = Math.PI / 2;
    rearPole.position.set(0, -0.87 + rackH - 0.05, -0.14);
    rearPole.castShadow = true;
    g.add(rearPole);

    // 下层中间横穿加固竹杆
    var midPole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.05, 12), matBamboo);
    midPole.rotation.z = Math.PI / 2;
    midPole.position.set(0, -0.15, 0);
    g.add(midPole);

    // 两端限位木竹销
    [[-1.0, 0.14], [1.0, 0.14], [-1.0, -0.14], [1.0, -0.14]].forEach(function (pp) {
      var pin = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 6), matWood);
      pin.position.set(pp[0], -0.87 + rackH + 0.02, pp[1]);
      g.add(pin);
    });

    // ===== 3. 三匹悬挂垂落的客家蓝染布料 =====
    // (A) 主布匹：宽幅前悬垂染布（生动立体褶皱 + 冰裂团花）
    var clothW = 1.35, clothH = 1.32;
    var clothGeo = new THREE.PlaneGeometry(clothW, clothH, 32, 28);
    var cp = clothGeo.attributes.position;
    for (var ci = 0; ci < cp.count; ci++) {
      var cx = cp.getX(ci), cy = cp.getY(ci);
      var ty = 1 - (cy + clothH / 2) / clothH; // 0 at top, 1 at bottom
      var waveA = Math.sin(cx * 5.2 + 0.4) * 0.065 * (0.2 + 0.8 * ty);
      var waveB = Math.sin(cx * 11.5 + ty * 3) * 0.025 * ty;
      var breeze = Math.sin(ty * 2.8) * 0.04 * (1 - Math.abs(cx) / (clothW * 0.5));
      cp.setZ(ci, waveA + waveB + breeze);
    }
    clothGeo.computeVertexNormals();
    var mainCloth = new THREE.Mesh(clothGeo, matMainCloth);
    mainCloth.position.set(0.10, -0.87 + rackH - clothH / 2 + 0.02, 0.14);
    mainCloth.castShadow = true;
    mainCloth.receiveShadow = true;
    g.add(mainCloth);

    // (B) 后幅渐变蓝染布匹（三浸三晒青黛层次）
    var rearW = 0.95, rearH = 1.15;
    var rearGeo = new THREE.PlaneGeometry(rearW, rearH, 20, 20);
    var rp = rearGeo.attributes.position;
    for (var ri = 0; ri < rp.count; ri++) {
      var rx = rp.getX(ri), ry = rp.getY(ri);
      var rty = 1 - (ry + rearH / 2) / rearH;
      rp.setZ(ri, Math.sin(rx * 6.5) * 0.04 * rty);
    }
    rearGeo.computeVertexNormals();
    var rearCloth = new THREE.Mesh(rearGeo, matGradCloth);
    rearCloth.position.set(-0.35, -0.87 + rackH - rearH / 2 - 0.05, -0.14);
    rearCloth.castShadow = true;
    g.add(rearCloth);

    // (C) 侧挂搭搭挑花长巾带
    var scarfW = 0.28, scarfH = 1.05;
    var scarfGeo = new THREE.PlaneGeometry(scarfW, scarfH, 10, 20);
    var sp = scarfGeo.attributes.position;
    for (var si = 0; si < sp.count; si++) {
      var sy = sp.getY(si);
      var sty = 1 - (sy + scarfH / 2) / scarfH;
      sp.setZ(si, Math.sin(sty * 4.2) * 0.035 * sty);
      sp.setX(si, sp.getX(si) + Math.sin(sty * 3.1) * 0.03);
    }
    scarfGeo.computeVertexNormals();
    var scarf = new THREE.Mesh(scarfGeo, matBeltCloth);
    scarf.position.set(-0.70, -0.87 + rackH - scarfH / 2 + 0.02, 0.15);
    scarf.castShadow = true;
    g.add(scarf);

    // ===== 4. 双耳古陶染缸体系与靛蓝发酵原液 =====
    var vatX = -0.52, vatZ = 0.22, vatY = -0.92;
    var vatProfile = [
      [0.00, 0.00], [0.24, 0.00], [0.27, 0.03], [0.34, 0.14],
      [0.38, 0.30], [0.37, 0.44], [0.33, 0.50], [0.34, 0.53], [0.31, 0.54]
    ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    var vatBody = new THREE.Mesh(new THREE.LatheGeometry(vatProfile, 32), matVat);
    vatBody.position.set(vatX, vatY, vatZ);
    vatBody.castShadow = true;
    vatBody.receiveShadow = true;
    g.add(vatBody);

    // 陶缸双耳
    [-1, 1].forEach(function (side) {
      var earCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(vatX + side * 0.35, vatY + 0.40, vatZ),
        new THREE.Vector3(vatX + side * 0.42, vatY + 0.36, vatZ),
        new THREE.Vector3(vatX + side * 0.35, vatY + 0.32, vatZ)
      ]);
      var vatEar = new THREE.Mesh(new THREE.TubeGeometry(earCurve, 8, 0.018, 6, false), matVat);
      g.add(vatEar);
    });

    // 缸内靛蓝发酵深邃染液
    var liquor = new THREE.Mesh(new THREE.CircleGeometry(0.31, 24), matLiquor);
    liquor.rotation.x = -Math.PI / 2;
    liquor.position.set(vatX, vatY + 0.49, vatZ);
    g.add(liquor);

    // 染液表面浮沫“蓝花”（靛蓝天然发酵特征）
    for (var fmi = 0; fmi < 6; fmi++) {
      var fma = fmi * 1.1;
      var fmr = 0.08 + (fmi % 3) * 0.06;
      var foam = new THREE.Mesh(new THREE.CircleGeometry(0.045, 8), matFoam);
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(vatX + Math.cos(fma) * fmr, vatY + 0.492, vatZ + Math.sin(fma) * fmr);
      g.add(foam);
    }

    // 缸边斜插木制挑布搅棒
    var paddleCurve = new THREE.LineCurve3(
      new THREE.Vector3(vatX - 0.22, vatY + 0.08, vatZ),
      new THREE.Vector3(vatX + 0.16, vatY + 0.78, vatZ + 0.18)
    );
    var paddle = new THREE.Mesh(new THREE.TubeGeometry(paddleCurve, 4, 0.014, 6, false), matWood);
    paddle.castShadow = true;
    g.add(paddle);

    // ===== 5. 板蓝根草药捆（蓝草原料） =====
    var herbX = 0.65, herbZ = 0.25, herbY = -0.92;
    for (var b = 0; b < 2; b++) {
      var hx = herbX + b * 0.18, hz = herbZ - b * 0.06;
      var herbBundle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.38, 12), matHerb);
      herbBundle.position.set(hx, herbY + 0.19, hz);
      herbBundle.rotation.z = (b === 0 ? 0.08 : -0.10);
      herbBundle.castShadow = true;
      g.add(herbBundle);

      // 麻绳捆扎带
      var ropeTie = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.009, 4, 16), matStraw);
      ropeTie.rotation.x = Math.PI / 2;
      ropeTie.position.set(hx, herbY + 0.20, hz);
      g.add(ropeTie);
    }

    g.position.y = 0.0;
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
     客家凉帽 —— 标志性镂空圆顶天窗 + 红寿字同心结 + 双层竹编帽檐 + 悬垂风琴百褶深靛蓝面帘
     ================================================================ */
  function buildLiangmao() {
    var g = new THREE.Group();
    var weave = canvasTex('bambooWeave', 3, 3);
    var cloth = canvasTex('hatCloth', 4, 1);
    var beltTex = canvasTex('wovenBelt', 1, 2.5);

    var matBamboo = new THREE.MeshStandardMaterial({
      map: weave, color: 0xE2C288, roughness: 0.82, side: THREE.DoubleSide
    });
    var matRim = new THREE.MeshStandardMaterial({ color: 0x8C5E28, roughness: 0.72 });
    var matCloth = new THREE.MeshStandardMaterial({
      map: cloth, color: 0x243E54, roughness: 0.90, side: THREE.DoubleSide
    });
    var matRibbon = new THREE.MeshStandardMaterial({ color: 0xB5241C, roughness: 0.65 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.35, metalness: 0.4 });
    var matBlackTrim = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.85, side: THREE.DoubleSide });
    var matTieBelt = new THREE.MeshStandardMaterial({
      map: beltTex, roughness: 0.8, side: THREE.DoubleSide
    });

    var R = 0.98;
    var crownR = 0.28;

    // ===== 1. 标志性镂空圆顶“开天窗”（通爽透气，露出客家盘发） =====
    // 镂空圆环边缘（竹青皮收口卷边圈）
    var crownRing = new THREE.Mesh(new THREE.TorusGeometry(crownR, 0.022, 8, 36), matRim);
    crownRing.rotation.x = Math.PI / 2;
    crownRing.position.y = 0.30;
    crownRing.castShadow = true;
    g.add(crownRing);

    // 天窗正中悬挂的红福寿同心结与红丝绒绸球
    var knot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 10), matRibbon);
    knot.position.y = 0.31;
    knot.castShadow = true;
    g.add(knot);
    var knotGold = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), matGold);
    knotGold.position.y = 0.34;
    g.add(knotGold);

    // 十字相交的大红绸缎压条（从同心结延伸至帽檐）
    for (var bi = 0; bi < 4; bi++) {
      var ba = (bi / 4) * Math.PI * 2;
      var bowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, crownR * 0.95), matRibbon);
      bowMesh.position.set(Math.sin(ba) * crownR * 0.48, 0.305, Math.cos(ba) * crownR * 0.48);
      bowMesh.rotation.y = ba;
      g.add(bowMesh);
    }

    // ===== 2. 精细竹篾浅锥形帽檐（从天窗斜向延伸至大外径） =====
    var brimGeo = new THREE.CylinderGeometry(crownR, R, 0.14, 56, 3, true);
    var bp = brimGeo.attributes.position;
    for (var bi = 0; bi < bp.count; bi++) {
      var bx = bp.getX(bi), by = bp.getY(bi), bz = bp.getZ(bi);
      var bang = Math.atan2(bz, bx);
      var br = Math.sqrt(bx * bx + bz * bz);
      // 微妙自然竹编起伏
      var bwave = Math.sin(bang * 28) * 0.004 * (br / R);
      bp.setX(bi, Math.cos(bang) * (br + bwave));
      bp.setZ(bi, Math.sin(bang) * (br + bwave));
    }
    brimGeo.computeVertexNormals();
    var brim = new THREE.Mesh(brimGeo, matBamboo);
    brim.position.y = 0.23;
    brim.castShadow = true;
    brim.receiveShadow = true;
    g.add(brim);

    // 帽檐外沿竹青皮双层压条加固圈
    var brimEdge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.026, 8, 56), matRim);
    brimEdge.rotation.x = Math.PI / 2;
    brimEdge.position.y = 0.16;
    brimEdge.castShadow = true;
    g.add(brimEdge);

    // ===== 3. 下垂高密度风琴折百褶深靛蓝面帘（围帘） =====
    var skirtH = 0.54;
    // 正面预留劳作视线微豁口（约 20 度）
    var skirtGeo = new THREE.CylinderGeometry(R * 0.99, R * 1.05, skirtH, 72, 8, true, 0.18, Math.PI * 2 - 0.36);
    var sp = skirtGeo.attributes.position;
    for (var si = 0; si < sp.count; si++) {
      var sx = sp.getX(si), sy = sp.getY(si), sz = sp.getZ(si);
      var sang = Math.atan2(sz, sx);
      var st = (skirtH / 2 - sy) / skirtH; // 0 at top, 1 at bottom
      // 风琴密集折褶（随垂落自然舒展蓬松）
      var pleat = Math.sin(sang * 32) * 0.028 * (0.35 + 0.65 * st);
      var sr = Math.sqrt(sx * sx + sz * sz) + pleat;
      sp.setX(si, Math.cos(sang) * sr);
      sp.setZ(si, Math.sin(sang) * sr);
      sp.setY(si, sy - Math.abs(pleat) * 0.25);
    }
    skirtGeo.computeVertexNormals();
    var skirt = new THREE.Mesh(skirtGeo, matCloth);
    skirt.position.y = 0.16 - skirtH / 2;
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    g.add(skirt);

    // 面帘底部黑缎边滚边
    var trimGeo = new THREE.CylinderGeometry(R * 1.05, R * 1.055, 0.035, 72, 1, true, 0.18, Math.PI * 2 - 0.36);
    var trimMesh = new THREE.Mesh(trimGeo, matBlackTrim);
    trimMesh.position.y = 0.16 - skirtH + 0.017;
    g.add(trimMesh);

    // ===== 4. 客家挑花编织系带与流苏 =====
    [-0.26, 0.26].forEach(function (tx, idx) {
      var strapCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(tx, 0.16, 0.10),
        new THREE.Vector3(tx * 0.8, -0.10, 0.18),
        new THREE.Vector3(tx * 0.3, -0.32, 0.22),
        new THREE.Vector3(0, -0.38, 0.24)
      ]);
      var strap = new THREE.Mesh(new THREE.TubeGeometry(strapCurve, 12, 0.010, 4, false), matTieBelt);
      g.add(strap);
    });
    // 下颌系结与小垂苏
    var tieKnot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), matRibbon);
    tieKnot.position.set(0, -0.38, 0.24);
    g.add(tieKnot);
    var tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.002, 0.14, 6), matRibbon);
    tassel.position.set(0, -0.46, 0.24);
    g.add(tassel);

    g.position.y = 0.22;
    return g;
  }

  /* ================================================================
     竹编簸箕 —— 龙南杨村精细竹编 + 人字斜纹微凹底 + 双层卷边 + 晚稻谷粒 + 竹编笊篱
     ================================================================ */
  function buildBoji() {
    var g = new THREE.Group();
    var weave = canvasTex('bambooWeave', 4, 4);

    var matWeave = new THREE.MeshStandardMaterial({
      map: weave, color: 0xDDB87B, roughness: 0.82, side: THREE.DoubleSide
    });
    var matRim = new THREE.MeshStandardMaterial({ color: 0x94642C, roughness: 0.72 });
    var matUnderBone = new THREE.MeshStandardMaterial({ color: 0x6E451C, roughness: 0.85 });
    var matGrain = new THREE.MeshStandardMaterial({ color: 0xE0B246, roughness: 0.55 });
    var matTool = new THREE.MeshStandardMaterial({ color: 0xB58E52, roughness: 0.65 });

    var R = 1.02;

    // ===== 1. 抛物线微凹圆底盘 =====
    var baseGeo = new THREE.CircleGeometry(R * 0.94, 48, 6);
    var bp = baseGeo.attributes.position;
    for (var bi = 0; bi < bp.count; bi++) {
      var bx = bp.getX(bi), by = bp.getY(bi);
      var br = Math.sqrt(bx * bx + by * by);
      // 自然向下微凹弧度
      var sag = (1 - (br / (R * 0.94)) * (br / (R * 0.94))) * 0.055;
      bp.setZ(bi, -sag);
    }
    baseGeo.computeVertexNormals();
    var base = new THREE.Mesh(baseGeo, matWeave);
    base.rotation.x = -Math.PI / 2;
    base.receiveShadow = true;
    g.add(base);

    // ===== 2. 侧壁斜纹斜向敞口 =====
    var wallH = 0.22;
    var wallGeo = new THREE.CylinderGeometry(R, R * 0.94, wallH, 56, 4, true);
    var wp = wallGeo.attributes.position;
    for (var wi = 0; wi < wp.count; wi++) {
      var wx = wp.getX(wi), wy = wp.getY(wi), wz = wp.getZ(wi);
      var wang = Math.atan2(wz, wx);
      var wr = Math.sqrt(wx * wx + wz * wz);
      var wt = (wy + wallH / 2) / wallH;
      var ripple = Math.sin(wang * 36) * 0.005 * wt;
      wp.setX(wi, Math.cos(wang) * (wr + ripple));
      wp.setZ(wi, Math.sin(wang) * (wr + ripple));
    }
    wallGeo.computeVertexNormals();
    var wall = new THREE.Mesh(wallGeo, matWeave);
    wall.position.y = wallH / 2 - 0.02;
    wall.castShadow = true;
    wall.receiveShadow = true;
    g.add(wall);

    // ===== 3. 竹青皮厚密卷边圈口 =====
    var rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.032, 10, 56), matRim);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = wallH - 0.02;
    rim.castShadow = true;
    g.add(rim);
    // 卷边内侧紧箍竹条
    var innerRim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.015, 0.014, 6, 48), matUnderBone);
    innerRim.rotation.x = Math.PI / 2;
    innerRim.position.y = wallH - 0.03;
    g.add(innerRim);

    // ===== 4. 底部双十字拱形加固厚篾骨与老竹三足 =====
    [-1, 1].forEach(function (dir) {
      var rib = new THREE.Mesh(new THREE.BoxGeometry(R * 1.82, 0.022, 0.035), matUnderBone);
      rib.position.y = -0.06;
      if (dir === 1) rib.rotation.y = Math.PI / 2;
      g.add(rib);
    });

    for (var f = 0; f < 3; f++) {
      var fa = (f / 3) * Math.PI * 2 + 0.35;
      var foot = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.12, 10), matUnderBone);
      foot.position.set(Math.cos(fa) * R * 0.65, -0.08, Math.sin(fa) * R * 0.65);
      foot.castShadow = true;
      g.add(foot);
    }

    // ===== 5. 簸箕内饱满的客家金黄晚稻谷粒堆 =====
    var grainCount = 140;
    var grainMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.020, 6, 5), matGrain, grainCount);
    var mat4 = new THREE.Matrix4();
    for (var gi = 0; gi < grainCount; gi++) {
      var dist = Math.pow(Math.random(), 0.65) * (R * 0.72);
      var ga = Math.random() * Math.PI * 2;
      var gy = -0.02 + Math.max(0, (1 - dist / (R * 0.72))) * 0.08 + Math.random() * 0.02;
      mat4.makeScale(1.4, 0.6, 0.8);
      mat4.setPosition(Math.cos(ga) * dist, gy, Math.sin(ga) * dist);
      grainMesh.setMatrixAt(gi, mat4);
    }
    grainMesh.instanceMatrix.needsUpdate = true;
    grainMesh.castShadow = true;
    g.add(grainMesh);

    // ===== 6. 斜搭其上的客家精细竹编长柄笊篱（漏勺） =====
    var ladleGroup = new THREE.Group();
    // 笊篱碗状密网漏斗
    var scoop = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      matWeave
    );
    scoop.rotation.x = Math.PI;
    scoop.scale.set(1.0, 0.45, 1.0);
    ladleGroup.add(scoop);
    var scoopRim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.012, 6, 24), matRim);
    scoopRim.rotation.x = Math.PI / 2;
    ladleGroup.add(scoopRim);

    // 长竹柄
    var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.85, 8), matTool);
    handle.position.set(0, 0, -0.42);
    handle.rotation.x = Math.PI / 2;
    ladleGroup.add(handle);

    ladleGroup.position.set(0.20, 0.14, 0.10);
    ladleGroup.rotation.x = 0.22;
    ladleGroup.rotation.y = -0.65;
    ladleGroup.rotation.z = -0.15;
    g.add(ladleGroup);

    g.position.y = 0.06;
    return g;
  }

  /* ================================================================
     客家织带 —— 传统挑花木带架 + 经线卷轴 + 悬垂彩织带 + 编结流苏 + 织刀木梭 + 线篓
     ================================================================ */
  function buildZhidai() {
    var g = new THREE.Group();
    var beltTex = canvasTex('wovenBelt', 1, 2.2);

    // 材质
    var matWood = new THREE.MeshStandardMaterial({ color: 0x543B22, roughness: 0.72 });
    var matDarkWood = new THREE.MeshStandardMaterial({ color: 0x362210, roughness: 0.78 });
    var matBamboo = new THREE.MeshStandardMaterial({ color: 0xC89E58, roughness: 0.65 });
    var matRedSilk = new THREE.MeshStandardMaterial({ color: 0xB82424, roughness: 0.55 });
    var matIndigoSilk = new THREE.MeshStandardMaterial({ color: 0x1E3B5C, roughness: 0.6 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.35, metalness: 0.4 });
    var matBone = new THREE.MeshStandardMaterial({ color: 0xF5EFE1, roughness: 0.85 });

    var beltMat = new THREE.MeshStandardMaterial({
      map: beltTex, color: 0xffffff, roughness: 0.78, side: THREE.DoubleSide
    });

    var standH = 1.05;

    // ----- 1. 客家传统榫卯木带架基座 -----
    var base = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 0.48), matWood);
    base.position.set(0, 0.025, 0);
    base.receiveShadow = true;
    g.add(base);

    // 四角承重垫足
    [[-0.56, -0.18], [0.56, -0.18], [-0.56, 0.18], [0.56, 0.18]].forEach(function (pos) {
      var foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.08), matDarkWood);
      foot.position.set(pos[0], 0.01, pos[1]);
      g.add(foot);
    });

    // 双侧立柱（方转圆立柱 + 榫头加固木）
    [-0.50, 0.50].forEach(function (x) {
      var postShoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.20), matDarkWood);
      postShoe.position.set(x, 0.06, 0);
      g.add(postShoe);

      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.035, standH, 12), matWood);
      post.position.set(x, standH / 2 + 0.04, 0);
      post.castShadow = true;
      g.add(post);

      // 柱顶雕花宝珠木顶（绠瓠子意象柱头）
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), matDarkWood);
      cap.position.set(x, standH + 0.05, 0);
      g.add(cap);

      var finial = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 8), matWood);
      finial.position.set(x, standH + 0.09, 0);
      g.add(finial);
    });

    // 下横撑木档
    var lowerBar = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.032, 0.032), matWood);
    lowerBar.position.set(0, 0.18, 0);
    g.add(lowerBar);

    // 后张力木轴
    var rearRoller = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.04, 12), matWood);
    rearRoller.rotation.z = Math.PI / 2;
    rearRoller.position.set(0, 0.52, -0.14);
    g.add(rearRoller);

    // 后侧张力木斜撑
    [-0.50, 0.50].forEach(function (x) {
      var strutCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, 0.06, 0.07),
        new THREE.Vector3(x, 0.28, -0.05),
        new THREE.Vector3(x, 0.52, -0.14)
      ]);
      var strut = new THREE.Mesh(new THREE.TubeGeometry(strutCurve, 8, 0.015, 6, false), matDarkWood);
      g.add(strut);
    });

    // 织架上主横梁（光滑挑花织梁）
    var mainBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.14, 16), matWood);
    mainBeam.rotation.z = Math.PI / 2;
    mainBeam.position.set(0, standH, 0);
    mainBeam.castShadow = true;
    g.add(mainBeam);

    // 梁端限位木挡盘与木销
    [-0.55, 0.55].forEach(function (x) {
      var flange = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.024, 14), matDarkWood);
      flange.rotation.z = Math.PI / 2;
      flange.position.set(x, standH, 0);
      g.add(flange);
      var peg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.10, 8), matBamboo);
      peg.position.set(x, standH, 0);
      g.add(peg);
    });

    // 后轴盘绕的彩织带卷（未织完的经线带轴）
    var beltRoll = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.28, 24),
      new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.82 })
    );
    beltRoll.rotation.z = Math.PI / 2;
    beltRoll.position.set(-0.14, 0.52, -0.14);
    g.add(beltRoll);

    // 架线工序：后轴至主梁的张紧五彩经线束阵列
    var warpCount = 16;
    for (var wi = 0; wi < warpCount; wi++) {
      var wx = -0.22 + wi * (0.44 / (warpCount - 1));
      var wCurve = new THREE.LineCurve3(
        new THREE.Vector3(wx, 0.52, -0.14),
        new THREE.Vector3(wx, standH, 0)
      );
      var wMat = (wi % 3 === 0) ? matRedSilk : (wi % 3 === 1 ? matIndigoSilk : matBone);
      var wThread = new THREE.Mesh(new THREE.TubeGeometry(wCurve, 4, 0.002, 3, false), wMat);
      g.add(wThread);
    }

    // ----- 2. 真实立体悬垂客家织带 -----
    function makeHangingBelt(xCenter, length, zOffset, sway) {
      var w = 0.21;
      var segsY = 32, segsX = 6;
      var geo = new THREE.PlaneGeometry(w, length, segsX, segsY);
      var pos = geo.attributes.position;

      for (var i = 0; i < pos.count; i++) {
        var px = pos.getX(i);
        var py = pos.getY(i);
        var t = 1 - (py + length / 2) / length;

        var pz = 0;
        if (t < 0.12) {
          var arc = t / 0.12 * Math.PI * 0.5;
          pz = Math.sin(arc) * 0.035;
        } else {
          pz = 0.035 + Math.sin(t * 3.6 + sway) * 0.032 * t + Math.cos(px * 12) * 0.007;
        }
        var rotTwist = Math.sin(t * 2.6 + sway) * 0.05 * t;
        pos.setX(i, px * (1 - 0.04 * t) + rotTwist * 0.35);
        pos.setY(i, py);
        pos.setZ(i, pz);
      }
      geo.computeVertexNormals();

      var mesh = new THREE.Mesh(geo, beltMat);
      mesh.position.set(xCenter, standH - length / 2, zOffset);
      mesh.castShadow = true;
      g.add(mesh);

      // 织带侧边滚边包线（增强立体厚度感）
      [-1, 1].forEach(function (side) {
        var edgeCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(xCenter + side * w * 0.49, standH, zOffset),
          new THREE.Vector3(xCenter + side * w * 0.485, standH - length * 0.35, zOffset + 0.025),
          new THREE.Vector3(xCenter + side * w * 0.48, standH - length * 0.70, zOffset + 0.035),
          new THREE.Vector3(xCenter + side * w * 0.47, standH - length, zOffset + 0.04)
        ]);
        var edgeRib = new THREE.Mesh(new THREE.TubeGeometry(edgeCurve, 16, 0.004, 4, false), matRedSilk);
        g.add(edgeRib);
      });

      // 织带末端：平结编结横档与流苏
      var knotY = standH - length;
      var knotBar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 0.022, 0.018), matDarkWood);
      knotBar.position.set(xCenter, knotY, zOffset + 0.04);
      g.add(knotBar);

      // 客家同心编结扣
      var knotRing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 6, 16), matRedSilk);
      knotRing.position.set(xCenter, knotY - 0.018, zOffset + 0.045);
      g.add(knotRing);

      // 多层渐变手工流苏丝穗（双色穿插）
      var tasselCount = 11;
      for (var f = 0; f < tasselCount; f++) {
        var fx = (f - (tasselCount - 1) / 2) * (w * 0.80 / tasselCount);
        var fMat = (f % 2 === 0) ? matBone : matRedSilk;
        var fLen = 0.14 + (1 - Math.abs(fx) / (w * 0.5)) * 0.035;
        var tassel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0035, 0.002, fLen, 5),
          fMat
        );
        tassel.position.set(xCenter + fx, knotY - 0.018 - fLen / 2, zOffset + 0.045);
        tassel.rotation.z = fx * 0.35;
        tassel.rotation.x = 0.05;
        g.add(tassel);
      }
    }

    makeHangingBelt(-0.20, 0.74, 0.03, 0.2);
    makeHangingBelt(0.20, 0.70, 0.03, 1.4);

    // ----- 3. 客家传统手工艺具道具 -----
    // 客家竹带尺 / 打纬刀
    var beater = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.012, 0.036), matBamboo);
    beater.position.set(-0.28, 0.06, 0.13);
    beater.rotation.y = 0.35;
    beater.rotation.z = 0.02;
    beater.castShadow = true;
    g.add(beater);

    // 刻花木梭子
    var shuttleBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.004, 0.24, 10),
      matDarkWood
    );
    shuttleBody.rotation.z = Math.PI / 2;
    shuttleBody.scale.set(1, 1, 0.5);
    shuttleBody.position.set(0.18, 0.065, 0.14);
    shuttleBody.rotation.y = -0.22;
    shuttleBody.castShadow = true;
    g.add(shuttleBody);

    // 梭子中心的挑花红丝线
    var shuttleSilk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.017, 0.11, 12),
      matRedSilk
    );
    shuttleSilk.rotation.z = Math.PI / 2;
    shuttleSilk.position.set(0.18, 0.065, 0.14);
    shuttleSilk.rotation.y = -0.22;
    g.add(shuttleSilk);

    // 竹编线篓与丝线团
    var basketGeo = new THREE.CylinderGeometry(0.06, 0.048, 0.06, 16, 1, true);
    var basket = new THREE.Mesh(basketGeo, matBamboo);
    basket.position.set(0.46, 0.075, 0.11);
    basket.castShadow = true;
    g.add(basket);

    var ball1 = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), matRedSilk);
    ball1.position.set(0.45, 0.085, 0.10);
    g.add(ball1);
    var ball2 = new THREE.Mesh(new THREE.SphereGeometry(0.020, 10, 8), matIndigoSilk);
    ball2.position.set(0.47, 0.08, 0.125);
    g.add(ball2);
    var ball3 = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), matBone);
    ball3.position.set(0.44, 0.09, 0.12);
    g.add(ball3);

    g.position.y = -0.38;
    return g;
  }

  /* ================================================================
     米酒坛 —— 龙南酱釉老陶坛 + 荷叶边红纸扎绳封口 + 酒盏澄澈冬酒 + 竹酒吊子
     ================================================================ */
  function buildMijiutan() {
    var g = new THREE.Group();
    var glaze = canvasTex('glazeJar', 3, 1);

    var matGlaze = new THREE.MeshStandardMaterial({
      map: glaze, color: 0xB57640, roughness: 0.38, metalness: 0.08
    });
    var matClay = new THREE.MeshStandardMaterial({ color: 0x4E301E, roughness: 0.9 });
    var matPaper = new THREE.MeshStandardMaterial({ color: 0xB5241C, roughness: 0.75 });
    var matRope = new THREE.MeshStandardMaterial({ color: 0x5C462C, roughness: 0.92 });
    var matTag = new THREE.MeshStandardMaterial({ color: 0x8C3827, roughness: 0.65 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.35, metalness: 0.4 });
    var matCup = new THREE.MeshStandardMaterial({ color: 0xE8E2D2, roughness: 0.45, side: THREE.DoubleSide });
    var matWine = new THREE.MeshStandardMaterial({ color: 0xDDA032, roughness: 0.12, metalness: 0.18 });
    var matBamboo = new THREE.MeshStandardMaterial({ color: 0xBA9050, roughness: 0.65 });

    // ===== 1. 坛身轮廓（丰肩、圆鼓腹、平底微凹小敛口） =====
    var profile = [
      [0.00, 0.00], [0.30, 0.00], [0.33, 0.035], [0.38, 0.12],
      [0.46, 0.28], [0.52, 0.48], [0.51, 0.68], [0.44, 0.84],
      [0.34, 0.96], [0.28, 1.02], [0.27, 1.07], [0.30, 1.11], [0.28, 1.14]
    ].map(function (v) { return new THREE.Vector2(v[0], v[1]); });

    var body = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 56),
      matGlaze
    );
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // 坛底胎土微露圈足
    var footRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.30, 0.015, 6, 40),
      matClay
    );
    footRing.rotation.x = Math.PI / 2;
    footRing.position.y = 0.015;
    g.add(footRing);

    // 肩部双圈凸弦纹
    [0.64, 0.72].forEach(function (y, idx) {
      var ringR = idx === 0 ? 0.495 : 0.44;
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(ringR, 0.012, 6, 48),
        matClay
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
    });

    // 腹部模印“冬酒”凸雕印章
    var seal = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.015, 24), matClay);
    seal.rotation.x = Math.PI / 2;
    seal.position.set(0, 0.58, 0.515);
    g.add(seal);
    var sealInner = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 16), matGlaze);
    sealInner.rotation.x = Math.PI / 2;
    sealInner.position.set(0, 0.58, 0.52);
    g.add(sealInner);

    // ===== 2. 厚棉红纸泥头封口与自然抓褶荷叶裙边 =====
    // 顶部隆起泥头纸帽
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2.3),
      matPaper
    );
    dome.position.y = 1.19;
    dome.scale.set(1.0, 0.65, 1.0);
    dome.castShadow = true;
    g.add(dome);

    // 坛颈下垂的抓褶荷叶裙纸边
    var skirtH = 0.18;
    var skirtGeo = new THREE.CylinderGeometry(0.29, 0.35, skirtH, 48, 4, true);
    var skP = skirtGeo.attributes.position;
    for (var ki = 0; ki < skP.count; ki++) {
      var kx = skP.getX(ki), ky = skP.getY(ki), kz = skP.getZ(ki);
      var kang = Math.atan2(kz, kx);
      var kt = (skirtH / 2 - ky) / skirtH; // 1 at bottom
      var wave = Math.sin(kang * 18) * 0.025 * kt;
      var kr = Math.sqrt(kx * kx + kz * kz) + wave;
      skP.setX(ki, Math.cos(kang) * kr);
      skP.setZ(ki, Math.sin(kang) * kr);
    }
    skirtGeo.computeVertexNormals();
    var paperSkirt = new THREE.Mesh(skirtGeo, matPaper);
    paperSkirt.position.y = 1.08;
    g.add(paperSkirt);

    // 粗麻绳环绕捆扎（缠绕三圈）
    for (var rpi = 0; rpi < 3; rpi++) {
      var cord = new THREE.Mesh(
        new THREE.TorusGeometry(0.295 + rpi * 0.005, 0.011, 6, 36),
        matRope
      );
      cord.rotation.x = Math.PI / 2;
      cord.position.y = 1.135 - rpi * 0.016;
      g.add(cord);
    }

    // 正面麻绳十字交叉扎结
    var knot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), matRope);
    knot.position.set(0, 1.12, 0.305);
    g.add(knot);

    // 绳头下垂与木质“客家冬酒”酒签挂牌
    var tagCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.12, 0.305),
      new THREE.Vector3(0.02, 1.04, 0.315),
      new THREE.Vector3(0, 0.94, 0.325)
    ]);
    var tagCord = new THREE.Mesh(new THREE.TubeGeometry(tagCurve, 8, 0.005, 4, false), matRope);
    g.add(tagCord);

    var wineTag = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.12, 0.012), matTag);
    wineTag.position.set(0, 0.89, 0.33);
    wineTag.rotation.z = -0.08;
    g.add(wineTag);
    var tagGoldMark = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.08, 0.014), matGold);
    tagGoldMark.position.set(0, 0.89, 0.33);
    tagGoldMark.rotation.z = -0.08;
    g.add(tagGoldMark);

    // ===== 3. 坛前葵口青白釉客家酒盏与澄澈冬酒 =====
    var cupProfile = [
      [0.00, 0.00], [0.09, 0.00], [0.11, 0.018], [0.15, 0.065],
      [0.17, 0.095], [0.165, 0.10], [0.14, 0.06]
    ].map(function (v) { return new THREE.Vector2(v[0], v[1]); });
    var cup = new THREE.Mesh(
      new THREE.LatheGeometry(cupProfile, 32),
      matCup
    );
    cup.position.set(0.60, 0.0, 0.38);
    cup.castShadow = true;
    cup.receiveShadow = true;
    g.add(cup);

    // 酒盏内澄黄透亮的客家冬酒米酒
    var wineSurface = new THREE.Mesh(
      new THREE.CircleGeometry(0.142, 28),
      matWine
    );
    wineSurface.rotation.x = -Math.PI / 2;
    wineSurface.position.set(0.60, 0.072, 0.38);
    g.add(wineSurface);

    // ===== 4. 斜倚长柄天然青竹酒吊子（量酒竹筒） =====
    var ladleGroup = new THREE.Group();
    // 舀酒竹节筒
    var ladleCylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.040, 0.14, 16),
      matBamboo
    );
    ladleCylinder.position.set(0, 0.07, 0);
    ladleGroup.add(ladleCylinder);

    // 竹筒内酒液
    var innerWine = new THREE.Mesh(new THREE.CircleGeometry(0.038, 12), matWine);
    innerWine.rotation.x = -Math.PI / 2;
    innerWine.position.set(0, 0.138, 0);
    ladleGroup.add(innerWine);

    // 细长挑酒竹柄
    var ladleHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.010, 0.72, 8),
      matBamboo
    );
    ladleHandle.position.set(0, 0.44, 0);
    ladleGroup.add(ladleHandle);

    ladleGroup.position.set(-0.35, 0.0, 0.45);
    ladleGroup.rotation.z = 0.38;
    ladleGroup.rotation.y = -0.25;
    g.add(ladleGroup);

    g.position.y = -0.45;
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
