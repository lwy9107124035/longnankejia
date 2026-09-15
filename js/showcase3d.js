/**
 * 3D 非遗器物展示模块 v2
 * Three.js + AI 纹理 + PBR 材质
 */
(function () {
  'use strict';

  var THREE = null;
  var currentModel = null;
  var renderer, scene, camera, animationId;
  var isDragging = false, prevMouse = { x: 0, y: 0 };
  var rotX = 0.25, rotY = 0.4, targetRotX = 0.25, targetRotY = 0.4;
  var zoom = 4.2, targetZoom = 4.2;
  var autoRotate = true;
  var idleTimer = null;
  var textures = {};

  var ITEMS = [
    { id: 'hutoumao', name: '虎头帽', subtitle: '定南客家童帽', icon: '\u{1F42F}',
      desc: '定南县客家人给孩童缝制的精美童帽。老虎能驱恶辟邪，代表长辈对晚辈的美好祝愿。正面绣虎头，两侧及后脑有虎爪，顶部补元宝形绣片，中心绣太阳花，后脑垂虎掌形尾巴。' },
    { id: 'weiwu', name: '客家围屋', subtitle: '龙南世界围屋之都', icon: '\u{1F3EF}',
      desc: '龙南现存客家围屋 376 座。围屋是客家先民聚族而居、御外自保的城堡式建筑，外墙夯土，屋顶覆瓦，四角设碉楼。' },
    { id: 'landye', name: '蓝染布', subtitle: '客家草木染', icon: '\u{1F9F5}',
      desc: '以板蓝根为原料，经制靛、浸染、氧化、晾晒等工序染制而成。深沉温润的蓝色是客家女性心灵手巧的生动写照。' }
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
        landyeCloth: 'assets/landye-cloth.png',
        weiwuWall: 'assets/weiwu-wall.png'
      };
      var loaded = 0, total = 3;
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

  /* ========== 虎头帽 ========== */
  function buildHutoumao() {
    var g = new THREE.Group();
    var matRed = new THREE.MeshStandardMaterial({ color: 0xC45C26, roughness: 0.75 });
    var matDark = new THREE.MeshStandardMaterial({ color: 0x2A2218, roughness: 0.85 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.35, metalness: 0.5 });
    var matWhite = new THREE.MeshStandardMaterial({ color: 0xFFF6E8, roughness: 0.65 });
    var matPink = new THREE.MeshStandardMaterial({ color: 0xE8A0BF, roughness: 0.6 });
    var matGreen = new THREE.MeshStandardMaterial({ color: 0x5B8C5A, roughness: 0.65 });

    // 帽身
    var bodyGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
    var body = new THREE.Mesh(bodyGeo, matRed);
    body.position.y = 0.1;
    body.castShadow = true;
    g.add(body);

    // 内衬
    var innerGeo = new THREE.SphereGeometry(0.92, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    var inner = new THREE.Mesh(innerGeo, new THREE.MeshStandardMaterial({ color: 0x1A1410, roughness: 0.9, side: THREE.BackSide }));
    inner.position.y = 0.1;
    g.add(inner);

    // 帽檐
    var brim = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.14, 12, 48), matDark);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.06;
    brim.castShadow = true;
    g.add(brim);

    // 虎脸纹理（弯曲平面贴合球面）
    if (textures.tigerFace) {
      var faceGeo = new THREE.PlaneGeometry(1.1, 1.1, 16, 16);
      var fp = faceGeo.attributes.position;
      for (var fi = 0; fi < fp.count; fi++) {
        var fx = fp.getX(fi), fy = fp.getY(fi);
        var d = Math.sqrt(fx * fx + fy * fy);
        fp.setZ(fi, Math.max(0, 1 - d * 0.8) * 0.15);
      }
      faceGeo.computeVertexNormals();
      var faceMesh = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({
        map: textures.tigerFace, roughness: 0.7, transparent: true, alphaTest: 0.1
      }));
      faceMesh.position.set(0, 0.5, 0.82);
      faceMesh.castShadow = true;
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

    // 虎耳
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

    // 虎爪
    [[-0.78, 0.35, 0.25], [-0.72, 0.18, 0.05], [0.78, 0.35, 0.25], [0.72, 0.18, 0.05]].forEach(function (p) {
      var claw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), matGold);
      claw.position.set(p[0], p[1], p[2]);
      g.add(claw);
    });

    // 尾巴（曲线管）
    var tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.1, -0.9),
      new THREE.Vector3(0, -0.15, -1.0),
      new THREE.Vector3(0.05, -0.4, -0.95)
    ]);
    var tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.05, 8, false), matRed);
    g.add(tail);
    var tailEnd = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), matGreen);
    tailEnd.position.set(0.05, -0.42, -0.95);
    g.add(tailEnd);

    // 花纹点缀
    [[-0.42, 0.68, 0.52], [0.42, 0.68, 0.52], [-0.55, 0.48, -0.28], [0.55, 0.48, -0.28], [0, 0.88, -0.48]].forEach(function (p, i) {
      var f = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), i % 2 === 0 ? matGold : matGreen);
      f.position.set(p[0], p[1], p[2]);
      g.add(f);
    });

    return g;
  }

  /* ========== 客家围屋 ========== */
  function buildWeiwu() {
    var g = new THREE.Group();
    var matWall = textures.weiwuWall
      ? new THREE.MeshStandardMaterial({ map: textures.weiwuWall, roughness: 0.9 })
      : new THREE.MeshStandardMaterial({ color: 0xC4A882, roughness: 0.9 });
    if (textures.weiwuWall) textures.weiwuWall.repeat.set(4, 1);
    var matRoof = new THREE.MeshStandardMaterial({ color: 0x3D3228, roughness: 0.75 });
    var matInner = new THREE.MeshStandardMaterial({ color: 0xA08060, roughness: 0.85 });
    var matDoor = new THREE.MeshStandardMaterial({ color: 0x2A1F14, roughness: 0.6 });
    var matWood = new THREE.MeshStandardMaterial({ color: 0x6B4226, roughness: 0.7 });

    // 外墙
    var wall = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 1.3, 32, 1, true), matWall);
    wall.position.y = 0.65;
    wall.castShadow = true;
    g.add(wall);

    // 压顶
    var cap = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.08, 8, 32), matRoof);
    cap.rotation.x = Math.PI / 2;
    cap.position.y = 1.3;
    g.add(cap);

    // 基座
    var base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.9, 0.18, 32), matInner);
    base.position.y = 0.09;
    base.receiveShadow = true;
    g.add(base);

    // 屋顶
    var roof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.65, 32), matRoof);
    roof.position.y = 1.62;
    roof.castShadow = true;
    g.add(roof);
    var peak = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), matWood);
    peak.position.y = 1.95;
    g.add(peak);

    // 飞檐
    for (var ei = 0; ei < 4; ei++) {
      var ea = (ei / 4) * Math.PI * 2;
      var eave = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 4), matRoof);
      eave.position.set(Math.sin(ea) * 1.85, 1.38, Math.cos(ea) * 1.85);
      eave.rotation.x = Math.PI * 0.15;
      g.add(eave);
    }

    // 内院
    var court = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.06, 32), matInner);
    court.position.y = 0.2;
    court.receiveShadow = true;
    g.add(court);
    var innerWall = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.05, 0.85, 32, 1, true), matWall);
    innerWall.position.y = 0.55;
    g.add(innerWall);
    var sky = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.4), new THREE.MeshStandardMaterial({ color: 0x8B9E7A, roughness: 0.8 }));
    sky.position.y = 0.24;
    g.add(sky);

    // 大门
    var arch = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.6, 0.1), matDoor);
    arch.position.set(0, 0.42, 1.68);
    g.add(arch);
    var frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.06), matWood);
    frame.position.set(0, 0.44, 1.65);
    g.add(frame);
    for (var di = 0; di < 2; di++) {
      for (var dj = 0; dj < 3; dj++) {
        var nail = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), matGold);
        nail.position.set(-0.08 + di * 0.16, 0.28 + dj * 0.15, 1.74);
        g.add(nail);
      }
    }

    // 碉楼
    for (var ci = 0; ci < 4; ci++) {
      var ca = (ci / 4) * Math.PI * 2 + Math.PI / 4;
      var cx = Math.sin(ca) * 1.58, cz = Math.cos(ca) * 1.58;
      var tw = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 1.7, 12), matWall);
      tw.position.set(cx, 0.85, cz);
      tw.castShadow = true;
      g.add(tw);
      var tr = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.22, 8), matRoof);
      tr.position.set(cx, 1.8, cz);
      g.add(tr);
      var win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), matDoor);
      win.position.set(cx + Math.sin(ca) * 0.17, 1.3, cz + Math.cos(ca) * 0.17);
      win.lookAt(0, 1.3, 0);
      g.add(win);
    }

    return g;
  }

  /* ========== 蓝染布 ========== */
  function buildLandye() {
    var g = new THREE.Group();

    // 布料（纹理 + 波浪变形）
    var clothGeo = new THREE.PlaneGeometry(2, 2.4, 32, 32);
    var pos = clothGeo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 2.5 + 0.5) * 0.1 + Math.cos(y * 1.8) * 0.07 - Math.abs(x) * 0.05);
    }
    clothGeo.computeVertexNormals();
    var clothMat = textures.landyeCloth
      ? new THREE.MeshStandardMaterial({ map: textures.landyeCloth, roughness: 0.85, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: 0x2F5D50, roughness: 0.85, side: THREE.DoubleSide });
    if (textures.landyeCloth) textures.landyeCloth.repeat.set(1.5, 1.5);
    var cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.rotation.x = -0.08;
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    g.add(cloth);

    // 挂杆
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 12), new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.75 }));
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 1.25;
    rod.castShadow = true;
    g.add(rod);

    // 挂钩
    [-0.7, -0.3, 0.3, 0.7].forEach(function (hx) {
      var hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 12), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.4 }));
      hook.position.set(hx, 1.2, 0);
      hook.rotation.x = Math.PI / 2;
      g.add(hook);
    });

    // 染缸
    var vat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.55, 16), new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.88 }));
    vat.position.y = -0.9;
    vat.castShadow = true;
    g.add(vat);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 16), new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.88 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.62;
    g.add(rim);
    var liq = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0x0F2A22, roughness: 0.15 }));
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
    scene.add(new THREE.DirectionalLight(0xd0e8ff, 0.35).translateX(-3));
    var fill = new THREE.DirectionalLight(0xd0e8ff, 0.35);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    var ground = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshStandardMaterial({ color: 0xD8D0C0, roughness: 0.9 }));
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
      targetZoom = Math.max(2.2, Math.min(7, targetZoom + e.deltaY * 0.003));
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
        if (initDist > 0) targetZoom = Math.max(2.2, Math.min(7, targetZoom * initDist / d));
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
    targetZoom = id === 'landye' ? 4.5 : 4.0;
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
