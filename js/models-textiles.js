/* Photo-grounded textile display models. Three.js r128, x/z centered, y up. */
(function (root) {
  'use strict';

  var texturePaths = {
    huamaoFace: 'assets/model-textures/cloth-huamao-223-front.png',
    huamaoTop: 'assets/model-textures/cloth-huamao-223-brim.jpg',
    huamaoSide: 'assets/model-textures/cloth-huamao-223-side.jpg',
    huamaoSideLeft: 'assets/model-textures/cloth-huamao-223-side-left.jpg',
    huamaoDrape: 'assets/model-textures/cloth-huamao-223-red.jpg',
    huamaoMetal: 'assets/model-textures/metal-huamao-223-figures.jpg',
    huamaoRosette: 'assets/model-textures/metal-huamao-223-rosette.jpg',
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
    var g = new THREE.Group(); g.name = '花帽223·红金绣檐与人物饰件';
    var black = material(THREE, 0x332d28), red = material(THREE, 0x82201d);
    var liningMat = material(THREE, 0x30201d, null, 1, THREE.BackSide);
    var crown = addMesh(g, THREE, '黑布帽冠', new THREE.SphereGeometry(0.70, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2), black, [0, 1.32, 0]);
    crown.scale.set(1, 0.20, 0.74);
    var body = addMesh(g, THREE, '连续黑布帽体', new THREE.CylinderGeometry(0.70, 0.69, 0.92, 80, 24, true), black, [0, 0.86, 0]);
    body.scale.z = 0.74;
    var lining = addMesh(g, THREE, '帽内衬', new THREE.SphereGeometry(0.679, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), liningMat, [0, 1.32, 0]);
    lining.scale.set(1, 0.195, 0.74);
    var inner = addMesh(g, THREE, '帽侧内衬', new THREE.CylinderGeometry(0.68, 0.671, 0.92, 64, 16, true), liningMat, [0, 0.86, 0]);
    inner.scale.z = 0.74;
    ellipseSeam(g, THREE, '帽口红色包边', 0.69, 0.511, 0.40, 0x98362d, 0.006);
    addTube(g, THREE, '帽后拼缝', [[0,1.46,0],[0,1.41,-0.32],[0,1.32,-0.52],[0,0.40,-0.51]], 0.003, 0x41302a, 40);

    function frontZ(x) { return 0.518 * Math.sqrt(Math.max(0.015, 1 - x*x/(0.70*0.70))); }
    var frontMat = material(THREE, 0xffffff, textures.huamaoFace, 1, THREE.DoubleSide);
    frontMat.transparent = true; frontMat.alphaTest = 0.4;
    addMesh(g, THREE, '223原图前额刺绣', clothGrid(THREE, 96, 64, function (u,v) {
      var x = (u-0.5)*1.36;
      return [x, 0.40+v*0.88, frontZ(x)+0.009, u, v];
    }), frontMat);

    function brimPoint(u,v) {
      var a = (u-0.5)*2.85, edge = Math.abs(u*2-1);
      return [0.85*Math.sin(a)*(1+0.035*(1-v)),
        1.50-0.30*Math.pow(edge,1.65)-0.115*v+0.08*Math.pow(edge,9)*v,
        0.53*Math.cos(a)+0.055+0.15*(1-v)+0.012*Math.sin(u*19)*v];
    }
    var brimMat = material(THREE, 0xffffff, textures.huamaoTop, 1, THREE.DoubleSide);
    addMesh(g, THREE, '223向外翻起的红金绣檐', clothGrid(THREE, 96, 20, function(u,v) {
      var p = brimPoint(u,1-v); return [p[0],p[1],p[2],u,v];
    }), brimMat);
    addMesh(g, THREE, '绣檐红布底衬', clothGrid(THREE, 96, 20, function(u,v) {
      var p = brimPoint(u,1-v); return [p[0],p[1]+0.012,p[2]-0.008];
    }), material(THREE,0x681e1c,null,1,THREE.DoubleSide));
    [0,1].forEach(function(v) {
      var points=[]; for(var i=0;i<=96;i++)points.push(brimPoint(i/96,v));
      addTube(g,THREE,'绣檐红线锁边'+v,points,v?0.006:0.009,0xb3422c,96);
    });

    var brass = new THREE.MeshStandardMaterial({color:0xa88b52,roughness:0.50,metalness:0.65,envMapIntensity:1.1});
    var photoBrass = new THREE.MeshStandardMaterial({color:0xffffff,map:textures.huamaoMetal,roughness:0.53,metalness:0.45,envMapIntensity:0.6});
    function castRelief() {
      var data = root.Huamao223Relief, w = data.width, h = data.height;
      var field = atob(data.heights), vertices=[], uvs=[], faces=[], backs=[], edges=[], border=new Map();
      for(var y=0;y<h;y++)for(var x=0;x<w;x++) {
        var u=x/(w-1),v=y/(h-1), px=-0.68+u*1.36*530/560;
        var py=0.40+(615-(370+v*218))*0.88/370, z=frontZ(px)+0.021;
        var rise=field.charCodeAt(y*w+x)/255*0.075;
        vertices.push(px,py,z+rise, px,py,z-0.004);
        uvs.push(u,1-v,u,1-v);
      }
      function edge(a,b) {
        var key=Math.min(a,b)+','+Math.max(a,b);
        if(border.has(key))border.delete(key);else border.set(key,[a,b]);
      }
      function triangle(a,b,c) {
        faces.push(a*2,b*2,c*2); backs.push(a*2+1,c*2+1,b*2+1);
        edge(a,b);edge(b,c);edge(c,a);
      }
      for(var r=0;r<h-1;r++)for(var c=0;c<w-1;c++) {
        var a=r*w+c,b=a+1,d=a+w,e=d+1;
        if(field.charCodeAt(a)&&field.charCodeAt(b)&&field.charCodeAt(d))triangle(a,d,b);
        if(field.charCodeAt(b)&&field.charCodeAt(d)&&field.charCodeAt(e))triangle(b,d,e);
      }
      border.forEach(function(pair) {
        var a=pair[0]*2,b=pair[1]*2; edges.push(a,b,a+1,b,b+1,a+1);
      });
      var geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
      geo.setIndex(faces.concat(backs,edges));
      geo.addGroup(0,faces.length,0);geo.addGroup(faces.length,backs.length+edges.length,1);
      geo.computeVertexNormals();
      return geo;
    }
    addMesh(g,THREE,'223七尊人物金属浮雕',castRelief(),[photoBrass,brass]);

    var rosetteMat = new THREE.MeshStandardMaterial({color:0xffffff,map:textures.huamaoRosette,roughness:0.52,metalness:0.48,envMapIntensity:0.55});
    function rosette(x,y,z,size,angle) {
      var flower=new THREE.Group();flower.position.set(x,y,z);flower.rotation.y=angle||0;g.add(flower);
      var shape=new THREE.Shape(),n=64;
      for(var i=0;i<=n;i++) {
        var a=i/n*Math.PI*2,r=size*(0.88+0.12*Math.cos(a*6)),px=Math.cos(a)*r,py=Math.sin(a)*r;
        if(i)shape.lineTo(px,py);else shape.moveTo(px,py);
      }
      addMesh(flower,THREE,'花形金属饰片厚边',new THREE.ExtrudeGeometry(shape,{depth:0.012,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:0.002,bevelThickness:0.002}),brass);
      var face=clothGrid(THREE,20,20,function(u,v) {
        var a=u*Math.PI*2,r=v*size*(0.88+0.12*Math.cos(a*6));
        return [Math.cos(a)*r,Math.sin(a)*r,0.017+0.006*(1-v*v),0.5+Math.cos(a)*v*0.5,0.5+Math.sin(a)*v*0.5];
      },true);
      addMesh(flower,THREE,'原图花形饰片正面',face,rosetteMat);
    }
    for(var f=0;f<10;f++) {
      var x=-0.55+f*0.119;
      rosette(x,0.415+0.035*Math.pow(x/0.60,2),frontZ(x)+0.04,0.047+(f===5?0.005:0),Math.asin(x/0.70)*0.7);
    }

    function sidePoint(sign,u,v) {
      var a=sign*(1.12+u*0.43), radius=0.70+0.035*v;
      return [Math.sin(a)*radius,0.83-v*0.76+0.06*Math.sin(u*Math.PI)*v,
        Math.cos(a)*0.518+0.025*Math.sin(v*8+u*3)*v];
    }
    [-1,1].forEach(function(sign) {
      addMesh(g,THREE,'223侧垂绣片'+sign,clothGrid(THREE,20,44,function(u,v) {
        var p=sidePoint(sign,u,1-v);return [p[0],p[1],p[2],sign===1?u:1-u,v];
      }),material(THREE,0xffffff,sign<0?textures.huamaoSideLeft:textures.huamaoSide,1,THREE.DoubleSide));
      for(var j=0;j<3;j++) {
        var p=sidePoint(sign,0.18,0.65+j*0.15);
        rosette(p[0]+sign*0.016,p[1],p[2]+0.016,0.029,sign*1.14);
      }
    });

    function drapePoint(u,v) {
      var a=(0.5+u)*Math.PI,fold=(0.027*Math.sin(u*27)+0.015*Math.sin(u*47+v))*Math.pow(v,0.65);
      var radius=0.69+0.08*v+fold;
      return [Math.sin(a)*radius,0.415-1.12*v+0.105*Math.pow(Math.abs(u*2-1),4)*v,
        Math.cos(a)*(0.51+0.02*v+fold)-0.025*v,Math.abs(u*2-1),1-v];
    }
    // The drape wraps behind the open head passage. Its two front side edges are
    // visible, but there is no board or fabric plane stretched across the opening.
    var drapeMat=material(THREE,0xffffff,textures.huamaoDrape,1,THREE.DoubleSide);
    addMesh(g,THREE,'223深红褶皱后披',clothGrid(THREE,112,64,drapePoint),drapeMat);
    var hem=[];for(var k=0;k<=112;k++)hem.push(drapePoint(k/112,1));
    addTube(g,THREE,'后披软布下摆',hem,0.005,0x702523,112);
    [0,1].forEach(function(u) {
      var edge=[];for(var k=0;k<=40;k++)edge.push(drapePoint(u,k/40));
      addTube(g,THREE,'后披侧缝'+u,edge,0.004,0x84221f,40);
    });

    var linkGeo=new THREE.TorusGeometry(0.010,0.0023,5,10);
    var links=new THREE.InstancedMesh(linkGeo,brass,72),dummy=new THREE.Object3D();links.name='两侧金属垂链';
    for(var side=0;side<2;side++)for(var link=0;link<36;link++) {
      var t=link/35,sign=side?1:-1;
      dummy.position.set(sign*(0.724+0.012*Math.sin(t*6)),1.18-0.80*t,0.24+0.016*Math.sin(t*4));
      dummy.rotation.set(0,link%2?Math.PI/2:0,sign*0.07);dummy.updateMatrix();links.setMatrixAt(side*36+link,dummy.matrix);
    }
    links.castShadow=true;g.add(links);
    [-1,1].forEach(function(sign) {
      var bell=addMesh(g,THREE,'侧链垂铃'+sign,new THREE.SphereGeometry(0.031,16,12),brass,[sign*0.73,0.33,0.24]);
      bell.scale.y=1.25;
      var p=drapePoint(sign<0?1:0,0.99);
      var charm=addMesh(g,THREE,'后披角金属坠饰'+sign,new THREE.BoxGeometry(0.052,0.071,0.025),brass,[p[0],p[1]-0.022,p[2]]);
      charm.rotation.z=sign*0.13;
      addMesh(g,THREE,'坠饰凸纹'+sign,new THREE.TorusGeometry(0.015,0.0025,6,12),brass,[p[0],p[1]-0.022,p[2]+0.016]);
    });
    return setEvidence(g,[223],'photo-textured');
  }

  function buildZhidai(THREE, textures) {
    var g = new THREE.Group(); g.name = '织带255·独立长带与穗';
    // 传统木制绠瓠子展示挂轴（直径约2.8cm，两端穿小木棒）
    var woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5732, roughness: 0.82, metalness: 0.02 });
    woodMat.userData.surface = 'wood';
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.36, 16), woodMat);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 1.18, 0.035);
    rod.name = '绠瓠子展示木轴';
    rod.castShadow = true;
    g.add(rod);
    [-0.175, 0.175].forEach(function (x) {
      var peg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.048, 8), woodMat);
      peg.position.set(x, 1.18, 0.035);
      peg.name = '挂棒两端木栓';
      g.add(peg);
    });
    // 红色挂绳
    addTube(g, THREE, '挂架红丝提线', [[-0.12, 1.18, 0.035], [0, 1.28, 0.02], [0.12, 1.18, 0.035]], 0.0038, 0xbb2535, 16);

    // 主织带：微偏左呈现，优美垂荡波浪
    createStrip(THREE, '单条蓝底织带255', textures.zhidaiBand, {
      group: g, x: -0.065, yTop: 1.15, z: 0.01, width: 0.11, length: 1.95, wave: 0.055, steps: 64, phase: 0.25
    });
    // 配对次织带：微偏右呈现，展现“成双成对、带带相传”的客家婚俗与头饰织带形态
    createStrip(THREE, '配对挑花织带255_右', textures.zhidaiBand, {
      group: g, x: 0.065, yTop: 1.15, z: -0.01, width: 0.11, length: 1.92, wave: 0.048, steps: 64, phase: 0.75
    });

    // 织带顶部卷边与固定结
    addTube(g, THREE, '织带上端卷边', [[-0.12, 1.15, 0.04], [0, 1.17, 0.04], [0.12, 1.15, 0.04]], 0.012, 0x263f72, 16);
    addTube(g, THREE, '左带顶端彩绳结', [[-0.09, 1.14, 0.045], [-0.04, 1.14, 0.045]], 0.008, 0x9c4765, 8);
    addTube(g, THREE, '右带顶端彩绳结', [[0.04, 1.14, 0.045], [0.09, 1.14, 0.045]], 0.008, 0x2d6850, 8);

    // 左右两条带子的底部穗根结（多色彩结与包线环）
    addTube(g, THREE, '穗根结', [[-0.11, -0.79, 0.01], [-0.065, -0.82, 0.01], [-0.02, -0.79, 0.01]], 0.016, 0x9c4765, 12);
    addTube(g, THREE, '右穗根结', [[0.02, -0.76, 0.00], [0.065, -0.79, 0.00], [0.11, -0.76, 0.00]], 0.016, 0x2e4a82, 12);

    // 彩珠饰
    var beadMat = new THREE.MeshStandardMaterial({ color: 0x8b2500, roughness: 0.35, metalness: 0.1 });
    beadMat.userData.surface = 'mineral';
    [-0.065, 0.065].forEach(function (bx, bi) {
      var bead = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), beadMat);
      bead.position.set(bx, bi === 0 ? -0.83 : -0.80, bi === 0 ? 0.012 : 0.002);
      bead.name = '流苏彩珠饰_' + bi;
      g.add(bead);
    });

    // 丰满多色的下垂真丝带穗
    var colors = [0x394e82, 0xb34f74, 0xd1c4b1, 0x2d6850, 0x9b4361, 0xc28535];
    for (var i = 0; i < 11; i++) {
      var x = -0.105 + i * 0.008;
      addTube(g, THREE, '穗线-' + (i + 1), [
        [x, -0.80, 0.005],
        [x + 0.008, -0.90, 0.025],
        [x - 0.010, -1.00, 0.045],
        [x + (i % 2 ? 0.012 : -0.014), -1.10, 0.035]
      ], 0.0042, colors[i % colors.length], 10);
    }
    for (var j = 0; j < 11; j++) {
      var rx = 0.025 + j * 0.008;
      addTube(g, THREE, '右带穗线-' + (j + 1), [
        [rx, -0.77, 0.00],
        [rx - 0.006, -0.87, 0.018],
        [rx + 0.008, -0.97, 0.038],
        [rx + (j % 2 ? -0.010 : 0.012), -1.07, 0.028]
      ], 0.0042, colors[(j + 2) % colors.length], 10);
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
      [1.45,0.555,0.25],[1.60,0.55,0.225],[1.71,0.445,0.195],[1.84,0.215,0.145]];
    function torsoPoint(angle, y, inner) {
      var size = profileAt(profile, y), height = (y - 0.12) / 1.72;
      var front=Math.sin(angle),fold=(0.008*Math.sin(angle*7+y*2.1)+0.005*Math.sin(angle*14-y*4))*(1-height*0.6);
      fold+=0.024*Math.exp(-Math.pow((height-0.67)/0.17,2))*Math.sin(angle*4+height*10)*Math.pow(Math.abs(front),3);
      var factor = inner ? 0.965 : 1;
      return [Math.cos(angle) * (size[0] + fold) * factor,
        y + 0.011 * Math.sin(angle * 5) * (1 - height),
        Math.sin(angle) * (size[1] + fold) * factor];
    }
    var openingY = 1.38, openingHeight = 0.30, openingAngle = 0.84;
    var halfRing = 32, ringSegments = halfRing * 2, sleeveRows = 32;
    var cuffAngle = 0.28, cuffX = 0.87, cuffY = 0.46;
    var vertices = [], garmentUVs = [], garmentIndices = [], sharedVertices = new Map();
    function vertex(point) {
      var key = point.map(function (c) { return Math.round(c * 1000000); }).join(',');
      if (sharedVertices.has(key)) return sharedVertices.get(key);
      var index = vertices.length / 3;
      vertices.push(point[0], point[1], point[2]);
      garmentUVs.push(0.5 + point[0] / 2.30, (point[1] - 0.12) / 1.72);
      sharedVertices.set(key, index);
      return index;
    }
    function quad(a, b, c, d, reverse) {
      if (reverse) garmentIndices.push(a, c, b, b, c, d);
      else garmentIndices.push(a, b, c, b, d, c);
    }
    var bodyRows = [];
    for (var lower = 0; lower < 26; lower++) {
      bodyRows.push({y: 0.12 + lower / 26 * (openingY - openingHeight - 0.12), angle: 0});
    }
    // The panel edges and sleeve roots sample the same armhole ring.
    for (var hole = halfRing; hole >= 0; hole--) {
      var phi = hole / halfRing * Math.PI;
      bodyRows.push({y: openingY + openingHeight * Math.cos(phi), angle: openingAngle * Math.sin(phi)});
    }
    for (var upper = 1; upper <= 10; upper++) {
      bodyRows.push({y: openingY + openingHeight + upper / 10 * (1.84 - openingY - openingHeight), angle: 0});
    }
    [false, true].forEach(function (back) {
      var grid = [], columns = 48;
      bodyRows.forEach(function (row, r) {
        grid[r] = [];
        for (var c = 0; c <= columns; c++) {
          var angle = (back ? Math.PI : 0) + row.angle + c / columns * (Math.PI - row.angle * 2);
          grid[r].push(vertex(torsoPoint(angle, row.y, false)));
          if (r && c) quad(grid[r-1][c-1], grid[r-1][c], grid[r][c-1], grid[r][c], true);
        }
      });
    });
    [-1, 1].forEach(function (side) {
      var sleeveGrid = [];
      for (var row = 0; row <= sleeveRows; row++) {
        var t = row / sleeveRows, t2 = t * t, t3 = t2 * t;
        sleeveGrid[row] = [];
        for (var segment = 0; segment < ringSegments; segment++) {
          var phi = segment / ringSegments * Math.PI * 2;
          var angle = (side < 0 ? Math.PI : 0) + side * openingAngle * Math.sin(phi);
          var y = openingY + openingHeight * Math.cos(phi);
          var root = new THREE.Vector3().fromArray(torsoPoint(angle, y, false));
          var alongY = new THREE.Vector3().fromArray(torsoPoint(angle, y + 0.001, false))
            .sub(new THREE.Vector3().fromArray(torsoPoint(angle, y - 0.001, false))).multiplyScalar(500);
          var alongAngle = new THREE.Vector3().fromArray(torsoPoint(angle + 0.001, y, false))
            .sub(new THREE.Vector3().fromArray(torsoPoint(angle - 0.001, y, false))).multiplyScalar(500);
          var rootTangent = alongY.multiplyScalar(-Math.cos(phi) / openingHeight)
            .add(alongAngle.multiplyScalar(-side * Math.sin(phi) / openingAngle)).normalize().multiplyScalar(0.42);
          var cuff = new THREE.Vector3(side * (cuffX + Math.cos(cuffAngle) * 0.265 * Math.cos(phi)),
            cuffY + Math.sin(cuffAngle) * 0.265 * Math.cos(phi), 0.265 * 0.82 * Math.sin(phi));
          var endTangent = new THREE.Vector3(side * Math.sin(cuffAngle), -Math.cos(cuffAngle), 0)
            .multiplyScalar(root.distanceTo(cuff));
          var point = root.multiplyScalar(2*t3-3*t2+1).add(rootTangent.multiplyScalar(t3-2*t2+t))
            .add(cuff.multiplyScalar(-2*t3+3*t2)).add(endTangent.multiplyScalar(t3-t2));
          var fold = 0.006 * Math.sin(phi * 5 + t * 4) * Math.pow(Math.sin(Math.PI * t), 2);
          point.x += side * Math.cos(phi) * fold;
          point.z += Math.sin(phi) * fold;
          sleeveGrid[row].push(vertex(point.toArray()));
        }
        if (row) for (var edge = 0; edge < ringSegments; edge++) {
          var next = (edge + 1) % ringSegments;
          quad(sleeveGrid[row-1][edge], sleeveGrid[row-1][next], sleeveGrid[row][edge], sleeveGrid[row][next], side < 0);
        }
      }
      var arm = new THREE.Group(); arm.name = side < 0 ? '左宽袖' : '右宽袖';
      arm.position.set(side * cuffX, cuffY, 0); arm.rotation.z = side * cuffAngle;
      g.add(arm);
      var cuff = addMesh(arm, THREE, '袖口整圈织带', new THREE.CylinderGeometry(0.265,0.272,0.18,64,4,true),
        material(THREE, 0xffffff, textures.dajinshanCuff, 1, THREE.DoubleSide), [0,0.09,0]);
      cuff.scale.z = 0.82;
      var cuffEnd = new THREE.CircleGeometry(0.270, 64);
      var cuffEndPoints = cuffEnd.attributes.position;
      cuffEndPoints.setZ(0, 0.015);
      cuffEnd.computeVertexNormals();
      var closedCuff = addMesh(arm, THREE, '袖口闭合蓝布', cuffEnd,
        material(THREE, 0xd5dbe5, textures.dajinshanBody, 1, THREE.DoubleSide), [0,0.002,0]);
      closedCuff.rotation.x = Math.PI / 2;
      closedCuff.scale.y = 0.82;
      var mouth = ellipseSeam(arm, THREE, '袖口折边', 0.272, 0.223, 0, 0xa99986, 0.006);
      mouth.material.map = textures.dajinshanCuff;
    });
    var garment = new THREE.BufferGeometry();
    garment.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    garment.setAttribute('uv', new THREE.Float32BufferAttribute(garmentUVs, 2));
    garment.setIndex(garmentIndices); garment.computeVertexNormals();
    addMesh(g, THREE, '衣身与宽袖连续布面', garment, blueCloth);
    var lining = addMesh(g, THREE, '领口与下摆可见布衫内层', garment.clone(), inside);
    lining.scale.set(0.985, 1, 0.96);
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
