/**
 * 3D 非遗器物展示模块 v2
 * ------------------------------------------------------------
 * 高精度几何 + 程序化纹理 + PBR 材质 + 环境光照
 * Three.js r128 (CDN)
 */
(function () {
  'use strict';

  var THREE = null;
  var currentModel = null;
  var renderer, scene, camera, animationId;
  var isDragging = false, prevMouse = { x: 0, y: 0 };
  var rotX = 0.3, rotY = 0.5, targetRotX = 0.3, targetRotY = 0.5;
  var zoom = 4.0, targetZoom = 4.0;
  var autoRotate = true;
  var idleTimer = null;

  var ITEMS = [
    { id: 'hutoumao', name: '虎头帽', subtitle: '定南客家童帽', icon: '🐯',
      desc: '定南县客家人给孩童缝制的精美童帽。虎头正面绣虎眼、虎鼻、王字纹，两侧缀虎爪纹样，顶部饰元宝形绣片，后脑垂虎尾形飘带。老虎能驱恶辟邪，代表长辈对晚辈的美好祝愿。卍字纹、莲花纹寓意吉祥平安。',
      color: '#C45C26' },
    { id: 'weiwu', name: '客家围屋', subtitle: '龙南世界围屋之都', icon: '🏯',
      desc: '龙南现存客家围屋 376 座。围屋是客家先民聚族而居、御外自保的城堡式建筑，外墙夯土厚实，四角设角楼，中轴对称，融合中原营造技艺与客家智慧。2006 年列入全国重点文物保护单位。',
      color: '#8B6B4A' },
    { id: 'landye', name: '蓝染布', subtitle: '客家草木染', icon: '🧵',
      desc: '以板蓝根为原料，经制靛、浸染、氧化、晾晒等工序。扎染以扎缝防染形成花纹，蜡染以蜂蜡防染产生冰裂纹。深沉温润的靛蓝是客家女性心灵手巧的生动写照。',
      color: '#2F5D50' }
  ];

  /* ---------- 加载 Three.js ---------- */
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

  /* ==================== 材质工厂 ==================== */

  function makeMaterials() {
    var T = window.Textures;

    // 织物纹理
    var fabricTex = new THREE.CanvasTexture(T.redFabric());
    fabricTex.wrapS = fabricTex.wrapT = THREE.RepeatWrapping;
    fabricTex.repeat.set(2, 2);

    // 虎脸纹理
    var faceTex = new THREE.CanvasTexture(T.tigerFace());

    // 蓝染纹理
    var landyeTex = new THREE.CanvasTexture(T.landye());
    landyeTex.wrapS = landyeTex.wrapT = THREE.RepeatWrapping;

    // 墙纹理
    var wallTex = new THREE.CanvasTexture(T.wall());
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(3, 2);

    // 瓦纹理
    var roofTex = new THREE.CanvasTexture(T.roof());
    roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
    roofTex.repeat.set(4, 4);

    // 环境贴图
    var envTex = new THREE.CanvasTexture(T.envMap());
    envTex.mapping = THREE.EquirectangularReflectionMapping;

    return {
      fabricRed: new THREE.MeshStandardMaterial({
        map: fabricTex, roughness: 0.82, metalness: 0.02,
        bumpMap: fabricTex, bumpScale: 0.02
      }),
      faceWhite: new THREE.MeshStandardMaterial({
        map: faceTex, roughness: 0.75, metalness: 0.0
      }),
      gold: new THREE.MeshStandardMaterial({
        color: 0xD4A843, roughness: 0.3, metalness: 0.6,
        envMap: envTex
      }),
      dark: new THREE.MeshStandardMaterial({
        color: 0x2A1A10, roughness: 0.7, metalness: 0.05
      }),
      pink: new THREE.MeshStandardMaterial({
        color: 0xE8A0BF, roughness: 0.6, metalness: 0.0
      }),
      green: new THREE.MeshStandardMaterial({
        color: 0x5B8C5A, roughness: 0.65, metalness: 0.02
      }),
      silver: new THREE.MeshStandardMaterial({
        color: 0xC0C0C0, roughness: 0.2, metalness: 0.8,
        envMap: envTex
      }),
      wall: new THREE.MeshStandardMaterial({
        map: wallTex, roughness: 0.9, metalness: 0.0,
        bumpMap: wallTex, bumpScale: 0.05
      }),
      roof: new THREE.MeshStandardMaterial({
        map: roofTex, roughness: 0.75, metalness: 0.05,
        bumpMap: roofTex, bumpScale: 0.03
      }),
      wood: new THREE.MeshStandardMaterial({
        color: 0x6B4226, roughness: 0.7, metalness: 0.02
      }),
      landye: new THREE.MeshStandardMaterial({
        map: landyeTex, roughness: 0.85, metalness: 0.0,
        side: THREE.DoubleSide
      }),
      vat: new THREE.MeshStandardMaterial({
        color: 0x5C4033, roughness: 0.9, metalness: 0.0
      }),
      liquid: new THREE.MeshStandardMaterial({
        color: 0x0D2818, roughness: 0.15, metalness: 0.1
      })
    };
  }

  /* ==================== 虎头帽 ==================== */

  function buildHutoumao(M) {
    var g = new THREE.Group();

    // ---- 帽身（旋转体，更精确的轮廓） ----
    // 帽身侧面轮廓曲线（从底部到顶部）
    var profile = [];
    var steps = 40;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var angle = t * Math.PI * 0.52;
      // 半径随高度变化：底部宽 -> 顶部窄
      var r = Math.cos(angle) * 1.0 + Math.sin(angle * 0.3) * 0.05;
      var y = Math.sin(angle) * 0.95 + 0.05;
      profile.push(new THREE.Vector2(Math.max(r, 0.01), y));
    }
    // 底部收口
    profile.push(new THREE.Vector2(0.92, 0.0));
    profile.push(new THREE.Vector2(0.88, -0.02));

    var bodyGeo = new THREE.LatheGeometry(profile, 64);
    var body = new THREE.Mesh(bodyGeo, M.fabricRed);
    body.castShadow = true;
    g.add(body);

    // ---- 帽檐（圆环加厚边缘） ----
    var brimGeo = new THREE.TorusGeometry(0.92, 0.08, 16, 64);
    var brim = new THREE.Mesh(brimGeo, M.fabricRed);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.02;
    brim.castShadow = true;
    g.add(brim);

    // 帽檐内衬（深色）
    var brimInnerGeo = new THREE.TorusGeometry(0.88, 0.05, 12, 64);
    var brimInner = new THREE.Mesh(brimInnerGeo, M.dark);
    brimInner.rotation.x = Math.PI / 2;
    brimInner.position.y = 0.01;
    g.add(brimInner);

    // ---- 虎脸面板（用平面贴图，微微弯曲） ----
    var faceGeo = new THREE.PlaneGeometry(1.2, 1.1, 16, 16);
    // 弯曲平面以贴合帽身
    var fPos = faceGeo.attributes.position;
    for (var fi = 0; fi < fPos.count; fi++) {
      var fx = fPos.getX(fi);
      var fy = fPos.getY(fi);
      // 沿 z 轴弯曲
      fPos.setZ(fi, Math.cos(fx * 0.8) * 0.15 - 0.05);
    }
    faceGeo.computeVertexNormals();
    var face = new THREE.Mesh(faceGeo, M.faceWhite);
    face.position.set(0, 0.48, 0.82);
    face.rotation.x = -0.15;
    g.add(face);

    // ---- 虎耳（精致的圆锥 + 内耳） ----
    [-1, 1].forEach(function (side) {
      // 外耳
      var earGeo = new THREE.ConeGeometry(0.14, 0.28, 16);
      var ear = new THREE.Mesh(earGeo, M.fabricRed);
      ear.position.set(side * 0.52, 0.92, 0.08);
      ear.rotation.z = side * 0.35;
      ear.rotation.x = -0.1;
      ear.castShadow = true;
      g.add(ear);

      // 内耳（粉色）
      var earInGeo = new THREE.ConeGeometry(0.08, 0.18, 12);
      var earIn = new THREE.Mesh(earInGeo, M.pink);
      earIn.position.set(side * 0.5, 0.9, 0.13);
      earIn.rotation.z = side * 0.35;
      earIn.rotation.x = -0.1;
      g.add(earIn);

      // 耳朵边缘绒毛（小球）
      for (var f = 0; f < 4; f++) {
        var fuzzGeo = new THREE.SphereGeometry(0.025, 6, 4);
        var fuzz = new THREE.Mesh(fuzzGeo, M.gold);
        var fa = f / 4 * Math.PI - Math.PI / 2;
        fuzz.position.set(
          side * 0.52 + Math.sin(fa) * 0.13,
          0.92 + 0.12,
          0.08 + Math.cos(fa) * 0.05
        );
        g.add(fuzz);
      }
    });

    // ---- 顶部元宝绣片 ----
    var ybBaseGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.05, 32);
    var ybBase = new THREE.Mesh(ybBaseGeo, M.gold);
    ybBase.position.y = 1.0;
    g.add(ybBase);

    // 元宝主体（椭圆压扁）
    var ybBodyGeo = new THREE.SphereGeometry(0.15, 16, 12);
    var ybBody = new THREE.Mesh(ybBodyGeo, M.gold);
    ybBody.position.y = 1.04;
    ybBody.scale.set(1.4, 0.5, 1.0);
    g.add(ybBody);

    // 元宝中间凹陷
    var ybDipGeo = new THREE.SphereGeometry(0.08, 12, 8);
    var ybDip = new THREE.Mesh(ybDipGeo, M.gold);
    ybDip.position.y = 1.06;
    ybDip.scale.set(1.2, 0.3, 0.8);
    g.add(ybDip);

    // 中心太阳花
    var sunGeo = new THREE.SphereGeometry(0.04, 8, 6);
    var sun = new THREE.Mesh(sunGeo, M.gold);
    sun.position.y = 1.07;
    g.add(sun);
    // 花瓣
    for (var sp = 0; sp < 8; sp++) {
      var spa = (sp / 8) * Math.PI * 2;
      var petalGeo = new THREE.SphereGeometry(0.025, 6, 4);
      var petal = new THREE.Mesh(petalGeo, M.gold);
      petal.position.set(Math.cos(spa) * 0.07, 1.065, Math.sin(spa) * 0.07);
      petal.scale.set(1, 0.5, 1.5);
      g.add(petal);
    }

    // ---- 虎爪装饰（两侧各两只） ----
    [-1, 1].forEach(function (side) {
      [0.35, 0.15].forEach(function (y, idx) {
        // 爪子主体
        var clawGeo = new THREE.SphereGeometry(0.07, 10, 8);
        var claw = new THREE.Mesh(clawGeo, M.gold);
        claw.position.set(side * 0.78, y, 0.25 - idx * 0.1);
        claw.scale.set(1, 0.8, 0.7);
        g.add(claw);

        // 爪尖（三个小锥）
        for (var c = 0; c < 3; c++) {
          var ca = (c - 1) * 0.4;
          var tipGeo = new THREE.ConeGeometry(0.015, 0.05, 6);
          var tip = new THREE.Mesh(tipGeo, M.gold);
          tip.position.set(
            side * 0.82 + Math.sin(ca) * 0.02,
            y - 0.04,
            0.25 - idx * 0.1 + Math.cos(ca) * 0.04
          );
          tip.rotation.x = Math.PI * 0.8;
          tip.rotation.z = side * 0.2;
          g.add(tip);
        }
      });
    });

    // ---- 后脑虎尾 ----
    // 尾巴主体（弯曲圆柱）
    var tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.15, -0.9),
      new THREE.Vector3(0, -0.05, -1.0),
      new THREE.Vector3(0.05, -0.25, -0.95),
      new THREE.Vector3(0.08, -0.45, -0.88)
    ]);
    var tailGeo = new THREE.TubeGeometry(tailCurve, 20, 0.04, 8, false);
    var tail = new THREE.Mesh(tailGeo, M.fabricRed);
    tail.castShadow = true;
    g.add(tail);

    // 尾巴末端（虎掌形）
    var tailEndGeo = new THREE.SphereGeometry(0.1, 12, 10);
    var tailEnd = new THREE.Mesh(tailEndGeo, M.green);
    tailEnd.position.set(0.08, -0.48, -0.87);
    tailEnd.scale.set(1, 0.7, 1.2);
    g.add(tailEnd);

    // 尾巴上的花纹（小色块）
    var tailPatches = [
      { pos: [0, -0.1, -0.98], color: M.gold },
      { pos: [0.03, -0.28, -0.93], color: M.pink },
      { pos: [0.06, -0.4, -0.9], color: M.gold }
    ];
    tailPatches.forEach(function (p) {
      var pg = new THREE.SphereGeometry(0.03, 6, 4);
      var pm = new THREE.Mesh(pg, p.color);
      pm.position.set(p.pos[0], p.pos[1], p.pos[2]);
      g.add(pm);
    });

    // ---- 帽身装饰花纹 ----
    // 侧面花卉刺绣
    var flowerSpots = [
      [-0.65, 0.55, 0.45], [0.65, 0.55, 0.45],
      [-0.7, 0.4, -0.2], [0.7, 0.4, -0.2],
      [-0.5, 0.7, -0.5], [0.5, 0.7, -0.5],
      [0, 0.8, -0.65]
    ];
    flowerSpots.forEach(function (pos, i) {
      // 花芯
      var coreGeo = new THREE.SphereGeometry(0.025, 8, 6);
      var core = new THREE.Mesh(coreGeo, M.gold);
      core.position.set(pos[0], pos[1], pos[2]);
      g.add(core);
      // 花瓣
      for (var p = 0; p < 5; p++) {
        var pa = (p / 5) * Math.PI * 2;
        var petGeo = new THREE.SphereGeometry(0.02, 6, 4);
        var pet = new THREE.Mesh(petGeo, i % 2 === 0 ? M.green : M.pink);
        pet.position.set(
          pos[0] + Math.cos(pa) * 0.045,
          pos[1] + Math.sin(pa) * 0.045,
          pos[2]
        );
        pet.scale.set(1, 0.6, 0.4);
        g.add(pet);
      }
    });

    // 虎纹条（深色条纹）
    for (var st = 0; st < 6; st++) {
      var sa = (st / 6) * Math.PI * 2 + 0.3;
      var stripeGeo = new THREE.BoxGeometry(0.04, 0.28, 0.03);
      var stripe = new THREE.Mesh(stripeGeo, M.dark);
      stripe.position.set(
        Math.sin(sa) * 0.82,
        0.5 + Math.sin(st * 0.7) * 0.1,
        Math.cos(sa) * 0.82
      );
      stripe.lookAt(0, 0.5, 0);
      g.add(stripe);
    }

    // 卍字纹（四个方向）
    var wanPositions = [
      [-0.85, 0.3, 0], [0.85, 0.3, 0],
      [0, 0.3, -0.85], [0, 0.3, 0.85]
    ];
    wanPositions.forEach(function (wp) {
      // 简化的卍字：十字 + 折角
      var cross1 = new THREE.BoxGeometry(0.08, 0.02, 0.02);
      var m1 = new THREE.Mesh(cross1, M.gold);
      m1.position.set(wp[0], wp[1], wp[2]);
      m1.lookAt(0, wp[1], 0);
      g.add(m1);

      var cross2 = new THREE.BoxGeometry(0.02, 0.08, 0.02);
      var m2 = new THREE.Mesh(cross2, M.gold);
      m2.position.set(wp[0], wp[1], wp[2]);
      m2.lookAt(0, wp[1], 0);
      g.add(m2);
    });

    return g;
  }

  /* ==================== 客家围屋 ==================== */

  function buildWeiwu(M) {
    var g = new THREE.Group();

    // ---- 外墙（圆柱体，带厚度感） ----
    var outerWallGeo = new THREE.CylinderGeometry(1.6, 1.7, 1.3, 48, 1, true);
    var outerWall = new THREE.Mesh(outerWallGeo, M.wall);
    outerWall.position.y = 0.65;
    outerWall.castShadow = true;
    outerWall.receiveShadow = true;
    g.add(outerWall);

    // 外墙顶部（女儿墙）
    var paraGeo = new THREE.TorusGeometry(1.62, 0.04, 8, 48);
    var para = new THREE.Mesh(paraGeo, M.wall);
    para.rotation.x = Math.PI / 2;
    para.position.y = 1.3;
    g.add(para);

    // ---- 底部基座 ----
    var baseGeo = new THREE.CylinderGeometry(1.78, 1.88, 0.18, 48);
    var base = new THREE.Mesh(baseGeo, M.wall);
    base.position.y = 0.09;
    base.receiveShadow = true;
    g.add(base);

    // 台阶
    var stepGeo = new THREE.BoxGeometry(0.5, 0.06, 0.2);
    var step = new THREE.Mesh(stepGeo, M.wall);
    step.position.set(0, 0.03, 1.85);
    g.add(step);

    // ---- 内院地面 ----
    var courtGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.04, 48);
    var court = new THREE.Mesh(courtGeo, M.wood);
    court.position.y = 0.2;
    court.receiveShadow = true;
    g.add(court);

    // 内院天井（中间的方形开口，用深色表示）
    var skyGeo = new THREE.BoxGeometry(0.5, 0.02, 0.5);
    var skyMat = new THREE.MeshStandardMaterial({ color: 0x87CEEB, roughness: 0.3 });
    var sky = new THREE.Mesh(skyGeo, skyMat);
    sky.position.y = 0.22;
    g.add(sky);

    // ---- 内墙 ----
    var innerWallGeo = new THREE.CylinderGeometry(1.0, 1.05, 0.9, 48, 1, true);
    var innerWall = new THREE.Mesh(innerWallGeo, M.wall);
    innerWall.position.y = 0.55;
    innerWall.castShadow = true;
    g.add(innerWall);

    // 内墙窗户（小方孔）
    for (var w = 0; w < 8; w++) {
      var wa = (w / 8) * Math.PI * 2;
      var winGeo = new THREE.BoxGeometry(0.08, 0.12, 0.02);
      var winMat = new THREE.MeshStandardMaterial({ color: 0x1A1008, roughness: 0.5 });
      var win = new THREE.Mesh(winGeo, winMat);
      win.position.set(Math.sin(wa) * 1.01, 0.6, Math.cos(wa) * 1.01);
      win.lookAt(0, 0.6, 0);
      g.add(win);
    }

    // ---- 屋顶（双层锥形） ----
    // 下层屋顶（大）
    var roof1Geo = new THREE.ConeGeometry(1.88, 0.5, 48);
    var roof1 = new THREE.Mesh(roof1Geo, M.roof);
    roof1.position.y = 1.55;
    roof1.castShadow = true;
    g.add(roof1);

    // 屋檐（宽出的边缘）
    var eaveGeo = new THREE.TorusGeometry(1.88, 0.05, 8, 48);
    var eave = new THREE.Mesh(eaveGeo, M.roof);
    eave.rotation.x = Math.PI / 2;
    eave.position.y = 1.32;
    g.add(eave);

    // 上层屋顶（小）
    var roof2Geo = new THREE.ConeGeometry(0.9, 0.35, 32);
    var roof2 = new THREE.Mesh(roof2Geo, M.roof);
    roof2.position.y = 1.95;
    g.add(roof2);

    // 顶部装饰（小宝顶）
    var topGeo = new THREE.SphereGeometry(0.06, 8, 6);
    var top = new THREE.Mesh(topGeo, M.gold);
    top.position.y = 2.15;
    g.add(top);

    // ---- 大门 ----
    // 门洞
    var doorGeo = new THREE.BoxGeometry(0.38, 0.6, 0.1);
    var doorMat = new THREE.MeshStandardMaterial({ color: 0x1A1008, roughness: 0.4 });
    var door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.45, 1.68);
    g.add(door);

    // 门框
    var frameGeo = new THREE.BoxGeometry(0.5, 0.7, 0.08);
    var frame = new THREE.Mesh(frameGeo, M.wood);
    frame.position.set(0, 0.47, 1.65);
    g.add(frame);

    // 门楣（横梁）
    var lintelGeo = new THREE.BoxGeometry(0.6, 0.08, 0.1);
    var lintel = new THREE.Mesh(lintelGeo, M.wood);
    lintel.position.set(0, 0.82, 1.66);
    g.add(lintel);

    // 门匾（金字）
    var plaqueGeo = new THREE.BoxGeometry(0.35, 0.1, 0.02);
    var plaque = new THREE.Mesh(plaqueGeo, M.gold);
    plaque.position.set(0, 0.95, 1.67);
    g.add(plaque);

    // ---- 四角角楼 ----
    for (var c = 0; c < 4; c++) {
      var ca = (c / 4) * Math.PI * 2 + Math.PI / 4;
      var cx = Math.sin(ca) * 1.55;
      var cz = Math.cos(ca) * 1.55;

      // 角楼主体
      var towerGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.7, 12);
      var tower = new THREE.Mesh(towerGeo, M.wall);
      tower.position.set(cx, 0.85, cz);
      tower.castShadow = true;
      g.add(tower);

      // 角楼屋顶
      var tRoofGeo = new THREE.ConeGeometry(0.25, 0.22, 12);
      var tRoof = new THREE.Mesh(tRoofGeo, M.roof);
      tRoof.position.set(cx, 1.8, cz);
      g.add(tRoof);

      // 角楼窗（枪眼）
      for (var sl = 0; sl < 3; sl++) {
        var slGeo = new THREE.BoxGeometry(0.03, 0.06, 0.02);
        var slMat = new THREE.MeshStandardMaterial({ color: 0x1A1008 });
        var slit = new THREE.Mesh(slGeo, slMat);
        var sla = ca + sl * 0.3 - 0.3;
        slit.position.set(
          cx + Math.sin(sla) * 0.17,
          0.5 + sl * 0.35,
          cz + Math.cos(sla) * 0.17
        );
        slit.lookAt(cx * 2, slit.position.y, cz * 2);
        g.add(slit);
      }
    }

    return g;
  }

  /* ==================== 蓝染布 ==================== */

  function buildLandye(M) {
    var g = new THREE.Group();

    // ---- 布料（高分辨率平面 + 波浪变形） ----
    var clothGeo = new THREE.PlaneGeometry(1.6, 2.0, 40, 40);
    var pos = clothGeo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var y = pos.getY(i);
      // 多层波浪（模拟垂挂布料）
      var z = Math.sin(x * 2.5 + y * 0.5) * 0.1 +
              Math.cos(y * 3) * 0.06 +
              Math.sin(x * 5 + y * 2) * 0.03;
      pos.setZ(i, z);
    }
    clothGeo.computeVertexNormals();
    var cloth = new THREE.Mesh(clothGeo, M.landye);
    cloth.rotation.x = -0.1;
    cloth.castShadow = true;
    g.add(cloth);

    // 布料顶部褶皱（更自然的垂感）
    for (var f = 0; f < 6; f++) {
      var fx = -0.6 + f * 0.24;
      var foldGeo = new THREE.PlaneGeometry(0.08, 1.8, 2, 10);
      var foldPos = foldGeo.attributes.position;
      for (var fp = 0; fp < foldPos.count; fp++) {
        var fpy = foldPos.getY(fp);
        foldPos.setZ(fp, Math.sin(fpy * 3 + f) * 0.04);
      }
      foldGeo.computeVertexNormals();
      var fold = new THREE.Mesh(foldGeo, M.landye);
      fold.position.set(fx, 0.05, 0.05);
      fold.rotation.y = Math.sin(f) * 0.1;
      g.add(fold);
    }

    // ---- 晾晒杆 ----
    var rodGeo = new THREE.CylinderGeometry(0.025, 0.025, 2.2, 12);
    var rod = new THREE.Mesh(rodGeo, M.wood);
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 1.1;
    rod.castShadow = true;
    g.add(rod);

    // 挂钩
    [-0.5, 0, 0.5].forEach(function (hx) {
      var hookGeo = new THREE.TorusGeometry(0.03, 0.008, 6, 12);
      var hook = new THREE.Mesh(hookGeo, M.wood);
      hook.position.set(hx, 1.07, 0);
      g.add(hook);
    });

    // ---- 染缸 ----
    // 缸身（上宽下窄）
    var vatProfile = [];
    for (var v = 0; v <= 20; v++) {
      var vt = v / 20;
      var vr = 0.38 + vt * 0.06;
      vatProfile.push(new THREE.Vector2(vr, vt * 0.55));
    }
    var vatGeo = new THREE.LatheGeometry(vatProfile, 24);
    var vat = new THREE.Mesh(vatGeo, M.vat);
    vat.position.y = -0.95;
    vat.castShadow = true;
    g.add(vat);

    // 缸沿
    var rimGeo = new THREE.TorusGeometry(0.44, 0.025, 8, 24);
    var rim = new THREE.Mesh(rimGeo, M.vat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.4;
    g.add(rim);

    // 染液
    var liquidGeo = new THREE.CylinderGeometry(0.4, 0.38, 0.08, 24);
    var liquid = new THREE.Mesh(liquidGeo, M.liquid);
    liquid.position.y = -0.42;
    g.add(liquid);

    // 缸底
    var bottomGeo = new THREE.CylinderGeometry(0.32, 0.3, 0.05, 24);
    var bottom = new THREE.Mesh(bottomGeo, M.vat);
    bottom.position.y = -0.96;
    g.add(bottom);

    // ---- 板蓝根植物（旁边装饰） ----
    var plantStemGeo = new THREE.CylinderGeometry(0.01, 0.015, 0.6, 6);
    var plantStem = new THREE.Mesh(plantStemGeo, M.green);
    plantStem.position.set(0.7, -0.65, 0.2);
    plantStem.rotation.z = 0.15;
    g.add(plantStem);

    // 叶子
    for (var lf = 0; lf < 5; lf++) {
      var leafGeo = new THREE.PlaneGeometry(0.12, 0.08);
      var leafMat = new THREE.MeshStandardMaterial({
        color: 0x3A7A3A, roughness: 0.7, side: THREE.DoubleSide
      });
      var leaf = new THREE.Mesh(leafGeo, leafMat);
      var la = lf * 1.2;
      leaf.position.set(
        0.7 + Math.cos(la) * 0.08,
        -0.5 + lf * 0.1,
        0.2 + Math.sin(la) * 0.08
      );
      leaf.rotation.set(Math.random() * 0.5, la, Math.random() * 0.3);
      g.add(leaf);
    }

    return g;
  }

  /* ==================== 场景管理 ==================== */

  function initScene(container) {
    var w = container.clientWidth || 360;
    var h = 300;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEDE8DC);

    // 雾效（增加深度感）
    scene.fog = new THREE.Fog(0xEDE8DC, 6, 12);

    camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    camera.position.set(0, 0.8, zoom);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // ---- 灯光 ----
    // 环境光
    var ambient = new THREE.AmbientLight(0xFFF8EE, 0.5);
    scene.add(ambient);

    // 半球光（天空色 + 地面色）
    var hemi = new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 0.4);
    scene.add(hemi);

    // 主光源（阳光）
    var sun = new THREE.DirectionalLight(0xFFF5E0, 0.9);
    sun.position.set(4, 6, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 20;
    sun.shadow.camera.left = -3;
    sun.shadow.camera.right = 3;
    sun.shadow.camera.top = 3;
    sun.shadow.camera.bottom = -3;
    sun.shadow.bias = -0.001;
    scene.add(sun);

    // 补光
    var fillLight = new THREE.DirectionalLight(0xE0E8FF, 0.3);
    fillLight.position.set(-3, 3, -2);
    scene.add(fillLight);

    // 轮廓光
    var rim = new THREE.DirectionalLight(0xFFFFFF, 0.2);
    rim.position.set(0, 2, -4);
    scene.add(rim);

    // ---- 地面 ----
    var groundGeo = new THREE.CircleGeometry(3, 48);
    var groundMat = new THREE.MeshStandardMaterial({
      color: 0xD4C8B0, roughness: 0.9, metalness: 0.0
    });
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.3;
    ground.receiveShadow = true;
    scene.add(ground);

    // 地面圆环装饰
    var ringGeo = new THREE.RingGeometry(1.8, 2.0, 48);
    var ringMat = new THREE.MeshStandardMaterial({
      color: 0xC4B89A, roughness: 0.85, side: THREE.DoubleSide
    });
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.29;
    scene.add(ring);

    bindControls(renderer.domElement);
  }

  function bindControls(canvas) {
    function startDrag(x, y) {
      isDragging = true;
      autoRotate = false;
      prevMouse.x = x; prevMouse.y = y;
      if (idleTimer) clearTimeout(idleTimer);
    }
    function moveDrag(x, y) {
      if (!isDragging) return;
      targetRotY += (x - prevMouse.x) * 0.008;
      targetRotX += (y - prevMouse.y) * 0.006;
      targetRotX = Math.max(-1.0, Math.min(1.0, targetRotX));
      prevMouse.x = x; prevMouse.y = y;
    }
    function endDrag() {
      isDragging = false;
      // 3秒后恢复自动旋转
      idleTimer = setTimeout(function () { autoRotate = true; }, 3000);
    }

    canvas.addEventListener('mousedown', function (e) { startDrag(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { moveDrag(e.clientX, e.clientY); });
    window.addEventListener('mouseup', endDrag);

    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1) {
        e.preventDefault();
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });
    canvas.addEventListener('touchend', endDrag);

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      targetZoom += e.deltaY * 0.003;
      targetZoom = Math.max(2, Math.min(7, targetZoom));
    }, { passive: false });

    // 双指缩放
    var initDist = 0;
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        initDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (initDist > 0) {
          targetZoom *= initDist / dist;
          targetZoom = Math.max(2, Math.min(7, targetZoom));
        }
        initDist = dist;
      }
    }, { passive: true });
  }

  function showModel(id) {
    var M = makeMaterials();

    if (currentModel) {
      scene.remove(currentModel);
      // 释放几何体和材质
      currentModel.traverse(function (child) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(function (m) { m.dispose(); });
          } else {
            child.material.dispose();
          }
        }
      });
      currentModel = null;
    }

    switch (id) {
      case 'hutoumao': currentModel = buildHutoumao(M); break;
      case 'weiwu': currentModel = buildWeiwu(M); break;
      case 'landye': currentModel = buildLandye(M); break;
      default: currentModel = buildHutoumao(M);
    }

    scene.add(currentModel);
    targetRotX = 0.25;
    targetRotY = 0.4;
    targetZoom = id === 'landye' ? 3.5 : 4.0;
  }

  function animate() {
    animationId = requestAnimationFrame(animate);

    if (autoRotate && !isDragging) {
      targetRotY += 0.003;
    }

    rotX += (targetRotX - rotX) * 0.08;
    rotY += (targetRotY - rotY) * 0.08;
    zoom += (targetZoom - zoom) * 0.08;

    if (currentModel) {
      currentModel.rotation.x = rotX;
      currentModel.rotation.y = rotY;
    }
    camera.position.z = zoom;
    camera.position.y = 0.6 + rotX * 0.3;
    camera.lookAt(0, 0.1, 0);

    renderer.render(scene, camera);
  }

  function stop() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
  }

  /* ==================== UI ==================== */

  function renderItemList(container) {
    container.innerHTML = ITEMS.map(function (item) {
      return '<button class="c3d-item" data-id="' + item.id + '" type="button">' +
        '<div class="c3d-item-icon">' + item.icon + '</div>' +
        '<div class="c3d-item-name">' + item.name + '</div>' +
        '<div class="c3d-item-sub">' + item.subtitle + '</div>' +
        '</button>';
    }).join('');

    container.querySelectorAll('.c3d-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        container.querySelectorAll('.c3d-item').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        showModel(id);
        updateInfo(id);
      });
    });
  }

  function updateInfo(id) {
    var item = ITEMS.find(function (i) { return i.id === id; });
    if (!item) return;
    var nameEl = document.getElementById('c3dName');
    var descEl = document.getElementById('c3dDesc');
    if (nameEl) nameEl.textContent = item.name + ' · ' + item.subtitle;
    if (descEl) descEl.textContent = item.desc;
  }

  function init() {
    var section = document.getElementById('showcase3dSection');
    if (!section) return;

    var list = document.getElementById('c3dList');
    var viewport = document.getElementById('c3dViewport');

    renderItemList(list);

    var firstBtn = list.querySelector('.c3d-item');
    if (firstBtn) firstBtn.classList.add('active');
    updateInfo(ITEMS[0].id);

    loadThree().then(function () {
      initScene(viewport);
      showModel(ITEMS[0].id);
      animate();
    }).catch(function (err) {
      console.error('[3D] Three.js 加载失败:', err);
      viewport.innerHTML = '<div class="c3d-error">3D 模型加载失败，请检查网络后刷新</div>';
    });
  }

  window.Showcase3D = { init: init, stop: stop };
})();
