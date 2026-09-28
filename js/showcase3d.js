/**
 * 3D 非遗器物展示模块 v2 — 七件器物与建筑形制示意
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
  // 各模型的最低几何点对齐场景地面 y=-1.15；修改轮廓时同步复核对应偏移。
  // 相机焦点同步下移同样的量，保持各模型的取景关系。
  var SEAT_ADJUST = {hutoumao: -0.994, weiwu: 0, landye: -0.150, liangmao: -0.952, boji: -1.150, zhidai: -0.319, mijiutan: -0.570};
  var FOCUS_BASE = {weiwu: -0.10, zhidai: -0.17};
  // The engine and shared model textures are loaded only when the 3D view opens.
  var booted = false, booting = null, pendingShow = null;

  var ITEMS = [
    { id: 'hutoumao', name: '虎头帽', subtitle: '定南客家童帽 · 展示示意', icon: '\u{1F42F}', zoom: 4.2,
      desc: '参考博物馆展柜中多种童帽的红、黑底色与额前绣片，作一顶展示型概括示意；展柜照片不足以确认单顶帽子的具体结构、针法与配饰。' },
    { id: 'weiwu', name: '客家围屋', subtitle: '龙南关西新围 · 形制示意', icon: '\u{1F3EF}', zoom: 8.2,
      desc: '依据公开资料概括关西新围约7426平方米的方形“回”字围合、中央祠堂、四角炮楼及九幢十八厅关系。用于说明空间组织，非文物测绘复原；尺寸和细部均为示意。' },
    { id: 'landye', name: '蓝染布', subtitle: '客家草木染 · 样布示意', icon: '\u{1F9F5}', zoom: 4.8,
      desc: '参考博物馆蓝染样布中的靛蓝底色、几何折叠留白与圆形放射纹，以程序化纹样作展示示意；不指代某一件实物或特定植物染方。' },
    { id: 'liangmao', name: '客家凉帽', subtitle: '宁龙片妇女首服 · 概念示意', icon: '\u{1F3A9}', zoom: 3.4,
      desc: '概念性帽形示意。本批素材没有可确认的凉帽实物近照，竹编纹理、布面颜色及帽檐比例仅用于展示，不能视为某一款凉帽的复原。' },
    { id: 'boji', name: '竹编簸箕', subtitle: '客家竹编 · 浅圆器示意', icon: '\u{1F9FA}', zoom: 2.7,
      desc: '参考博物馆中圆形浅口竹器的交织底面、收边圈口与自然竹色作概括示意；本批照片不足以确认器物名称、尺寸及具体用途。' },
    { id: 'zhidai', name: '客家织带', subtitle: '冬头帕织带 · 纹样示意', icon: '\u{1F9F3}', zoom: 3.15,
      desc: '参考照片中蓝、紫、红等色带、白色几何装饰与散穗，制作不含可读文字的展示纹样。配色与组合为概括示意，不能对应某一件藏品。' },
    { id: 'mijiutan', name: '客家米酒坛', subtitle: '龙南米酒 · 造型概念示意', icon: '\u{1F3FA}', zoom: 3.0,
      desc: '陶质酒坛的概念造型示意。本批没有可确认的米酒坛实物照片，器形与釉色不作为龙南某件酒坛的史实复原。' }
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
        stonePaving: 'assets/textures/stone-paving.png'
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
     虎头帽 — 布帽轮廓与额前绣片的展示型示意
     ================================================================ */
  function buildHutoumao() {
    var g = new THREE.Group();

    // 深靛炭色细布：低对比经纬线在移动端仍能读出绒面/织物层次。
    var fabricCanvas = document.createElement('canvas'); fabricCanvas.width = 256; fabricCanvas.height = 256;
    var fctx = fabricCanvas.getContext('2d');
    var fabricBase = fctx.createLinearGradient(0, 0, 256, 256);
    fabricBase.addColorStop(0, '#465268'); fabricBase.addColorStop(0.55, '#353e50'); fabricBase.addColorStop(1, '#424d61');
    fctx.fillStyle = fabricBase; fctx.fillRect(0, 0, 256, 256);
    for (var fy = 0; fy < 256; fy += 3) {
      fctx.strokeStyle = fy % 6 ? 'rgba(176,188,211,0.19)' : 'rgba(13,18,29,0.16)';
      fctx.lineWidth = 1; fctx.beginPath(); fctx.moveTo(0, fy + 0.5); fctx.lineTo(256, fy + 0.5); fctx.stroke();
    }
    for (var fx = 0; fx < 256; fx += 4) {
      fctx.strokeStyle = fx % 8 ? 'rgba(158,173,202,0.15)' : 'rgba(10,15,25,0.15)';
      fctx.lineWidth = 1; fctx.beginPath(); fctx.moveTo(fx + 0.5, 0); fctx.lineTo(fx + 0.5, 256); fctx.stroke();
    }
    for (var fiber = 0; fiber < 120; fiber++) {
      var xFiber = (fiber * 73) % 256, yFiber = (fiber * 131) % 256;
      fctx.fillStyle = fiber % 2 ? 'rgba(204,211,224,0.14)' : 'rgba(10,15,24,0.10)';
      fctx.fillRect(xFiber, yFiber, 2, 1);
    }
    var fabricTexture = new THREE.CanvasTexture(fabricCanvas);
    fabricTexture.wrapS = fabricTexture.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding !== undefined) fabricTexture.encoding = THREE.sRGBEncoding;
    fabricTexture.anisotropy = 4; generatedTextures.push(fabricTexture);
    var matBlack = new THREE.MeshStandardMaterial({ map: fabricTexture, color: 0xffffff, roughness: 0.96, metalness: 0.0 });
    var edgeMat = new THREE.MeshStandardMaterial({ color: 0x394253, roughness: 0.94 });

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
    // 深靛色双针包边只作细微层次，不添加照片未能确认的金色装饰。
    var brimSeam = new THREE.Mesh(new THREE.TorusGeometry(1.055, 0.009, 5, 56), edgeMat);
    brimSeam.rotation.x = Math.PI / 2; brimSeam.position.y = 0.06; brimSeam.name = 'subtle_brim_stitching'; g.add(brimSeam);

    // 额前绣片用可读的抽象彩线纹样，避免纹理裁切成单点或塑成卡通五官。
    var patchCanvas = document.createElement('canvas'); patchCanvas.width = 512; patchCanvas.height = 512;
    var pctx = patchCanvas.getContext('2d');
    pctx.fillStyle = '#202632'; pctx.fillRect(0, 0, 512, 512);
    function embroideryRing(radius, color, width) {
      pctx.beginPath(); pctx.arc(256, 256, radius, 0, Math.PI * 2);
      pctx.strokeStyle = color; pctx.lineWidth = width; pctx.stroke();
    }
    embroideryRing(244, '#bd8b37', 14); embroideryRing(224, '#963d32', 9); embroideryRing(207, '#365d86', 8);
    // Short radial stitches give the edge a textile rhythm without asserting a particular hat's trim.
    for (var stitch = 0; stitch < 32; stitch++) {
      var sa = stitch * Math.PI / 16, sr0 = 226, sr1 = 240;
      pctx.beginPath(); pctx.moveTo(256 + Math.cos(sa) * sr0, 256 + Math.sin(sa) * sr0);
      pctx.lineTo(256 + Math.cos(sa) * sr1, 256 + Math.sin(sa) * sr1);
      pctx.strokeStyle = stitch % 2 ? '#e0bd70' : '#d45a3d'; pctx.lineWidth = 5; pctx.stroke();
    }
    // Abstract flower/diamond embroidery, with no eyes, teeth, or legible symbols.
    for (var petal = 0; petal < 8; petal++) {
      var pa = petal * Math.PI / 4, px = 256 + Math.cos(pa) * 92, py = 256 + Math.sin(pa) * 92;
      pctx.save(); pctx.translate(px, py); pctx.rotate(pa);
      pctx.beginPath(); pctx.ellipse(0, 0, 30, 58, 0, 0, Math.PI * 2);
      pctx.fillStyle = petal % 2 ? '#315a83' : '#a94235'; pctx.fill();
      pctx.lineWidth = 8; pctx.strokeStyle = '#e0b957'; pctx.stroke(); pctx.restore();
    }
    pctx.beginPath(); pctx.moveTo(256, 171); pctx.lineTo(337, 256); pctx.lineTo(256, 341); pctx.lineTo(175, 256); pctx.closePath();
    pctx.fillStyle = '#bd8b37'; pctx.fill(); pctx.lineWidth = 9; pctx.strokeStyle = '#f0d596'; pctx.stroke();
    pctx.beginPath(); pctx.moveTo(256, 204); pctx.lineTo(306, 256); pctx.lineTo(256, 308); pctx.lineTo(206, 256); pctx.closePath();
    pctx.fillStyle = '#963d32'; pctx.fill();
    pctx.beginPath(); pctx.arc(256, 256, 28, 0, Math.PI * 2); pctx.fillStyle = '#e3c57c'; pctx.fill();
    var patchTexture = new THREE.CanvasTexture(patchCanvas);
    patchTexture.wrapS = patchTexture.wrapT = THREE.ClampToEdgeWrapping;
    if (THREE.sRGBEncoding !== undefined) patchTexture.encoding = THREE.sRGBEncoding;
    patchTexture.anisotropy = 4; generatedTextures.push(patchTexture);

    var patchR = 1.014, patchTheta = 1.10, patchAngle = -0.4, patchSpan = 0.62, patchSpanY = 0.57;
    var patchSegments = 64, patchRings = 12, patchPos = [], patchUv = [], patchIdx = [];
    for (var ring = 0; ring <= patchRings; ring++) {
      var radius = ring / patchRings;
      for (var seg = 0; seg <= patchSegments; seg++) {
        var angle = seg * Math.PI * 2 / patchSegments;
        var nx = radius * Math.cos(angle), ny = radius * Math.sin(angle);
        var phi = patchAngle + nx * patchSpan, theta = patchTheta - ny * patchSpanY;
        patchPos.push(patchR * Math.sin(theta) * Math.sin(phi), patchR * Math.cos(theta), patchR * Math.sin(theta) * Math.cos(phi));
        patchUv.push(0.5 + nx * 0.5, 0.5 + ny * 0.5);
      }
    }
    for (var pr = 0; pr < patchRings; pr++) for (var ps = 0; ps < patchSegments; ps++) {
      var a = pr * (patchSegments + 1) + ps, b = a + patchSegments + 1;
      patchIdx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    var patchGeo = new THREE.BufferGeometry();
    patchGeo.setAttribute('position', new THREE.Float32BufferAttribute(patchPos, 3));
    patchGeo.setAttribute('uv', new THREE.Float32BufferAttribute(patchUv, 2));
    patchGeo.setIndex(patchIdx); patchGeo.computeVertexNormals();
    var faceMesh = new THREE.Mesh(patchGeo, new THREE.MeshStandardMaterial({ map: patchTexture, roughness: 0.72, side: THREE.DoubleSide }));
    faceMesh.position.y = 0.1; faceMesh.name = 'abstract_front_embroidery_patch'; faceMesh.castShadow = true; g.add(faceMesh);

    // ---- 护耳（两侧） ----
    function makeEarFlap(side) {
      var flap = new THREE.Group();
      // 主体（黑色棉布）
      var main = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), matBlack);
      main.scale.set(0.65, 1.3, 0.12);
      flap.add(main);
      flap.position.set(side * 0.72, 0.35, 0.15);
      flap.rotation.z = side * -0.25;
      flap.rotation.y = side * 0.3;
      return flap;
    }
    g.add(makeEarFlap(-1));
    g.add(makeEarFlap(1));
    g.userData.conceptOnly = true;

    return g;
  }

  /* ================================================================
     客家围屋 — 方形堡垒 + 夯土墙 + 四角炮楼 + 梅花枪眼 + 石板院
     ================================================================ */
  function buildWeiwu() { return buildGuanxiWeiwu(); }

  // 关西新围：方形“回”字围合、九幢十八厅关系、中央祠堂与四角炮楼；仅作形制示意。
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
    var W = 3.5, D = 3.5, y0 = 0.18, floorH = 0.54;

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




    // 方形围墙；正面两座门（主门与侧门）用分段墙体保留示意洞口。
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

    // 三进轴线：中央厅堂作为祠堂，两座天井与前后厅堂形成“回”字空间示意。
    var names=['front_hall','ancestral_hall','rear_hall'];
    var rowZ=[0.83,0.06,-0.74], widths=[2.24,2.52,2.24], depths=[.36,.34,.42], eaveY=[1.06,1.26,1.10];
    rowZ.forEach(function(z,i){
      var w=widths[i], d=depths[i], nm=names[i], bodyH=eaveY[i]-.44;
      box(nm+'_rammed_earth_ground',w,.44,d,earth,0,.47,z);
      box(nm+'_blue_brick_upper',w,bodyH,d,brick,0,.44+bodyH/2,z);
      box(nm+'_shadowed_veranda',w+.10,.08,d+.10,timber,0,.30,z,false);
      roof(nm,0,z,w+.14,d+.10,eaveY[i],i===1?.34:.26,i===1);
      [-1,1].forEach(function(s){var wingX=s*1.36; box('covered_corridor_'+i+'_wingwall_'+s,.30,.72,.34,earth,wingX,.66,z); box('covered_corridor_'+i+'_eave_'+s,.42,.05,.44,timber,wingX,1.02,z,false);});
    });
    // 中轴祠堂正面台阶、门扇、檐柱与空白匾额。匾额留白，避免凭空添加题字。
    var ancestralFrontZ=rowZ[1]+depths[1]/2;
    box('ancestral_hall_stone_steps',1.05,.10,.22,stone,0,.30,ancestralFrontZ+.10);
    box('ancestral_hall_entry',.36,.66,.055,doorMat,0,.69,ancestralFrontZ+.055);
    box('ancestral_hall_blank_plaque',.46,.13,.05,lime,0,1.02,ancestralFrontZ+.02,false);
    [-.62,-.21,.21,.62].forEach(function(x,i){var col=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.72,8),timber);col.position.set(x,.72,ancestralFrontZ+.04);col.name='ancestral_hall_veranda_column_'+i;g.add(col);});
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
    g.userData.modelKind='guanxi-square-hui-form-schematic';
    g.userData.majorStructure=['square_hui_form_enclosure','nine_building_masses_eighteen_hall_relationship','central_ancestral_hall','four_corner_watchtowers','rammed_earth_and_brick','schematic_gates_and_courtyards'];
    g.position.y=-1.15;
    return g;
  }

  /* ================================================================
     蓝染布 — 几何留白样布 + 染缸情境示意
     ================================================================ */
  function buildLandye() {
    var g = new THREE.Group();
    var rodY = 1.32;
    var wood = new THREE.MeshStandardMaterial({ color: 0x745b43, roughness: 0.82 });
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.95, 12), wood);
    rod.rotation.z = Math.PI / 2; rod.position.y = rodY; rod.castShadow = true; g.add(rod);

    // 以博物馆样布的靛蓝几何留白、圆形放射纹为灵感的轻量程序纹样。
    var canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    var ctx = canvas.getContext('2d');
    var bg = ctx.createLinearGradient(0, 0, 512, 512);
    bg.addColorStop(0, '#315b83'); bg.addColorStop(0.52, '#173a62'); bg.addColorStop(1, '#244d75');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(8,28,51,0.26)'; ctx.lineWidth = 2;
    for (var grain = 0; grain < 48; grain++) {
      var gy = grain * 11 + 2; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(512, gy + 3); ctx.stroke();
    }
    function resistLine(points, width, alpha) {
      ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
      for (var p = 1; p < points.length; p++) ctx.lineTo(points[p][0], points[p][1]);
      ctx.strokeStyle = 'rgba(225,235,233,' + alpha + ')'; ctx.lineWidth = width;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.shadowColor = 'rgba(227,239,239,0.45)'; ctx.shadowBlur = 3; ctx.stroke(); ctx.shadowBlur = 0;
    }
    // 同心折叠圆纹与放射折线，保留少量断续边缘，避免图案像硬质印刷。
    for (var ring = 0; ring < 4; ring++) {
      ctx.beginPath(); ctx.arc(256, 256, 58 + ring * 26, 0.12, Math.PI * 1.86);
      ctx.strokeStyle = 'rgba(228,238,235,' + (0.82 - ring * 0.08) + ')'; ctx.lineWidth = 9 - ring; ctx.stroke();
    }
    for (var ray = 0; ray < 16; ray++) {
      var angle = ray * Math.PI / 8, r0 = 64, r1 = 178;
      resistLine([[256 + Math.cos(angle) * r0, 256 + Math.sin(angle) * r0],
        [256 + Math.cos(angle + 0.035) * (r0 + 14), 256 + Math.sin(angle + 0.035) * (r0 + 14)],
        [256 + Math.cos(angle) * r1, 256 + Math.sin(angle) * r1]], 6, 0.75);
    }
    // 角部用折线菱形呼应方形折叠样布，不绘制无法由照片支持的植物图案。
    [[92,92],[420,92],[92,420],[420,420]].forEach(function (c) {
      var d = 42;
      resistLine([[c[0],c[1]-d],[c[0]+d,c[1]],[c[0],c[1]+d],[c[0]-d,c[1]],[c[0],c[1]-d]], 7, 0.78);
    });
    var batik = new THREE.CanvasTexture(canvas);
    batik.wrapS = batik.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding !== undefined) batik.encoding = THREE.sRGBEncoding;
    batik.anisotropy = 4; generatedTextures.push(batik);

    var clothW = 1.55, clothH = 1.55;
    var clothGeo = new THREE.PlaneGeometry(clothW, clothH, 40, 40);
    var cp = clothGeo.attributes.position;
    for (var i = 0; i < cp.count; i++) {
      var x = cp.getX(i), y = cp.getY(i);
      var fold = Math.sin(x * 5.5) * 0.045 + Math.sin(x * 12 + y * 1.7) * 0.012;
      var sag = -0.045 * (1 - (y + clothH / 2) / clothH) * (1 - Math.abs(x) / (clothW / 2));
      cp.setZ(i, fold + sag);
    }
    clothGeo.computeVertexNormals();
    var cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ map: batik, roughness: 0.9, side: THREE.DoubleSide }));
    cloth.position.set(0, rodY - clothH / 2, 0); cloth.castShadow = true; cloth.receiveShadow = true; g.add(cloth);
    [-0.48, -0.16, 0.16, 0.48].forEach(function (hx) {
      var hook = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.62, metalness: 0.2 }));
      hook.position.set(hx, rodY - 0.025, 0.015); hook.rotation.x = Math.PI / 2; g.add(hook);
    });

    // 染缸只作工艺情境提示；不额外加入缺少照片依据的植物道具。
    var vatY = -0.72;
    var vatMat = new THREE.MeshStandardMaterial({ color: 0x514237, roughness: 0.93 });
    var vat = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.33, 0.48, 32, 1, true), vatMat);
    vat.position.set(0, vatY, -0.34); vat.castShadow = true; g.add(vat);
    var vatBase = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.035, 32), vatMat);
    vatBase.position.set(0, vatY - 0.22, -0.34); g.add(vatBase);
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.025, 8, 32), vatMat);
    rim.rotation.x = Math.PI / 2; rim.position.set(0, vatY + 0.23, -0.34); g.add(rim);
    var liquid = new THREE.Mesh(new THREE.CircleGeometry(0.335, 32),
      new THREE.MeshStandardMaterial({ color: 0x173554, roughness: 0.82, side: THREE.DoubleSide }));
    liquid.rotation.x = -Math.PI / 2; liquid.position.set(0, vatY + 0.195, -0.34); g.add(liquid);
    g.position.y = -0.04;
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
    var bamboo = new THREE.MeshStandardMaterial({ map: weave, color: 0xe1c18c, roughness: 0.88, side: THREE.DoubleSide });
    var R = 0.95;

    // 轮廓和材质为概念展示；本批素材没有可确认的凉帽实物近照。
    var crownProfile = [
      new THREE.Vector2(0, 0.26), new THREE.Vector2(0.25, 0.26), new THREE.Vector2(0.34, 0.29),
      new THREE.Vector2(0.35, 0.35), new THREE.Vector2(0.31, 0.43), new THREE.Vector2(0.24, 0.48),
      new THREE.Vector2(0, 0.49)
    ];
    var crown = new THREE.Mesh(new THREE.LatheGeometry(crownProfile, 40), bamboo);
    crown.name = 'concept_hat_crown'; crown.castShadow = true; g.add(crown);

    var brimGeo = new THREE.CylinderGeometry(R, R * 0.98, 0.045, 64, 1, false);
    var brim = new THREE.Mesh(brimGeo, bamboo);
    brim.position.y = 0.235; brim.castShadow = true; brim.receiveShadow = true; g.add(brim);
    var edge = new THREE.Mesh(new THREE.TorusGeometry(R * 0.995, 0.024, 8, 72),
      new THREE.MeshStandardMaterial({ color: 0xa98451, roughness: 0.8 }));
    edge.rotation.x = Math.PI / 2; edge.position.y = 0.235; edge.name = 'wrapped_brim_edge_concept'; g.add(edge);

    // 松量较轻的环形布片只表达“布面”材质，不指定未经照片确认的褶数与装饰。
    var skirtH = 0.42;
    var skirtGeo = new THREE.CylinderGeometry(R * 1.015, R * 1.035, skirtH, 72, 8, true);
    var sp = skirtGeo.attributes.position;
    for (var i = 0; i < sp.count; i++) {
      var x = sp.getX(i), z = sp.getZ(i), y = sp.getY(i), a = Math.atan2(z, x);
      var pleat = Math.sin(a * 20) * 0.009;
      var radius = Math.sqrt(x * x + z * z) + pleat;
      sp.setX(i, Math.cos(a) * radius); sp.setZ(i, Math.sin(a) * radius);
      sp.setY(i, y - Math.abs(pleat) * 0.25);
    }
    skirtGeo.computeVertexNormals();
    var skirtMat = new THREE.MeshStandardMaterial({ map: cloth, color: 0x66839a, roughness: 0.93, side: THREE.DoubleSide });
    var skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = 0.02; skirt.castShadow = true; g.add(skirt);
    g.position.y = -0.008;
    g.userData.conceptOnly = true;
    return g;
  }

  /* ================================================================
     竹编浅圆器 —— 交织底面与包边圈口
     ================================================================ */
  function buildBoji() {
    var g = new THREE.Group();
    // 留出明显安全边：编织片和篾条端点收在浅壁下沿以内，避免斜视时穿出圈口。
    var R = 1.0, weaveR = 0.83, stripW = 0.072, count = 19, segments = 38;
    var baseMat = new THREE.MeshStandardMaterial({ color: 0x987244, roughness: 0.94, side: THREE.DoubleSide });
    var base = new THREE.Mesh(new THREE.CircleGeometry(R * 0.84, 56), baseMat);
    base.rotation.x = -Math.PI / 2; base.position.y = 0; base.receiveShadow = true; g.add(base);

    // 每条篾带按交点轻微起伏，横竖带交替压挑，几何直接表现照片中的交织底面。
    function addWeave(axis) {
      var positions = [], indices = [];
      var span = 1.54, crossingStep = span / (count - 1), phaseBias = axis === 'v' ? 1 : 0;
      function weaveHeight(along, line) {
        var phase = (along + span / 2) / crossingStep + line + phaseBias;
        return 0.025 + 0.007 * Math.cos(Math.PI * phase);
      }
      function vertex(x, yy, z) {
        positions.push(x, yy, z);
      }
      for (var line = 0; line < count; line++) {
        var offset = -span / 2 + line * (span / (count - 1));
        // 以带宽最外侧的角点裁短，端头藏在圈口下方，轮廓不靠逐顶点挤压来凑圆。
        var edgeHalf = Math.sqrt(Math.max(0, weaveR * weaveR - Math.pow(Math.abs(offset) + stripW / 2, 2))) - 0.025;
        for (var seg = 0; seg < segments; seg++) {
          var along0 = -edgeHalf + (edgeHalf * 2) * seg / segments;
          var along1 = -edgeHalf + (edgeHalf * 2) * (seg + 1) / segments;
          var y0 = weaveHeight(along0, line), y1 = weaveHeight(along1, line);
          var start = positions.length / 3;
          if (axis === 'h') {
            vertex(along0,y0,offset-stripW/2); vertex(along1,y1,offset-stripW/2);
            vertex(along1,y1,offset+stripW/2); vertex(along0,y0,offset+stripW/2);
          } else {
            vertex(offset-stripW/2,y0,along0); vertex(offset+stripW/2,y0,along0);
            vertex(offset+stripW/2,y1,along1); vertex(offset-stripW/2,y1,along1);
          }
          indices.push(start,start+1,start+2,start,start+2,start+3);
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices); geo.computeVertexNormals();
      var mat = new THREE.MeshStandardMaterial({ color: axis === 'h' ? 0xa87940 : 0x815a32, roughness: 0.9, side: THREE.DoubleSide });
      var mesh = new THREE.Mesh(geo, mat); mesh.name = axis === 'h' ? 'woven_bamboo_over_strips' : 'woven_bamboo_under_strips';
      mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
    }
    addWeave('h'); addWeave('v');
    // 一道细窄的内收篾圈压住交织端头，避免斜视时看到锯齿切边。
    var weaveBinding = new THREE.Mesh(new THREE.TorusGeometry(0.824, 0.013, 6, 64),
      new THREE.MeshStandardMaterial({ color: 0x936b3b, roughness: 0.91 }));
    weaveBinding.rotation.x = Math.PI / 2; weaveBinding.position.y = 0.03;
    weaveBinding.name = 'woven_edge_binding'; g.add(weaveBinding);

    // 低矮浅边与双层圈口。编织片最大半径留在圈口内缘，边缘不会露出参差篾条。
    var sideCanvas = document.createElement('canvas'); sideCanvas.width = 256; sideCanvas.height = 128;
    var sctx = sideCanvas.getContext('2d'); sctx.fillStyle = '#987244'; sctx.fillRect(0,0,256,128);
    for (var sy = 0; sy < 128; sy += 8) {
      for (var sx = 0; sx < 256; sx += 16) {
        sctx.fillStyle = ((sx / 16 + sy / 8) % 2) ? '#a98450' : '#89643b';
        sctx.fillRect(sx + 1, sy + 1, 14, 6);
      }
    }
    var sideTexture = new THREE.CanvasTexture(sideCanvas); sideTexture.wrapS = sideTexture.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding !== undefined) sideTexture.encoding = THREE.sRGBEncoding;
    generatedTextures.push(sideTexture);
    var wall = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.84, 0.12, 64, 1, true),
      new THREE.MeshStandardMaterial({ map: sideTexture, color: 0xd0b17d, roughness: 0.93, side: THREE.DoubleSide }));
    wall.position.y = 0.08; wall.castShadow = true; g.add(wall);
    [0.135,0.16].forEach(function (y, i) {
      var rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.99, i === 0 ? 0.027 : 0.014, 8, 72),
        new THREE.MeshStandardMaterial({ color: i === 0 ? 0x9b7543 : 0xb28b53, roughness: 0.87 }));
      rim.rotation.x = Math.PI / 2; rim.position.y = y; rim.castShadow = true; g.add(rim);
    });
    g.position.y = 0;
    g.userData.modelKind = 'shallow-round-bamboo-woven-vessel-schematic';
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
    // 依据展柜/桌面照片做无文字的抽象挑花：饱和蓝紫红色带、白色折线菱纹。
    var beltCanvas=document.createElement('canvas'); beltCanvas.width=256; beltCanvas.height=512;
    var bctx=beltCanvas.getContext('2d');
    bctx.fillStyle='#245b9b'; bctx.fillRect(0,0,256,512);
    bctx.fillStyle='#783f82'; bctx.fillRect(54,0,148,512);
    bctx.fillStyle='#a62c3c'; bctx.fillRect(101,0,54,512);
    bctx.fillStyle='#1d2631'; bctx.fillRect(0,0,10,512); bctx.fillRect(246,0,10,512);
    for(var yy=0;yy<512;yy+=4){
      bctx.fillStyle=(yy/4)%2?'rgba(255,255,255,.10)':'rgba(0,0,0,.12)';
      bctx.fillRect(0,yy,256,1.4);
    }
    for(var my=24;my<512;my+=64){
      bctx.beginPath(); bctx.moveTo(128,my-19); bctx.lineTo(147,my); bctx.lineTo(128,my+19); bctx.lineTo(109,my); bctx.closePath();
      bctx.strokeStyle='rgba(250,244,229,.94)'; bctx.lineWidth=4; bctx.stroke();
      bctx.beginPath(); bctx.moveTo(76,my-17); bctx.lineTo(91,my-7); bctx.lineTo(76,my+3); bctx.lineTo(91,my+13);
      bctx.strokeStyle='rgba(250,244,229,.88)'; bctx.lineWidth=3; bctx.stroke();
      bctx.beginPath(); bctx.moveTo(180,my-17); bctx.lineTo(165,my-7); bctx.lineTo(180,my+3); bctx.lineTo(165,my+13); bctx.stroke();
    }
    for(var bx=12;bx<256;bx+=12){
      bctx.fillStyle='rgba(255,250,236,.20)'; bctx.fillRect(bx,0,1.2,512);
    }
    var belt=new THREE.CanvasTexture(beltCanvas); belt.wrapS=belt.wrapT=THREE.RepeatWrapping;
    if(THREE.sRGBEncoding!==undefined) belt.encoding=THREE.sRGBEncoding;
    belt.repeat.set(1,1.6); belt.anisotropy=4; generatedTextures.push(belt);
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
      // 经线细丝体现不同颜色束，白色只作装饰线，不伪造可读汉字或固定祝福含义。
      var lanes=[],wq=[['#171b22',1],['#f3ead9',2],['#a62c3c',5],['#245b9b',7],['#f3ead9',3],
                       ['#783f82',7],['#f3ead9',3],['#a62c3c',3],['#171b22',2]];
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
    g.userData.majorStructure=['blue_purple_red_band_sections','abstract_white_geometric_motifs','soft_twisted_drape','raised_warp_fibres','plain_twisted_yada','hand_tied_knots','visible_silk_fringe'];
    g.position.y=-1.15;
    return g;
  }

  /* ================================================================
     米酒坛 —— 酱釉陶坛 + 红纸封口
     ================================================================ */
  function buildMijiutan() {
    var g = new THREE.Group();
    var glaze = canvasTex('glazeJar', 2, 1);
    var profile = [
      [0.00,0.00],[0.28,0.00],[0.34,0.035],[0.43,0.14],[0.51,0.31],
      [0.54,0.50],[0.52,0.66],[0.46,0.81],[0.37,0.94],[0.30,1.01],
      [0.285,1.08],[0.30,1.13],[0.295,1.16]
    ].map(function (v) { return new THREE.Vector2(v[0], v[1]); });
    var ceramic = new THREE.MeshStandardMaterial({ map: glaze, color: 0xffffff, roughness: 0.58, metalness: 0.0 });
    var body = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), ceramic);
    body.name = 'concept_ceramic_jar_body'; body.castShadow = true; body.receiveShadow = true; g.add(body);

    // 开口与厚唇仅用于表现陶器截面；帽盖、弦纹、酒盏均无本批实物照片依据，故不添加。
    var lip = new THREE.Mesh(new THREE.TorusGeometry(0.298, 0.025, 10, 64),
      new THREE.MeshStandardMaterial({ color: 0x765039, roughness: 0.67 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 1.145; lip.name = 'unadorned_jar_lip'; g.add(lip);
    var innerWall = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.305, 0.27, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x553a2b, roughness: 0.88, side: THREE.DoubleSide }));
    innerWall.position.y = 1.015; g.add(innerWall);
    var inside = new THREE.Mesh(new THREE.CircleGeometry(0.276, 48),
      new THREE.MeshStandardMaterial({ color: 0x39291f, roughness: 0.95, side: THREE.DoubleSide }));
    inside.rotation.x = -Math.PI / 2; inside.position.y = 0.88; g.add(inside);
    g.position.y = -0.58;
    g.userData.conceptOnly = true;
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
        setProgress('加载模型贴图…');
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
