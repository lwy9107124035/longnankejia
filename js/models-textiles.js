/* Photo-grounded textile display models. Three.js r128, x/z centered, y up. */
(function (root) {
  'use strict';

  var texturePaths = {
    huamaoFace: 'assets/model-textures/cloth-huamao-face.jpg',
    huamaoTop: 'assets/model-textures/cloth-huamao-top.jpg',
    huamaoDrape: 'assets/model-textures/cloth-huamao-drape.jpg',
    zhidaiBand: 'assets/model-textures/cloth-zhidai-band.jpg',
    dongtoupaFront: 'assets/model-textures/cloth-dongtoupa-front.jpg',
    dajinshanBody: 'assets/model-textures/cloth-dajinshan-body.jpg',
    dajinshanCuff: 'assets/model-textures/cloth-dajinshan-cuff.jpg',
    dajinshanSash: 'assets/model-textures/cloth-dajinshan-sash.jpg',
    zisundaiFront: 'assets/model-textures/cloth-zisundai-front.jpg',
    boweiTop: 'assets/model-textures/cloth-bowei-top.jpg'
  };

  function material(THREE, color, map, roughness, side) {
    return new THREE.MeshStandardMaterial({
      color: color || 0xffffff,
      map: map || null,
      roughness: roughness == null ? 0.9 : roughness,
      metalness: 0,
      side: side || THREE.FrontSide
    });
  }

  function addMesh(group, THREE, name, geometry, mat, position) {
    var mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name;
    if (position) mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function setEvidence(group, ids, mode) {
    group.userData.referenceIds = ids;
    group.userData.referenceMode = mode || 'photo-textured';
    return group;
  }

  function curve(THREE, points) {
    return new THREE.CatmullRomCurve3(points.map(function (p) {
      return new THREE.Vector3(p[0], p[1], p[2]);
    }));
  }

  function addTube(group, THREE, name, points, radius, color, segments) {
    return addMesh(group, THREE, name,
      new THREE.TubeGeometry(curve(THREE, points), segments || 24, radius, 5, false),
      material(THREE, color));
  }

  function createStrip(THREE, name, texture, options) {
    var width = options.width, length = options.length, steps = options.steps || 48;
    var columns = 4, vertices = [], uvs = [], indices = [];
    function offset(t) {
      return Math.sin(t * Math.PI * 2 + (options.phase || 0)) * (options.wave || 0.06) +
        Math.sin(t * Math.PI * 4 + 0.4) * (options.wave || 0.06) * 0.24;
    }
    for (var j = 0; j <= steps; j++) {
      var t = j / steps;
      for (var i = 0; i <= columns; i++) {
        var across = i / columns - 0.5;
        var x = options.x + across * width;
        var y = options.yTop - t * length;
        var z = options.z + offset(t) + Math.sin(across * Math.PI) * 0.018;
        vertices.push(x, y, z, x, y, z - 0.018);
        uvs.push(t, 1 - i / columns, t, 1 - i / columns);
      }
    }
    var layerCount = (steps + 1) * (columns + 1) * 2;
    for (var row = 0; row < steps; row++) {
      for (var col = 0; col < columns; col++) {
        var a = row * (columns + 1) * 2 + col * 2;
        var b = a + (columns + 1) * 2;
        indices.push(a, a + 2, b, a + 2, b + 2, b);
        indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
      }
    }
    // A fine perimeter seam closes the narrow fabric edge in the cross-section.
    for (var e = 0; e < steps; e++) {
      var left = e * (columns + 1) * 2, nextLeft = left + (columns + 1) * 2;
      var right = left + columns * 2, nextRight = nextLeft + columns * 2;
      indices.push(left, left + 1, nextLeft, left + 1, nextLeft + 1, nextLeft);
      indices.push(right, nextRight, right + 1, right + 1, nextRight, nextRight + 1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.userData.layerCount = layerCount;
    return addMesh(options.group, THREE, name, geo,
      material(THREE, 0xffffff, texture, 1, THREE.DoubleSide));
  }

  function buildHutoumao(THREE, textures) {
    var g = new THREE.Group(); g.name = '花帽219·虎脸绣片';
    var black = material(THREE, 0x17151b), red = material(THREE, 0x9b2435), trim = material(THREE, 0xe8c8ad);
    var crown = addMesh(g, THREE, '黑布帽冠', new THREE.SphereGeometry(0.72, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.70), black, [0, 0.89, 0]);
    crown.scale.y = 0.86;
    addMesh(g, THREE, '帽檐软边', new THREE.CylinderGeometry(0.77, 0.72, 0.12, 48), black, [0, 0.46, 0]);
    var brimPiping = addMesh(g, THREE, '帽檐红色包边', new THREE.TorusGeometry(0.755, 0.035, 7, 48), red, [0, 0.51, 0]);
    brimPiping.rotation.x = Math.PI / 2;
    addMesh(g, THREE, '帽内衬', new THREE.CylinderGeometry(0.53, 0.56, 0.1, 40), material(THREE, 0x302a30), [0, 0.39, 0]);

    function hatSurfaceZ(x, y) {
      var yy = (y - 0.89) / 0.86;
      return Math.sqrt(Math.max(0.015, 0.72*0.72 - x*x - yy*yy*0.72*0.72)) + 0.012;
    }
    function addHatPatch(name, texture, width, height, centerY, rows, cols) {
      var positions = [], uvs = [], indices = [];
      for (var py = 0; py <= rows; py++) {
        var v = py / rows, y = centerY + height / 2 - v * height;
        for (var px = 0; px <= cols; px++) {
          var u = px / cols;
          // Narrow the top edge to follow the dome silhouette while keeping
          // the lower embroidered band broad across the front of the crown.
          var patchWidth = name === '219白地花绣冠饰' ? 0.48 + 0.52 * v : 1;
          var x = (u - 0.5) * width * patchWidth;
          positions.push(x, y, hatSurfaceZ(x, y)); uvs.push(u, 1 - v);
        }
      }
      for (var pr = 0; pr < rows; pr++) for (var pc = 0; pc < cols; pc++) {
        var pi = pr * (cols + 1) + pc;
        indices.push(pi, pi+1, pi+cols+1, pi+1, pi+cols+2, pi+cols+1);
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices); geo.computeVertexNormals();
      return addMesh(g, THREE, name, geo, material(THREE, 0xffffff, texture, 1, THREE.DoubleSide));
    }
    addHatPatch('219白地花绣冠饰', textures.huamaoTop, 1.35, 0.33, 1.31, 20, 56);
    addHatPatch('219虎脸弯曲刺绣布片', textures.huamaoFace, 0.72, 0.50, 0.88, 26, 36);
    addTube(g, THREE, '虎脸绣片弧形红锁边', [[-0.34,0.63,hatSurfaceZ(-0.34,0.63)],[-0.37,0.78,hatSurfaceZ(-0.37,0.78)],[-0.34,1.08,hatSurfaceZ(-0.34,1.08)],[0,1.14,hatSurfaceZ(0,1.14)],[0.34,1.08,hatSurfaceZ(0.34,1.08)],[0.37,0.78,hatSurfaceZ(0.37,0.78)],[0.34,0.63,hatSurfaceZ(0.34,0.63)],[0,0.62,hatSurfaceZ(0,0.62)],[-0.34,0.63,hatSurfaceZ(-0.34,0.63)]], 0.012, 0xcf3343, 48);
    var drapeVertices = [], drapeUvs = [], drapeIndices = [], dr = 14, dc = 28;
    for (var dy = 0; dy <= dr; dy++) for (var dx = 0; dx <= dc; dx++) {
      var du = dx / dc, dv = dy / dr, pxD = (du - 0.5) * 1.12, pyD = 0.40 - dv * 0.40;
      drapeVertices.push(pxD, pyD, 0.50 + 0.045 * Math.cos(du * Math.PI * 2) + 0.018 * Math.sin(dv * Math.PI * 2 + du * 4));
      drapeUvs.push(du, 1 - dv);
    }
    for (var dy2 = 0; dy2 < dr; dy2++) for (var dx2 = 0; dx2 < dc; dx2++) {
      var di = dy2 * (dc + 1) + dx2;
      drapeIndices.push(di, di+1, di+dc+1, di+1, di+dc+2, di+dc+1);
    }
    var drapeGeo = new THREE.BufferGeometry();
    drapeGeo.setAttribute('position', new THREE.Float32BufferAttribute(drapeVertices, 3));
    drapeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(drapeUvs, 2));
    drapeGeo.setIndex(drapeIndices); drapeGeo.computeVertexNormals();
    addMesh(g, THREE, '219红花布帘', drapeGeo, material(THREE, 0xffffff, textures.huamaoDrape, 1, THREE.DoubleSide));
    addTube(g, THREE, '红花布帘下摆', [[-0.56,0.01,0.54],[-0.28,-0.012,0.53],[0,-0.005,0.54],[0.28,-0.012,0.53],[0.56,0.01,0.54]], 0.014, 0x5b1c22, 30);
    addTube(g, THREE, '帽顶绣线', [[0,1.49,0],[0,1.57,0.02],[0.10,1.60,0.02]], 0.026, 0xc33142, 12);
    return setEvidence(g, [219], 'photo-textured');
  }

  function buildZhidai(THREE, textures) {
    var g = new THREE.Group(); g.name = '织带255·独立长带与穗';
    createStrip(THREE, '单条蓝底织带255', textures.zhidaiBand, {
      group: g, x: 0, yTop: 1.15, z: 0, width: 0.12, length: 1.95, wave: 0.055, steps: 64, phase: 0.25
    });
    // Short transverse hem and individually twisted yarns make the tassel readable at small scale.
    addTube(g, THREE, '织带上端卷边', [[-0.06,1.15,0.04],[0,1.17,0.04],[0.06,1.15,0.04]], 0.012, 0x263f72, 12);
    addTube(g, THREE, '穗根结', [[-0.045,-0.79,0.01],[0,-0.82,0.01],[0.045,-0.79,0.01]], 0.018, 0x9c4765, 12);
    var colors = [0x394e82,0xb34f74,0xd1c4b1,0x31436e,0x9b4361];
    for (var i = 0; i < 11; i++) {
      var x = -0.045 + i * 0.009;
      addTube(g, THREE, '穗线-' + (i + 1), [[x,-0.80,0.005],[x + 0.008,-0.90,0.025],[x - 0.010,-1.00,0.045],[x + (i % 2 ? 0.012 : -0.014),-1.10,0.035]], 0.0045, colors[i % colors.length], 10);
    }
    return setEvidence(g, [255], 'photo-textured');
  }

  function buildDongtoupa(THREE, textures) {
    var g = new THREE.Group(); g.name = '冬头帕235·矩形织物';
    var back = material(THREE, 0x4d2927), edge = material(THREE, 0x9d4d46);
    addMesh(g, THREE, '方形布料厚身', new THREE.BoxGeometry(1.58, 1.58, 0.075), back, [0, 0.80, 0]);
    var cloth = new THREE.PlaneGeometry(1.55, 1.55, 24, 24);
    var points = cloth.attributes.position;
    for (var v = 0; v < points.count; v++) {
      points.setZ(v, 0.008 * Math.sin(points.getX(v) * 8) * Math.sin(points.getY(v) * 6));
    }
    cloth.computeVertexNormals();
    addMesh(g, THREE, '235红布与中央密竖纹', cloth,
      material(THREE, 0xffffff, textures.dongtoupaFront, 1, THREE.DoubleSide), [0, 0.80, 0.052]);
    var hem = [[-0.77,0.02,0.05],[-0.40,0.005,0.05],[0.0,0.025,0.05],[0.40,0.005,0.05],[0.77,0.02,0.05]];
    addTube(g, THREE, '下摆锁边', hem, 0.022, 0xdec1a0, 28);
    addTube(g, THREE, '上边锁线', [[-0.76,1.57,0.05],[0,1.59,0.05],[0.76,1.57,0.05]], 0.013, 0xc18874, 20);
    for (var side = -1; side <= 1; side += 2) {
      addTube(g, THREE, side < 0 ? '左侧缝线' : '右侧缝线', [[side*0.76,0.08,0.05],[side*0.78,0.80,0.05],[side*0.76,1.52,0.05]], 0.009, 0xa76358, 20);
    }
    return setEvidence(g, [235], 'photo-textured');
  }

  function buildDajinshan(THREE, textures) {
    var g = new THREE.Group(); g.name = '大襟衫230·单件上衣';
    var blue = material(THREE, 0x263b64), inside = material(THREE, 0x18243e);
    var torsoShape = new THREE.Shape();
    torsoShape.moveTo(-0.48, 1.84); torsoShape.lineTo(0.48, 1.84); torsoShape.lineTo(0.59, 1.60);
    torsoShape.lineTo(0.53, 0.13); torsoShape.quadraticCurveTo(0, 0.02, -0.53, 0.13);
    torsoShape.lineTo(-0.59, 1.60); torsoShape.closePath();
    addMesh(g, THREE, '上衣蓝色后身', new THREE.ExtrudeGeometry(torsoShape, { depth: 0.15, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.025, bevelThickness: 0.025 }), blue, [0, 0, -0.08]);
    var front = new THREE.PlaneGeometry(1, 1.73, 24, 32);
    var vertices = front.attributes.position;
    for (var i = 0; i < vertices.count; i++) {
      var u = vertices.getX(i) + 0.5, y = vertices.getY(i) + 0.995;
      var halfWidth = y > 1.60 ? 0.59 - (y - 1.60) / 0.265 * 0.11 : 0.53 + (y - 0.13) / 1.47 * 0.06;
      vertices.setXYZ(i, (u - 0.5) * halfWidth * 2, y,
        0.115 + 0.025 * Math.sin(u * Math.PI) + 0.008 * Math.sin(u * 23 + y * 3));
    }
    front.computeVertexNormals();
    var blueCloth = material(THREE, 0xffffff, textures.dajinshanBody, 1, THREE.DoubleSide);
    addMesh(g, THREE, '前襟照片织纹', front, blueCloth);
    [-1, 1].forEach(function (side) {
      var arm = new THREE.Group(); arm.name = side < 0 ? '左宽袖' : '右宽袖';
      arm.position.set(side * 0.74, 1.10, 0); arm.rotation.z = side * 0.26;
      g.add(arm);
      var sleeve = new THREE.CylinderGeometry(0.17, 0.26, 1.10, 28, 18, true);
      var sleevePoints = sleeve.attributes.position;
      for (var j = 0; j < sleevePoints.count; j++) {
        var sx = sleevePoints.getX(j), sy = sleevePoints.getY(j), sz = sleevePoints.getZ(j);
        var ripple = 1 + 0.035 * Math.cos(Math.atan2(sz, sx) * 7 + sy * 4);
        sleevePoints.setXYZ(j, sx * ripple, sy, sz * 0.70 * ripple);
      }
      sleeve.computeVertexNormals();
      addMesh(arm, THREE, '宽袖照片织纹', sleeve, blueCloth);
      var shoulder = addMesh(arm, THREE, '圆顺袖山', new THREE.SphereGeometry(0.175,20,12), blueCloth, [0,0.53,0]);
      shoulder.scale.set(1,0.60,0.70);
      var cuff = addMesh(arm, THREE, '袖口整圈织带', new THREE.CylinderGeometry(0.245,0.263,0.20,28,1,true),
        material(THREE, 0xffffff, textures.dajinshanCuff, 1, THREE.DoubleSide), [0,-0.45,0]);
      cuff.scale.z = 0.70;
    });
    // The diagonal overlap is visible on the photographed garment and sits over the plain body.
    var sash = addMesh(g, THREE, '领口斜襟织带', new THREE.PlaneGeometry(0.82,0.135),
      material(THREE,0xffffff,textures.dajinshanSash,1,THREE.DoubleSide), [0,1.67,0.145]);
    sash.rotation.z = 0.22;
    var overlap = addMesh(g, THREE, '斜襟下接织边', new THREE.PlaneGeometry(0.57,0.09),
      material(THREE,0xffffff,textures.dajinshanSash,1,THREE.DoubleSide), [-0.42,1.37,0.155]);
    overlap.rotation.z = 1.45;
    addTube(g, THREE, '斜襟缝线', [[-0.38,1.57,0.15],[-0.15,1.64,0.15],[0.10,1.70,0.15],[0.38,1.79,0.15]], 0.008, 0xb9a4ad, 22);
    var collar = addMesh(g, THREE, '圆弧立领', new THREE.CylinderGeometry(0.20,0.23,0.19,28,1,true), blueCloth, [0,1.91,0]);
    collar.scale.z = 0.60;
    var collarInside = addMesh(g, THREE, '立领内侧', new THREE.CylinderGeometry(0.195,0.22,0.18,28,1,true), inside, [0,1.91,0]);
    collarInside.scale.z = 0.60; collarInside.material.side = THREE.DoubleSide;
    addTube(g, THREE, '衣摆折痕', [[-0.51,0.14,0.10],[-0.24,0.11,0.112],[0.05,0.13,0.112],[0.31,0.10,0.10],[0.52,0.14,0.10]], 0.012, 0x8090a5, 24);
    return setEvidence(g, [230], 'photo-textured');
  }

  function buildZisundai(THREE, textures) {
    var g = new THREE.Group(); g.name = '子孙袋199·软布袋';
    var backing = material(THREE, 0x5a4b3e), piping = material(THREE, 0xd9c9a6);
    addMesh(g, THREE, '袋身填充厚度', new THREE.BoxGeometry(1.12,1.23,0.05), backing, [0,0.66,0]);
    addMesh(g, THREE, '199号实物拼布正面', new THREE.PlaneGeometry(1.07,1.177), material(THREE, 0xffffff, textures.zisundaiFront, 1, THREE.DoubleSide), [0,0.66,0.026]);
    addTube(g, THREE, '袋口折缝', [[-0.52,1.28,0.075],[-0.26,1.30,0.075],[0,1.28,0.075],[0.26,1.30,0.075],[0.52,1.28,0.075]], 0.012, 0xcbb58f, 24);
    addTube(g, THREE, '左侧包边', [[-0.52,1.23,0.07],[-0.55,0.66,0.07],[-0.52,0.09,0.07]], 0.020, 0xd3c2a0, 24);
    addTube(g, THREE, '右侧包边', [[0.52,1.23,0.07],[0.55,0.66,0.07],[0.52,0.09,0.07]], 0.020, 0xd3c2a0, 24);
    addTube(g, THREE, '袋底缝线', [[-0.50,0.09,0.075],[-0.25,0.06,0.075],[0,0.08,0.075],[0.25,0.06,0.075],[0.50,0.09,0.075]], 0.014, 0xd3c2a0, 24);
    return setEvidence(g, [199], 'photo-textured');
  }

  function ringSector(THREE, name, inner, outer, start, end, y, mat) {
    var segments = 22, positions = [], uvs = [], indices = [];
    for (var i = 0; i <= segments; i++) {
      var t = i / segments, angle = start + (end - start) * t;
      [inner, outer].forEach(function (r, row) {
        positions.push(Math.cos(angle)*r, y, Math.sin(angle)*r);
        // The photograph's center at (.48,.416) from the top becomes v=.584.
        uvs.push(0.48 + Math.cos(angle)*r/outer*0.47, 0.584 + Math.sin(angle)*r/outer*0.47);
      });
    }
    for (var j = 0; j < segments; j++) {
      var a = j*2; indices.push(a,a+1,a+2,a+1,a+3,a+2);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs,2));
    geo.setIndex(indices); geo.computeVertexNormals();
    var mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function buildBowei(THREE, textures) {
    var g = new THREE.Group(); g.name = '脖围193·圆四分绣片';
    var outer = 0.78, inner = 0.164;
    for (var i = 0; i < 4; i++) {
      var start = -Math.PI/2 + i*Math.PI/2, end = start + Math.PI/2;
      var sector = ringSector(THREE, '四分之一照片布片-' + (i+1), inner, outer, start, end, 0.18,
        material(THREE, 0xffffff, textures.boweiTop, 1, THREE.DoubleSide));
      g.add(sector);
    }
    addMesh(g, THREE, '脖围软布侧壁', new THREE.CylinderGeometry(outer,outer,0.10,64,1,true), material(THREE,0x26374d, null,1,THREE.DoubleSide), [0,0.13,0]);
    addMesh(g, THREE, '孔口包边内壁', new THREE.CylinderGeometry(inner,inner,0.10,48,1,true), material(THREE,0x11192d, null,1,THREE.DoubleSide), [0,0.13,0]);
    // TorusGeometry starts in XY; rotate it flat in XZ to frame the real center opening.
    var topRim = addMesh(g, THREE, '外圈缝线', new THREE.TorusGeometry(outer-0.025,0.022,6,64), material(THREE,0xafa18c), [0,0.195,0]);
    topRim.rotation.x = Math.PI/2;
    var holeRim = addMesh(g, THREE, '中心孔包边', new THREE.TorusGeometry(inner+0.018,0.025,7,48), material(THREE,0x11182a), [0,0.20,0]);
    holeRim.rotation.x = Math.PI/2;
    return setEvidence(g, [193], 'photo-textured');
  }

  var builders = {
    hutoumao: buildHutoumao,
    zhidai: buildZhidai,
    dongtoupa: buildDongtoupa,
    dajinshan: buildDajinshan,
    zisundai: buildZisundai,
    bowei: buildBowei
  };

  root.TextileModels = {
    textures: texturePaths,
    build: function (id, THREE, textures) {
      var builder = builders[id];
      return builder ? builder(THREE, textures || {}) : null;
    }
  };
}(window));
