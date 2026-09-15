/**
 * 3D 非遗器物展示模块 v3
 * Three.js + AI 纹理 + 方形围屋 + 刺绣纹理
 */
(function () {
  'use strict';

  var THREE = null;
  var currentModel = null;
  var renderer, scene, camera, animationId;
  var isDragging = false, prevMouse = { x: 0, y: 0 };
  var rotX = 0.25, rotY = 0.4, targetRotX = 0.25, targetRotY = 0.4;
  var zoom = 4.5, targetZoom = 4.5;
  var autoRotate = true;
  var idleTimer = null;
  var textures = {};

  var ITEMS = [
    { id: 'hutoumao', name: '虎头帽', subtitle: '定南客家童帽', icon: '\u{1F42F}',
      desc: '定南客家人给孩童缝制的精美童帽。正面绣虎头，两侧及后脑有虎爪，顶部补元宝形绣片，中心绣太阳花，后脑垂虎掌形尾巴，缀有多色拼布与蝴蝶、牡丹等花样。虎头帽上常见卍字纹、莲花纹，祝福吉祥平安。' },
    { id: 'weiwu', name: '客家围屋', subtitle: '龙南世界围屋之都', icon: '\u{1F3EF}',
      desc: '龙南现存客家围屋 376 座。围屋是客家先民聚族而居、御外自保的方形城堡式建筑，外墙夯土，屋顶覆小青瓦，四角设碉楼，中轴对称，方正厚重。' },
    { id: 'landye', name: '蓝染布', subtitle: '客家草木染', icon: '\u{1F9F5}',
      desc: '以板蓝根为原料，经制靛、浸染、氧化、晾晒等工序染制而成。扎染纹样以扎缝防染，形成深浅相间的同心圆与几何花纹，深沉温润的蓝色是客家女性心灵手巧的生动写照。' }
  ];

  function loadThree() {
    return new Promise(function (resolve, reject) {
      if (THREE) { resolve(THREE); return; }
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      s.onload = function () { THREE = window.THREE; resolve(THREE); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function loadTextures() {
    return new Promise(function (resolve) {
      if (!THREE) { resolve(); return; }
      var loader = new THREE.TextureLoader();
      var files = {
        tigerFace: 'assets/tiger-face.png',
        embroidery: 'assets/embroidery-pattern.png',
        landyeCloth: 'assets/landye-cloth.png',
        landyePattern: 'assets/landye-pattern.png',
        weiwuWall: 'assets/weiwu-wall.png',
        roofTiles: 'assets/roof-tiles.png'
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

  /* ========== 虎头帽 v2 ========== */
  function buildHutoumao() {
    var g = new THREE.Group();
    var matRed = new THREE.MeshStandardMaterial({ color: 0xC45C26, roughness: 0.72 });
    var matDark = new THREE.MeshStandardMaterial({ color: 0x2A2218, roughness: 0.85 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.3, metalness: 0.55 });
    var matWhite = new THREE.MeshStandardMaterial({ color: 0xFFF6E8, roughness: 0.65 });
    var matPink = new THREE.MeshStandardMaterial({ color: 0xE8A0BF, roughness: 0.6 });
    var matGreen = new THREE.MeshStandardMaterial({ color: 0x5B8C5A, roughness: 0.65 });
    var matBlue = new THREE.MeshStandardMaterial({ color: 0x3A6B8C, roughness: 0.65 });

    // 帽身（红底）
    var body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), matRed);
    body.position.y = 0.1;
    body.castShadow = true;
    g.add(body);

    // 刺绣纹理覆盖层（环绕帽身的装饰带）
    if (textures.embroidery) {
      var wrapGeo = new THREE.CylinderGeometry(1.005, 0.95, 0.7, 48, 1, true, 0, Math.PI * 2);
      var wrapTex = textures.embroidery.clone();
      wrapTex.repeat.set(3, 1);
      wrapTex.needsUpdate = true;
      var wrap = new THREE.Mesh(wrapGeo, new THREE.MeshStandardMaterial({
        map: wrapTex, roughness: 0.7, transparent: true, opacity: 0.85, side: THREE.DoubleSide
      }));
      wrap.position.y = 0.35;
      g.add(wrap);
    }

    // 内衬
    var inner = new THREE.Mesh(new THREE.SphereGeometry(0.92, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1A1410, roughness: 0.9, side: THREE.BackSide }));
    inner.position.y = 0.1;
    g.add(inner);

    // 帽檐
    var brim = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.14, 12, 48), matDark);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.06;
    g.add(brim);

    // 虎脸纹理（弯曲平面）
    if (textures.tigerFace) {
      var faceGeo = new THREE.PlaneGeometry(1.1, 1.1, 16, 16);
      var fp = faceGeo.attributes.position;
      for (var fi = 0; fi < fp.count; fi++) {
        var fx = fp.getX(fi), fy = fp.getY(fi);
        fp.setZ(fi, Math.max(0, 1 - Math.sqrt(fx * fx + fy * fy) * 0.8) * 0.15);
      }
      faceGeo.computeVertexNormals();
      var faceMesh = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({
        map: textures.tigerFace, roughness: 0.7, transparent: true, alphaTest: 0.1
      }));
      faceMesh.position.set(0, 0.5, 0.82);
      g.add(faceMesh);
    }

    // 立体虎眼
    [-0.2, 0.2].forEach(function (ex) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 }));
      eye.position.set(ex, 0.54, 0.9);
      g.add(eye);
      var hl = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 }));
      hl.position.set(ex + 0.03, 0.57, 0.96);
      g.add(hl);
    });

    // 虎耳（带内衬）
    function makeEar(side) {
      var ear = new THREE.Group();
      var outer = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI), matRed);
      outer.scale.set(1, 1.2, 0.4);
      ear.add(outer);
      var ie = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI), matPink);
      ie.scale.set(1, 1.1, 0.3);
      ie.position.z = 0.04;
      ear.add(ie);
      ear.position.set(side * 0.55, 0.85, 0.05);
      ear.rotation.z = side * -0.35;
      ear.rotation.x = -0.2;
      return ear;
    }
    g.add(makeEar(-1));
    g.add(makeEar(1));

    // 顶部元宝 + 太阳花
    var yuanbao = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 8), matGold);
    yuanbao.position.y = 1.05;
    g.add(yuanbao);
    for (var pi = 0; pi < 6; pi++) {
      var pa = (pi / 6) * Math.PI * 2;
      var petal = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), matGold);
      petal.position.set(Math.cos(pa) * 0.08, 1.1, Math.sin(pa) * 0.08);
      g.add(petal);
    }
    var center = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), matPink);
    center.position.y = 1.1;
    g.add(center);

    // 虎爪（掌形 + 三趾）
    function makeClaw(side, front) {
      var claw = new THREE.Group();
      // 掌垫
      var pad = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), matGold);
      claw.add(pad);
      // 三趾
      for (var t = 0; t < 3; t++) {
        var toe = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), matGold);
        toe.position.set((t - 1) * 0.04, 0.05, 0.02);
        claw.add(toe);
      }
      claw.position.set(side * 0.78, front ? 0.35 : 0.18, front ? 0.25 : 0.05);
      claw.rotation.z = side * -0.3;
      return claw;
    }
    g.add(makeClaw(-1, true));
    g.add(makeClaw(-1, false));
    g.add(makeClaw(1, true));
    g.add(makeClaw(1, false));

    // 尾巴（虎掌形末端）
    var tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.1, -0.9),
      new THREE.Vector3(0, -0.15, -1.0),
      new THREE.Vector3(0.05, -0.4, -0.95)
    ]);
    var tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.05, 8, false), matRed);
    g.add(tail);
    // 尾巴末端做成虎掌形（掌垫+趾）
    var tailPad = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), matGreen);
    tailPad.position.set(0.05, -0.42, -0.95);
    tailPad.scale.set(1, 0.8, 0.5);
    g.add(tailPad);
    for (var tt = 0; tt < 3; tt++) {
      var ttOffset = (tt - 1) * 0.05;
      var tToe = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), matGold);
      tToe.position.set(0.05 + ttOffset, -0.48, -0.97);
      g.add(tToe);
    }

    // 装饰花纹（蝴蝶/牡丹意象的小装饰）
    var decoMat = [matGold, matGreen, matBlue, matPink];
    var decoPos = [
      [-0.42, 0.68, 0.52], [0.42, 0.68, 0.52],
      [-0.55, 0.48, -0.28], [0.55, 0.48, -0.28],
      [0, 0.88, -0.48], [-0.3, 0.75, 0.6], [0.3, 0.75, 0.6]
    ];
    decoPos.forEach(function (p, i) {
      var d = new THREE.Mesh(new THREE.SphereGeometry(0.035 + (i % 3) * 0.01, 8, 6), decoMat[i % 4]);
      d.position.set(p[0], p[1], p[2]);
      g.add(d);
    });

    return g;
  }

  /* ========== 客家围屋（方形） ========== */
  function buildWeiwu() {
    var g = new THREE.Group();

    var matWall = textures.weiwuWall
      ? new THREE.MeshStandardMaterial({ map: textures.weiwuWall, roughness: 0.9 })
      : new THREE.MeshStandardMaterial({ color: 0xC4A882, roughness: 0.9 });
    var matRoof = textures.roofTiles
      ? new THREE.MeshStandardMaterial({ map: textures.roofTiles, roughness: 0.75 })
      : new THREE.MeshStandardMaterial({ color: 0x3D3228, roughness: 0.75 });
    var matInner = new THREE.MeshStandardMaterial({ color: 0xA08060, roughness: 0.85 });
    var matDoor = new THREE.MeshStandardMaterial({ color: 0x2A1F14, roughness: 0.6 });
    var matWood = new THREE.MeshStandardMaterial({ color: 0x6B4226, roughness: 0.7 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.3, metalness: 0.5 });

    if (textures.weiwuWall) textures.weiwuWall.repeat.set(2, 1);
    if (textures.roofTiles) textures.roofTiles.repeat.set(3, 3);

    // ===== 方形外墙（四面墙） =====
    var W = 1.8, H = 1.3, T = 0.12; // 宽、高、厚度
    // 前墙（有门洞）
    var frontL = new THREE.Mesh(new THREE.BoxGeometry(W * 0.35, H, T), matWall);
    frontL.position.set(-W * 0.325, H / 2, W / 2);
    frontL.castShadow = true;
    g.add(frontL);
    var frontR = new THREE.Mesh(new THREE.BoxGeometry(W * 0.35, H, T), matWall);
    frontR.position.set(W * 0.325, H / 2, W / 2);
    frontR.castShadow = true;
    g.add(frontR);
    // 门楣（门上方）
    var lintel = new THREE.Mesh(new THREE.BoxGeometry(W * 0.3, H * 0.25, T), matWall);
    lintel.position.set(0, H * 0.875, W / 2);
    g.add(lintel);

    // 后墙
    var back = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), matWall);
    back.position.set(0, H / 2, -W / 2);
    back.castShadow = true;
    g.add(back);

    // 左墙
    var left = new THREE.Mesh(new THREE.BoxGeometry(T, H, W), matWall);
    left.position.set(-W / 2, H / 2, 0);
    left.castShadow = true;
    g.add(left);

    // 右墙
    var right = new THREE.Mesh(new THREE.BoxGeometry(T, H, W), matWall);
    right.position.set(W / 2, H / 2, 0);
    right.castShadow = true;
    g.add(right);

    // ===== 基座 =====
    var base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.15, W + 0.3), matInner);
    base.position.y = 0.075;
    base.receiveShadow = true;
    g.add(base);

    // ===== 屋顶（四坡水，方形） =====
    // 主屋顶（用 4 个三角面模拟四坡顶）
    var roofH = 0.5;
    var roofVertices = new Float32Array([
      // 前坡
      -W/2-0.15, H, W/2+0.15,   W/2+0.15, H, W/2+0.15,   0, H+roofH, 0,
      // 后坡
      W/2+0.15, H, -W/2-0.15,  -W/2-0.15, H, -W/2-0.15,  0, H+roofH, 0,
      // 左坡
      -W/2-0.15, H, -W/2-0.15, -W/2-0.15, H, W/2+0.15,   0, H+roofH, 0,
      // 右坡
      W/2+0.15, H, W/2+0.15,   W/2+0.15, H, -W/2-0.15,  0, H+roofH, 0,
    ]);
    var roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.BufferAttribute(roofVertices, 3));
    roofGeo.computeVertexNormals();
    var roofMesh = new THREE.Mesh(roofGeo, matRoof);
    roofMesh.castShadow = true;
    g.add(roofMesh);

    // 屋脊
    var ridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), matWood);
    ridge.position.y = H + roofH;
    g.add(ridge);

    // ===== 内院 =====
    var court = new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, 0.05, W * 0.6), matInner);
    court.position.y = 0.18;
    court.receiveShadow = true;
    g.add(court);

    // 内墙（较矮，围合内院）
    var iw = W * 0.55, ih = 0.7;
    [[0, iw/2, iw, T], [0, -iw/2, iw, T], [-iw/2, 0, T, iw], [iw/2, 0, T, iw]].forEach(function (s) {
      var wallSeg = new THREE.Mesh(new THREE.BoxGeometry(s[2], ih, s[3]), matWall);
      wallSeg.position.set(s[0], 0.2 + ih / 2, s[1]);
      g.add(wallSeg);
    });

    // 天井（中央方形开口）
    var sky = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x8B9E7A, roughness: 0.8 }));
    sky.position.y = 0.22;
    g.add(sky);

    // ===== 大门 =====
    var arch = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, 0.08), matDoor);
    arch.position.set(0, 0.38, W / 2 + 0.05);
    g.add(arch);
    var frame = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.68, 0.05), matWood);
    frame.position.set(0, 0.4, W / 2 + 0.02);
    g.add(frame);
    // 门钉
    for (var di = 0; di < 2; di++) {
      for (var dj = 0; dj < 3; dj++) {
        var nail = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), matGold);
        nail.position.set(-0.07 + di * 0.14, 0.25 + dj * 0.14, W / 2 + 0.1);
        g.add(nail);
      }
    }
    // 门匾
    var plaque = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.03), matWood);
    plaque.position.set(0, 0.75, W / 2 + 0.07);
    g.add(plaque);

    // ===== 四角碉楼 =====
    var corners = [[-W/2, -W/2], [W/2, -W/2], [-W/2, W/2], [W/2, W/2]];
    corners.forEach(function (c) {
      var cx = c[0], cz = c[1];
      // 碉楼主体（比主墙高）
      var tw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.7, 0.3), matWall);
      tw.position.set(cx, 0.85, cz);
      tw.castShadow = true;
      g.add(tw);
      // 碉楼顶（小四坡）
      var trGeo = new THREE.ConeGeometry(0.28, 0.22, 4);
      var tr = new THREE.Mesh(trGeo, matRoof);
      tr.position.set(cx, 1.8, cz);
      tr.rotation.y = Math.PI / 4;
      g.add(tr);
      // 窗洞
      var win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), matDoor);
      win.position.set(cx, 1.3, cz + (cz > 0 ? 0.16 : -0.16));
      g.add(win);
      var win2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.06), matDoor);
      win2.position.set(cx + (cx > 0 ? 0.16 : -0.16), 1.3, cz);
      g.add(win2);
    });

    return g;
  }

  /* ========== 蓝染布 v2 ========== */
  function buildLandye() {
    var g = new THREE.Group();

    // 布料（用扎染纹理 + 波浪变形）
    var clothGeo = new THREE.PlaneGeometry(2, 2.4, 32, 32);
    var pos = clothGeo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 2.5 + 0.5) * 0.1 + Math.cos(y * 1.8) * 0.07 - Math.abs(x) * 0.05);
    }
    clothGeo.computeVertexNormals();

    var clothMat;
    if (textures.landyePattern) {
      var lt = textures.landyePattern.clone();
      lt.repeat.set(1.2, 1.2);
      lt.needsUpdate = true;
      clothMat = new THREE.MeshStandardMaterial({ map: lt, roughness: 0.85, side: THREE.DoubleSide });
    } else if (textures.landyeCloth) {
      clothMat = new THREE.MeshStandardMaterial({ map: textures.landyeCloth, roughness: 0.85, side: THREE.DoubleSide });
    } else {
      clothMat = new THREE.MeshStandardMaterial({ color: 0x2F5D50, roughness: 0.85, side: THREE.DoubleSide });
    }
    var cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.rotation.x = -0.08;
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    g.add(cloth);

    // 挂杆
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 12),
      new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.75 }));
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 1.25;
    rod.castShadow = true;
    g.add(rod);

    // 挂钩
    [-0.7, -0.3, 0.3, 0.7].forEach(function (hx) {
      var hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.4 }));
      hook.position.set(hx, 1.2, 0);
      hook.rotation.x = Math.PI / 2;
      g.add(hook);
    });

    // 染缸
    var vatMat = new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.88 });
    var vat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.55, 16), vatMat);
    vat.position.y = -0.9;
    vat.castShadow = true;
    g.add(vat);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 16), vatMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.62;
    g.add(rim);
    var liq = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0x0F2A22, roughness: 0.15 }));
    liq.position.y = -0.65;
    g.add(liq);

    // 板蓝根
    var stemMat = new THREE.MeshStandardMaterial({ color: 0x4A7A3A, roughness: 0.7 });
    var leafMat = new THREE.MeshStandardMaterial({ color: 0x3D6B2E, roughness: 0.65, side: THREE.DoubleSide });
    var px = 1.1, pz = -0.3;
    var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.5, 6), stemMat);
    stem.position.set(px, -0.7, pz);
    g.add(stem);
    for (var li = 0; li < 4; li++) {
      var leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), leafMat);
      var la = (li / 4) * Math.PI * 2;
      leaf.position.set(px + Math.cos(la) * 0.08, -0.55 + li * 0.1, pz + Math.sin(la) * 0.08);
      leaf.rotation.y = la;
      leaf.rotation.x = -0.3;
      g.add(leaf);
    }

    return g;
  }

  /* ========== 场景 ========== */

  function initScene(container) {
    var w = container.clientWidth || 360, h = 300;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEDE8DC);
    scene.fog = new THREE.Fog(0xEDE8DC, 6, 12);
    camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    camera.position.set(0, 0.4, zoom);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xfff5e6, 0.5));
    var main = new THREE.DirectionalLight(0xffeedd, 0.9);
    main.position.set(4, 6, 3);
    main.castShadow = true;
    main.shadow.mapSize.set(1024, 1024);
    scene.add(main);
    var fill = new THREE.DirectionalLight(0xd0e8ff, 0.35);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    var ground = new THREE.Mesh(new THREE.CircleGeometry(4, 32),
      new THREE.MeshStandardMaterial({ color: 0xD8D0C0, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.3;
    ground.receiveShadow = true;
    scene.add(ground);

    bindControls(renderer.domElement);
  }

  function bindControls(canvas) {
    function startDrag(x, y) {
      isDragging = true;
      autoRotate = false;
      prevMouse.x = x;
      prevMouse.y = y;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { autoRotate = true; }, 5000);
    }
    function moveDrag(x, y) {
      if (!isDragging) return;
      targetRotY += (x - prevMouse.x) * 0.008;
      targetRotX += (y - prevMouse.y) * 0.006;
      targetRotX = Math.max(-1.0, Math.min(1.0, targetRotX));
      prevMouse.x = x;
      prevMouse.y = y;
    }

    canvas.addEventListener('mousedown', function (e) { startDrag(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { moveDrag(e.clientX, e.clientY); });
    window.addEventListener('mouseup', function () { isDragging = false; });
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (isDragging && e.touches.length === 1) { e.preventDefault(); moveDrag(e.touches[0].clientX, e.touches[0].clientY); }
    }, { passive: false });
    canvas.addEventListener('touchend', function () { isDragging = false; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      targetZoom = Math.max(2.5, Math.min(8, targetZoom + e.deltaY * 0.003));
    }, { passive: false });

    var initDist = 0;
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        initDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (initDist > 0) targetZoom = Math.max(2.5, Math.min(8, targetZoom * initDist / d));
        initDist = d;
      }
    }, { passive: true });
  }

  function showModel(id) {
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.traverse(function (c) {
        if (c.geometry) c.geometry.dispose();
        if (c.material) { if (Array.isArray(c.material)) c.material.forEach(function (m) { m.dispose(); }); else c.material.dispose(); }
      });
      currentModel = null;
    }
    switch (id) {
      case 'hutoumao': currentModel = buildHutoumao(); break;
      case 'weiwu': currentModel = buildWeiwu(); break;
      case 'landye': currentModel = buildLandye(); break;
      default: currentModel = buildHutoumao();
    }
    scene.add(currentModel);
    targetRotX = 0.25;
    targetRotY = 0.4;
    targetZoom = id === 'weiwu' ? 5.0 : (id === 'landye' ? 4.5 : 4.0);
  }

  function animate() {
    animationId = requestAnimationFrame(animate);
    if (autoRotate && !isDragging) targetRotY += 0.003;
    rotX += (targetRotX - rotX) * 0.08;
    rotY += (targetRotY - rotY) * 0.08;
    zoom += (targetZoom - zoom) * 0.08;
    if (currentModel) { currentModel.rotation.x = rotX; currentModel.rotation.y = rotY; }
    camera.position.z = zoom;
    camera.lookAt(0, 0.15, 0);
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

  function init() {
    var section = document.getElementById('showcase3dSection');
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

    loadThree().then(function () { return loadTextures(); }).then(function () {
      initScene(viewport);
      showModel(ITEMS[0].id);
      animate();
    }).catch(function (err) {
      console.error('[3D]', err);
      viewport.innerHTML = '<div class="c3d-error">3D \u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u5237\u65b0\u9875\u9762</div>';
    });
  }

  window.Showcase3D = { init: init, stop: stop };
})();
