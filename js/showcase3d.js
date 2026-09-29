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
    { id: 'hutoumao', name: '客家花帽', subtitle: '龙南刺绣花帽', icon: '\u{1F42F}', zoom: 4.2,
      desc: '黑缎为底，前额立体虎头刺绣以桃红、橙红、白色丝线绣制，眼部圆润有神，额顶饰"王"字。帽身周围有多处彩色花卉刺绣贴片，两侧饰以白色与彩色小绒球，是客家儿童祈福辟邪的标志性首服。' },
    { id: 'weiwu', name: '客家围屋', subtitle: '龙南关西新围', icon: '\u{1F3EF}', zoom: 7.8,
      desc: '经典客家方形围屋，国字形九井十八厅，高耸生土夯土墙配青石基座，四角三层歇山顶炮楼碉楼，墙体布满梅花枪眼。重檐门楼高悬关西新围金字牌匾，门前半月风水池与旗杆夹石，呈现坚固堡垒与礼制秩序。' },
    { id: 'dajinshan', name: '客家大襟衫', subtitle: '传统客家蓝衫', icon: '\u{1F458}', zoom: 4.6,
      desc: '赣南客家传统服饰代表，展于人台之上。天然靛蓝竖纹粗布染制，立领右衽大襟，领口至前襟镶滚桃红色挑花织带，袖口外翻露出多层红蓝白彩织挑花边饰。配深藏青阔腿裤，裤脚同饰挑花织带。' },
    { id: 'dongtoupa', name: '客家冬头帕', subtitle: '妇女御寒首服', icon: '\u{1F9E3}', zoom: 4.2,
      desc: '客家妇女防风御寒标志性头饰。博物馆玻璃柜中展陈两件冬头帕：一件红黑条纹，一件深褐色。红黑条纹冬头帕有白色底条与红色横纹交织，前端垂下两条彩色挑花织带与末端流苏，寓意带带相传。' },
    { id: 'bowei', name: '客家绣花脖围', subtitle: '如意八宝云肩', icon: '\u{1F4FF}', zoom: 3.8,
      desc: '客家妇女节庆盛装佩戴的如意云肩。黑底内环，八瓣如意云形外展，以白、淡紫、粉红多色丝绸拼缝，精绣桃红橙色缠枝花卉与如意纹。每瓣尖端缀圆形錾刻纯银徽牌，銀质小铃球悬于接缝处。' },
    { id: 'landye', name: '客家蓝染', subtitle: '渔仔潭围草木染', icon: '\u{1F9F5}', zoom: 4.8,
      desc: '展示两方靛蓝扎染方巾：一方深靛蓝底白色同心圆环纹，一方浅底放射状冰裂花纹。旁置青花瓷坛与古法双耳粗陶发酵染缸，呈现板蓝根草木染"三浸三晒三发酵"的传统工艺。' },
    { id: 'boji', name: '杨村竹编', subtitle: '客家农具与竹器', icon: '\u{1F9FA}', zoom: 3.2,
      desc: '博物馆展陈的杨村竹编：左为浅弧底竹编提篮，双弯弓竹提手，细密人字编纹；右为带盖竹编食盒，圆鼓造型，顶部精编穹顶盖，侧面六角透花编，方木搭扣提梁。展现杨村篾匠精湛手艺。' },
    { id: 'zhidai', name: '客家织带', subtitle: '绠瓠子与挑花带', icon: '\u{1F9F3}', zoom: 3.5,
      desc: '展示多条客家传统挑花织带。蓝灰底布上散放长条织带，有桃红底白字"幸福美满""四世同堂"挑花纹样带，也有蓝白色带中织入吉祥文字的蓝色系织带，末端均有分股彩色流苏。' },
    { id: 'zisundai', name: '客家子孙袋', subtitle: '刺绣祈福布袋', icon: '\u{1F45C}', zoom: 3.6,
      desc: '客家传统刺绣祈福布袋。袋身方形，中央浅黄底绣红橙色缠枝花卉纹，两侧镶蓝色布边，上下各饰一条红底白色铜钱纹几何花边。袋口收束为条纹格子布，是客家人祈求子孙繁衍的吉祥信物。' },
    { id: 'zhiyi', name: '客家纸艺', subtitle: '纸艺梅花盆景', icon: '\u{1F338}', zoom: 3.5,
      desc: '世界客家非遗展示馆藏品。以纸搓捻塑形的仿真梅花盆景：褐色纸塑主干苍劲盘曲，枝条横斜伸展，满缀数十朵粉橙色纸折梅花与嫩绿花苞。底部为深绿色六角形古典花盆，盆面浮雕花鸟纹样。' },
    { id: 'zhiji', name: '客家织机', subtitle: '传统手工织布机', icon: '\u{2699}', zoom: 5.5,
      desc: '龙南博物馆实物展陈的传统客家手工织布机。原木框架结构，前低后高，后端弯弓形张力架撑起蓝白色经线，经线穿过分绞棒与综框向前伸展，前端已织出一段蓝色条纹布匹。整机木质温润，绳索穿连。' },
    { id: 'yuwenshubi', name: '鱼纹梳篦', subtitle: '客家妇女发饰', icon: '\u{1F451}', zoom: 2.8,
      desc: '客家妇女传统金银发饰。一对鎏金发簪并排展示：左簪顶端为"吉"字镂空雕花，配如意卷草纹与翠绿宝石点缀；右簪顶端为立体花卉镂雕，嵌绿色宝石。簪身细长，中段有螺旋绕丝装饰。' }
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
      // 穗子头
      var tHead = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4),
        si % 3 === 0 ? matRed : (si % 3 === 1 ? matYellow : matBlue));
      tHead.position.set(sx, -0.08, sz);
      g.add(tHead);
    }

    // ---- 银饰与如意额帘材质 ----
    var silverTex = canvasTex('silverEngraving', 1, 1);
    var matSilver = new THREE.MeshStandardMaterial({
      bumpMap: silverTex || null,
      bumpScale: 0.04,
      color: 0xEEF0F8,
      roughness: 0.22,
      metalness: 0.85
    });

    // ---- 前额如意云头红锦缎额带（参考原图211实物） ----
    var ruyiBand = new THREE.Mesh(
      new THREE.CylinderGeometry(1.01, 1.02, 0.16, 36, 1, true, -Math.PI * 0.32, Math.PI * 0.64),
      matRed
    );
    ruyiBand.position.y = 0.52;
    g.add(ruyiBand);

    [-0.08, 0.08].forEach(function (dy) {
      var ruyiTrim = new THREE.Mesh(
        new THREE.CylinderGeometry(1.025, 1.025, 0.015, 36, 1, true, -Math.PI * 0.32, Math.PI * 0.64),
        matGold
      );
      ruyiTrim.position.y = 0.52 + dy;
      g.add(ruyiTrim);
    });

    // 额带钉缀7尊纯银铸造八仙人牌与下垂细银链排铃
    for (var bi = -3; bi <= 3; bi++) {
      var ba = (bi / 3) * 0.38;
      var bx = Math.sin(ba) * 1.03;
      var bz = Math.cos(ba) * 1.03;

      var plaque = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.10, 0.018), matSilver);
      plaque.position.set(bx, 0.54, bz);
      plaque.rotation.y = ba;
      g.add(plaque);

      var arch = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.018, 12, 1, false, 0, Math.PI), matSilver);
      arch.rotation.x = Math.PI / 2;
      arch.rotation.z = Math.PI / 2 - ba;
      arch.position.set(bx, 0.59, bz);
      g.add(arch);

      // 下垂细银链
      var chainCurve = new THREE.LineCurve3(
        new THREE.Vector3(bx, 0.48, bz),
        new THREE.Vector3(bx, 0.36 - Math.abs(bi) * 0.015, bz)
      );
      var chain = new THREE.Mesh(new THREE.TubeGeometry(chainCurve, 3, 0.003, 4, false), matSilver);
      g.add(chain);

      var bell = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), matSilver);
      bell.position.set(bx, 0.35 - Math.abs(bi) * 0.015, bz);
      g.add(bell);
    }

    // ---- 帽顶红绿双色立体丝绒花球（参考原图211实物） ----
    [-0.30, 0.30].forEach(function (px, pidx) {
      var pMat = pidx === 0 ? matRed : matGreen;
      var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.010, 0.14, 8), matGold);
      stem.position.set(px, 1.08, 0.12);
      stem.rotation.z = (pidx === 0 ? 0.22 : -0.22);
      g.add(stem);

      var pomCenter = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 14), pMat);
      pomCenter.position.set(px * 1.25, 1.18, 0.12);
      g.add(pomCenter);

      for (var pi = 0; pi < 10; pi++) {
        var pa = (pi / 10) * Math.PI * 2;
        var pCluster = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), pMat);
        pCluster.position.set(
          px * 1.25 + Math.cos(pa) * 0.07,
          1.18 + Math.sin(pa) * 0.07,
          0.12 + (pi % 2 === 0 ? 0.025 : -0.025)
        );
        g.add(pCluster);
      }
    });

    // ---- 后披风下垂大红长飘带与大银铃（参考原图211实物） ----
    [-0.18, 0.18].forEach(function (rx) {
      var ribbonCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(rx, 0.08, -0.96),
        new THREE.Vector3(rx * 1.15, -0.15, -0.94),
        new THREE.Vector3(rx * 0.9, -0.36, -0.90),
        new THREE.Vector3(rx * 0.8, -0.52, -0.86)
      ]);
      var ribbon = new THREE.Mesh(new THREE.TubeGeometry(ribbonCurve, 16, 0.016, 4, false), matRed);
      g.add(ribbon);

      var bigBell = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), matSilver);
      bigBell.position.set(rx * 0.8, -0.55, -0.86);
      g.add(bigBell);

      var bellRim = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.006, 6, 16), matSilver);
      bellRim.rotation.x = Math.PI / 2;
      bellRim.position.set(rx * 0.8, -0.55, -0.86);
      g.add(bellRim);
    });

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
     客家大襟衫 —— 传统客家蓝衫 + 实木衣架展陈 + 立领右衽大襟 + 双道彩织挑花滚边 + 翻袖格纹 + 布结盘扣
     ================================================================ */
  function buildDajinshan() {
    var g = new THREE.Group();
    var blueTex = canvasTex('dajinshanCloth', 1, 1);
    var beltTex = canvasTex('wovenBelt', 1, 2.5);

    var matIndigo = new THREE.MeshStandardMaterial({
      map: blueTex,
      color: 0xffffff,
      roughness: 0.86,
      side: THREE.DoubleSide
    });
    var matLiningCheck = new THREE.MeshStandardMaterial({
      color: 0xB91C1C,
      roughness: 0.80,
      side: THREE.DoubleSide
    });
    var matTrim = new THREE.MeshStandardMaterial({
      map: beltTex,
      color: 0xffffff,
      roughness: 0.78,
      side: THREE.DoubleSide
    });
    var matWood = new THREE.MeshStandardMaterial({ color: 0x4A3018, roughness: 0.72 });
    var matDarkWood = new THREE.MeshStandardMaterial({ color: 0x2A1808, roughness: 0.8 });
    var matBlackSilk = new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.85 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.35, metalness: 0.4 });

    // ===== 1. 实木展示衣架（榫卯挂架） =====
    var baseBoard = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.04, 0.34), matDarkWood);
    baseBoard.position.set(0, -0.78, 0);
    baseBoard.receiveShadow = true;
    g.add(baseBoard);

    [-0.42, 0.42].forEach(function (px) {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.82, 12), matWood);
      pole.position.set(px, 0.13, 0);
      pole.castShadow = true;
      g.add(pole);

      var poleCap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), matDarkWood);
      poleCap.position.set(px, 1.05, 0);
      g.add(poleCap);
    });

    var hangerBar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.32, 12), matWood);
    hangerBar.rotation.z = Math.PI / 2;
    hangerBar.position.set(0, 0.96, 0);
    hangerBar.castShadow = true;
    g.add(hangerBar);

    [-0.66, 0.66].forEach(function (ex) {
      var tip = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), matDarkWood);
      tip.position.set(ex, 0.96, 0);
      g.add(tip);
    });

    // ===== 2. 衣身主干（平展微褶、下摆微展） =====
    var bodyH = 1.08;
    var bodyGeo = new THREE.CylinderGeometry(0.38, 0.52, bodyH, 36, 12, true);
    var bp = bodyGeo.attributes.position;
    for (var bi = 0; bi < bp.count; bi++) {
      var bx = bp.getX(bi), by = bp.getY(bi), bz = bp.getZ(bi);
      var bt = (bodyH / 2 - by) / bodyH;
      bz = bz * (0.28 + bt * 0.08);
      var wave = Math.sin(bx * 14) * 0.018 * bt;
      bp.setZ(bi, bz + wave);
    }
    bodyGeo.computeVertexNormals();
    var coatBody = new THREE.Mesh(bodyGeo, matIndigo);
    coatBody.position.set(0, 0.38, 0);
    coatBody.castShadow = true;
    coatBody.receiveShadow = true;
    g.add(coatBody);

    // ===== 3. 客家立领（小圆立领） =====
    var collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.145, 0.085, 24, 1, true),
      matIndigo
    );
    collar.position.set(0, 0.96, 0);
    collar.scale.set(1.0, 1.0, 0.65);
    g.add(collar);

    var collarTrim = new THREE.Mesh(
      new THREE.TorusGeometry(0.142, 0.012, 6, 24),
      matTrim
    );
    collarTrim.rotation.x = Math.PI / 2;
    collarTrim.position.set(0, 1.00, 0);
    collarTrim.scale.set(1.0, 0.65, 1.0);
    g.add(collarTrim);

    // ===== 4. 右衽大襟弧线滚边（大襟挑花带） =====
    var lapelCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.04, 0.92, 0.07),
      new THREE.Vector3(0.15, 0.82, 0.08),
      new THREE.Vector3(0.26, 0.68, 0.085),
      new THREE.Vector3(0.33, 0.50, 0.09),
      new THREE.Vector3(0.35, 0.22, 0.095),
      new THREE.Vector3(0.38, -0.15, 0.10)
    ]);
    var lapelBand = new THREE.Mesh(new THREE.TubeGeometry(lapelCurve, 24, 0.018, 4, false), matTrim);
    g.add(lapelBand);

    var lapelEdge = new THREE.Mesh(new THREE.TubeGeometry(lapelCurve, 24, 0.005, 4, false), matGold);
    g.add(lapelEdge);

    // ===== 5. 传统宽大连肩平袖 =====
    [-1, 1].forEach(function (side) {
      var sleeveCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.35, 0.92, 0),
        new THREE.Vector3(side * 0.52, 0.76, 0.01),
        new THREE.Vector3(side * 0.68, 0.54, 0.02)
      ]);
      var sleeve = new THREE.Mesh(new THREE.TubeGeometry(sleeveCurve, 12, 0.14, 16, false), matIndigo);
      sleeve.scale.set(1.0, 1.0, 0.45);
      sleeve.castShadow = true;
      g.add(sleeve);

      // 袖口外翻露出红格衬里与挑花织边（翻袖特征，客家妇女劳作利落考究）
      var cuffLining = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.148, 0.09, 16, 1, true),
        matLiningCheck
      );
      cuffLining.position.set(side * 0.68, 0.54, 0.02);
      cuffLining.rotation.z = side * 0.55;
      cuffLining.scale.set(1.0, 1.0, 0.48);
      g.add(cuffLining);

      var cuffTrim = new THREE.Mesh(
        new THREE.TorusGeometry(0.148, 0.014, 6, 20),
        matTrim
      );
      cuffTrim.position.set(side * 0.70, 0.51, 0.02);
      cuffTrim.rotation.y = Math.PI / 2;
      cuffTrim.rotation.x = side * 0.55;
      cuffTrim.scale.set(1.0, 0.48, 1.0);
      g.add(cuffTrim);
    });

    // ===== 6. 手工一字布结盘扣（传统纯黑布纽扣） =====
    var buttonPos = [
      [0.02, 0.94, 0.08],
      [0.10, 0.86, 0.085],
      [0.22, 0.74, 0.09],
      [0.31, 0.58, 0.095],
      [0.34, 0.38, 0.10]
    ];
    buttonPos.forEach(function (pos) {
      var knotBall = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), matBlackSilk);
      knotBall.position.set(pos[0], pos[1], pos[2]);
      g.add(knotBall);

      var knotBar = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.008, 0.008), matBlackSilk);
      knotBar.position.set(pos[0], pos[1], pos[2] - 0.002);
      g.add(knotBar);
    });

    // ===== 7. 衣摆下边缘滚边 =====
    var hemTrim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.525, 0.525, 0.035, 36, 1, true),
      matTrim
    );
    hemTrim.position.set(0, -0.14, 0);
    hemTrim.scale.set(1.0, 1.0, 0.36);
    g.add(hemTrim);

    g.position.y = 0.08;
    return g;
  }

  /* ================================================================
     客家冬头帕 —— T型实木展架 + 黑缎提花护额 + 两侧下垂披肩 + 双道长款五彩挑花织带与流苏
     ================================================================ */
  function buildDongtoupa() {
    var g = new THREE.Group();
    var silkTex = canvasTex('dongtoupaFabric', 1, 1);
    var zhidaiTex = canvasTex('zhidaiHighRes', 1, 2);

    var matSilk = new THREE.MeshStandardMaterial({
      map: silkTex,
      color: 0xffffff,
      roughness: 0.72,
      side: THREE.DoubleSide
    });
    var matZhidai = new THREE.MeshStandardMaterial({
      map: zhidaiTex,
      color: 0xffffff,
      roughness: 0.78,
      side: THREE.DoubleSide
    });
    var matStand = new THREE.MeshStandardMaterial({ color: 0x2A1B0E, roughness: 0.75 });
    var matRedSilk = new THREE.MeshStandardMaterial({ color: 0xB91C1C, roughness: 0.55 });
    var matWhiteSilk = new THREE.MeshStandardMaterial({ color: 0xF8FAFC, roughness: 0.6 });

    // ===== 1. 经典T型黑胡桃木展架 =====
    var base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.045, 0.28), matStand);
    base.position.set(0, -0.68, 0);
    base.receiveShadow = true;
    g.add(base);

    var standPole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.58, 12), matStand);
    standPole.position.set(0, 0.11, 0);
    standPole.castShadow = true;
    g.add(standPole);

    var tBar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 12), matStand);
    tBar.rotation.z = Math.PI / 2;
    tBar.position.set(0, 0.90, 0);
    tBar.castShadow = true;
    g.add(tBar);

    [-0.575, 0.575].forEach(function (tx) {
      var finial = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), matStand);
      finial.position.set(tx, 0.90, 0);
      g.add(finial);
    });

    // ===== 2. 冬头帕横向护额与披肩主体 =====
    var scarfW = 1.08, scarfH = 0.58;
    var scarfGeo = new THREE.PlaneGeometry(scarfW, scarfH, 36, 16);
    var sp = scarfGeo.attributes.position;
    for (var si = 0; si < sp.count; si++) {
      var sx = sp.getX(si), sy = sp.getY(si);
      var rx = Math.abs(sx) / (scarfW / 2);
      var drop = rx > 0.65 ? Math.pow(rx - 0.65, 1.8) * 0.28 : 0;
      var forward = Math.sin(rx * Math.PI) * 0.045;
      sp.setY(si, sy - drop);
      sp.setZ(si, forward);
    }
    scarfGeo.computeVertexNormals();
    var scarfMesh = new THREE.Mesh(scarfGeo, matSilk);
    scarfMesh.position.set(0, 0.68, 0.02);
    scarfMesh.castShadow = true;
    g.add(scarfMesh);

    var topBorder = new THREE.Mesh(new THREE.BoxGeometry(scarfW, 0.022, 0.015), matRedSilk);
    topBorder.position.set(0, 0.965, 0.025);
    g.add(topBorder);

    // ===== 3. 两条标志性下垂长款客家挑花织带（代代相传核心载体） =====
    [-0.18, 0.18].forEach(function (bx, idx) {
      var beltL = 0.98;
      var beltW = 0.13;
      var beltGeo = new THREE.PlaneGeometry(beltW, beltL, 8, 32);
      var bp = beltGeo.attributes.position;
      for (var bi = 0; bi < bp.count; bi++) {
        var by = bp.getY(bi);
        var t = 1 - (by + beltL / 2) / beltL;
        var wave = Math.sin(t * 3.8 + idx * 1.5) * 0.026 * t;
        bp.setZ(bi, 0.035 + wave);
      }
      beltGeo.computeVertexNormals();
      var belt = new THREE.Mesh(beltGeo, matZhidai);
      belt.position.set(bx, 0.90 - beltL / 2, 0.035);
      belt.castShadow = true;
      g.add(belt);

      var topKnot = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), matRedSilk);
      topKnot.position.set(bx, 0.90, 0.05);
      g.add(topKnot);

      var bottomY = 0.90 - beltL;
      var bar = new THREE.Mesh(new THREE.BoxGeometry(beltW * 0.95, 0.018, 0.014), matRedSilk);
      bar.position.set(bx, bottomY, 0.045);
      g.add(bar);

      for (var fi = 0; fi < 9; fi++) {
        var fx = bx - beltW * 0.4 + fi * (beltW * 0.8 / 8);
        var fMat = fi % 2 === 0 ? matWhiteSilk : matRedSilk;
        var tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.0015, 0.12, 4), fMat);
        tassel.position.set(fx, bottomY - 0.065, 0.045);
        tassel.rotation.z = (fi - 4) * 0.04;
        g.add(tassel);
      }
    });

    g.position.y = 0.05;
    return g;
  }

  /* ================================================================
     客家绣花脖围 —— 如意八宝云肩 + 黑丝绒牡丹刺绣 + 錾银徽牌压领 + 垂悬双层长命富贵银锁
     ================================================================ */
  function buildBowei() {
    var g = new THREE.Group();
    var velvetTex = canvasTex('cloudShoulderVelvet', 1, 1);
    var silverTex = canvasTex('silverEngraving', 1, 1);

    var matVelvet = new THREE.MeshStandardMaterial({
      map: velvetTex,
      color: 0xffffff,
      roughness: 0.88,
      side: THREE.DoubleSide
    });
    var matStand = new THREE.MeshStandardMaterial({ color: 0x221810, roughness: 0.75 });
    var matSilver = new THREE.MeshStandardMaterial({
      bumpMap: silverTex || null,
      bumpScale: 0.04,
      color: 0xEEEEF6,
      roughness: 0.24,
      metalness: 0.85
    });
    var matGoldTrim = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.35, metalness: 0.45 });
    var matBlackVelvet = new THREE.MeshStandardMaterial({ color: 0x0E0E12, roughness: 0.9 });

    // ===== 1. 实木展示立架（前倾展台） =====
    var standBase = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.05, 24), matStand);
    standBase.position.set(0, -0.62, 0);
    standBase.receiveShadow = true;
    g.add(standBase);

    var standStem = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.82, 16), matStand);
    standStem.position.set(0, -0.22, 0);
    standStem.castShadow = true;
    g.add(standStem);

    var collarMount = new THREE.Group();
    collarMount.position.set(0, 0.20, 0);
    collarMount.rotation.x = 0.52;

    // ===== 2. 内圈领环（黑丝绒滚边） =====
    var innerCollar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.038, 8, 36), matBlackVelvet);
    collarMount.add(innerCollar);

    var collarGoldRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.008, 6, 36), matGoldTrim);
    collarMount.add(collarGoldRing);

    // ===== 3. 多层如意八宝云肩瓣（层叠如意大盘） =====
    var shoulderDisc = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.72, 48, 4),
      matVelvet
    );
    shoulderDisc.castShadow = true;
    collarMount.add(shoulderDisc);

    var rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.016, 6, 48), matGoldTrim);
    collarMount.add(rimRing);

    for (var pi = 0; pi < 8; pi++) {
      var pa = (pi / 8) * Math.PI * 2;
      var px = Math.cos(pa) * 0.72;
      var py = Math.sin(pa) * 0.72;

      var lobe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), matVelvet);
      lobe.scale.set(1.0, 1.0, 0.15);
      lobe.position.set(px, py, -0.01);
      collarMount.add(lobe);

      var medal = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.014, 16), matSilver);
      medal.rotation.x = Math.PI / 2;
      medal.position.set(px, py, 0.02);
      collarMount.add(medal);

      var medalBead = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.005, 4, 16), matSilver);
      medalBead.position.set(px, py, 0.025);
      collarMount.add(medalBead);
    }

    // ===== 5. 前胸悬挂的双层长命富贵纯银锁与细银链 =====
    var lockGroup = new THREE.Group();
    lockGroup.position.set(0, -0.26, 0.04);

    [-0.08, 0.08].forEach(function (lx) {
      var chain = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 0.14, 6),
        matSilver
      );
      chain.position.set(lx, 0.07, 0);
      lockGroup.add(chain);
    });

    var lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.02), matSilver);
    lockGroup.add(lockBody);

    var lockArch = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 16, Math.PI), matSilver);
    lockArch.position.y = 0.055;
    lockGroup.add(lockArch);

    [-0.06, 0, 0.06].forEach(function (bx) {
      var bellStem = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.04, 4), matSilver);
      bellStem.position.set(bx, -0.07, 0);
      lockGroup.add(bellStem);

      var bell = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), matSilver);
      bell.position.set(bx, -0.09, 0);
      lockGroup.add(bell);
    });

    collarMount.add(lockGroup);
    g.add(collarMount);

    g.position.y = 0.02;
    return g;
  }

  /* ================================================================
     客家围屋 — 方形堡垒 + 夯土墙 + 四角炮楼 + 梅花枪眼 + 石板院
     ================================================================ */
  /* ================================================================
     客家围屋 —— 标志性防御性堡垒建筑：四角炮楼 + 夯土外墙 + 内部三进祠堂 + 环形走马楼
     ================================================================ */
  function buildWeiwu() {
    var g = new THREE.Group();

    var matWall = textures.rammedEarth
      ? new THREE.MeshStandardMaterial({ map: textures.rammedEarth, roughness: 0.95, metalness: 0.0 })
      : new THREE.MeshStandardMaterial({ color: 0x947D63, roughness: 0.95 });
    var matRoof = textures.roofTiles
      ? new THREE.MeshStandardMaterial({ map: textures.roofTiles, roughness: 0.78 })
      : new THREE.MeshStandardMaterial({ color: 0x2A2623, roughness: 0.78 });
    var matStone = textures.stonePaving
      ? new THREE.MeshStandardMaterial({ map: textures.stonePaving, roughness: 0.88 })
      : new THREE.MeshStandardMaterial({ color: 0x75706B, roughness: 0.88 });
    var matDarkStone = new THREE.MeshStandardMaterial({ color: 0x4A4642, roughness: 0.9 });
    var matWood = new THREE.MeshStandardMaterial({ color: 0x4A2E1B, roughness: 0.75 });
    var matPond = new THREE.MeshStandardMaterial({ color: 0x1A383A, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.9 });
    var matDoor = new THREE.MeshStandardMaterial({ color: 0x1F1109, roughness: 0.6 });
    var matWindow = new THREE.MeshStandardMaterial({ color: 0x0A0806, roughness: 0.9 });
    
    if (textures.rammedEarth) textures.rammedEarth.repeat.set(4, 2);
    if (textures.roofTiles) textures.roofTiles.repeat.set(5, 5);
    if (textures.stonePaving) textures.stonePaving.repeat.set(4, 4);

    var W = 2.6; // 整体宽度
    var L = 2.4; // 整体深度
    var H = 0.6; // 主墙高
    var T = 0.18; // 外墙厚
    var roofOverhang = 0.08;

    // ----- 1. 基础青石地台与外部环境 -----
    var basePlinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.08, L + 0.4), matDarkStone);
    basePlinth.position.set(0, 0.04, 0);
    basePlinth.receiveShadow = true;
    g.add(basePlinth);

    // 门前禾坪（打谷场）
    var heping = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.8), matStone);
    heping.position.set(0, 0.03, L / 2 + 0.4);
    heping.receiveShadow = true;
    g.add(heping);

    // 半月池（风水塘）
    var pondGeo = new THREE.CylinderGeometry(W * 0.4, W * 0.4, 0.05, 32, 1, false, 0, Math.PI);
    var pond = new THREE.Mesh(pondGeo, matPond);
    pond.position.set(0, 0.06, L / 2 + 0.8);
    g.add(pond);
    // 池塘青石护岸
    var curbGeo = new THREE.TorusGeometry(W * 0.4, 0.02, 6, 32, Math.PI);
    var curb = new THREE.Mesh(curbGeo, matDarkStone);
    curb.rotation.x = Math.PI / 2;
    curb.position.set(0, 0.07, L / 2 + 0.8);
    g.add(curb);

    // 门前功名桅杆夹石（一对）
    [-0.8, 0.8].forEach(function (fx) {
      var poleBase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.1), matDarkStone);
      poleBase.position.set(fx, 0.1, L / 2 + 0.3);
      g.add(poleBase);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.7, 8), matWood);
      pole.position.set(fx, 0.45, L / 2 + 0.3);
      g.add(pole);
    });

    // ----- 2. 主体围墙（生土夯筑） -----
    var wallGroup = new THREE.Group();
    wallGroup.position.y = 0.08;

    // 左、右、后墙
    var sideW = new THREE.Mesh(new THREE.BoxGeometry(T, H, L), matWall);
    sideW.position.set(-W / 2 + T / 2, H / 2, 0);
    sideW.castShadow = true;
    wallGroup.add(sideW);

    var sideE = new THREE.Mesh(new THREE.BoxGeometry(T, H, L), matWall);
    sideE.position.set(W / 2 - T / 2, H / 2, 0);
    sideE.castShadow = true;
    wallGroup.add(sideE);

    var backN = new THREE.Mesh(new THREE.BoxGeometry(W - T * 2, H, T), matWall);
    backN.position.set(0, H / 2, -L / 2 + T / 2);
    backN.castShadow = true;
    wallGroup.add(backN);

    // 前墙（留大门洞）
    var doorW = 0.35;
    var frontL = new THREE.Mesh(new THREE.BoxGeometry((W - doorW) / 2 - T, H, T), matWall);
    frontL.position.set(-W / 4 - doorW / 4 - T / 2, H / 2, L / 2 - T / 2);
    frontL.castShadow = true;
    wallGroup.add(frontL);

    var frontR = new THREE.Mesh(new THREE.BoxGeometry((W - doorW) / 2 - T, H, T), matWall);
    frontR.position.set(W / 4 + doorW / 4 + T / 2, H / 2, L / 2 - T / 2);
    frontR.castShadow = true;
    wallGroup.add(frontR);

    // 门楣上方夯土
    var doorTopH = 0.3;
    var frontTop = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorTopH, T), matWall);
    frontTop.position.set(0, H - doorTopH / 2, L / 2 - T / 2);
    wallGroup.add(frontTop);

    // 主围墙悬山顶/平顶覆瓦
    var mainRoofGeo = new THREE.BoxGeometry(W + roofOverhang * 2, 0.04, T + roofOverhang * 2);
    // 左、右、后、前檐顶
    var r1 = new THREE.Mesh(mainRoofGeo, matRoof);
    r1.scale.set(T / W, 1, L / T);
    r1.position.set(-W / 2 + T / 2, H + 0.02, 0);
    wallGroup.add(r1);

    var r2 = new THREE.Mesh(mainRoofGeo, matRoof);
    r2.scale.set(T / W, 1, L / T);
    r2.position.set(W / 2 - T / 2, H + 0.02, 0);
    wallGroup.add(r2);

    var r3 = new THREE.Mesh(mainRoofGeo, matRoof);
    r3.scale.set((W - T * 2) / W, 1, 1);
    r3.position.set(0, H + 0.02, -L / 2 + T / 2);
    wallGroup.add(r3);

    var r4 = new THREE.Mesh(mainRoofGeo, matRoof);
    r4.scale.set((W - T * 2) / W, 1, 1);
    r4.position.set(0, H + 0.02, L / 2 - T / 2);
    wallGroup.add(r4);

    g.add(wallGroup);

    // ----- 3. 门楼与防御铁门 -----
    var doorFrame = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.1, H - doorTopH, 0.08), matDarkStone);
    doorFrame.position.set(0, 0.08 + (H - doorTopH) / 2, L / 2 - T / 2 + 0.04);
    g.add(doorFrame);

    // 大门黑漆厚木铁皮门
    var leftDoor = new THREE.Mesh(new THREE.BoxGeometry(doorW / 2, H - doorTopH - 0.05, 0.04), matDoor);
    leftDoor.position.set(-doorW / 4, 0.08 + (H - doorTopH) / 2 - 0.025, L / 2 - T / 2);
    g.add(leftDoor);
    var rightDoor = new THREE.Mesh(new THREE.BoxGeometry(doorW / 2, H - doorTopH - 0.05, 0.04), matDoor);
    rightDoor.position.set(doorW / 4, 0.08 + (H - doorTopH) / 2 - 0.025, L / 2 - T / 2);
    // 右门微开
    rightDoor.rotation.y = -0.3;
    rightDoor.position.x += 0.02;
    rightDoor.position.z -= 0.04;
    g.add(rightDoor);

    // 门槛与台阶
    var step1 = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.4, 0.05, 0.15), matStone);
    step1.position.set(0, 0.105, L / 2 + 0.08);
    g.add(step1);
    var step2 = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.2, 0.04, 0.12), matStone);
    step2.position.set(0, 0.14, L / 2 + 0.02);
    g.add(step2);

    // ----- 4. 标志性四角炮楼（角楼） -----
    var towerW = 0.45;
    var towerH = H + 0.25; // 比主墙高
    var tPositions = [
      [-W / 2 + T / 2, -L / 2 + T / 2],
      [W / 2 - T / 2, -L / 2 + T / 2],
      [-W / 2 + T / 2, L / 2 - T / 2],
      [W / 2 - T / 2, L / 2 - T / 2]
    ];
    tPositions.forEach(function (pos) {
      var towerGrp = new THREE.Group();
      towerGrp.position.set(pos[0], 0.08, pos[1]);
      
      // 炮楼主体
      var tBody = new THREE.Mesh(new THREE.BoxGeometry(towerW, towerH, towerW), matWall);
      tBody.position.y = towerH / 2;
      tBody.castShadow = true;
      towerGrp.add(tBody);
      
      // 炮楼四坡屋顶
      var tRoof = new THREE.Mesh(new THREE.ConeGeometry(towerW * 0.8, 0.25, 4), matRoof);
      tRoof.rotation.y = Math.PI / 4; // 对角线对齐
      tRoof.position.y = towerH + 0.125;
      towerGrp.add(tRoof);
      
      // 枪眼/炮眼（每面两个，上层）
      var holeGeo = new THREE.BoxGeometry(0.06, 0.08, 0.02);
      var hole1 = new THREE.Mesh(holeGeo, matWindow);
      hole1.position.set(0, towerH - 0.15, towerW / 2 + 0.01);
      towerGrp.add(hole1);
      var hole2 = new THREE.Mesh(holeGeo, matWindow);
      hole2.position.set(towerW / 2 + 0.01, towerH - 0.15, 0);
      hole2.rotation.y = Math.PI / 2;
      towerGrp.add(hole2);

      g.add(towerGrp);
    });

    // ----- 5. 内部中轴线祠堂（祖堂） -----
    // 关西新围典型的"三进三开"中轴祠堂
    var hallW = 0.7;
    var hallL = 0.5;
    
    // 下厅
    var hall1 = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.35, hallL), matWood);
    hall1.position.set(0, 0.08 + 0.175, 0.4);
    g.add(hall1);
    var roof1 = new THREE.Mesh(new THREE.BoxGeometry(hallW + 0.1, 0.05, hallL + 0.1), matRoof);
    roof1.position.set(0, 0.08 + 0.35, 0.4);
    g.add(roof1);

    // 中厅（略高）
    var hall2 = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.45, hallL), matWood);
    hall2.position.set(0, 0.08 + 0.225, -0.15);
    g.add(hall2);
    var roof2 = new THREE.Mesh(new THREE.BoxGeometry(hallW + 0.1, 0.06, hallL + 0.1), matRoof);
    roof2.position.set(0, 0.08 + 0.45, -0.15);
    // 悬山顶微斜
    roof2.rotation.x = -0.1;
    g.add(roof2);

    // 上厅（最高，供奉祖先）
    var hall3 = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.55, hallL), matWood);
    hall3.position.set(0, 0.08 + 0.275, -0.7);
    g.add(hall3);
    var roof3 = new THREE.Mesh(new THREE.BoxGeometry(hallW + 0.15, 0.08, hallL + 0.1), matRoof);
    roof3.position.set(0, 0.08 + 0.55, -0.7);
    g.add(roof3);

    // 内部环形走廊/回廊（简化为内圈矮屋）
    var innerRingGeo = new THREE.BoxGeometry(W - T*2 - 0.2, 0.3, L - T*2 - 0.2);
    var innerRingHoleGeo = new THREE.BoxGeometry(W - T*2 - 0.8, 0.4, L - T*2 - 0.8);
    // 这里使用简单的四个长条来组合内环廊
    var ring1 = new THREE.Mesh(new THREE.BoxGeometry(W - T*2 - 0.2, 0.3, 0.3), matWood);
    ring1.position.set(0, 0.08 + 0.15, -L/2 + T + 0.25);
    g.add(ring1);
    var ring1R = new THREE.Mesh(new THREE.BoxGeometry(W - T*2 - 0.2 + 0.1, 0.04, 0.3 + 0.1), matRoof);
    ring1R.position.set(0, 0.08 + 0.3, -L/2 + T + 0.25);
    g.add(ring1R);

    var ring2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, L - T*2 - 0.2), matWood);
    ring2.position.set(-W/2 + T + 0.25, 0.08 + 0.15, 0);
    g.add(ring2);
    var ring2R = new THREE.Mesh(new THREE.BoxGeometry(0.3 + 0.1, 0.04, L - T*2 - 0.2 + 0.1), matRoof);
    ring2R.position.set(-W/2 + T + 0.25, 0.08 + 0.3, 0);
    g.add(ring2R);
    
    var ring3 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, L - T*2 - 0.2), matWood);
    ring3.position.set(W/2 - T - 0.25, 0.08 + 0.15, 0);
    g.add(ring3);
    var ring3R = new THREE.Mesh(new THREE.BoxGeometry(0.3 + 0.1, 0.04, L - T*2 - 0.2 + 0.1), matRoof);
    ring3R.position.set(W/2 - T - 0.25, 0.08 + 0.3, 0);
    g.add(ring3R);

    // 稍微调整一下整体位置，让它居中展示更好看
    g.position.y = -0.2;
    return g;
  }
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
     客家子孙袋 —— 方形刺绣祈福布袋：蓝色侧边 + 浅黄底缠枝花卉中心 + 红底铜钱纹花边 + 条纹袋口
     ================================================================ */
  function buildZisundai() {
    var g = new THREE.Group();

    // ---- 展示台（倾斜小木架） ----
    var standMat = new THREE.MeshStandardMaterial({ color: 0x4A3018, roughness: 0.55 });
    var standBase = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.03, 0.40), standMat);
    standBase.position.y = -0.35;
    standBase.castShadow = true;
    g.add(standBase);
    var standBack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.50, 0.02), standMat);
    standBack.position.set(0, -0.08, -0.18);
    standBack.rotation.x = -0.15;
    g.add(standBack);

    // ---- 袋身主体（方形厚板） ----
    var bodyGroup = new THREE.Group();
    bodyGroup.rotation.x = -0.15;
    bodyGroup.position.set(0, -0.05, -0.12);

    // 中央浅黄绣地
    var embTex = canvasTex('wovenBelt', 2, 2);
    var matCenter = new THREE.MeshStandardMaterial({ color: 0xF5E6C8, roughness: 0.72, map: embTex });
    var center = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.30, 0.025), matCenter);
    center.castShadow = true;
    bodyGroup.add(center);

    // 刺绣花卉装饰（中央叠加）
    var matEmb = new THREE.MeshStandardMaterial({ color: 0xE8445A, roughness: 0.45 });
    for (var fi = 0; fi < 5; fi++) {
      var petal = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), matEmb);
      var ang = fi * Math.PI * 2 / 5;
      petal.position.set(Math.cos(ang) * 0.045, Math.sin(ang) * 0.045, 0.018);
      petal.scale.set(1.4, 1, 0.5);
      bodyGroup.add(petal);
    }
    // 花心
    var matGold = new THREE.MeshStandardMaterial({ color: 0xFFD700, roughness: 0.35, metalness: 0.3 });
    var flowerCore = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), matGold);
    flowerCore.position.z = 0.02;
    bodyGroup.add(flowerCore);

    // 蓝色侧边布面
    var matBlue = new THREE.MeshStandardMaterial({ color: 0x1A4A8A, roughness: 0.82 });
    var leftPanel = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.30, 0.022), matBlue);
    leftPanel.position.x = -0.19;
    bodyGroup.add(leftPanel);
    var rightPanel = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.30, 0.022), matBlue);
    rightPanel.position.x = 0.19;
    bodyGroup.add(rightPanel);

    // 红底铜钱纹花边（上下各一条）
    var matRed = new THREE.MeshStandardMaterial({ color: 0xCC2222, roughness: 0.75 });
    var topBand = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.024), matRed);
    topBand.position.y = 0.17;
    bodyGroup.add(topBand);
    var botBand = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.024), matRed);
    botBand.position.y = -0.17;
    bodyGroup.add(botBand);
    // 白色铜钱纹装饰点
    var matWhite = new THREE.MeshStandardMaterial({ color: 0xF5F0E8, roughness: 0.6 });
    for (var ci = 0; ci < 8; ci++) {
      var coin = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), matWhite);
      coin.position.set(-0.18 + ci * 0.052, 0.17, 0.015);
      bodyGroup.add(coin);
      var coin2 = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), matWhite);
      coin2.position.set(-0.18 + ci * 0.052, -0.17, 0.015);
      bodyGroup.add(coin2);
    }

    // 条纹袋口
    var matStripe1 = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 });
    var matStripe2 = new THREE.MeshStandardMaterial({ color: 0xF5E6C8, roughness: 0.8 });
    for (var si = 0; si < 6; si++) {
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.015, 0.023),
        si % 2 === 0 ? matStripe1 : matStripe2);
      stripe.position.y = 0.22 + si * 0.015;
      bodyGroup.add(stripe);
    }

    // 袋口收束褶皱
    var matGather = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.78 });
    var gatherTop = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.24, 0.03, 16), matGather);
    gatherTop.position.y = 0.33;
    bodyGroup.add(gatherTop);

    // 系绳
    var matRope = new THREE.MeshStandardMaterial({ color: 0xCC2222, roughness: 0.65 });
    var ropePts = [
      new THREE.Vector3(-0.08, 0.35, 0.02),
      new THREE.Vector3(-0.15, 0.50, 0.04),
      new THREE.Vector3(0.0, 0.60, 0.03),
      new THREE.Vector3(0.15, 0.50, 0.04),
      new THREE.Vector3(0.08, 0.35, 0.02)
    ];
    var ropeCurve = new THREE.CatmullRomCurve3(ropePts);
    var rope = new THREE.Mesh(new THREE.TubeGeometry(ropeCurve, 20, 0.008, 6, false), matRope);
    bodyGroup.add(rope);

    // 下垂流苏
    var matTassel = new THREE.MeshStandardMaterial({ color: 0xE8445A, roughness: 0.7 });
    for (var ti = 0; ti < 5; ti++) {
      var tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, 0.06, 4), matTassel);
      tassel.position.set(-0.10 + ti * 0.05, -0.22, 0.01);
      bodyGroup.add(tassel);
    }

    g.add(bodyGroup);
    g.position.y = -0.15;
    return g;
  }

  /* ================================================================
     客家纸艺梅花盆景 —— 纸塑苍劲树干 + 粉橙纸折梅花 + 嫩绿花苞 + 深绿六角古盆 + 白卵石
     ================================================================ */
  function buildZhiyi() {
    var g = new THREE.Group();

    // ---- 六角形花盆 ----
    var matPot = new THREE.MeshStandardMaterial({ color: 0x2E5E3A, roughness: 0.45, metalness: 0.05 });
    var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.18, 6), matPot);
    pot.position.y = -0.42;
    pot.castShadow = true;
    g.add(pot);
    // 盆口唇边
    var matPotRim = new THREE.MeshStandardMaterial({ color: 0x3A7A4A, roughness: 0.38 });
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.015, 8, 6), matPotRim);
    rim.position.y = -0.33;
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
    // 盆面浮雕装饰（简化为色带）
    var matRelief = new THREE.MeshStandardMaterial({ color: 0x5A9A6A, roughness: 0.55 });
    var relief = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.01, 8, 6), matRelief);
    relief.position.y = -0.39;
    relief.rotation.x = Math.PI / 2;
    g.add(relief);

    // 白卵石
    var matPebble = new THREE.MeshStandardMaterial({ color: 0xF0EDE5, roughness: 0.6 });
    for (var pi = 0; pi < 18; pi++) {
      var pa = pi * Math.PI * 2 / 18 + Math.random() * 0.3;
      var pr = Math.random() * 0.14 + 0.02;
      var pebble = new THREE.Mesh(new THREE.SphereGeometry(0.018 + Math.random() * 0.012, 6, 5), matPebble);
      pebble.position.set(Math.cos(pa) * pr, -0.32, Math.sin(pa) * pr);
      pebble.scale.y = 0.5 + Math.random() * 0.3;
      g.add(pebble);
    }

    // ---- 树干（主干 + 分枝） ----
    var matBark = new THREE.MeshStandardMaterial({ color: 0x5A3520, roughness: 0.92 });

    // 主干
    var trunkPts = [
      new THREE.Vector3(0, -0.32, 0),
      new THREE.Vector3(-0.03, -0.15, 0.02),
      new THREE.Vector3(0.04, 0.0, -0.01),
      new THREE.Vector3(-0.02, 0.15, 0.03),
      new THREE.Vector3(0.01, 0.28, 0.0)
    ];
    var trunkCurve = new THREE.CatmullRomCurve3(trunkPts);
    var trunk = new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, 24, 0.035, 8, false), matBark);
    trunk.castShadow = true;
    g.add(trunk);

    // 分枝定义（方向、长度、起始Y）
    var branches = [
      { start: [0.02, 0.10, 0.0], mid: [0.18, 0.20, 0.08], end: [0.32, 0.28, 0.05], r: 0.018 },
      { start: [-0.01, 0.15, 0.02], mid: [-0.15, 0.28, -0.05], end: [-0.28, 0.35, -0.02], r: 0.016 },
      { start: [0.03, 0.22, -0.01], mid: [0.12, 0.35, -0.10], end: [0.22, 0.42, -0.08], r: 0.014 },
      { start: [-0.02, 0.25, 0.03], mid: [-0.08, 0.38, 0.12], end: [-0.18, 0.45, 0.10], r: 0.012 },
      { start: [0.01, 0.28, 0.0], mid: [0.02, 0.42, 0.02], end: [0.05, 0.52, -0.02], r: 0.012 },
      // 低分枝
      { start: [0.0, -0.05, 0.01], mid: [0.15, 0.02, 0.10], end: [0.25, 0.08, 0.14], r: 0.015 },
      { start: [-0.02, 0.0, -0.01], mid: [-0.12, 0.05, -0.12], end: [-0.22, 0.12, -0.15], r: 0.013 }
    ];

    for (var bi = 0; bi < branches.length; bi++) {
      var b = branches[bi];
      var bCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(b.start[0], b.start[1], b.start[2]),
        new THREE.Vector3(b.mid[0], b.mid[1], b.mid[2]),
        new THREE.Vector3(b.end[0], b.end[1], b.end[2])
      ]);
      var bMesh = new THREE.Mesh(new THREE.TubeGeometry(bCurve, 12, b.r, 6, false), matBark);
      bMesh.castShadow = true;
      g.add(bMesh);
    }

    // ---- 梅花（分布在枝条末端与中段） ----
    var matPetalPink = new THREE.MeshStandardMaterial({ color: 0xF4A460, roughness: 0.65, side: THREE.DoubleSide });
    var matPetalDeep = new THREE.MeshStandardMaterial({ color: 0xFF8C69, roughness: 0.60, side: THREE.DoubleSide });
    var matStamen = new THREE.MeshStandardMaterial({ color: 0xFFD700, roughness: 0.4, metalness: 0.2 });
    var matBud = new THREE.MeshStandardMaterial({ color: 0x6B8E23, roughness: 0.7 });

    var flowerPositions = [
      [0.32, 0.28, 0.05], [0.26, 0.24, 0.07], [-0.28, 0.35, -0.02], [-0.22, 0.30, -0.04],
      [0.22, 0.42, -0.08], [0.18, 0.38, -0.06], [-0.18, 0.45, 0.10], [-0.14, 0.40, 0.08],
      [0.05, 0.52, -0.02], [0.03, 0.48, 0.0], [0.25, 0.08, 0.14], [0.20, 0.05, 0.12],
      [-0.22, 0.12, -0.15], [-0.18, 0.08, -0.12], [0.15, 0.18, 0.06], [-0.12, 0.25, -0.03],
      [0.08, 0.32, -0.05], [-0.06, 0.35, 0.06], [0.10, 0.12, 0.09], [-0.16, 0.20, -0.08]
    ];

    for (var fli = 0; fli < flowerPositions.length; fli++) {
      var fp = flowerPositions[fli];
      var flowerGroup = new THREE.Group();
      flowerGroup.position.set(fp[0], fp[1], fp[2]);

      // 每朵花5个花瓣
      var petalMat = fli % 3 === 0 ? matPetalDeep : matPetalPink;
      for (var pi2 = 0; pi2 < 5; pi2++) {
        var pa2 = pi2 * Math.PI * 2 / 5;
        var petal = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), petalMat);
        petal.position.set(Math.cos(pa2) * 0.018, Math.sin(pa2) * 0.018, 0);
        petal.scale.set(1.3, 1.0, 0.35);
        flowerGroup.add(petal);
      }
      // 花蕊
      for (var si2 = 0; si2 < 3; si2++) {
        var stamen = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.001, 0.015, 4), matStamen);
        var sa = si2 * Math.PI * 2 / 3;
        stamen.position.set(Math.cos(sa) * 0.006, Math.sin(sa) * 0.006, 0.008);
        flowerGroup.add(stamen);
      }
      // 随机朝向
      flowerGroup.rotation.set(Math.random() * 0.8 - 0.4, Math.random() * Math.PI * 2, Math.random() * 0.5 - 0.25);
      g.add(flowerGroup);
    }

    // 花苞（嫩绿小锥）
    var budPositions = [
      [0.30, 0.32, 0.04], [-0.25, 0.38, -0.01], [0.20, 0.45, -0.09],
      [-0.10, 0.42, 0.12], [0.06, 0.50, 0.01], [0.22, 0.15, 0.10],
      [-0.20, 0.15, -0.13], [0.12, 0.26, 0.04], [-0.08, 0.32, -0.06]
    ];
    for (var bdi = 0; bdi < budPositions.length; bdi++) {
      var bp = budPositions[bdi];
      var bud = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.022, 5), matBud);
      bud.position.set(bp[0], bp[1], bp[2]);
      bud.rotation.set(Math.random() * 0.5, 0, Math.random() * Math.PI);
      g.add(bud);
    }

    g.position.y = -0.1;
    return g;
  }

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
  /* ================================================================
     客家织带 —— 更精细的立体悬垂、多条错落彩带、堆叠效果
     ================================================================ */
  function buildZhidai() {
    var g = new THREE.Group();
    var beltTex = canvasTex('wovenBelt', 1, 2.2);

    var matWood = new THREE.MeshStandardMaterial({ color: 0x543B22, roughness: 0.72 });
    var matDarkWood = new THREE.MeshStandardMaterial({ color: 0x362210, roughness: 0.78 });
    var matBamboo = new THREE.MeshStandardMaterial({ color: 0xC89E58, roughness: 0.65 });
    var matRedSilk = new THREE.MeshStandardMaterial({ color: 0xB82424, roughness: 0.55 });
    var matIndigoSilk = new THREE.MeshStandardMaterial({ color: 0x1E3B5C, roughness: 0.6 });
    
    var beltMat = new THREE.MeshStandardMaterial({
      map: beltTex, color: 0xffffff, roughness: 0.78, side: THREE.DoubleSide
    });

    var standH = 1.05;

    // ----- 1. 织带木架基座 -----
    var base = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 0.48), matWood);
    base.position.set(0, 0.025, 0);
    base.receiveShadow = true;
    g.add(base);

    [[-0.56, -0.18], [0.56, -0.18], [-0.56, 0.18], [0.56, 0.18]].forEach(function (pos) {
      var foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.08), matDarkWood);
      foot.position.set(pos[0], 0.01, pos[1]);
      g.add(foot);
    });

    // 立柱
    [-0.50, 0.50].forEach(function (x) {
      var postShoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.20), matDarkWood);
      postShoe.position.set(x, 0.06, 0);
      g.add(postShoe);

      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.035, standH, 12), matWood);
      post.position.set(x, standH / 2 + 0.04, 0);
      post.castShadow = true;
      g.add(post);

      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), matDarkWood);
      cap.position.set(x, standH + 0.05, 0);
      g.add(cap);
    });

    // 后张力木轴
    var rearRoller = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.04, 12), matWood);
    rearRoller.rotation.z = Math.PI / 2;
    rearRoller.position.set(0, 0.52, -0.14);
    g.add(rearRoller);

    [-0.50, 0.50].forEach(function (x) {
      var strutCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, 0.06, 0.07),
        new THREE.Vector3(x, 0.28, -0.05),
        new THREE.Vector3(x, 0.52, -0.14)
      ]);
      var strut = new THREE.Mesh(new THREE.TubeGeometry(strutCurve, 8, 0.015, 6, false), matDarkWood);
      g.add(strut);
    });

    // 主横梁
    var mainBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.14, 16), matWood);
    mainBeam.rotation.z = Math.PI / 2;
    mainBeam.position.set(0, standH, 0);
    mainBeam.castShadow = true;
    g.add(mainBeam);

    // 未织完的经线带轴
    var beltRoll = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.28, 24),
      new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.82 })
    );
    beltRoll.rotation.z = Math.PI / 2;
    beltRoll.position.set(-0.14, 0.52, -0.14);
    g.add(beltRoll);

    // 张紧的五彩经线束阵列 (增加密度)
    var warpCount = 28;
    for (var wi = 0; wi < warpCount; wi++) {
      var wx = -0.35 + wi * (0.7 / (warpCount - 1));
      var wCurve = new THREE.LineCurve3(
        new THREE.Vector3(wx, 0.52, -0.14),
        new THREE.Vector3(wx, standH, 0)
      );
      var wMat = (wi % 3 === 0) ? matRedSilk : (wi % 3 === 1 ? matIndigoSilk : new THREE.MeshStandardMaterial({color: 0xF5EFE1, roughness:0.85}));
      var wThread = new THREE.Mesh(new THREE.TubeGeometry(wCurve, 4, 0.002, 3, false), wMat);
      g.add(wThread);
    }

    // ----- 2. 高精度立体悬垂与堆叠织带 -----
    function makeHangingBelt(xCenter, length, zOffset, sway, phase, addPooling) {
      var w = 0.15;
      var segsY = 64, segsX = 8; // 更高的多边形数以平滑褶皱
      var geo = new THREE.PlaneGeometry(w, length, segsX, segsY);
      var pos = geo.attributes.position;

      for (var i = 0; i < pos.count; i++) {
        var px = pos.getX(i);
        var py = pos.getY(i);
        // t从0(顶)到1(底)
        var t = 1 - (py + length / 2) / length;

        var pz = 0;
        var pXOffset = 0;
        
        if (t < 0.1) {
          pz = Math.sin(t / 0.1 * Math.PI * 0.5) * 0.04;
        } else if (addPooling && t > 0.8) {
          // 底部堆叠褶皱效果
          var poolT = (t - 0.8) / 0.2; // 0 to 1
          pz = 0.04 + Math.sin(t * 15 + phase) * 0.08 * poolT;
          pXOffset = Math.sin(t * 20) * 0.05 * poolT;
          py = py + poolT * 0.15; // 压缩长度形成堆积
        } else {
          // 自然下垂的风动摇摆
          pz = 0.04 + Math.sin(t * 4.5 + phase) * 0.05 * t + Math.cos(px * 15) * 0.008;
          pXOffset = Math.sin(t * 3.5 + sway) * 0.04 * t;
        }
        
        var rotTwist = Math.sin(t * 3.0 + sway) * 0.06 * t;
        pos.setX(i, px * (1 - 0.02 * t) + rotTwist * 0.4 + pXOffset);
        pos.setY(i, py);
        pos.setZ(i, pz);
      }
      geo.computeVertexNormals();

      var mesh = new THREE.Mesh(geo, beltMat);
      mesh.position.set(xCenter, standH - length / 2, zOffset);
      mesh.castShadow = true;
      g.add(mesh);
    }

    // 主织带（长，带底部堆叠）
    makeHangingBelt(0, 0.95, 0.05, 0, 0, true);
    // 侧边织带1（短，不同相位）
    makeHangingBelt(-0.25, 0.65, 0.08, 0.5, 1.2, false);
    // 侧边织带2（长，交错）
    makeHangingBelt(0.28, 0.85, 0.02, -0.4, 2.5, true);

    // 散落在台面上的织带卷/平铺
    var flatBeltGeo = new THREE.PlaneGeometry(0.15, 0.4, 4, 12);
    var fPos = flatBeltGeo.attributes.position;
    for(var j=0; j<fPos.count; j++) {
       var fy = fPos.getY(j);
       var fx = fPos.getX(j);
       fPos.setZ(j, Math.sin(fy*20)*0.01 + Math.cos(fx*10)*0.005);
    }
    flatBeltGeo.computeVertexNormals();
    var flatBelt = new THREE.Mesh(flatBeltGeo, beltMat);
    flatBelt.rotation.x = -Math.PI / 2;
    flatBelt.rotation.z = 0.4;
    flatBelt.position.set(-0.35, 0.06, 0.1);
    g.add(flatBelt);

    // 加上流苏
    [-0.25, 0, 0.28].forEach(function(cx, idx) {
       var len = [0.65, 0.95, 0.85][idx];
       if(len >= 0.95) return; // 堆叠的就不加流苏了
       var knotY = standH - len;
       var knotBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.015), matDarkWood);
       knotBar.position.set(cx + Math.sin(1*3.5+0.5)*0.04, knotY, 0.08 + Math.sin(1*4.5+1.2)*0.05);
       // g.add(knotBar); 简化流苏连接处
    });

    g.position.y = -0.35;
    return g;
  }
  function buildZhiji() {
    var g = new THREE.Group();

    var matWood = new THREE.MeshStandardMaterial({ color: 0xB8860B, roughness: 0.52 });
    var matDarkWood = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.58 });
    var matRope = new THREE.MeshStandardMaterial({ color: 0x386641, roughness: 0.7 });
    var matThread = new THREE.MeshStandardMaterial({ color: 0x4A7BB0, roughness: 0.85 });
    var matWhiteThread = new THREE.MeshStandardMaterial({ color: 0xF5EBE0, roughness: 0.85 });
    var matCloth = new THREE.MeshStandardMaterial({ color: 0x3A5A8C, roughness: 0.88, side: THREE.DoubleSide });
    var matBamboo = new THREE.MeshStandardMaterial({ color: 0xA3B18A, roughness: 0.55 });

    // ---- 基座坐凳（前部） ----
    // 底横档
    var baseFront = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.05, 0.05), matWood);
    baseFront.position.set(0, -0.65, 0.50);
    baseFront.castShadow = true;
    g.add(baseFront);
    var baseBack = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.05, 0.05), matWood);
    baseBack.position.set(0, -0.65, 0.10);
    g.add(baseBack);
    // 坐凳面板
    var seatBoard = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.03, 0.35), matDarkWood);
    seatBoard.position.set(0, -0.55, 0.30);
    seatBoard.castShadow = true;
    g.add(seatBoard);
    // 凳腿
    for (var li = 0; li < 4; li++) {
      var lx = (li % 2 === 0 ? -0.35 : 0.35);
      var lz = (li < 2 ? 0.48 : 0.12);
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 8), matWood);
      leg.position.set(lx, -0.52, lz);
      g.add(leg);
    }

    // ---- 斜身主立柱（两根，后高前低） ----
    for (var si = 0; si < 2; si++) {
      var sx = si === 0 ? -0.35 : 0.35;
      var pillarPts = [
        new THREE.Vector3(sx, -0.55, 0.10),
        new THREE.Vector3(sx, -0.10, -0.25),
        new THREE.Vector3(sx, 0.45, -0.55)
      ];
      var pillarCurve = new THREE.CatmullRomCurve3(pillarPts);
      var pillar = new THREE.Mesh(new THREE.TubeGeometry(pillarCurve, 12, 0.03, 8, false), matWood);
      pillar.castShadow = true;
      g.add(pillar);
    }

    // 横档连接两立柱
    var crossBar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.68, 8), matWood);
    crossBar1.position.set(0, -0.30, -0.08);
    crossBar1.rotation.z = Math.PI / 2;
    g.add(crossBar1);
    var crossBar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.68, 8), matWood);
    crossBar2.position.set(0, 0.15, -0.35);
    crossBar2.rotation.z = Math.PI / 2;
    g.add(crossBar2);

    // ---- 顶部弯弓（竹弓） ----
    var bowPts = [
      new THREE.Vector3(-0.35, 0.45, -0.55),
      new THREE.Vector3(-0.30, 0.72, -0.62),
      new THREE.Vector3(0, 0.82, -0.65),
      new THREE.Vector3(0.30, 0.72, -0.62),
      new THREE.Vector3(0.35, 0.45, -0.55)
    ];
    var bowCurve = new THREE.CatmullRomCurve3(bowPts);
    var bow = new THREE.Mesh(new THREE.TubeGeometry(bowCurve, 20, 0.018, 8, false), matBamboo);
    bow.castShadow = true;
    g.add(bow);

    // ---- 吊绳（从弓顶垂下） ----
    for (var ri = 0; ri < 4; ri++) {
      var rx = -0.20 + ri * 0.13;
      var ropePts = [
        new THREE.Vector3(rx, 0.75 - Math.abs(rx) * 0.3, -0.63),
        new THREE.Vector3(rx, 0.35, -0.42),
        new THREE.Vector3(rx, 0.05, -0.20)
      ];
      var ropeCurve = new THREE.CatmullRomCurve3(ropePts);
      var rope = new THREE.Mesh(new THREE.TubeGeometry(ropeCurve, 10, 0.005, 4, false), matRope);
      g.add(rope);
    }

    // ---- 经线（蓝白条纹从后上斜拉到前下） ----
    for (var wi = 0; wi < 22; wi++) {
      var wx = -0.25 + wi * 0.023;
      var warpPts = [
        new THREE.Vector3(wx, 0.35, -0.50),
        new THREE.Vector3(wx, -0.10, -0.05),
        new THREE.Vector3(wx, -0.40, 0.25)
      ];
      var warpCurve = new THREE.CatmullRomCurve3(warpPts);
      var warpMat = wi % 3 === 0 ? matWhiteThread : matThread;
      var warp = new THREE.Mesh(new THREE.TubeGeometry(warpCurve, 8, 0.003, 4, false), warpMat);
      g.add(warp);
    }

    // ---- 综框（两根横杆 + 白纱帘） ----
    var heddleMat = new THREE.MeshStandardMaterial({ color: 0xF5F0E8, roughness: 0.9, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    var heddleBar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 8), matDarkWood);
    heddleBar1.position.set(0, 0.05, -0.18);
    heddleBar1.rotation.z = Math.PI / 2;
    g.add(heddleBar1);
    var heddleBar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 8), matDarkWood);
    heddleBar2.position.set(0, -0.15, -0.08);
    heddleBar2.rotation.z = Math.PI / 2;
    g.add(heddleBar2);
    var heddlePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.18), heddleMat);
    heddlePlane.position.set(0, -0.05, -0.13);
    heddlePlane.rotation.x = -0.45;
    g.add(heddlePlane);

    // ---- 已织成蓝布（前端垂下） ----
    var clothGeo = new THREE.PlaneGeometry(0.48, 0.35, 16, 12);
    var positions = clothGeo.attributes.position;
    for (var ci = 0; ci < positions.count; ci++) {
      var cy = positions.getY(ci);
      positions.setZ(ci, positions.getZ(ci) + Math.sin(cy * 5) * 0.01 + cy * 0.05);
    }
    var cloth = new THREE.Mesh(clothGeo, matCloth);
    cloth.position.set(0, -0.48, 0.40);
    cloth.rotation.x = -0.3;
    g.add(cloth);

    // ---- 卷布轴（前端圆木） ----
    var clothBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8), matWood);
    clothBeam.position.set(0, -0.33, 0.35);
    clothBeam.rotation.z = Math.PI / 2;
    g.add(clothBeam);

    // ---- 经轴（后上方圆木） ----
    var warpBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.60, 8), matDarkWood);
    warpBeam.position.set(0, 0.38, -0.52);
    warpBeam.rotation.z = Math.PI / 2;
    g.add(warpBeam);

    // ---- 脚踏板（两块） ----
    for (var ti = 0; ti < 2; ti++) {
      var tx = ti === 0 ? -0.12 : 0.12;
      var treadle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.015, 0.08), matDarkWood);
      treadle.position.set(tx, -0.63, 0.55);
      g.add(treadle);
      // 吊绳
      var treaPts = [
        new THREE.Vector3(tx, -0.63, 0.55),
        new THREE.Vector3(tx, -0.20, 0.10)
      ];
      var treaCurve = new THREE.CatmullRomCurve3(treaPts);
      var treaRope = new THREE.Mesh(new THREE.TubeGeometry(treaCurve, 6, 0.004, 4, false), matRope);
      g.add(treaRope);
    }

    // ---- 斜撑（对角支撑杆） ----
    for (var di = 0; di < 2; di++) {
      var dx = di === 0 ? -0.35 : 0.35;
      var diagPts = [
        new THREE.Vector3(dx, -0.55, 0.10),
        new THREE.Vector3(dx, 0.10, -0.30)
      ];
      var diagCurve = new THREE.CatmullRomCurve3(diagPts);
      var diag = new THREE.Mesh(new THREE.TubeGeometry(diagCurve, 6, 0.015, 6, false), matWood);
      g.add(diag);
    }

    g.position.y = 0.10;
    return g;
  }

  /* ================================================================
     鱼纹梳篦/发簪 —— 一对鎏金发簪：镂空花丝顶饰 + 翠绿宝石 + 螺旋绕丝 + 暗紫绒底展台
     ================================================================ */
  function buildYuwenshubi() {
    var g = new THREE.Group();

    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4AF37, roughness: 0.22, metalness: 0.88 });
    var matDarkGold = new THREE.MeshStandardMaterial({ color: 0xC59B27, roughness: 0.28, metalness: 0.85 });
    var matJade = new THREE.MeshStandardMaterial({ color: 0x2E8B57, roughness: 0.12, metalness: 0.05 });
    var matVelvet = new THREE.MeshStandardMaterial({ color: 0x1A1040, roughness: 0.95 });

    // ---- 展示底座（深紫绒布） ----
    var base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.30), matVelvet);
    base.position.y = -0.30;
    base.castShadow = true;
    g.add(base);
    var baseTop = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.015, 0.26), matVelvet);
    baseTop.position.y = -0.27;
    g.add(baseTop);

    // ============ 左簪："吉"字镂空 ============
    var leftGroup = new THREE.Group();
    leftGroup.position.x = -0.10;

    // 簪脚（细长针）
    var pinL = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, 0.50, 8), matGold);
    pinL.position.y = -0.02;
    pinL.castShadow = true;
    leftGroup.add(pinL);

    // 螺旋绕丝（中段）
    for (var ci = 0; ci < 12; ci++) {
      var coilAng = ci * Math.PI / 3;
      var coilY = 0.15 + ci * 0.008;
      var coil = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.002, 6, 12), matDarkGold);
      coil.position.set(Math.cos(coilAng) * 0.004, coilY, Math.sin(coilAng) * 0.004);
      coil.rotation.x = Math.PI / 2;
      leftGroup.add(coil);
    }

    // 顶饰底座（如意云头）
    var crownBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.025), matGold);
    crownBase.position.y = 0.28;
    leftGroup.add(crownBase);

    // "吉"字方框
    var jiFrame = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.005), matGold);
    jiFrame.position.y = 0.32;
    leftGroup.add(jiFrame);
    // 镂空效果（深色内芯）
    var jiHole = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.035, 0.006),
      new THREE.MeshStandardMaterial({ color: 0x1A1040, roughness: 0.9 }));
    jiHole.position.y = 0.32;
    leftGroup.add(jiHole);
    // "吉"字横画（两横一口）
    var matGoldBright = new THREE.MeshStandardMaterial({ color: 0xE5B83B, roughness: 0.20, metalness: 0.9 });
    var heng1 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.003, 0.006), matGoldBright);
    heng1.position.y = 0.34;
    leftGroup.add(heng1);
    var heng2 = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.003, 0.006), matGoldBright);
    heng2.position.y = 0.33;
    leftGroup.add(heng2);
    var shu = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.025, 0.006), matGoldBright);
    shu.position.y = 0.325;
    leftGroup.add(shu);
    // 口字
    var kou = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.015, 0.006), matGoldBright);
    kou.position.y = 0.305;
    leftGroup.add(kou);

    // 如意卷草翅展
    for (var wi = 0; wi < 2; wi++) {
      var wDir = wi === 0 ? -1 : 1;
      var wingPts = [
        new THREE.Vector3(0, 0.30, 0),
        new THREE.Vector3(wDir * 0.025, 0.33, 0.005),
        new THREE.Vector3(wDir * 0.045, 0.36, 0),
        new THREE.Vector3(wDir * 0.035, 0.39, -0.005)
      ];
      var wingCurve = new THREE.CatmullRomCurve3(wingPts);
      var wing = new THREE.Mesh(new THREE.TubeGeometry(wingCurve, 10, 0.004, 6, false), matGold);
      leftGroup.add(wing);
    }

    // 翠绿宝石（2颗）
    var jade1 = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), matJade);
    jade1.position.set(-0.015, 0.35, 0.006);
    jade1.scale.y = 0.7;
    leftGroup.add(jade1);
    var jade2 = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), matJade);
    jade2.position.set(0.018, 0.30, 0.006);
    jade2.scale.y = 0.7;
    leftGroup.add(jade2);

    g.add(leftGroup);

    // ============ 右簪：花卉镂雕 ============
    var rightGroup = new THREE.Group();
    rightGroup.position.x = 0.10;

    // 簪脚
    var pinR = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.002, 0.50, 8), matGold);
    pinR.position.y = -0.02;
    pinR.castShadow = true;
    rightGroup.add(pinR);

    // 螺旋绕丝
    for (var ci2 = 0; ci2 < 12; ci2++) {
      var coilAng2 = ci2 * Math.PI / 3;
      var coilY2 = 0.15 + ci2 * 0.008;
      var coil2 = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.002, 6, 12), matDarkGold);
      coil2.position.set(Math.cos(coilAng2) * 0.004, coilY2, Math.sin(coilAng2) * 0.004);
      coil2.rotation.x = Math.PI / 2;
      rightGroup.add(coil2);
    }

    // 花卉顶饰
    var flowerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.020, 0.015, 8), matGold);
    flowerBase.position.y = 0.28;
    rightGroup.add(flowerBase);

    // 花瓣（6瓣展开）
    for (var pi = 0; pi < 6; pi++) {
      var petalAng = pi * Math.PI * 2 / 6;
      var petal = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), matGold);
      petal.position.set(Math.cos(petalAng) * 0.020, 0.30 + Math.sin(petalAng * 0.5) * 0.01, Math.sin(petalAng) * 0.020);
      petal.scale.set(1.2, 0.6, 0.4);
      rightGroup.add(petal);
    }
    // 花蕊中心
    var stamen = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), matGoldBright);
    stamen.position.y = 0.31;
    rightGroup.add(stamen);

    // 叶片（两片）
    for (var lfi = 0; lfi < 2; lfi++) {
      var lfDir = lfi === 0 ? -1 : 1;
      var leafPts = [
        new THREE.Vector3(0, 0.29, 0),
        new THREE.Vector3(lfDir * 0.02, 0.33, 0.01),
        new THREE.Vector3(lfDir * 0.04, 0.35, 0.005)
      ];
      var leafCurve = new THREE.CatmullRomCurve3(leafPts);
      var leaf = new THREE.Mesh(new THREE.TubeGeometry(leafCurve, 8, 0.005, 5, false), matGold);
      rightGroup.add(leaf);
    }

    // 翠绿宝石
    var jade3 = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), matJade);
    jade3.position.set(0, 0.33, 0.008);
    jade3.scale.y = 0.7;
    rightGroup.add(jade3);
    var jade4 = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), matJade);
    jade4.position.set(-0.025, 0.30, 0.005);
    jade4.scale.y = 0.7;
    rightGroup.add(jade4);

    g.add(rightGroup);

    g.position.y = -0.05;
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
      case 'dajinshan': currentModel = buildDajinshan(); break;
      case 'dongtoupa': currentModel = buildDongtoupa(); break;
      case 'bowei': currentModel = buildBowei(); break;
      case 'landye': currentModel = buildLandye(); break;
      case 'boji': currentModel = buildBoji(); break;
      case 'zhidai': currentModel = buildZhidai(); break;
      case 'zisundai': currentModel = buildZisundai(); break;
      case 'zhiyi': currentModel = buildZhiyi(); break;
      case 'zhiji': currentModel = buildZhiji(); break;
      case 'yuwenshubi': currentModel = buildYuwenshubi(); break;
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
