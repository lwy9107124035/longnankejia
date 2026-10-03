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
    var result = new THREE.MeshStandardMaterial({
      color: color || 0xffffff,
      map: map || null,
      roughness: roughness == null ? 0.9 : roughness,
      metalness: 0,
      side: side || THREE.FrontSide
    });
    result.userData.surface='fabric';
    return result;
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

  function clothGrid(THREE, columns, rows, sample, reverse) {
    var positions = [], uvs = [], indices = [];
    for (var row = 0; row <= rows; row++) for (var col = 0; col <= columns; col++) {
      var u = col / columns, v = row / rows, point = sample(u, v);
      positions.push(point[0], point[1], point[2]);
      uvs.push(point[3] == null ? u : point[3], point[4] == null ? v : point[4]);
    }
    for (var y = 0; y < rows; y++) for (var x = 0; x < columns; x++) {
      var a = y * (columns + 1) + x, b = a + columns + 1;
      if (reverse) indices.push(a, b, a + 1, a + 1, b, b + 1);
      else indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }

  function profileAt(profile, y) {
    for (var i = 1; i < profile.length; i++) {
      if (y <= profile[i][0]) {
        var a = profile[i - 1], b = profile[i], t = Math.max(0, (y - a[0]) / (b[0] - a[0]));
        var before=profile[Math.max(0,i-2)],after=profile[Math.min(profile.length-1,i+1)],dy=b[0]-a[0];
        return [1,2].map(function(c){
          var m0=(b[c]-before[c])/(b[0]-before[0]),m1=(after[c]-a[c])/(after[0]-a[0]);
          return (2*t*t*t-3*t*t+1)*a[c]+(t*t*t-2*t*t+t)*dy*m0+(-2*t*t*t+3*t*t)*b[c]+(t*t*t-t*t)*dy*m1;
        });
      }
    }
    return profile[profile.length - 1].slice(1);
  }

  function ellipseSeam(group, THREE, name, rx, rz, y, color, radius) {
    var points = [];
    for (var i = 0; i <= 64; i++) {
      var angle = i / 64 * Math.PI * 2;
      points.push([Math.cos(angle) * rx, y, Math.sin(angle) * rz]);
    }
    return addTube(group, THREE, name, points, radius || 0.007, color, 64);
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
    var black = material(THREE, 0x393638), red = material(THREE, 0x9b2435), trim = material(THREE, 0xe8c8ad);
    var crown = addMesh(g, THREE, '黑布帽冠', new THREE.SphereGeometry(0.72, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2), black, [0, 0.89, 0]);
    crown.scale.y = 0.86;
    addMesh(g, THREE, '帽侧连续黑布', new THREE.CylinderGeometry(0.72,0.72,0.43,64,12,true), black, [0,0.675,0]);
    addMesh(g, THREE, '帽檐软边', new THREE.CylinderGeometry(0.724, 0.715, 0.055, 64, 1, true), black, [0, 0.475, 0]);
    var brimPiping = addMesh(g, THREE, '帽檐红色包边', new THREE.TorusGeometry(0.725, 0.011, 10, 64), red, [0, 0.48, 0]);
    brimPiping.rotation.x = Math.PI / 2;
    var liningMat=material(THREE,0x302a30,null,1,THREE.BackSide);
    var lining = addMesh(g, THREE, '帽内衬', new THREE.SphereGeometry(0.695, 40, 28, 0, Math.PI * 2, 0, Math.PI / 2), liningMat, [0, 0.89, 0]);
    lining.scale.y = 0.86;
    addMesh(g,THREE,'帽侧内衬',new THREE.CylinderGeometry(0.697,0.697,0.43,48,8,true),liningMat,[0,0.675,0]);
    addTube(g, THREE, '帽后拼缝', [[0,1.50,0],[0,1.39,-0.48],[0,1.13,-0.69],[0,0.85,-0.727],[0,0.49,-0.727]], 0.003, 0x39303d, 40);

    function hatSurfaceZ(x, y) {
      var yy = Math.max(0,(y - 0.89) / 0.86);
      return Math.sqrt(Math.max(0.0003, 0.72*0.72 - x*x - yy*yy)) + 0.012;
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
          if(name === '219白地花绣冠饰'){
            var normalizedY=(y-0.89)/0.86,available=Math.sqrt(Math.max(0.01,0.72*0.72-normalizedY*normalizedY));
            x=Math.sin((u-0.5)*Math.PI*0.88)*available;
          }
          positions.push(x, y, hatSurfaceZ(x, y));
          var uvTop=name === '219白地花绣冠饰' ? 0.97-0.18*Math.pow(u*2-1,2) : 1;
          uvs.push(u, (1-v)*uvTop);
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
    var g = new THREE.Group(); g.name = '冬头帕235·垂悬软布';
    function clothPoint(u, v, back) {
      var x = (u - 0.5) * 1.58, y = 0.01 + v * 1.58;
      var sag = 0.07 * Math.cos((u - 0.5) * Math.PI) * (1 - v);
      var z = 0.08 * Math.sin(u * Math.PI) + 0.025 * Math.sin(u * Math.PI * 3.7 + v * 1.2)
        + 0.010 * Math.sin(u * 23 + v * 4) * (1 - v * 0.7);
      return [x, y - sag, z + (back ? -0.006 : 0.006), u, v];
    }
    addMesh(g, THREE, '235红布与中央密竖纹', clothGrid(THREE, 48, 48, function (u, v) {
      return clothPoint(u, v, false);
    }), material(THREE, 0xffffff, textures.dongtoupaFront, 1));
    addMesh(g, THREE, '冬头帕织物背面', clothGrid(THREE, 48, 48, function (u, v) {
      return clothPoint(u, v, true);
    }, true), material(THREE, 0xa68b82, textures.dongtoupaFront, 1));
    var edges = [[], [], [], []];
    for (var e = 0; e <= 32; e++) {
      var t = e / 32;
      edges[0].push(clothPoint(t, 0, false).slice(0, 3));
      edges[1].push(clothPoint(t, 1, false).slice(0, 3));
      edges[2].push(clothPoint(0, t, false).slice(0, 3));
      edges[3].push(clothPoint(1, t, false).slice(0, 3));
    }
    edges.forEach(function (points, i) { addTube(g, THREE, '软布锁边-' + i, points, 0.008, 0xc9ab91, 48); });
    g.userData.reconstruction = '连续双面布料曲面，垂悬褶皱为展示补全';
    return setEvidence(g, [235], 'photo-textured');
  }

  function buildDajinshan(THREE, textures) {
    var g = new THREE.Group(); g.name = '大襟衫230·立体衣身与宽袖';
    var inside = material(THREE, 0x556584, textures.dajinshanBody, 1, THREE.BackSide);
    var blueCloth = material(THREE, 0xffffff, textures.dajinshanBody, 1, THREE.DoubleSide);
    var profile = [[0.12,0.57,0.225],[0.40,0.56,0.245],[0.95,0.52,0.26],
      [1.45,0.565,0.25],[1.60,0.60,0.225],[1.71,0.49,0.195],[1.84,0.215,0.145]];
    function torsoPoint(angle, y, inner) {
      var size = profileAt(profile, y), height = (y - 0.12) / 1.72;
      var front=Math.sin(angle),fold=(0.008*Math.sin(angle*7.3+y*2.1)+0.005*Math.sin(angle*13.7-y*4))*(1-height*0.6);
      fold+=0.024*Math.exp(-Math.pow((height-0.67)/0.17,2))*Math.sin(angle*3.5+height*10)*Math.pow(Math.abs(front),3);
      var factor = inner ? 0.965 : 1;
      return [Math.cos(angle) * (size[0] + fold) * factor,
        y + 0.011 * Math.sin(angle * 5) * (1 - height),
        Math.sin(angle) * (size[1] + fold) * factor];
    }
    function torsoSurface(inner) {
      return clothGrid(THREE, 80, 56, function (u, v) {
        var angle = u * Math.PI * 2, y = 0.12 + v * 1.72, point = torsoPoint(angle, y, inner);
        // Both sides use the same photographed plain weave, rather than a solid back plate.
        point.push(0.5 + Math.cos(angle) * 0.5, v);
        return point;
      }, true);
    }
    addMesh(g, THREE, '立体衣身连续前后曲面', torsoSurface(false), blueCloth);
    addMesh(g, THREE, '领口与下摆可见布衫内层', torsoSurface(true), inside);
    [-1, 1].forEach(function (side) {
      var arm = new THREE.Group(); arm.name = side < 0 ? '左宽袖' : '右宽袖';
      arm.position.set(side * 0.77, 1.03, 0); arm.rotation.z = side * 0.34;
      g.add(arm);
      var sleeve = new THREE.CylinderGeometry(0.18, 0.265, 1.22, 40, 28, true);
      var sleeveUV=sleeve.attributes.uv;
      for(var uv=0;uv<sleeveUV.count;uv++)sleeveUV.setXY(uv,sleeveUV.getY(uv),1-sleeveUV.getX(uv));
      var sleevePoints = sleeve.attributes.position;
      for (var j = 0; j < sleevePoints.count; j++) {
        var sx = sleevePoints.getX(j), sy = sleevePoints.getY(j), sz = sleevePoints.getZ(j);
        var ripple = 1 + 0.028 * Math.cos(Math.atan2(sz, sx) * 5.3 + sy * 4.7);
        sleevePoints.setXYZ(j, sx * ripple, sy, sz * 0.82 * ripple);
      }
      sleeve.computeVertexNormals();
      addMesh(arm, THREE, '宽袖照片织纹', sleeve, blueCloth);
      var innerSleeve = addMesh(arm, THREE, '袖筒内衬', sleeve.clone(), inside);
      innerSleeve.scale.set(0.95,1,0.95);
      ellipseSeam(arm,THREE,'肩袖细接缝',0.179,0.147,0.59,0x435875,0.0025);
      var cuff = addMesh(arm, THREE, '袖口整圈织带', new THREE.CylinderGeometry(0.251,0.269,0.18,40,4,true),
        material(THREE, 0xffffff, textures.dajinshanCuff, 1, THREE.DoubleSide), [0,-0.52,0]);
      cuff.scale.z = 0.82;
      var mouth = ellipseSeam(arm, THREE, '袖口折边', 0.266, 0.218, -0.61, 0xa99986, 0.006);
      mouth.material.map = textures.dajinshanCuff;
    });
    function band(name, points, width) {
      var path = curve(THREE, points);
      var geometry = clothGrid(THREE, 64, 8, function (u, v) {
        var p = path.getPoint(u), tangent = path.getTangent(u), offset = (v - 0.5) * width;
        var y = p.y + tangent.x * offset, size = profileAt(profile, y);
        var x = Math.max(-size[0]*0.96, Math.min(size[0]*0.96, p.x - tangent.y * offset));
        var angle = Math.acos(x / size[0]), surface = torsoPoint(angle, y, false);
        return [x, y, surface[2] + 0.012, u, v];
      });
      addMesh(g, THREE, name, geometry, material(THREE, 0xffffff, textures.dajinshanSash, 1, THREE.DoubleSide));
    }
    band('随衣身弯曲的领口斜襟织带', [[-0.39,1.55,0],[0,1.67,0],[0.40,1.68,0]], 0.13);
    band('斜襟下接织边', [[-0.39,1.55,0],[-0.47,1.35,0],[-0.49,1.15,0]], 0.075);
    var collar = addMesh(g, THREE, '圆弧立领', new THREE.CylinderGeometry(0.20,0.23,0.19,28,1,true), blueCloth, [0,1.91,0]);
    collar.scale.z = 0.73;
    var collarInside = addMesh(g, THREE, '立领内侧', new THREE.CylinderGeometry(0.195,0.22,0.18,28,1,true), inside, [0,1.91,0]);
    collarInside.scale.z = 0.73; collarInside.material.side = THREE.DoubleSide;
    ellipseSeam(g, THREE, '立领滚边', 0.202, 0.147, 2.005, 0x728399, 0.006);
    var hem = [], backSeam = [];
    for (var k = 0; k <= 64; k++) hem.push(torsoPoint(k / 64 * Math.PI * 2, 0.12, false));
    for (var s = 0; s <= 28; s++) backSeam.push(torsoPoint(Math.PI * 1.5, 0.15 + s / 28 * 1.63, false));
    addTube(g, THREE, '衣摆整圈折缝', hem, 0.006, 0x7889a5, 64);
    addTube(g, THREE, '后身细接缝', backSeam, 0.003, 0x526c91, 40);
    g.userData.reconstruction = '依据正面轮廓补全胸背、肩部、袖筒和内层；背面形体为合理展示重建';
    return setEvidence(g, [230], 'photo-textured');
  }

  function buildZisundai(THREE, textures) {
    var g = new THREE.Group(); g.name = '子孙袋199·开口软布囊';
    var profile = [[0.08,0.46,0.025],[0.25,0.51,0.125],[0.65,0.55,0.17],[1.00,0.535,0.145],[1.28,0.51,0.09]];
    function bagPoint(u, v, rear, inner) {
      var y = 0.08 + v * 1.20, size = profileAt(profile, y), across = u * 2 - 1;
      var round = Math.pow(Math.max(0, 1 - across * across), 0.65);
      var fold = (0.009*Math.sin(across*17+v*4)+0.015*Math.sin(across*7-v*8))*round*Math.sin(Math.PI*v);
      var z = 0.018 + size[1] * round + fold;
      if (inner) z *= 0.92;
      var uvX = rear ? 0.025 + u * 0.08 : u;
      var uvY = rear ? 0.30 + v * 0.35 : v;
      return [across * size[0] * (inner ? 0.992 : 1), y + 0.009 * Math.sin(u * 15) * v,
        rear ? -z : z, uvX, uvY];
    }
    var frontMat = material(THREE, 0xffffff, textures.zisundaiFront, 1);
    var rearMat = material(THREE, 0xe0e4ed, textures.zisundaiFront, 1);
    [false, true].forEach(function (rear) {
      addMesh(g, THREE, rear ? '蓝布背囊曲面' : '199号实物拼布软囊正面',
        clothGrid(THREE, 48, 48, function (u, v) { return bagPoint(u, v, rear, false); }, rear), rear ? rearMat : frontMat);
      addMesh(g, THREE, rear ? '袋内后层' : '袋内前层',
        clothGrid(THREE, 48, 48, function (u, v) { return bagPoint(u, v, rear, true); }, rear),
        material(THREE, 0xb5a58d, null, 1, THREE.BackSide));
      var lip = [];
      for (var i = 0; i <= 40; i++) lip.push(bagPoint(i / 40, 1, rear, false).slice(0, 3));
      addTube(g, THREE, rear ? '袋口后折边' : '袋口前折边', lip, 0.009, 0xcabb9f, 48);
    });
    [-1, 1].forEach(function (side) {
      addMesh(g, THREE, '柔软侧围-' + side, clothGrid(THREE, 6, 40, function (u, v) {
        var front = bagPoint(side < 0 ? 0 : 1, v, false, false);
        return [front[0], front[1], front[2] * (1 - 2 * u), 0.025 + u * 0.08, 0.30 + v * 0.35];
      }), rearMat);
      var seam = [];
      for (var j = 0; j <= 32; j++) seam.push(bagPoint(side < 0 ? 0 : 1, j / 32, false, false).slice(0, 3));
      addTube(g, THREE, side < 0 ? '左侧包边' : '右侧包边', seam, 0.009, 0xd3c2a0, 40);
    });
    addMesh(g, THREE, '袋底闭合折缝', clothGrid(THREE, 48, 4, function (u, v) {
      var point = bagPoint(u, 0, false, false); point[2] *= 1 - 2 * v;
      return point;
    }), rearMat);
    var bottom = [];
    for (var b = 0; b <= 40; b++) bottom.push(bagPoint(b / 40, 0, false, false).slice(0, 3));
    addTube(g, THREE, '袋底缝线', bottom, 0.008, 0xd3c2a0, 48);
    g.userData.reconstruction = '保留实物绣面，补全蓝布背囊、开口、侧围、内层和软褶；不增设提手';
    return setEvidence(g, [199], 'photo-textured');
  }

  function buildBowei(THREE, textures) {
    var g = new THREE.Group(); g.name = '脖围193·圆四分绣片';
    var outer = 0.78, inner = 0.164;
    function surface(angle, radial, underside) {
      var r = inner + (outer-inner)*radial;
      var height = 0.07 + 0.15*Math.pow(1-radial, 1.4) + 0.038*Math.sin(angle*4)*radial
        + 0.009*Math.sin(angle*12+radial*9)*Math.sin(radial*Math.PI);
      return [Math.cos(angle)*r, height-(underside ? 0.015 : 0), Math.sin(angle)*r,
        0.48+Math.cos(angle)*r/outer*0.47, 0.584+Math.sin(angle)*r/outer*0.47];
    }
    for (var i = 0; i < 4; i++) {
      var start = -Math.PI/2 + i*Math.PI/2;
      addMesh(g, THREE, '四分之一照片布片-' + (i+1), clothGrid(THREE, 24, 16, function(u,v){
        return surface(start+u*Math.PI/2,v,false);
      }), material(THREE, 0xffffff, textures.boweiTop, 1, THREE.DoubleSide));
    }
    addMesh(g,THREE,'脖围曲面底衬',clothGrid(THREE,96,20,function(u,v){return surface(u*Math.PI*2,v,true);},true),material(THREE,0x26374d,null,1,THREE.DoubleSide));
    [0,1].forEach(function(radial){
      var points=[];
      for(var j=0;j<=96;j++)points.push(surface(j/96*Math.PI*2,radial,false).slice(0,3));
      addTube(g,THREE,radial?'外圈缝线':'中心孔包边',points,radial?0.009:0.012,radial?0xc0ae94:0x11182a,96);
      addMesh(g,THREE,radial?'脖围薄布外沿':'孔口包边内壁',clothGrid(THREE,96,2,function(u,v){
        var p=surface(u*Math.PI*2,radial,false);p[1]-=v*0.015;return p;
      }),material(THREE,0x26374d,null,1,THREE.DoubleSide));
    });
    g.userData.reconstruction='四片绣面保留中心孔，补全轻微垂褶和薄布底衬';
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
