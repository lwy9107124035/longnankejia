/**
 * 3D 非遗器物展示模块
 * ------------------------------------------------------------
 * 使用 Three.js（CDN 加载）实现可旋转/缩放的轻量 3D 模型。
 * 模型用基础几何体程序化构建，零外部模型文件依赖。
 *
 * 展示器物：
 *   - 虎头帽（定南客家童帽）
 *   - 客家围屋
 *   - 蓝染布
 */
(function () {
  'use strict';

  var THREE = null; // 从 CDN 加载后赋值
  var currentModel = null;
  var currentItemId = null;
  var renderer, scene, camera, animationId;
  var isDragging = false, prevMouse = { x: 0, y: 0 };
  var rotX = 0.3, rotY = 0.5, targetRotX = 0.3, targetRotY = 0.5;
  var zoom = 4.5, targetZoom = 4.5;

  /* ---------- 器物数据 ---------- */
  var ITEMS = [
    {
      id: 'hutoumao',
      name: '虎头帽',
      subtitle: '定南客家童帽',
      icon: '🐯',
      desc: '定南县客家人给孩童缝制的精美童帽。老虎是猛兽，能帮助弱小的孩童驱恶辟邪，代表长辈对晚辈的美好祝愿。虎头帽上常见的卍字纹、莲花纹也有祝福吉祥平安之意。',
      color: '#C45C26'
    },
    {
      id: 'weiwu',
      name: '客家围屋',
      subtitle: '龙南世界围屋之都',
      icon: '🏯',
      desc: '龙南现存客家围屋 376 座，围屋是客家先民聚族而居、御外自保的城堡式建筑，融合中原营造技艺与客家智慧，中轴对称、方正厚重。',
      color: '#8B6B4A'
    },
    {
      id: 'landye',
      name: '蓝染布',
      subtitle: '客家草木染',
      icon: '🧵',
      desc: '以板蓝根为原料，经制靛、浸染、氧化、晾晒等工序染制而成。深沉温润的蓝色是客家女性心灵手巧的生动写照。',
      color: '#2F5D50'
    }
  ];

  /* ---------- 加载 Three.js ---------- */
  function loadThree() {
    return new Promise(function (resolve, reject) {
      if (THREE) { resolve(THREE); return; }
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      s.onload = function () {
        THREE = window.THREE;
        resolve(THREE);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* ==================== 3D 模型构建 ==================== */

  function buildHutoumao() {
    var group = new THREE.Group();

    // 材质
    var matRed = new THREE.MeshStandardMaterial({ color: 0xC45C26, roughness: 0.7 });
    var matDark = new THREE.MeshStandardMaterial({ color: 0x3A2F2A, roughness: 0.8 });
    var matGold = new THREE.MeshStandardMaterial({ color: 0xD4A843, roughness: 0.4, metalness: 0.3 });
    var matWhite = new THREE.MeshStandardMaterial({ color: 0xFFF6E8, roughness: 0.6 });
    var matPink = new THREE.MeshStandardMaterial({ color: 0xE8A0BF, roughness: 0.6 });
    var matGreen = new THREE.MeshStandardMaterial({ color: 0x5B8C5A, roughness: 0.6 });

    // 主体帽身（半球）
    var bodyGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    var body = new THREE.Mesh(bodyGeo, matRed);
    body.position.y = 0.1;
    group.add(body);

    // 帽檐（圆环）
    var brimGeo = new THREE.TorusGeometry(0.95, 0.12, 8, 32);
    var brim = new THREE.Mesh(brimGeo, matDark);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.08;
    group.add(brim);

    // 虎脸底色（白色椭圆贴在前面）
    var faceGeo = new THREE.SphereGeometry(0.45, 16, 12);
    var face = new THREE.Mesh(faceGeo, matWhite);
    face.position.set(0, 0.45, 0.72);
    face.scale.set(1, 0.85, 0.35);
    group.add(face);

    // 虎眼（左）
    var eyeLG = new THREE.SphereGeometry(0.1, 12, 8);
    var eyeL = new THREE.Mesh(eyeLG, matDark);
    eyeL.position.set(-0.18, 0.52, 0.88);
    group.add(eyeL);
    // 眼珠高光
    var hlLG = new THREE.SphereGeometry(0.035, 8, 6);
    var hlL = new THREE.Mesh(hlLG, matWhite);
    hlL.position.set(-0.15, 0.55, 0.94);
    group.add(hlL);

    // 虎眼（右）
    var eyeRG = new THREE.SphereGeometry(0.1, 12, 8);
    var eyeR = new THREE.Mesh(eyeRG, matDark);
    eyeR.position.set(0.18, 0.52, 0.88);
    group.add(eyeR);
    var hlRG = new THREE.SphereGeometry(0.035, 8, 6);
    var hlR = new THREE.Mesh(hlRG, matWhite);
    hlR.position.set(0.21, 0.55, 0.94);
    group.add(hlR);

    // 虎鼻
    var noseGeo = new THREE.SphereGeometry(0.07, 10, 8);
    var nose = new THREE.Mesh(noseGeo, matPink);
    nose.position.set(0, 0.38, 0.92);
    group.add(nose);

    // 虎嘴（弧形）
    var mouthGeo = new THREE.TorusGeometry(0.12, 0.02, 6, 16, Math.PI);
    var mouth = new THREE.Mesh(mouthGeo, matDark);
    mouth.position.set(0, 0.3, 0.88);
    mouth.rotation.x = Math.PI;
    group.add(mouth);

    // 虎耳（左）
    var earLGeo = new THREE.ConeGeometry(0.15, 0.25, 8);
    var earL = new THREE.Mesh(earLGeo, matRed);
    earL.position.set(-0.5, 0.95, 0.1);
    earL.rotation.z = 0.3;
    group.add(earL);
    var earLInGeo = new THREE.ConeGeometry(0.08, 0.15, 8);
    var earLIn = new THREE.Mesh(earLInGeo, matPink);
    earLIn.position.set(-0.48, 0.93, 0.15);
    earLIn.rotation.z = 0.3;
    group.add(earLIn);

    // 虎耳（右）
    var earRGeo = new THREE.ConeGeometry(0.15, 0.25, 8);
    var earR = new THREE.Mesh(earRGeo, matRed);
    earR.position.set(0.5, 0.95, 0.1);
    earR.rotation.z = -0.3;
    group.add(earR);
    var earRInGeo = new THREE.ConeGeometry(0.08, 0.15, 8);
    var earRIn = new THREE.Mesh(earRInGeo, matPink);
    earRIn.position.set(0.48, 0.93, 0.15);
    earRIn.rotation.z = -0.3;
    group.add(earRIn);

    // 虎纹条（深色条纹装饰）
    for (var i = 0; i < 4; i++) {
      var stripeGeo = new THREE.BoxGeometry(0.06, 0.35, 0.06);
      var stripe = new THREE.Mesh(stripeGeo, matDark);
      var angle = (i / 4) * Math.PI * 0.6 + Math.PI * 0.2;
      stripe.position.set(Math.sin(angle) * 0.7, 0.55, Math.cos(angle) * 0.7);
      stripe.lookAt(0, 0.5, 0);
      group.add(stripe);
    }

    // 顶部元宝绣片
    var yuanbaoGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.06, 8);
    var yuanbao = new THREE.Mesh(yuanbaoGeo, matGold);
    yuanbao.position.y = 1.02;
    group.add(yuanbao);
    // 太阳花（中心装饰）
    var flowerGeo = new THREE.SphereGeometry(0.06, 8, 6);
    var flower = new THREE.Mesh(flowerGeo, matGold);
    flower.position.y = 1.06;
    group.add(flower);

    // 虎爪（两侧各两只，简化为小球）
    var clawPositions = [
      [-0.75, 0.3, 0.3], [-0.7, 0.15, 0.1],
      [0.75, 0.3, 0.3], [0.7, 0.15, 0.1]
    ];
    clawPositions.forEach(function (p) {
      var clawGeo = new THREE.SphereGeometry(0.08, 8, 6);
      var claw = new THREE.Mesh(clawGeo, matGold);
      claw.position.set(p[0], p[1], p[2]);
      group.add(claw);
    });

    // 尾巴（后下方垂挂）
    var tailGeo = new THREE.CylinderGeometry(0.04, 0.08, 0.5, 8);
    var tail = new THREE.Mesh(tailGeo, matRed);
    tail.position.set(0, -0.1, -0.85);
    tail.rotation.x = -0.4;
    group.add(tail);
    // 尾巴末端装饰
    var tailEndGeo = new THREE.SphereGeometry(0.1, 8, 6);
    var tailEnd = new THREE.Mesh(tailEndGeo, matGreen);
    tailEnd.position.set(0, -0.35, -0.95);
    group.add(tailEnd);

    // 装饰花纹（小圆点散布在帽身）
    var flowerPositions = [
      [-0.4, 0.7, 0.5], [0.4, 0.7, 0.5],
      [-0.5, 0.5, -0.3], [0.5, 0.5, -0.3],
      [0, 0.85, -0.5]
    ];
    flowerPositions.forEach(function (p, i) {
      var fGeo = new THREE.SphereGeometry(0.05, 6, 4);
      var mat = i % 2 === 0 ? matGold : matGreen;
      var f = new THREE.Mesh(fGeo, mat);
      f.position.set(p[0], p[1], p[2]);
      group.add(f);
    });

    return group;
  }

  function buildWeiwu() {
    var group = new THREE.Group();

    var matWall = new THREE.MeshStandardMaterial({ color: 0xC4A882, roughness: 0.85 });
    var matRoof = new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.7 });
    var matInner = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.9 });
    var matDoor = new THREE.MeshStandardMaterial({ color: 0x3A2F2A, roughness: 0.6 });

    // 外墙（圆柱体）
    var wallGeo = new THREE.CylinderGeometry(1.6, 1.7, 1.2, 24, 1, true);
    var wall = new THREE.Mesh(wallGeo, matWall);
    wall.position.y = 0.6;
    group.add(wall);

    // 外墙底座
    var baseGeo = new THREE.CylinderGeometry(1.75, 1.85, 0.15, 24);
    var base = new THREE.Mesh(baseGeo, matInner);
    base.position.y = 0.075;
    group.add(base);

    // 屋顶（圆锥）
    var roofGeo = new THREE.ConeGeometry(1.85, 0.6, 24);
    var roof = new THREE.Mesh(roofGeo, matRoof);
    roof.position.y = 1.5;
    group.add(roof);

    // 屋顶边缘
    var eaveGeo = new THREE.TorusGeometry(1.85, 0.06, 6, 24);
    var eave = new THREE.Mesh(eaveGeo, matRoof);
    eave.rotation.x = Math.PI / 2;
    eave.position.y = 1.22;
    group.add(eave);

    // 内院（凹陷地面）
    var courtyardGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.05, 24);
    var courtyard = new THREE.Mesh(courtyardGeo, matInner);
    courtyard.position.y = 0.18;
    group.add(courtyard);

    // 内墙（较小的圆柱）
    var innerWallGeo = new THREE.CylinderGeometry(1.0, 1.05, 0.8, 24, 1, true);
    var innerWall = new THREE.Mesh(innerWallGeo, matWall);
    innerWall.position.y = 0.5;
    group.add(innerWall);

    // 大门（正面）
    var doorGeo = new THREE.BoxGeometry(0.35, 0.55, 0.08);
    var door = new THREE.Mesh(doorGeo, matDoor);
    door.position.set(0, 0.4, 1.68);
    group.add(door);
    // 门框
    var frameGeo = new THREE.BoxGeometry(0.45, 0.65, 0.06);
    var frame = new THREE.Mesh(frameGeo, matInner);
    frame.position.set(0, 0.42, 1.65);
    group.add(frame);

    // 角楼（四个方向的小塔）
    for (var i = 0; i < 4; i++) {
      var angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      var towerGeo = new THREE.CylinderGeometry(0.15, 0.18, 1.5, 8);
      var tower = new THREE.Mesh(towerGeo, matWall);
      tower.position.set(Math.sin(angle) * 1.55, 0.75, Math.cos(angle) * 1.55);
      group.add(tower);
      var tRoofGeo = new THREE.ConeGeometry(0.22, 0.2, 8);
      var tRoof = new THREE.Mesh(tRoofGeo, matRoof);
      tRoof.position.set(Math.sin(angle) * 1.55, 1.6, Math.cos(angle) * 1.55);
      group.add(tRoof);
    }

    return group;
  }

  function buildLandye() {
    var group = new THREE.Group();

    // 布料（用平面模拟垂挂的蓝染布）
    var clothGeo = new THREE.PlaneGeometry(1.8, 2.2, 20, 20);
    // 给顶点加波浪变形
    var pos = clothGeo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 3) * 0.08 + Math.cos(y * 2) * 0.06);
    }
    clothGeo.computeVertexNormals();

    var matCloth = new THREE.MeshStandardMaterial({
      color: 0x2F5D50,
      roughness: 0.85,
      side: THREE.DoubleSide
    });
    var cloth = new THREE.Mesh(clothGeo, matCloth);
    cloth.rotation.x = -0.15;
    group.add(cloth);

    // 布上的花纹（白色圆点模拟扎染效果）
    var dotPositions = [
      [-0.5, 0.6], [0.3, 0.4], [-0.2, 0.1], [0.5, -0.2],
      [-0.6, -0.5], [0.1, -0.6], [0.4, 0.7], [-0.3, -0.3]
    ];
    var matDot = new THREE.MeshStandardMaterial({ color: 0xE8F0F5, roughness: 0.7 });
    dotPositions.forEach(function (p) {
      var dotGeo = new THREE.CircleGeometry(0.08 + Math.random() * 0.06, 12);
      var dot = new THREE.Mesh(dotGeo, matDot);
      dot.position.set(p[0], p[1], 0.12);
      group.add(dot);
    });

    // 挂杆
    var rodGeo = new THREE.CylinderGeometry(0.03, 0.03, 2, 8);
    var rodMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.8 });
    var rod = new THREE.Mesh(rodGeo, rodMat);
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 1.15;
    group.add(rod);

    // 染缸（下方）
    var vatGeo = new THREE.CylinderGeometry(0.4, 0.35, 0.5, 12);
    var vatMat = new THREE.MeshStandardMaterial({ color: 0x5C4033, roughness: 0.9 });
    var vat = new THREE.Mesh(vatGeo, vatMat);
    vat.position.y = -0.85;
    group.add(vat);
    // 缸内染液
    var liquidGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.05, 12);
    var liquidMat = new THREE.MeshStandardMaterial({ color: 0x1A3A30, roughness: 0.3 });
    var liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.y = -0.62;
    group.add(liquid);

    return group;
  }

  /* ==================== 场景管理 ==================== */

  function initScene(container) {
    var w = container.clientWidth || 360;
    var h = 300;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF0EBE0);

    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 0.5, zoom);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 灯光
    var ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    var dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(3, 5, 4);
    dir.castShadow = true;
    scene.add(dir);
    var fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-2, 2, -3);
    scene.add(fill);

    // 地面阴影接收
    var groundGeo = new THREE.PlaneGeometry(6, 6);
    var groundMat = new THREE.ShadowMaterial({ opacity: 0.1 });
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    scene.add(ground);

    bindControls(renderer.domElement);
  }

  function bindControls(canvas) {
    // 鼠标拖拽旋转
    canvas.addEventListener('mousedown', function (e) {
      isDragging = true;
      prevMouse.x = e.clientX;
      prevMouse.y = e.clientY;
    });
    window.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      targetRotY += (e.clientX - prevMouse.x) * 0.008;
      targetRotX += (e.clientY - prevMouse.y) * 0.006;
      targetRotX = Math.max(-1.2, Math.min(1.2, targetRotX));
      prevMouse.x = e.clientX;
      prevMouse.y = e.clientY;
    });
    window.addEventListener('mouseup', function () { isDragging = false; });

    // 触摸旋转
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) {
        isDragging = true;
        prevMouse.x = e.touches[0].clientX;
        prevMouse.y = e.touches[0].clientY;
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (!isDragging || e.touches.length !== 1) return;
      e.preventDefault();
      targetRotY += (e.touches[0].clientX - prevMouse.x) * 0.008;
      targetRotX += (e.touches[0].clientY - prevMouse.y) * 0.006;
      targetRotX = Math.max(-1.2, Math.min(1.2, targetRotX));
      prevMouse.x = e.touches[0].clientX;
      prevMouse.y = e.touches[0].clientY;
    }, { passive: false });
    canvas.addEventListener('touchend', function () { isDragging = false; });

    // 滚轮缩放
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      targetZoom += e.deltaY * 0.003;
      targetZoom = Math.max(2, Math.min(8, targetZoom));
    }, { passive: false });

    // 双指缩放
    var initialDist = 0;
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        initialDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (initialDist > 0) {
          targetZoom *= initialDist / dist;
          targetZoom = Math.max(2, Math.min(8, targetZoom));
        }
        initialDist = dist;
      }
    }, { passive: true });
  }

  function showModel(id) {
    // 移除旧模型
    if (currentModel) {
      scene.remove(currentModel);
      currentModel = null;
    }

    switch (id) {
      case 'hutoumao': currentModel = buildHutoumao(); break;
      case 'weiwu': currentModel = buildWeiwu(); break;
      case 'landye': currentModel = buildLandye(); break;
      default: currentModel = buildHutoumao();
    }

    currentModel.castShadow = true;
    scene.add(currentModel);
    currentItemId = id;

    // 重置视角
    targetRotX = 0.3;
    targetRotY = 0.5;
    targetZoom = 4.5;
  }

  function animate() {
    animationId = requestAnimationFrame(animate);

    // 平滑插值
    rotX += (targetRotX - rotX) * 0.08;
    rotY += (targetRotY - rotY) * 0.08;
    zoom += (targetZoom - zoom) * 0.08;

    if (currentModel) {
      currentModel.rotation.x = rotX;
      currentModel.rotation.y = rotY;
    }
    camera.position.z = zoom;
    camera.lookAt(0, 0.2, 0);

    renderer.render(scene, camera);
  }

  function stop() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
  }

  /* ==================== UI 绑定 ==================== */

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

    // 默认选中第一个
    var firstBtn = list.querySelector('.c3d-item');
    if (firstBtn) firstBtn.classList.add('active');
    updateInfo(ITEMS[0].id);

    // 延迟初始化 Three.js（不阻塞页面）
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
