/**
 * 3D 非遗器物展示模块 v2 — 精细重构版
 * 虎头帽（黑底刺绣）/ 客家围屋（方形堡垒）/ 蓝染布（水墨晕染）
 */
(function () {
  'use strict';

  var THREE = null;
  var currentModel = null;
  var renderer, scene, camera, animationId, viewportContainer, resizeObserver;
  var isDragging = false, dragMode = 'rotate', prevMouse = { x: 0, y: 0 };
  var rotX = 0.25, rotY = 0.4, targetRotX = 0.25, targetRotY = 0.4;
  var zoom = 4.5, targetZoom = 4.5, cameraFocusY = 0.15;
  var panX = 0, panY = 0, targetPanX = 0, targetPanY = 0;
  var autoRotate = true, idleTimer = null, textures = {}, generatedTextures = [];
  var touchMode = null, pinchDist = 0, pinchMidX = 0, pinchMidY = 0;
  // 每个模型的竖直范围只跟几何有关，量一次就够：切换时重复遍历会把一帧堵死
  var SEAT_CACHE = {};
  // 每件模型按实测差值坐到场景地面上（trueMinY 原本高出 -1.15 多少就往下补多少）。
  // 各件自定的 position.y 是历史遗留：簸箕 +0.12 让它悬空 1.15，虎头帽悬空 1.05，
  // 凉帽 0.95，米酒坛 0.57，蓝染的染缸几乎埋进地里。模型不再整体前倾之后这些全暴露出来。
  // 焦点同步下移同样的量，取景关系与逐项调好的距离保持不变。
  var SEAT_ADJUST = {hutoumao: -1.047, weiwu: 0, landye: -1.146, liangmao: -0.919, boji: -1.150, zhidai: -0.319, mijiutan: -0.537};
  var FOCUS_BASE = {weiwu: -0.10, zhidai: -0.17};
  // 引擎 603KB + 贴图约 13MB 只在观众真的点开 3D 时才拉，见 init()/boot() 的分工
  var booted = false, booting = null, pendingShow = null;

  var ITEMS = [
    { id: 'hutoumao', name: '虎头帽', subtitle: '定南客家童帽', icon: '\u{1F42F}', zoom: 4.2,
      desc: '黑底多层棉布基底，以红、黄、蓝、白、绿真丝线手工刺绣。前幅覆盖夸张虎头纹样，带立体凸起的刺绣眼睛、鼻子、眉毛和胡须，对称结构，两侧护耳，后方小披风，边缘饰有穗子和花边。' },
    { id: 'weiwu', name: '客家围屋', subtitle: '龙南关西新围', icon: '\u{1F3EF}', zoom: 8.2,
      desc: '依据关西新围公开形制资料构建的长方形围合示意：三层围墙、夯土与青砖层次、双门、四角炮楼、三进院落和中轴祠堂。模型用于呈现空间关系，并非文物测绘复原。' },
    { id: 'landye', name: '蓝染布', subtitle: '客家草木染', icon: '\u{1F9F5}', zoom: 4.8,
      desc: '折叠的分层布料，深邃靛蓝色带白色防染图案，含植物纹样与几何纹样。粗糙手工棉麻材质，天然板蓝根染料呈现从出缸绿到氧化蓝的水墨晕染渐变效果。' },
    { id: 'liangmao', name: '客家凉帽', subtitle: '宁龙片妇女首服', icon: '\u{1F3A9}', zoom: 3.4,
      desc: '竹篾编成扁平帽檐，顶覆蓝布，檐缘垂一圈靛蓝褶布遮面遮阳，是龙南及赣南客家妇女田间劳作的标志性首服，与蓝染、竹编两项技艺直接相关。' },
    { id: 'boji', name: '竹编簸箕', subtitle: '客家农具', icon: '\u{1F9FA}', zoom: 2.7,
      desc: '浅口圆形竹编器，篾片一压一挑编成，圈口缠竹皮收边，底设三足。用于扬去谷物糠秕、晾晒米果与茶叶，是龙南客家日常最具代表性的竹编活计。' },
    { id: 'zhidai', name: '客家织带', subtitle: '冬头帕护额织带', icon: '\u{1F9F3}', zoom: 3.15,
      desc: '冬头帕前方垂下的两根手织丝带：白色经线居中，红、蓝、绿、黑线分层排布；经纬交织出菱格祝福纹，带身柔软起伏，尾端拧线打结并留丝穗。' },
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
          if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
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

    // ---- 前幅虎头刺绣：投影到帽体球面上的圆形绣片 ----
    // 原来是一块 PlaneGeometry 微微鼓一下、摆在 z=0.8：方形直角露在圆帽轮廓之外，
    // 近看像贴了张广告牌。改成把圆盘逐点投到半径与帽体一致的球面上，绣片随帽面弯。
    if (textures.tigerEmb) {
      var R = 1.014, thC = 0.96, span = 0.62, spanY = 0.54;
      var faceGeo = new THREE.CircleGeometry(0.5, 46);
      var fp = faceGeo.attributes.position;
      for (var fi = 0; fi < fp.count; fi++) {
        var ang = (fp.getX(fi) / 0.5) * span;            // 绕竖直轴
        var pol = thC - (fp.getY(fi) / 0.5) * spanY;     // 与顶点的极角
        fp.setXYZ(fi, R * Math.sin(pol) * Math.sin(ang), R * Math.cos(pol), R * Math.sin(pol) * Math.cos(ang));
      }
      faceGeo.computeVertexNormals();
      var faceMesh = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({
        map: textures.tigerEmb, roughness: 0.55, metalness: 0.03, side: THREE.DoubleSide
      }));
      faceMesh.position.y = 0.1;
      faceMesh.castShadow = true;
      g.add(faceMesh);
      // 绣片外圈压一道金线，圆边的收口看得见
      var ringPts = [];
      for (var ri = 0; ri <= 64; ri++) {
        var ra = (ri / 64) * Math.PI * 2;   // 与绣片同一套映射，走这片圆盘自己的边
        var rang = span * Math.cos(ra), rpol = thC - spanY * Math.sin(ra);
        ringPts.push(new THREE.Vector3(R * Math.sin(rpol) * Math.sin(rang), 0.1 + R * Math.cos(rpol), R * Math.sin(rpol) * Math.cos(rang)));
      }
      var faceRing = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts), 72, 0.022, 6, true), matGold);
      faceRing.name = 'embroidery_gold_border';
      g.add(faceRing);
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
  function buildWeiwu() { return buildGuanxiWeiwu(); }

  // 关西新围：长方形国字围合，三层主体、三进院落、中央祠堂及四角炮楼。
  // 重复瓦片、枪眼、窗格使用 InstancedMesh，避免按细节数量增加 draw call。
  function buildGuanxiWeiwu() {
    var g = new THREE.Group();
    g.name = 'GuanxiXinwei';
    var brickTex=canvasTex('qingBrick',3,2);
    // 瓦与夯土改走程序化贴图：那两张 PNG 本身偏黑，color × map 只会更黑，
    // 上一版整片屋顶糊成炭黑、天井和厅堂全被吃掉就是这个问题。
    var roofTex=canvasTex('qingwaRoof',4,4);
    var roofTexFine=canvasTex('qingwaRoof',1,2);
    var loamTex=canvasTex('rammedLoam',2,1);
    var earth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, map: loamTex });
    var brick = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: brickTex });
    var stone = new THREE.MeshStandardMaterial({ color: 0x8b877c, roughness: 0.92, map: textures.stonePaving || null });
    var tile = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: roofTex });
    var tileAlt = new THREE.MeshStandardMaterial({ color: 0xc3c9cb, roughness: 0.9, map: roofTexFine });
    var timber = new THREE.MeshStandardMaterial({ color: 0x4d3220, roughness: 0.82 });
    var doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2518, roughness: 0.84 });
    var shadowMat = new THREE.MeshBasicMaterial({ color: 0x241f1b });
    var mortar = new THREE.MeshStandardMaterial({ color: 0xc4bba4, roughness: 0.96 });
    var lime = new THREE.MeshStandardMaterial({ color: 0xd9d3c3, roughness: 0.94 });
    var pebbleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, map: canvasTex('cobbleCourt',4,1) });
    var courtMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, map: canvasTex('cobbleCourt',2,1) });
    // 水面不用低 roughness：没有环境贴图时镜面会把池子渲染成一个黑洞
    var waterMat = new THREE.MeshStandardMaterial({ color: 0xa8c4bf, roughness: 0.45, map: canvasTex('pondWater',2,2) });
    // 收分棱台是不闭合的棱柱，法线朝向靠双面兜住；克隆出来只给墙用，不污染共享材质。
    var earthWall = earth.clone(); earthWall.side = THREE.DoubleSide;
    var brickWall = brick.clone(); brickWall.side = THREE.DoubleSide;
    var tileFace = tile.clone(); tileFace.side = THREE.DoubleSide;
    var gableMat = brick.clone(); gableMat.side = THREE.DoubleSide;
    var W = 3.5, D = 2.6, y0 = 0.18, floorH = 0.54;

    function box(name, w, h, d, mat, x, y, z, cast) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.name = name; m.position.set(x, y, z); m.castShadow = cast !== false; m.receiveShadow = true; g.add(m); return m;
    }
    function inst(name, geo, mat, mats) {
      var im = new THREE.InstancedMesh(geo, mat, mats.length); im.name = name;
      var o = new THREE.Object3D();
      mats.forEach(function (m, i) {
        o.position.set(m[0], m[1], m[2]);
        o.rotation.set(m[3] || 0, m[4] || 0, m[5] || 0);
        o.scale.set(m[6] == null ? 1 : m[6], m[7] == null ? 1 : m[7], m[8] == null ? 1 : m[8]);
        o.updateMatrix(); im.setMatrixAt(i, o.matrix);
      });
      im.count = mats.length; im.instanceMatrix.needsUpdate = true;
      im.castShadow = true; im.receiveShadow = true; g.add(im); return im;
    }
    // 收分棱台：底面比顶面宽，一次成型。围墙与炮楼都靠它，等宽方盒一眼就是塑料玩具。
    function prism(name, x, z, wB, wT, dB, dT, h, mat, yBase) {
      var hb = wB / 2, ht = wT / 2, db = dB / 2, dt = dT / 2, y = yBase == null ? y0 : yBase;
      var faces = [
        [-hb, 0, -db, hb, 0, -db, ht, h, -dt, -ht, h, -dt],
        [hb, 0, db, -hb, 0, db, -ht, h, dt, ht, h, dt],
        [hb, 0, -db, hb, 0, db, ht, h, dt, ht, h, -dt],
        [-hb, 0, db, -hb, 0, -db, -ht, h, -dt, -ht, h, dt],
        [-ht, h, -dt, ht, h, -dt, ht, h, dt, -ht, h, dt]
      ];
      var pos = [], uv = [], idx = [];
      faces.forEach(function (f, fi) {
        var base = pos.length / 3;
        for (var i = 0; i < 4; i++) {
          var vx = f[i * 3], vy = f[i * 3 + 1], vz = f[i * 3 + 2];
          pos.push(vx, vy + y, vz);
          if (fi === 4) { uv.push((vx + hb) / wB, (vz + db) / dB); }
          else if (fi < 2) { uv.push((vx + hb) / wB * 3, vy / h * 2); }
          else { uv.push((vz + db) / dB * 3, vy / h * 2); }
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      var m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(x, 0, z);
      m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
    }
    function wall(name, x, z, length, thick, floors, axis, material) {
      var h = floors * floorH, core = material || earthWall;
      // 收分只作用于墙厚，长度不变：底 2.0 → 中 1.5 → 顶 1.0（实地"底厚2米、顶厚1米"）
      var t0 = thick * 2.0, t1 = thick * 1.5, t2 = thick * 1.0;
      if (axis === 'x') {
        prism(name + '_earth_core', x, z, length, length, t0, t1, h * 0.32, core, y0);
        prism(name + '_brick_story', x, z, length, length * 0.995, t1, t2, h * 0.68, brickWall, y0 + h * 0.32);
        box(name + '_stone_belt', length + 0.04, 0.05, thick * 1.6, mortar, x, y0 + h * 0.32, z, false);
      } else {
        prism(name + '_earth_core', x, z, t0, t1, length, length, h * 0.32, core, y0);
        prism(name + '_brick_story', x, z, t1, t2, length, length * 0.995, h * 0.68, brickWall, y0 + h * 0.32);
        box(name + '_stone_belt', thick * 1.6, 0.05, length + 0.04, mortar, x, y0 + h * 0.32, z, false);
      }
      return { x: x, z: z, length: length, thick: thick, top: y0 + h };
    }
    function roof(name, x, z, w, d, y, rise, orn) {
      // 长向脊线双坡屋顶：两片闭合瓦面、前后封檐板及山墙三角，避免纸片式开口屋面。
      var e=.12, ex=w/2+e, ez=d/2+e, ridgeY=y+rise, ridgeHalf=w*.42;
      var pts=[
        [x-ex,y,z-ez, x+ex,y,z-ez, x+ridgeHalf,ridgeY,z], [x-ex,y,z-ez, x+ridgeHalf,ridgeY,z, x-ridgeHalf,ridgeY,z],
        [x+ex,y,z+ez, x-ex,y,z+ez, x-ridgeHalf,ridgeY,z], [x+ex,y,z+ez, x-ridgeHalf,ridgeY,z, x+ridgeHalf,ridgeY,z]
      ];
      var arr=[], roofUv=[]; pts.forEach(function(a){ for(var i=0;i<9;i+=3){arr.push(a[i],a[i+1],a[i+2]);roofUv.push((a[i]-(x-ex))/(2*ex), (a[i+1]-y)/rise); } });
      var geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(roofUv,2)); geo.computeVertexNormals();
      var r=new THREE.Mesh(geo,tileFace); r.name=name+'_closed_double_pitch_tile_roof'; r.castShadow=true; g.add(r);
      // 前后檐口木枋压在瓦口之下，不再伸出山墙之外
      [-1,1].forEach(function(s){box(name+'_timber_eave_'+s,w,.04,.045,timber,x,y-.03,z+s*(ez-.02),false);});
      var ridge=new THREE.Mesh(new THREE.CylinderGeometry(.026,.026,w*.86,10),lime); ridge.rotation.z=Math.PI/2; ridge.position.set(x,ridgeY+.012,z); ridge.name=name+'_grey_ridge_cap'; g.add(ridge);
      // 细密小青瓦依坡面排布，面朝瓦檐，几何矩阵按屋坡旋转。
      var across=Math.max(9,Math.floor(w*15)), courses=7, slopeLen=Math.sqrt((d/2+e)*(d/2+e)+rise*rise), tg=new THREE.BoxGeometry(w/across*.98,.018,slopeLen/courses*.96), inst2=new THREE.InstancedMesh(tg,tileAlt,across*courses*2); inst2.name=name+'_overlapping_qingwa_courses';
      var dummy=new THREE.Object3D(), n=0;
      for(var face=0;face<2;face++) for(var row=0;row<courses;row++) for(var col=0;col<across;col++) {
        var u=(col+.5)/across, v=(row+.5)/courses, xx=x+(u-.5)*w, zz, yy=y+rise*v+.008;
        if(face===0) zz=z-ez*(1-v); else zz=z+ez*(1-v);
        dummy.position.set(xx,yy,zz); dummy.rotation.set(face===0?-Math.atan2(rise,ez):Math.atan2(rise,ez),0,0);
        dummy.updateMatrix(); inst2.setMatrixAt(n++,dummy.matrix);
      }
      inst2.count=n; inst2.instanceMatrix.needsUpdate=true; g.add(inst2);
      // 山墙实体封口：泥砖三角位于屋架端头，屋面内侧不再露出黑色空洞。
      var ga=[x-w*.43,y,z-ez,x+w*.43,y,z-ez,x,ridgeY,z-ez, x-w*.43,y,z+ez,x,ridgeY,z+ez,x+w*.43,y,z+ez];
      var gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(ga,3));gg.computeVertexNormals();var gable=new THREE.Mesh(gg,gableMat);gable.name=name+'_sealed_brick_gable_ends';g.add(gable);
      if (orn) {
        // 檐口一排瓦当：圆瓦头压住檐口，是中国屋顶最抢眼的轮廓线
        var wg=new THREE.CylinderGeometry(.019,.019,.03,8), wm=[];
        for(var f2=0;f2<2;f2++) for(var c2=0;c2<across;c2++){
          var wx=x+(c2+.5)/across*w-w/2;
          wm.push([wx,y+.012,z+(f2?ez:-ez),Math.PI/2,0,0]);
        }
        inst(name+'_eave_drip_tiles',wg,tileAlt,wm);
        // 正脊两端翘起的脊饰
        [[-1,.03],[1,-.03]].forEach(function(s){var o=new THREE.Mesh(new THREE.ConeGeometry(.03,.09,6),lime);o.position.set(x+s[0]*w*.44,ridgeY+.05,z);o.rotation.z=s[1];o.name=name+'_ridge_ornament';g.add(o);});
      }
    }
    // 卵石与条石台基。围前的禾坪（晒谷卵石埕）和半月池是赣南围屋的门面，缺了就不像。
    // 台基分两进：下进要含住 2:1 收分外扩的墙脚（墙中线外 0.20）与角楼台座（外 0.32），
    // 否则墙脚会从台基侧边穿出去；底面抬离地面 0.004，避免与场景地面共面闪皮。
    box('pebble_rubble_foundation',W+0.62,0.09,D+0.62,stone,0,0.069,0);
    box('rubble_plinth_upper',W+0.44,0.09,D+0.44,mortar,0,0.159,0);
    // 门前的卵石埕与半月池试过四种摆法，在 320px 高的视口与默认俯角下都读成悬在台面外的一块板，
    // 先不放进模型；要恢复得同时改场景地面半径或默认俯角。




    // 三层围墙；正面两座门（主门与侧门）用分段墙体保留真实洞口。
    var wallY=y0+3*floorH, menZan=[], guShi=[];
    function facade(z, back) {
      var openings=back?[[-0.9,0.40]]:[[-0.78,0.48],[0.82,0.34]];var xLo=-(W/2-0.30), xHi=W/2-0.30, cursor=xLo;
      openings.forEach(function(o,oi){
        var left=o[0]-o[1]/2,right=o[0]+o[1]/2,mid=(left+right)/2,gw=o[1],tag=(back?'rear':'front');
        if(left>cursor) wall(tag+'_wall_'+oi,cursor+(left-cursor)/2,z,left-cursor,.20,3,'x');
        // 门洞两侧石框、木门、门槛；门簪与抱鼓石攒到最后各出一批实例
        box(tag+'_gate_jamb_L_'+oi,.09,1.02,.27,mortar,left+.045,.70,z);
        box(tag+'_gate_jamb_R_'+oi,.09,1.02,.27,mortar,right-.045,.70,z);
        box(tag+'_gate_lintel_'+oi,gw+.16,.12,.28,stone,mid,1.23,z);
        box(tag+'_timber_gate_'+oi,gw-.08,.82,.045,doorMat,mid,.65,z+(back?-.10:.10));
        box(tag+'_gate_threshold_'+oi,gw-.04,.04,.12,stone,mid,.26,z+(back?-.08:.08),false);
        [-1,1].forEach(function(s){
          menZan.push([mid+s*gw*.24,1.33,z+(back?-.02:.10),Math.PI/2,0,0]);
          guShi.push([mid+s*(gw/2+.10),.30,z+(back?-.19:.19)]);
        });
        if(!back&&oi===0) box('main_gate_stone_plaque',.54,.15,.07,lime,mid,1.37,z+.14,false);
        cursor=right;
      }); if(cursor<xHi) wall((back?'rear':'front')+'_wall_end',cursor+(xHi-cursor)/2,z,xHi-cursor,.20,3,'x');
    }
    facade(D/2,false); facade(-D/2,true);
    inst('gate_door_studs',new THREE.CylinderGeometry(.026,.026,.05,10),lime,menZan);
    inst('gate_drum_piers',new THREE.BoxGeometry(.10,.17,.13),stone,guShi);
    // 侧面墙在角楼内缘收头：两堵带收分的墙直接贯穿，四角会拱出一片不像墙的"鳍"
    [-1,1].forEach(function(s){wall('east_west_enclosing_wall_'+s,s*W/2,0,D-0.60,.20,3,'z');});
    // 墙身枪眼：分层外挑量跟着收分走，孔洞才不会浮在墙面之外。
    var slitM=[], winM=[], merlons=[], walkM=[], off=[0.176,0.140,0.116];
    for(var side=0;side<4;side++) for(var level=0;level<3;level++) for(var j=0;j<9;j++){
      var q=(j-4)*0.36, xx=0,zz=0,yy=y0+floorH*(level+.56);
      if(side===0){xx=q;zz=D/2+off[level];} if(side===1){xx=q;zz=-D/2-off[level];}
      if(side===2){xx=W/2+off[level];zz=q*0.66;} if(side===3){xx=-W/2-off[level];zz=q*0.66;}
      if((side===0||side===1)&&level===0&&Math.abs(xx)<1.12) continue;
      slitM.push([xx,yy,zz,0,side<2?0:Math.PI/2]);
      if(level>0&&j%2===0) winM.push([xx,yy+0.17,zz*1.02,0,side<2?0:Math.PI/2]);
    }
    inst('defensive_slit_windows',new THREE.BoxGeometry(0.105,0.035,0.03),shadowMat,slitM);
    inst('wall_lattice_windows',new THREE.BoxGeometry(.115,.15,.02),timber,winM);
    // 墙顶女儿墙、压顶与一排垛口；走马廊石板铺在内沿
    box('perimeter_parapet_front',W,.12,.23,brick,0,wallY+.06,D/2,false); box('perimeter_parapet_back',W,.12,.23,brick,0,wallY+.06,-D/2,false);
    box('perimeter_parapet_left',.23,.12,D,brick,-W/2,wallY+.06,0,false); box('perimeter_parapet_right',.23,.12,D,brick,W/2,wallY+.06,0,false);
    for(var ms=0;ms<2;ms++) for(var mi=0;mi<13;mi++){
      var mq=(mi-6)*0.225;
      merlons.push([mq,wallY+.19,ms?D/2+.055:-D/2-.055]);
    }
    for(var me=0;me<2;me++) for(var mj=0;mj<9;mj++){
      var mz=(mj-4)*0.21;
      merlons.push([me?W/2+.055:-W/2-.055,wallY+.19,mz]);
    }
    inst('parapet_crenellations',new THREE.BoxGeometry(.15,.14,.12),brick,merlons);
    for(var wi2=0;wi2<2;wi2++) for(var wj=0;wj<12;wj++){
      walkM.push([(wj-5.5)*0.245,wallY+.125,wi2?D/2-.13:-D/2+.13]);
    }
    for(var wk=0;wk<2;wk++) for(var wl=0;wl<9;wl++){
      walkM.push([wk?W/2-.13:-W/2+.13,wallY+.125,(wl-4)*0.235]);
    }
    inst('wall_walk_paving',new THREE.BoxGeometry(.27,.022,.2),stone,walkM);

    // 四角炮楼：收分砖身、腰檐、两层歇山顶，比围墙和垛口都高出一截才压得住画面。
    var towerSlit=[];
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(function(c,idx){
      var x=c[0]*(W/2-.02),z=c[1]*(D/2-.02),tw=.50;
      box('watchtower_'+idx+'_rubble_plinth',tw+.14,.2,tw+.14,stone,x,.32,z);
      prism('watchtower_'+idx+'_rammed_earth_lower',x,z,tw*1.12,tw*.96,tw*1.12,tw*.96,1.02,earthWall,.42);
      prism('watchtower_'+idx+'_blue_brick_upper',x,z,tw*.98,tw*.88,tw*.98,tw*.88,.62,brickWall,1.44);
      box('watchtower_'+idx+'_timber_belt',tw+.05,.06,tw+.05,timber,x,1.44,z,false);
      // 官方形制：方形炮楼、两层歇山式屋顶。下圈四撇水腰檐，上承两坡瓦顶与山墙。
      prism('watchtower_'+idx+'_lower_hip_skirt',x,z,tw*1.95,tw*1.0,tw*1.95,tw*1.0,.13,tileFace,2.00);
      roof('watchtower_'+idx+'_upper',x,z,tw*1.15,tw*1.15,2.13,.24);
      var finial=new THREE.Mesh(new THREE.SphereGeometry(.032,10,8),lime);
      finial.position.set(x,2.42,z); finial.name='watchtower_'+idx+'_ridge_finial'; g.add(finial);
      for(var lv=0;lv<4;lv++) for(var f=0;f<3;f++){
        var ty=.62+lv*.42, half=[0.278,0.262,0.245,0.232][lv], ang=[0,Math.PI/2,Math.PI][f];
        towerSlit.push([x+Math.sin(ang)*half,ty,z+Math.cos(ang)*half,0,ang]);
      }
    });
    inst('watchtower_loopholes',new THREE.BoxGeometry(.075,.03,.03),shadowMat,towerSlit);

    // 三进厅堂：前厅、中厅、后祠堂夹着两座天井。祠堂最高、脊上带饰，天井才不会被屋顶吃掉。
    var names=['front_hall','middle_hall','ancestral_hall'];
    var rowZ=[0.83,0.06,-0.74], widths=[2.24,2.52,2.24], depths=[.36,.34,.42], eaveY=[1.06,1.10,1.26];
    rowZ.forEach(function(z,i){
      var w=widths[i], d=depths[i], nm=names[i], bodyH=eaveY[i]-.44;
      box(nm+'_rammed_earth_ground',w,.44,d,earth,0,.47,z);
      box(nm+'_blue_brick_upper',w,bodyH,d,brick,0,.44+bodyH/2,z);
      box(nm+'_shadowed_veranda',w+.10,.08,d+.10,timber,0,.30,z,false);
      roof(nm,0,z,w+.14,d+.10,eaveY[i],i===2?.34:.26,i===2);
      [-1,1].forEach(function(s){var wingX=s*1.36; box('covered_corridor_'+i+'_wingwall_'+s,.30,.72,.34,earth,wingX,.66,z); box('covered_corridor_'+i+'_eave_'+s,.42,.05,.44,timber,wingX,1.02,z,false);});
    });
    // 中轴祠堂正面台阶、门扇、檐柱与匾额
    box('ancestral_hall_stone_steps',1.05,.10,.22,stone,0,.30,-.42);
    box('ancestral_hall_entry',.36,.66,.055,doorMat,0,.69,-.465);
    box('ancestral_hall_plaque',.46,.13,.05,lime,0,1.02,-.5,false);
    [-.62,-.21,.21,.62].forEach(function(x,i){var col=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.72,8),timber);col.position.set(x,.72,-.5);col.name='ancestral_hall_veranda_column_'+i;g.add(col);});
    // 檐廊列柱：三排一次实例化，绕着天井一圈
    var cols=[];
    rowZ.forEach(function(z,i){
      var front=i===2?z+depths[i]/2+.07:z-depths[i]/2-.07;
      for(var c=0;c<6;c++) cols.push([-1.25+c*.5,.68,front]);
    });
    inst('covered_corridor_columns',new THREE.CylinderGeometry(.03,.038,.74,8),timber,cols);
    // 两座天井地坪、排水沟和石砌井沿。
    [-0.32,0.44].forEach(function(z,i){box('open_sky_courtyard_'+i,1.62,.03,.40,courtMat,0,.29,z,false);
      box('courtyard_drain_'+i,1.5,.02,.035,shadowMat,0,.305,z-.17,false);
      box('courtyard_coping_front_'+i,1.68,.045,.035,mortar,0,.315,z-.20,false); box('courtyard_coping_back_'+i,1.68,.045,.035,mortar,0,.315,z+.20,false);
    });
    // 厅堂开间窗：正面一列木窗棂，实例化
    var hallWin=[];
    rowZ.forEach(function(z,i){for(var c=0;c<5;c++) hallWin.push([-1.0+c*.5,.86,z-depths[i]/2-.02]);});
    inst('wood_lattice_windows',new THREE.BoxGeometry(.16,.20,.022),doorMat,hallWin);
    g.userData.modelKind='guanxi-rectangular-enclosed-hakka-weiwu';
    g.userData.majorStructure=['rectangular_enclosure','three_storeys','rammed_earth_and_brick','two_gates','four_pyramidal_watchtowers','three_courts','five_halls','ancestral_hall','covered_corridors','defensive_slits','battered_walls','wall_walk','crenellations'];
    g.position.y=-1.15;
    return g;
  }

  /* ================================================================
     蓝染布 — 折叠布料 + 水墨晕染 + 染缸 + 板蓝根
     ================================================================ */
  function buildLandye() {
    var g = new THREE.Group();
    var rodY = 1.42, postX = 1.02;
    var wood = new THREE.MeshStandardMaterial({ color: 0x6E563C, roughness: 0.82 });
    var woodDark = new THREE.MeshStandardMaterial({ color: 0x4A382A, roughness: 0.86 });

    // 晾染架：两根立柱 + 顶梁 + 斜撑。原来只有一根悬空的横杆。
    [-1, 1].forEach(function (s) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, rodY + 0.06, 10), wood);
      post.position.set(s * postX, (rodY + 0.06) / 2, 0);
      post.castShadow = true;
      g.add(post);
      var foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), woodDark);
      foot.position.set(s * postX, 0.02, 0);
      g.add(foot);
      var brace = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8), wood);
      brace.position.set(s * (postX - 0.16), 0.24, 0.12);
      brace.rotation.set(0.55, 0, s * 0.62);
      g.add(brace);
    });
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, postX * 2 + 0.16, 12), wood);
    rod.rotation.z = Math.PI / 2;
    rod.position.y = rodY;
    rod.castShadow = true;
    g.add(rod);

    var clothMat;
    if (textures.landyeFinal) {
      var lt = textures.landyeFinal.clone();
      lt.repeat.set(1.35, 1.15);
      lt.needsUpdate = true;
      clothMat = new THREE.MeshStandardMaterial({ map: lt, roughness: 0.86, side: THREE.DoubleSide });
    } else {
      clothMat = new THREE.MeshStandardMaterial({ color: 0x1A3A5C, roughness: 0.86, side: THREE.DoubleSide });
    }
    // 刚出缸偏绿、氧化后才转蓝：资料记的就是这个次序，晾架上两色并置
    var freshGreen = new THREE.MeshStandardMaterial({ color: 0x3C5C46, roughness: 0.9, side: THREE.DoubleSide });

    // 三幅不同长度的垂布，顶上一段绕着横梁翻过去，布与杆之间不留缝
    function drape(name, cx, width, len, phase, amp, mat, z0) {
      var cols = 26, rows = 34, pos = [], uv = [], idx = [];
      for (var j = 0; j <= rows; j++) {
        var t = j / rows;
        for (var i = 0; i <= cols; i++) {
          var u = i / cols - 0.5;
          var x = cx + u * width, y, z;
          if (t < 0.10) {
            var a = (t / 0.10) * Math.PI * 0.92 - Math.PI * 0.46;
            y = rodY + Math.cos(a) * 0.055;
            z = z0 + Math.sin(a) * 0.055;
          } else {
            var s2 = (t - 0.10) / 0.90;
            y = rodY - 0.055 - s2 * len * (1 - 0.05 * Math.cos(u * Math.PI * 3));
            z = z0 + Math.sin(u * Math.PI * 5.5 + phase) * amp * (0.30 + 0.70 * s2)
                     + Math.sin(u * Math.PI * 13 + phase * 2) * amp * 0.22 * s2;
          }
          pos.push(x, y, z);
          uv.push(i / cols, t);
        }
      }
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var a0 = r * (cols + 1) + c, b0 = a0 + cols + 1;
        idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      var m = new THREE.Mesh(geo, mat);
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    drape('hanging_indigo_cloth_main', -0.42, 0.62, 1.24, 0.4, 0.075, clothMat, 0.02);
    drape('hanging_indigo_cloth_second', 0.30, 0.52, 1.02, 1.9, 0.062, clothMat, -0.05);
    drape('fresh_out_of_vat_green_cloth', 0.78, 0.30, 0.52, 3.1, 0.05, freshGreen, 0.06);
    [-0.72, -0.12, 0.06, 0.54].forEach(function (hx, n) {
      var clip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.14, 0.05), wood);
      clip.position.set(hx, rodY - 0.02, n % 2 ? 0.06 : -0.06);
      clip.rotation.z = 0.12 * (n % 2 ? 1 : -1);
      clip.name = 'cloth_clip_' + n;
      g.add(clip);
    });

    // 染缸：陶缸旋转成型，配靛泥液面、发酵泡沫圈与染杵
    var vatMat = new THREE.MeshStandardMaterial({ color: 0x53412F, roughness: 0.88 });
    var vatProfile = [
      [0.00, 0.00], [0.26, 0.00], [0.30, 0.05], [0.37, 0.18],
      [0.40, 0.34], [0.38, 0.50], [0.33, 0.58], [0.335, 0.62], [0.30, 0.63]
    ].map(function (v) { return new THREE.Vector2(v[0], v[1]); });
    var vat = new THREE.Mesh(new THREE.LatheGeometry(vatProfile, 26), vatMat);
    vat.position.set(-0.86, 0, -0.34);
    vat.castShadow = true;
    vat.name = 'indigo_vat';
    g.add(vat);
    var liq = new THREE.Mesh(new THREE.CylinderGeometry(0.295, 0.295, 0.02, 24),
      new THREE.MeshStandardMaterial({ color: 0x0B2135, roughness: 0.22, metalness: 0.08 }));
    liq.position.set(-0.86, 0.52, -0.34);
    liq.name = 'indigo_liquid_surface';
    g.add(liq);
    var foam = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.022, 7, 22),
      new THREE.MeshStandardMaterial({ color: 0x4F6B4A, roughness: 0.6 }));
    foam.rotation.x = Math.PI / 2;
    foam.position.set(-0.86, 0.535, -0.34);
    foam.name = 'vat_fermentation_scum';
    g.add(foam);
    var pestle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.86, 8), woodDark);
    pestle.position.set(-0.74, 0.62, -0.28);
    pestle.rotation.set(0.30, 0, -0.34);
    pestle.name = 'dipping_pestle';
    g.add(pestle);

    // 蜡染模板：李洁春在古法之外加的一步，刻好花纹的木板
    var board = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.022), woodDark);
    board.position.set(1.02, 0.24, -0.44);
    board.rotation.set(-0.26, 0.34, 0.10);
    board.name = 'wax_resist_template';
    g.add(board);
    var tmplMat = new THREE.MeshStandardMaterial({ color: 0xD9CFB6, roughness: 0.7 });
    [[0, 0.14], [0, -0.12], [-0.10, 0.02], [0.10, 0.02]].forEach(function (o, n) {
      var cut = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 14), tmplMat);
      cut.position.set(1.02 + o[0] * 0.92, 0.24 + o[1], -0.44 + 0.016);
      cut.rotation.set(-0.26, 0.34, 0.10);
      cut.name = 'template_cutout_' + n;
      g.add(cut);
    });

    // 板蓝根：一丛带叶的蓝草（叶子实例化）+ 缸边扎好的一捆
    var stemMat = new THREE.MeshStandardMaterial({ color: 0x416B32, roughness: 0.75 });
    var leafMat = new THREE.MeshStandardMaterial({ color: 0x2F5A26, roughness: 0.68, side: THREE.DoubleSide });
    var bx = 0.34, bz = 0.62, leafM = [];
    for (var st = 0; st < 5; st++) {
      var sa = (st / 5) * Math.PI * 2 + 0.4, sr = 0.06 + (st % 2) * 0.05;
      var sh = 0.52 + (st % 3) * 0.16;
      var sx = bx + Math.cos(sa) * sr, sz = bz + Math.sin(sa) * sr;
      var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.016, sh, 6), stemMat);
      stem.position.set(sx, sh / 2, sz);
      stem.rotation.set(Math.sin(sa) * 0.14, 0, -Math.cos(sa) * 0.14);
      stem.name = 'indigo_plant_stem_' + st;
      g.add(stem);
      for (var lf = 0; lf < 6; lf++) {
        var la = sa + lf * 1.15, ly = 0.14 + lf * (sh - 0.2) / 5;
        leafM.push([sx + Math.cos(la) * 0.075, ly, sz + Math.sin(la) * 0.075, -0.42, la, (lf % 2 ? 0.2 : -0.2)]);
      }
    }
    var leafGeo = new THREE.CircleGeometry(0.055, 8);
    leafGeo.scale(1, 0.42, 1);
    var leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafM.length);
    leaves.name = 'indigo_leaves';
    var lo = new THREE.Object3D();
    leafM.forEach(function (m, n) {
      lo.position.set(m[0], m[1], m[2]);
      lo.rotation.set(m[3], m[4], m[5]);
      lo.updateMatrix();
      leaves.setMatrixAt(n, lo.matrix);
    });
    leaves.instanceMatrix.needsUpdate = true;
    leaves.castShadow = true;
    g.add(leaves);
    var bundle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.56, 10), stemMat);
    bundle.position.set(-0.26, 0.085, 0.34);
    bundle.rotation.z = Math.PI / 2;
    bundle.name = 'harvested_indigo_bundle';
    g.add(bundle);
    [0.16, -0.16].forEach(function (o, n) {
      var tie = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.009, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0x8A7A4E, roughness: 0.85 }));
      tie.position.set(-0.26 + o, 0.085, 0.34);
      tie.rotation.y = Math.PI / 2;
      tie.name = 'bundle_tie_' + n;
      g.add(tie);
    });

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
    if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    tex.repeat.set(repeatX || 1, repeatY || 1);
    tex.anisotropy = 4;
    generatedTextures.push(tex);
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
    var bamboo = new THREE.MeshStandardMaterial({ map: weave, color: 0xD8B57E, roughness: 0.85 });
    var bambooDark = new THREE.MeshStandardMaterial({ color: 0x9C7138, roughness: 0.8 });
    // 色偏近白、只留一点蓝味：hatCloth 本身就深，再乘一个中等蓝就成了黑布
    var blue = new THREE.MeshStandardMaterial({ map: cloth, color: 0xDCEAF2, roughness: 0.9, side: THREE.DoubleSide });

    var crown = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.20, 28), bamboo);
    crown.position.y = 0.34;
    crown.castShadow = true;
    g.add(crown);

    // 顶覆蓝布：资料说宁龙片凉帽是竹篾檐、顶覆蓝布，不是整顶竹的
    var cover = new THREE.Mesh(new THREE.SphereGeometry(0.365, 26, 12, 0, Math.PI * 2, 0, Math.PI * 0.44), blue);
    cover.position.y = 0.245;
    cover.castShadow = true;
    cover.name = 'blue_cloth_crown_cover';
    g.add(cover);
    var coverEdge = new THREE.Mesh(new THREE.TorusGeometry(0.352, 0.016, 7, 30), bambooDark);
    coverEdge.rotation.x = Math.PI / 2;
    coverEdge.position.y = 0.44;
    coverEdge.name = 'crown_cover_binding';
    g.add(coverEdge);

    // 帽檐：扁平竹篾编的圆盘
    var brim = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.035, 48),
      new THREE.MeshStandardMaterial({ map: weave, color: 0xD8B57E, roughness: 0.85, side: THREE.DoubleSide }));
    brim.position.y = 0.22;
    brim.castShadow = true;
    g.add(brim);

    // 放射状竹篾：从帽顶向外一根根铺，扁平檐才读得出是编的而不是一张片
    var ribM = [];
    for (var rb = 0; rb < 24; rb++) {
      var ra2 = (rb / 24) * Math.PI * 2;
      ribM.push([Math.cos(ra2) * (R * 0.52), 0.243, Math.sin(ra2) * (R * 0.52), 0, -ra2, 0, 1, 1, 1]);
    }
    var ribGeo = new THREE.BoxGeometry(R * 0.9, 0.008, 0.026);
    var ribs = new THREE.InstancedMesh(ribGeo, bambooDark, ribM.length);
    ribs.name = 'radiating_bamboo_ribs';
    var ro = new THREE.Object3D();
    ribM.forEach(function (m, n) {
      ro.position.set(m[0], m[1], m[2]);
      ro.rotation.set(0, m[4], 0);
      ro.updateMatrix();
      ribs.setMatrixAt(n, ro.matrix);
    });
    ribs.instanceMatrix.needsUpdate = true;
    g.add(ribs);

    // 檐缘包边：竹皮一圈缠住断口
    var brimEdge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.026, 9, 56), bambooDark);
    brimEdge.rotation.x = Math.PI / 2;
    brimEdge.position.y = 0.222;
    brimEdge.name = 'brim_wrapped_edge';
    brimEdge.castShadow = true;
    g.add(brimEdge);
    // 内圈汗带
    var sweat = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.028, 8, 26),
      new THREE.MeshStandardMaterial({ color: 0x6B4A2A, roughness: 0.9 }));
    sweat.rotation.x = Math.PI / 2;
    sweat.position.y = 0.245;
    sweat.name = 'inner_sweat_band';
    g.add(sweat);

    // 垂布：绕帽檐一圈带褶，前低后高——遮面是它的功能
    var skirtH = 0.60;
    var skirtGeo = new THREE.CylinderGeometry(R * 1.01, R * 1.07, skirtH, 72, 8, true);
    var sp = skirtGeo.attributes.position;
    for (var i = 0; i < sp.count; i++) {
      var x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      var ang = Math.atan2(z, x);
      var t = (y + skirtH / 2) / skirtH;
      var pleat = (Math.sin(ang * 24) * 0.030 + Math.sin(ang * 37 + 1.2) * 0.010) * (1.15 - t);
      var rr = Math.sqrt(x * x + z * z) + pleat;
      // 前侧（+z）多垂一段，后侧收短
      var front = Math.max(0, Math.sin(ang)) * 0 + Math.max(0, z / R);
      sp.setX(i, Math.cos(ang) * rr);
      sp.setZ(i, Math.sin(ang) * rr);
      sp.setY(i, y - front * 0.16 - Math.abs(pleat) * 0.4);
    }
    skirtGeo.computeVertexNormals();
    var skirt = new THREE.Mesh(skirtGeo, blue);
    skirt.position.y = 0.22 - skirtH / 2 + 0.02;
    skirt.castShadow = true;
    skirt.name = 'indigo_pleated_face_veil';
    g.add(skirt);
    // 褶圈下沿的布边
    var veilEdge = new THREE.Mesh(new THREE.TorusGeometry(R * 1.07, 0.014, 6, 56),
      new THREE.MeshStandardMaterial({ color: 0x3F5F72, roughness: 0.9 }));
    veilEdge.rotation.x = Math.PI / 2;
    veilEdge.position.y = 0.22 - skirtH + 0.02;
    veilEdge.name = 'veil_lower_hem';
    g.add(veilEdge);

    // 帽顶红布结：缠布的圆钮，不是一颗光球
    var knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xB03A28, roughness: 0.72 }));
    knot.position.y = 0.50;
    knot.castShadow = true;
    g.add(knot);
    [0, Math.PI / 2].forEach(function (ta, n) {
      var wrap = new THREE.Mesh(new THREE.TorusGeometry(0.071, 0.009, 6, 18),
        new THREE.MeshStandardMaterial({ color: 0x8A2A1E, roughness: 0.75 }));
      wrap.position.y = 0.50;
      wrap.rotation.set(Math.PI / 2, 0, ta);
      wrap.name = 'button_wrap_' + n;
      g.add(wrap);
    });

    // 系带与带结
    var strapMat = new THREE.MeshStandardMaterial({ color: 0xC9C2B0, roughness: 0.9 });
    [-1, 1].forEach(function (s) {
      var strap = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.55, 8), strapMat);
      strap.position.set(s * 0.30, -0.28, 0.16);
      strap.rotation.z = s * 0.28;
      strap.name = 'chin_strap_' + (s < 0 ? 'L' : 'R');
      g.add(strap);
      var bow = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.010, 6, 14), strapMat);
      bow.position.set(s * 0.36, -0.54, 0.16);
      bow.rotation.y = Math.PI / 2;
      bow.name = 'strap_knot_' + (s < 0 ? 'L' : 'R');
      g.add(bow);
    });

    g.position.y = 0.35;
    return g;
  }

  /* ================================================================
     竹编簸箕 —— 浅口圆簸箕，三足
     ================================================================ */
  function buildBoji() {
    var g = new THREE.Group();
    var weave = canvasTex('bambooWeave', 6, 3);
    var mat = new THREE.MeshStandardMaterial({
      map: weave, color: 0xD9B77E, roughness: 0.86, side: THREE.DoubleSide
    });
    var R = 1.0;

    // 底面：浅碟形下凹，不再是与侧壁脱节的平盘
    var baseGeo = new THREE.CircleGeometry(R * 0.965, 64, 0, Math.PI * 2);
    baseGeo.rotateX(-Math.PI / 2);
    var bp = baseGeo.attributes.position;
    for (var bi = 0; bi < bp.count; bi++) {
      var bxr = Math.hypot(bp.getX(bi), bp.getZ(bi)) / (R * 0.965);
      bp.setY(bi, -0.055 * (1 - bxr * bxr));
    }
    baseGeo.computeVertexNormals();
    var base = new THREE.Mesh(baseGeo, mat);
    base.receiveShadow = true;
    base.name = 'basket_woven_floor';
    g.add(base);

    // 侧壁：向外敞开的浅口，带一挑一压的边口起伏
    var wallGeo = new THREE.CylinderGeometry(R * 0.965, R, 0.22, 64, 4, true);
    var wp = wallGeo.attributes.position;
    for (var i = 0; i < wp.count; i++) {
      var y = wp.getY(i);
      var t = (y + 0.11) / 0.22;
      var ang = Math.atan2(wp.getZ(i), wp.getX(i));
      var rr = Math.sqrt(wp.getX(i) * wp.getX(i) + wp.getZ(i) * wp.getZ(i));
      rr += Math.sin(ang * 26) * 0.007 * t + Math.sin(ang * 13) * 0.004 * t;
      wp.setX(i, Math.cos(ang) * rr);
      wp.setZ(i, Math.sin(ang) * rr);
    }
    wallGeo.computeVertexNormals();
    var wall = new THREE.Mesh(wallGeo, mat);
    wall.position.y = 0.10;
    wall.castShadow = true;
    wall.name = 'basket_woven_wall';
    g.add(wall);

    // 纬篾凸痕：一圈圈压过经篾的纬条，编法在近景读得出来
    var weft = [], o3 = new THREE.Object3D();
    for (var wf = 0; wf < 4; wf++) {
      var wy = 0.045 + wf * 0.048;
      // 贴着侧壁的敞口走：壁是下窄上宽的锥面，固定半径会让纬篾在上沿支出来
      var wr = R * (1 - 0.035 * ((wy + 0.01) / 0.22)) + 0.004;
      for (var wn = 0; wn < 46; wn++) {
        var wa = (wn / 46) * Math.PI * 2;
        weft.push([Math.cos(wa) * wr, wy, Math.sin(wa) * wr, 0, -wa, 0.34 * (wf % 2 ? 1 : -1)]);
      }
    }
    var weftMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.055, 0.014, 0.008),
      new THREE.MeshStandardMaterial({ color: 0xC79A5E, roughness: 0.84 }), weft.length);
    weftMesh.name = 'weft_bamboo_over_under';
    weft.forEach(function (m, n) {
      o3.position.set(m[0], m[1], m[2]);
      o3.rotation.set(m[3], m[4], m[5]);
      o3.updateMatrix();
      weftMesh.setMatrixAt(n, o3.matrix);
    });
    weftMesh.instanceMatrix.needsUpdate = true;
    g.add(weftMesh);

    // 圈口：主篾 + 缠竹皮（斜着一圈圈裹住断口）+ 内穿骨架
    var rimMat = new THREE.MeshStandardMaterial({ color: 0x9C6B33, roughness: 0.72 });
    var rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.028, 10, 56), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.21;
    rim.castShadow = true;
    rim.name = 'basket_rim_core';
    g.add(rim);
    var wrapM = [];
    for (var wk = 0; wk < 40; wk++) {
      var wka = (wk / 40) * Math.PI * 2;
      wrapM.push([Math.cos(wka) * R, 0.21, Math.sin(wka) * R, Math.PI / 2, wka, 0.55]);
    }
    var wrapMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.062, 0.016, 0.012),
      new THREE.MeshStandardMaterial({ color: 0xB07C3C, roughness: 0.78 }), wrapM.length);
    wrapMesh.name = 'rim_binding_wrapped_peel';
    wrapM.forEach(function (m, n) {
      o3.position.set(m[0], m[1], m[2]);
      o3.rotation.set(m[3], m[4], m[5]);
      o3.updateMatrix();
      wrapMesh.setMatrixAt(n, o3.matrix);
    });
    wrapMesh.instanceMatrix.needsUpdate = true;
    g.add(wrapMesh);
    var stay = new THREE.Mesh(new THREE.TorusGeometry(R * 0.86, 0.014, 6, 44), rimMat);
    stay.rotation.x = Math.PI / 2;
    stay.position.y = 0.055;
    stay.name = 'inner_stay_ring';
    g.add(stay);

    // 三足
    var footMat = new THREE.MeshStandardMaterial({ color: 0x7A5228, roughness: 0.8 });
    for (var f = 0; f < 3; f++) {
      var fa = (f / 3) * Math.PI * 2 + 0.4;
      var foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.12, 10), footMat);
      foot.position.set(Math.cos(fa) * R * 0.62, -0.06, Math.sin(fa) * R * 0.62);
      foot.name = 'basket_foot_' + f;
      g.add(foot);
    }

    // 摊着的稻谷：带芒的细长粒，中间厚、边缘稀；再撒一点糠秕
    var grainM = [];
    for (var k = 0; k < 150; k++) {
      var gr = Math.pow(Math.random(), 0.62) * R * 0.70;
      var ga = Math.random() * Math.PI * 2;
      var gy = -0.055 * (1 - Math.pow(gr / (R * 0.965), 2)) + 0.012;
      grainM.push([Math.cos(ga) * gr, gy, Math.sin(ga) * gr,
                   (Math.random() - 0.5) * 0.5, Math.random() * Math.PI * 2, 0]);
    }
    var grainGeo = new THREE.SphereGeometry(0.021, 7, 6);
    grainGeo.scale(1, 0.52, 2.05);
    var grain = new THREE.InstancedMesh(grainGeo,
      new THREE.MeshStandardMaterial({ color: 0xC8A24A, roughness: 0.65 }), grainM.length);
    grain.name = 'rice_grains_with_awns';
    grainM.forEach(function (m, n) {
      o3.position.set(m[0], m[1], m[2]);
      o3.rotation.set(m[3], m[4], m[5]);
      o3.updateMatrix();
      grain.setMatrixAt(n, o3.matrix);
    });
    grain.instanceMatrix.needsUpdate = true;
    grain.castShadow = true;
    g.add(grain);
    var awnM = [];
    for (var an = 0; an < 60; an++) {
      var ar = Math.pow(Math.random(), 0.6) * R * 0.66, aa = Math.random() * Math.PI * 2;
      awnM.push([Math.cos(aa) * ar, -0.055 * (1 - Math.pow(ar / (R * 0.965), 2)) + 0.026, Math.sin(aa) * ar,
                 (Math.random() - 0.5) * 0.9, Math.random() * Math.PI * 2, 0]);
    }
    var awnGeo = new THREE.CylinderGeometry(0.0016, 0.0016, 0.05, 4);
    awnGeo.rotateZ(Math.PI / 2);
    var awns = new THREE.InstancedMesh(awnGeo,
      new THREE.MeshStandardMaterial({ color: 0xD8C48E, roughness: 0.8 }), awnM.length);
    awns.name = 'rice_awns';
    awnM.forEach(function (m, n) {
      o3.position.set(m[0], m[1], m[2]);
      o3.rotation.set(m[3], m[4], m[5]);
      o3.updateMatrix();
      awns.setMatrixAt(n, o3.matrix);
    });
    awns.instanceMatrix.needsUpdate = true;
    g.add(awns);
    var chaff = new THREE.InstancedMesh(new THREE.BoxGeometry(0.016, 0.003, 0.011),
      new THREE.MeshStandardMaterial({ color: 0x8E7343, roughness: 0.9 }), 70);
    chaff.name = 'chaff_flecks';
    for (var cf = 0; cf < 70; cf++) {
      var cr = Math.random() * R * 0.8, ca = Math.random() * Math.PI * 2;
      o3.position.set(Math.cos(ca) * cr, -0.055 * (1 - Math.pow(cr / (R * 0.965), 2)) + 0.006, Math.sin(ca) * cr);
      o3.rotation.set(0, Math.random() * Math.PI, 0);
      o3.updateMatrix();
      chaff.setMatrixAt(cf, o3.matrix);
    }
    chaff.instanceMatrix.needsUpdate = true;
    g.add(chaff);

    g.position.y = 0.12;
    return g;
  }

  /* ================================================================
     客家织带 —— 搭在横杆上的一条织带，末端有穗
     ================================================================ */
  function buildZhidai() { return buildDongtoupaBelt(); }

  // 冬头帕：黑色双层护额，两端各垂一条手织丝带；丝带分织花段、拧成的亚带、结头与丝穗。
  function buildDongtoupaBelt() {
    var g=new THREE.Group(); g.name='DongtoupaWovenSilkBelts';
    // 实地比例：织带宽约 2cm、长约 67cm，护额高约 6.7cm。展示时按 3.5cm×58cm 放大了一档，
    // 否则在 320px 高的视口里挑花纹样会糊成一条线；偏差记在 docs/v2-model-notes.md。
    var belt=canvasTex('wovenBelt',1,1.6);
    var silk=new THREE.MeshStandardMaterial({map:belt,color:0xffffff,roughness:.42,metalness:.02,side:THREE.DoubleSide});
    // 亚带是五彩线拧出来的素段，不带挑花，用本白丝线
    var yadaMat=new THREE.MeshStandardMaterial({color:0xd9cdb2,roughness:.48,metalness:.02,side:THREE.DoubleSide});
    var knotMat=new THREE.MeshStandardMaterial({color:0x7b2631,roughness:.6});
    var tasselMat=new THREE.MeshStandardMaterial({color:0xe7dcc4,roughness:.55});
    var clothMat=new THREE.MeshStandardMaterial({color:0x1d2026,roughness:.95,side:THREE.DoubleSide});
    var PAT=.62, YADA=.83, LEN=1.30, headR=.27, bandY=1.72, bandH=.17, arc=1.45;
    // 护额：双层黑棉布对折贴额。两条织带缝在头帕两端、位于额前上方，所以只有两根。
    var band=new THREE.Mesh(new THREE.CylinderGeometry(headR,headR,bandH,34,1,true,-arc,arc*2),clothMat);
    band.position.set(0,bandY,.02); band.name='black_cotton_headband'; band.castShadow=true; g.add(band);
    var fold=new THREE.Mesh(new THREE.CylinderGeometry(headR+.008,headR+.008,.034,34,1,true,-arc,arc*2),
      new THREE.MeshStandardMaterial({color:0x33394a,roughness:.92,side:THREE.DoubleSide}));
    fold.position.set(0,bandY+bandH/2-.017,.02); fold.name='headband_folded_upper_edge'; g.add(fold);
    var hangX=Math.sin(arc)*headR, hangZ=Math.cos(arc)*headR+.02, topY=bandY-bandH/2+.03;

    function sample(t,u,side) {
      // 带子自发际两侧平贴下垂，末端略向外摆；亚带段是"拧"出来的：
      // 截面绕垂轴转，宽度转到 z 上，视觉上收成一条细股。
      var bx=side*(hangX+.045*t*t) + .030*Math.sin(t*2.1+side*.35)*t + .010*Math.sin(t*6.3+side)*t;
      var by=topY - t*LEN - .02*t*t;
      var into=Math.max(0,(t-PAT)/(YADA-PAT));
      var width=.078*(1-.04*t)*(1-.42*into*into);
      var phi=side*(.14*Math.sin(t*2.65)*t + 4.4*into*into);
      var bz=hangZ + .05*Math.sin(t*2.45+side*.4)*t + .006*Math.sin(t*8.5+u*5+side)*t;
      var off=u*width;
      return [bx+off*Math.cos(phi),by,bz+off*Math.sin(phi)];
    }
    function surface(side,t0,t1,steps,mat,name) {
      var nu=14,pos=[],uv=[],idx=[];
      for(var j=0;j<=steps;j++){var t=t0+(t1-t0)*j/steps;
        for(var i=0;i<=nu;i++){var p=sample(t,i/nu-.5,side);pos.push(p[0],p[1],p[2]);uv.push(i/nu,t);}}
      for(var y=0;y<steps;y++)for(var x=0;x<nu;x++){var a=y*(nu+1)+x,b=a+nu+1;idx.push(a,b,a+1,b,b+1,a+1);}
      var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
      var m=new THREE.Mesh(geo,mat);m.name=name;m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
    }
    function makeRibbon(side,tag) {
      surface(side,0,PAT,132,silk,side<0?'left_woven_ribbon':'right_woven_ribbon');
      surface(side,PAT,YADA,44,yadaMat,side<0?'left_yada_plain_twist':'right_yada_plain_twist');
      // 经线细丝按架线顺序上色，并入单个 BufferGeometry，不产生逐根 draw call
      var lanes=[],wq=[['#151619',2],['#2c6d4a',2],['#2a5f96',2],['#b5272c',5],['#f0e8d7',11],
                       ['#b5272c',5],['#2a5f96',2],['#2c6d4a',2],['#151619',2]];
      wq.forEach(function(gr){for(var i=0;i<gr[1];i++)lanes.push(gr[0]);});
      var laneCount=lanes.length, steps=96;
      var threadPos=[],threadCol=[],threadIdx=[];
      for(var lane=0;lane<laneCount;lane++){
        var u=-.49+.98*(lane+.5)/laneCount, start=threadPos.length/3, rgb=hexRGB(lanes[lane]);
        for(var k=0;k<=steps;k++){
          var p=sample(k/steps,u,side), q=sample(k/steps,u+.01,side), dx=q[0]-p[0],dz=q[2]-p[2],dl=Math.hypot(dx,dz)||1, off=.0007;
          threadPos.push(p[0]-dz/dl*off,p[1],p[2]+dx/dl*off,p[0]+dz/dl*off,p[1],p[2]-dx/dl*off);
          threadCol.push(rgb[0],rgb[1],rgb[2],rgb[0],rgb[1],rgb[2]);
          if(k<steps){var v=start+k*2;threadIdx.push(v,v+2,v+1,v+1,v+2,v+3);}
        }
      }
      var fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.Float32BufferAttribute(threadPos,3));
      fg.setAttribute('color',new THREE.Float32BufferAttribute(threadCol,3));fg.setIndex(threadIdx);fg.computeVertexNormals();
      var fm=new THREE.Mesh(fg,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62,side:THREE.DoubleSide}));
      fm.name='continuous_silk_warp_fibres_'+tag;fm.castShadow=true;g.add(fm);
      // 侧边包芯织边：前后各错开一点，做出真正的厚度而不是零宽贴片
      var edgeGeo=new THREE.BufferGeometry(), ep=[], ei=[];
      [-.5,.5].forEach(function(u2){
        var st=ep.length/3;
        for(var k=0;k<=YADA*160;k++){
          var t=k/160,p=sample(t,u2,side);
          ep.push(p[0],p[1],p[2]-.0028,p[0],p[1],p[2]+.0028);
          if(k<YADA*160){var b=st+k*2;ei.push(b,b+2,b+1,b+1,b+2,b+3);}
        }
      });
      edgeGeo.setAttribute('position',new THREE.Float32BufferAttribute(ep,3));edgeGeo.setIndex(ei);edgeGeo.computeVertexNormals();
      var edge=new THREE.Mesh(edgeGeo,new THREE.MeshStandardMaterial({color:0x1b1c1f,roughness:.8,side:THREE.DoubleSide}));
      edge.name='black_selvedge_'+tag;g.add(edge);
      // 结头与流苏：亚带末端拧线打结，散开的丝穗留出资料记载的十厘米以上
      var end=sample(YADA,0,side);
      var knot=new THREE.Mesh(new THREE.SphereGeometry(.028,14,10),knotMat);
      knot.position.set(end[0],end[1],end[2]);knot.scale.set(1.5,.62,.8);knot.name='hand_tied_knot_'+tag;g.add(knot);
      var tip=sample(1,0,side), count=34, tm=[];
      for(var i=0;i<count;i++){
        var fan=(i-(count-1)/2)/(count-1);
        tm.push([tip[0]+fan*.095,(end[1]+tip[1])/2+.015,tip[2]+Math.abs(fan)*.026,
                 fan*.26,fan*.12,0, 1,1+Math.abs(fan)*.6,1]);
      }
      inst2('silk_fringe_threads_'+tag,new THREE.CylinderGeometry(.0042,.0020,.24,6),tasselMat,tm);
    }
    function hexRGB(h){return [parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255];}
    function inst2(name,geo,mat,mats){
      var im=new THREE.InstancedMesh(geo,mat,mats.length);im.name=name;var o=new THREE.Object3D();
      mats.forEach(function(m,i){o.position.set(m[0],m[1],m[2]);o.rotation.set(m[3]||0,m[4]||0,m[5]||0);
        o.scale.set(m[6]==null?1:m[6],m[7]==null?1:m[7],m[8]==null?1:m[8]);o.updateMatrix();im.setMatrixAt(i,o.matrix);});
      im.count=mats.length;im.instanceMatrix.needsUpdate=true;im.castShadow=true;g.add(im);return im;
    }
    makeRibbon(-1,'L'); makeRibbon(1,'R');
    g.userData.modelKind='longnan-dongtoupa-woven-silk-ribbons';
    g.userData.majorStructure=['white_core_warp','red_blue_green_black_warp_edges','wan_char_and_diamond_pickup','soft_twisted_drape','raised_warp_fibres','plain_twisted_yada','hand_tied_knots','silk_fringe'];
    g.position.y=-1.15;
    return g;
  }

  /* ================================================================
     米酒坛 —— 酱釉陶坛 + 红纸封口
     ================================================================ */
  function buildMijiutan() {
    var g = new THREE.Group();
    var glaze = canvasTex('glazeJar', 2, 1);
    var jarMat = new THREE.MeshStandardMaterial({ map: glaze, color: 0xC98A52, roughness: 0.42, metalness: 0.06 });

    // 坛身：一条轮廓线旋转成型
    var profile = [
      [0.00, 0.00], [0.30, 0.00], [0.34, 0.04], [0.42, 0.16],
      [0.50, 0.34], [0.53, 0.52], [0.50, 0.70], [0.42, 0.86],
      [0.32, 0.96], [0.27, 1.02], [0.28, 1.08], [0.31, 1.12], [0.29, 1.15]
    ].map(function (v) { return new THREE.Vector2(v[0], v[1]); });
    var body = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), jarMat);
    body.castShadow = true;
    body.receiveShadow = true;
    body.name = 'wine_jar_body';
    g.add(body);

    // 底部露胎：釉不到底，酱釉坛的烧制特征
    var raw = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.30, 0.055, 34),
      new THREE.MeshStandardMaterial({ color: 0x8A6244, roughness: 0.95 }));
    raw.position.y = 0.026;
    raw.name = 'unglazed_foot_ring';
    g.add(raw);

    // 肩部弦纹与指压纹：资料记"肩部弦纹"
    var cordMat = new THREE.MeshStandardMaterial({ color: 0x3B2213, roughness: 0.6 });
    [0.60, 0.665, 0.73].forEach(function (y, n) {
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.505 - n * 0.006, 0.010, 6, 40), cordMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      ring.name = 'shoulder_cord_' + n;
      g.add(ring);
    });
    var pressM = [], po = new THREE.Object3D();
    for (var pn = 0; pn < 26; pn++) {
      var pa = (pn / 26) * Math.PI * 2;
      pressM.push([Math.cos(pa) * 0.455, 0.80, Math.sin(pa) * 0.455, Math.PI / 2, -pa, 0]);
    }
    var press = new THREE.InstancedMesh(new THREE.SphereGeometry(0.026, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xB07E4C, roughness: 0.55 }), pressM.length);
    press.name = 'shoulder_finger_impressions';
    pressM.forEach(function (m, n) {
      po.position.set(m[0], m[1], m[2]);
      po.rotation.set(m[3], m[4], m[5]);
      po.scale.set(1, 1, 0.45);
      po.updateMatrix();
      press.setMatrixAt(n, po.matrix);
    });
    press.instanceMatrix.needsUpdate = true;
    g.add(press);

    // 红纸封口：纸面有褶皱，不是光滑圆柱
    var paperMat = new THREE.MeshStandardMaterial({ color: 0xB2352A, roughness: 0.78, side: THREE.DoubleSide });
    var capGeo = new THREE.CylinderGeometry(0.34, 0.30, 0.07, 30, 3, false);
    var cp = capGeo.attributes.position;
    for (var ci = 0; ci < cp.count; ci++) {
      var cx = cp.getX(ci), cy = cp.getY(ci), cz = cp.getZ(ci);
      var ca = Math.atan2(cz, cx), cr = Math.hypot(cx, cz);
      var crinkle = Math.sin(ca * 9 + cy * 12) * 0.008 + Math.sin(ca * 21) * 0.004;
      cp.setX(ci, Math.cos(ca) * (cr + crinkle));
      cp.setZ(ci, Math.sin(ca) * (cr + crinkle));
    }
    capGeo.computeVertexNormals();
    var cap = new THREE.Mesh(capGeo, paperMat);
    cap.position.y = 1.18;
    cap.castShadow = true;
    cap.name = 'red_paper_seal_skirt';
    g.add(cap);
    var domeGeo = new THREE.SphereGeometry(0.33, 30, 14, 0, Math.PI * 2, 0, Math.PI / 2.4);
    var dp = domeGeo.attributes.position;
    for (var di = 0; di < dp.count; di++) {
      var dx = dp.getX(di), dy = dp.getY(di), dz = dp.getZ(di);
      var da = Math.atan2(dz, dx);
      var bulge = 1 + Math.sin(da * 8) * 0.035 + Math.sin(da * 19) * 0.015;
      dp.setX(di, dx * bulge);
      dp.setZ(di, dz * bulge);
    }
    domeGeo.computeVertexNormals();
    var dome = new THREE.Mesh(domeGeo, new THREE.MeshStandardMaterial({ color: 0x9E2C22, roughness: 0.8, side: THREE.DoubleSide }));
    dome.position.y = 1.21;
    dome.name = 'red_paper_seal_dome';
    g.add(dome);
    // 两道扎绳与绳结
    [1.155, 1.128].forEach(function (y, n) {
      var cord = new THREE.Mesh(new THREE.TorusGeometry(0.318 - n * 0.006, 0.013, 6, 30),
        new THREE.MeshStandardMaterial({ color: 0x4A3A22, roughness: 0.9 }));
      cord.rotation.x = Math.PI / 2;
      cord.position.y = y;
      cord.name = 'seal_cord_' + n;
      g.add(cord);
    });
    [[0.30, 0.06], [-0.22, -0.20]].forEach(function (o, n) {
      var knotA = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.010, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0x4A3A22, roughness: 0.9 }));
      knotA.position.set(o[0], 1.145, o[1]);
      knotA.rotation.set(1.2, 0.5 * (n ? -1 : 1), 0.3);
      knotA.name = 'cord_loop_' + n;
      g.add(knotA);
      var tail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.12, 6),
        new THREE.MeshStandardMaterial({ color: 0x54401F, roughness: 0.9 }));
      tail.position.set(o[0] * 1.06, 1.085, o[1] * 1.06);
      tail.rotation.z = 0.34 * (n ? -1 : 1);
      tail.name = 'cord_tail_' + n;
      g.add(tail);
    });

    // 坛前一只酒盏与一把竹酒提
    var cupProfile = [
      [0.00, 0.00], [0.10, 0.00], [0.12, 0.02], [0.14, 0.07], [0.13, 0.08], [0.10, 0.05]
    ].map(function (v) { return new THREE.Vector2(v[0], v[1]); });
    var cup = new THREE.Mesh(new THREE.LatheGeometry(cupProfile, 24),
      new THREE.MeshStandardMaterial({ color: 0xE8E0CC, roughness: 0.5, side: THREE.DoubleSide }));
    cup.position.set(0.62, 0.0, 0.42);
    cup.castShadow = true;
    cup.name = 'wine_cup';
    g.add(cup);
    var ladleHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.52, 8),
      new THREE.MeshStandardMaterial({ color: 0xB08C50, roughness: 0.8 }));
    ladleHandle.position.set(-0.52, 0.16, 0.40);
    ladleHandle.rotation.set(0.20, 0, 1.16);
    ladleHandle.name = 'bamboo_ladle_handle';
    g.add(ladleHandle);
    var ladleCup = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      new THREE.MeshStandardMaterial({ color: 0xA67E46, roughness: 0.8, side: THREE.DoubleSide }));
    ladleCup.position.set(-0.29, 0.05, 0.44);
    ladleCup.rotation.x = 0.32;
    ladleCup.name = 'bamboo_ladle_cup';
    g.add(ladleCup);
    // 坛下的草垫：酒坛不直接落地，防潮也防滑
    var straw = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 30),
      new THREE.MeshStandardMaterial({ color: 0x9E8A57, roughness: 0.95 }));
    straw.rotation.x = Math.PI / 2;
    straw.position.y = 0.012;
    straw.name = 'straw_mat_ring';
    g.add(straw);

    // 坛子连封口高约 1.28，压低才不会把红纸坛帽裁掉
    g.position.y = -0.58;
    return g;
  }

  /* ================================================================
     场景管理
     ================================================================ */
  function initScene(container) {
    viewportContainer=container;
    var w = container.clientWidth || 360, h = container.clientHeight || 300;
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
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver=new ResizeObserver(function(){resizeViewport();});
      resizeObserver.observe(container);
    } else window.addEventListener('resize',resizeViewport);
  }

  function resizeViewport() {
    if(!renderer||!camera||!viewportContainer)return;
    var w=viewportContainer.clientWidth,h=viewportContainer.clientHeight;
    // Hidden tabs report 0×0; preserve the last valid camera until they become visible.
    if(!w||!h)return;
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
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
      targetZoom = Math.max(2.5, Math.min(12, targetZoom + e.deltaY * 0.003));
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
        if (pinchDist > 0) targetZoom = Math.max(2.5, Math.min(12, targetZoom * pinchDist / nd));
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
      // canvasTex maps belong to the displayed model. Loaded shared image textures remain cached.
      generatedTextures.forEach(function (tex) { tex.dispose(); });
      generatedTextures.length=0;
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
    var seat = SEAT_CACHE[id];
    if (!seat) {
      var lo = {x: Infinity, y: Infinity, z: Infinity}, hi = {x: -Infinity, y: -Infinity, z: -Infinity};
      var sM = new THREE.Matrix4(), sV = new THREE.Vector3();
      // 逐实例逐顶点量。用几何包围盒近似那一版会漏掉部分网格（织带的最低点量成 -Infinity，
      // 结果整件被往下多推了 1.2），而这里每个 id 只算一次并缓存，代价可以接受。
      currentModel.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        var pos = o.geometry.attributes.position, n = o.isInstancedMesh ? o.count : 1;
        for (var k = 0; k < n; k++) {
          if (o.isInstancedMesh) { o.getMatrixAt(k, sM); sM.premultiply(o.matrixWorld); }
          else { sM.copy(o.matrixWorld); }
          for (var v = 0; v < pos.count; v++) {
            sV.fromBufferAttribute(pos, v).applyMatrix4(sM);
            if (sV.x < lo.x) lo.x = sV.x; if (sV.x > hi.x) hi.x = sV.x;
            if (sV.y < lo.y) lo.y = sV.y; if (sV.y > hi.y) hi.y = sV.y;
            if (sV.z < lo.z) lo.z = sV.z; if (sV.z > hi.z) hi.z = sV.z;
          }
        }
      });
      seat = SEAT_CACHE[id] = {lo: lo, hi: hi};
    }
    var lo2 = seat.lo, hi2 = seat.hi;
    var seatDelta = SEAT_ADJUST[id] || 0;
    currentModel.position.y += seatDelta;
    currentModel.updateMatrixWorld(true);
    // 小件器物要拉近才看得清编织与釉面：条目给的取景距离当作下限
    var spec = ITEMS.filter(function (it) { return it.id === id; })[0];
    // 包围球取景：任何一点到注视点都不超过半径，按半径/sin(半视场) 定距离就不会裁切
    var cy = (lo2.y + hi2.y) / 2 + seatDelta;
    var sphereR = Math.sqrt(Math.pow((hi2.x - lo2.x) / 2, 2) + Math.pow((hi2.y - lo2.y) / 2, 2) + Math.pow((hi2.z - lo2.z) / 2, 2));
    var fitDist = sphereR / Math.sin((camera.fov * Math.PI / 180) / 2);
    cameraFocusY = (FOCUS_BASE[id] === undefined ? 0.15 : FOCUS_BASE[id]) + seatDelta;
    targetRotX = id === 'weiwu' ? 0.44 : 0.25;
    // Return to the canonical view by the shortest arc. Assigning 0.4 outright left
    // rotY at whatever the auto-rotation had accumulated, so the lerp unwound tens of
    // radians in a second — the violent spin on switching models.
    targetRotY = rotY + shortestTurnTo(rotY, 0.4);
    targetPanX = 0; targetPanY = 0;
    // 画布越方，水平视野越窄，按条目给的取景距离会左右溢出：以桌面 1.28 的宽高比为基准拉远
    var vw = viewportContainer ? (viewportContainer.clientWidth || 360) : 360;
    var vh = viewportContainer ? (viewportContainer.clientHeight || 300) : 300;
    var aspect = vw / vh, back = 1.28 / (aspect > 0 ? aspect : 1.28);
    targetZoom = ((spec && spec.zoom) || 4.2) * Math.max(1, Math.min(1.35, back));
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
    // 俯仰交给相机绕行，模型只绕自身竖轴转台旋转。
    // 原来这里写的是 currentModel.rotation.x = rotX：模型被整块向前倾 0.44 弧度，
    // 围屋前缘（局部 z≈1.6）因此扎进地板 0.9 深、后缘浮起，就是"与底面穿模"的根因；
    // 而且地面阴影是水平的，模型一倾，接触面的穿帮更明显。
    if (currentModel) { currentModel.rotation.y = rotY; }
    var focusY = cameraFocusY + panY;
    camera.position.set(panX, focusY + zoom * Math.sin(rotX), zoom * Math.cos(rotX));
    camera.lookAt(panX, focusY, 0);
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
    debugCamera: function () { return camera; },
    debugRendererStats: function () {
      if (!renderer || !renderer.info) return null;
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    }
  };
})();
