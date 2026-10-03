(function (root) {
  'use strict';

  function mat(THREE, color, roughness, surface) {
    var result=new THREE.MeshStandardMaterial({ color: color, roughness: roughness == null ? 0.78 : roughness });
    result.userData.surface=surface || 'fabric';return result;
  }

  function timberBox(THREE,width,height,depth){
    var r=Math.min(0.008,Math.min(width,height,depth)*0.06),shape=new THREE.Shape();
    var x=width/2-r,y=height/2-r;
    shape.moveTo(-x,-y);shape.lineTo(x,-y);shape.lineTo(x,y);shape.lineTo(-x,y);shape.closePath();
    var geometry=new THREE.ExtrudeGeometry(shape,{depth:depth-2*r,bevelEnabled:true,bevelSize:r,bevelThickness:r,bevelSegments:2,steps:1});
    geometry.translate(0,0,-depth/2+r);return geometry;
  }

  function mesh(THREE, geometry, material, parent, name) {
    var item = new THREE.Mesh(geometry, material);
    item.name = name || 'Craft detail';
    if (parent) parent.add(item);
    return item;
  }

  function box(THREE, parent, name, material, size, position) {
    var geometry=material.userData.surface==='wood'?timberBox(THREE,size[0],size[1],size[2]):new THREE.BoxGeometry(size[0],size[1],size[2]);
    var item = mesh(THREE, geometry, material, parent, name);
    item.position.set(position[0], position[1], position[2]);
    return item;
  }

  function between(THREE, parent, name, material, a, b, radius, radialSegments) {
    var start = new THREE.Vector3(a[0], a[1], a[2]);
    var end = new THREE.Vector3(b[0], b[1], b[2]);
    var delta = end.clone().sub(start);
    var item = mesh(THREE, new THREE.CylinderGeometry(radius, radius, delta.length(), radialSegments || 7), material, parent, name);
    item.position.copy(start.add(end).multiplyScalar(0.5));
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return item;
  }

  function tapered(THREE, parent, name, material, a, b, radiusA, radiusB, radialSegments) {
    var start = new THREE.Vector3(a[0], a[1], a[2]);
    var end = new THREE.Vector3(b[0], b[1], b[2]);
    var delta = end.clone().sub(start);
    var item = mesh(THREE, new THREE.CylinderGeometry(radiusB, radiusA, delta.length(), radialSegments || 8), material, parent, name);
    item.position.copy(start.add(end).multiplyScalar(0.5));
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return item;
  }

  function squareBeam(THREE, parent, name, material, a, b, width, depth) {
    var start = new THREE.Vector3(a[0], a[1], a[2]);
    var end = new THREE.Vector3(b[0], b[1], b[2]);
    var delta=end.clone().sub(start),geometry=timberBox(THREE,width,delta.length(),depth||width);
    var beam=mesh(THREE,geometry,material,parent,name);
    beam.position.copy(start.clone().add(end).multiplyScalar(0.5));
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    return beam;
  }

  function taperedSquareBeam(THREE, parent, name, material, a, b, widthA, widthB) {
    var beam=squareBeam(THREE,parent,name,material,a,b,widthA,widthA),p=beam.geometry.attributes.position;
    var length=new THREE.Vector3().fromArray(b).distanceTo(new THREE.Vector3().fromArray(a));
    for(var i=0;i<p.count;i++){
      var ratio=1+(widthB/widthA-1)*Math.max(0,Math.min(1,p.getY(i)/length+0.5));
      p.setXYZ(i,p.getX(i)*ratio,p.getY(i),p.getZ(i)*ratio);
    }
    beam.geometry.computeVertexNormals();return beam;
  }

  function curvedTube(THREE, parent, name, material, points, radius, radialSegments, taper) {
    var curve = new THREE.CatmullRomCurve3(points.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
    var longitudinal = Math.max(18, (points.length - 1) * 12);
    var geo = new THREE.TubeGeometry(curve, longitudinal, radius, radialSegments || 7, false);
    var positions = geo.getAttribute('position');
    for (var row = 0; row <= longitudinal; row++) {
      var center = curve.getPointAt(row / longitudinal);
      var factor = 1 - (taper || 0.25) * row / longitudinal;
      for (var col = 0; col <= (radialSegments || 7); col++) {
        var index = row * ((radialSegments || 7) + 1) + col;
        var p = new THREE.Vector3().fromBufferAttribute(positions, index);
        var surface = radius > 0.08 ? 1 + 0.035 * Math.sin(row * 1.9 + col * 2.3) : 1;
        p.sub(center).multiplyScalar(factor * surface).add(center);
        positions.setXYZ(index, p.x, p.y, p.z);
      }
    }
    positions.needsUpdate = true; geo.computeVertexNormals();
    return mesh(THREE, geo, material, parent, name);
  }

  function loomCloth(THREE) {
    var path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 2.27, -0.35), new THREE.Vector3(0, 2.19, -0.17),
      new THREE.Vector3(0, 1.91, 0.01), new THREE.Vector3(0, 1.56, 0.30),
      new THREE.Vector3(0, 1.23, 0.51), new THREE.Vector3(0, 0.78, 0.56),
      new THREE.Vector3(0, 0.69, 0.83)
    ]);
    var positions = [], uvs = [], indices = [], rows = 64, columns = 32;
    for (var row = 0; row <= rows; row++) {
      var t = row / rows, p = path.getPoint(t);
      for (var col = 0; col <= columns; col++) {
        var u = col / columns;
        positions.push((u - 0.5) * 1.90, p.y + Math.sin(u * Math.PI) * 0.012,
          p.z + Math.sin(u * 17 + t * 3) * 0.012 * Math.sin(t * Math.PI));
        uvs.push(u, 1 - t);
        if (row < rows && col < columns) {
          var a = row * (columns + 1) + col, b = a + columns + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices); geo.computeVertexNormals();
    return geo;
  }

  function loom(THREE, textures) {
    var g = new THREE.Group();
    g.name = '木织机 · 参考照片结构';
    var wood = mat(THREE, 0xb29b79,0.8,'wood'), pale = mat(THREE, 0xc7b28b,0.82,'wood'), dark = mat(THREE, 0x826e50,0.9,'wood'), cord = mat(THREE, 0xd8c7a0);
    var yarn = mat(THREE, 0xe4dfd4);
    var W = 2.45, D = 1.72, topY = 2.72;
    // Four square legs and the low rectangular stretcher frame.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p, i) {
      box(THREE, g, 'square timber leg ' + (i + 1), wood, [0.19, 0.72, 0.2], [p[0] * W / 2.25, 0.40, p[1] < 0 ? -D / 2.25 : 1.30]);
    });
    [0.26, 0.48].forEach(function (y, row) {
      box(THREE, g, 'lower side stretcher ' + row, pale, [W, 0.13, 0.14], [0, y, -D / 2 + 0.14]);
      box(THREE, g, 'right extended base rail ' + row, wood, [0.14, 0.13, 2.26], [W / 2 - 0.13, y, 0.35]);
      box(THREE, g, 'left extended base rail ' + row, wood, [0.14, 0.13, 2.26], [-W / 2 + 0.13, y, 0.35]);
    });
    // Tall end frames: paired uprights, splayed braces and projecting top side beams.
    [-1, 1].forEach(function (xSide) {
      var x = xSide * 0.91;
      taperedSquareBeam(THREE, g, 'square loom upright', wood, [x, 0.54, -0.48], [x * 0.96, topY, -0.31], 0.22, 0.19);
      taperedSquareBeam(THREE, g, 'square splayed loom upright', pale, [x, 0.54, 0.52], [x * 0.96, topY, 0.2], 0.23, 0.19);
      squareBeam(THREE, g, 'square triangular frame brace', dark, [x, 0.63, 0.52], [x * 0.96, 1.8, 0.16], 0.13);
      squareBeam(THREE, g, 'square triangular frame brace', pale, [x, 1.8, 0.16], [x * 0.96, topY, 0.2], 0.13);
      squareBeam(THREE, g, 'projecting square top side rail', wood, [x * 1.38, 2.48, 0.44], [x * 1.38, 2.48, -0.75], 0.15, 0.13);
    });
    // Cross members and rollers span the loom width.
    [
      ['upper cross beam', 2.48, -0.16, 0.13], ['rear warp beam', 2.22, -0.35, 0.105],
      ['heddle crossbar', 1.62, -0.11, 0.075], ['breast beam', 1.47, 0.48, 0.09],
      ['cloth roller', 1.25, 0.53, 0.09], ['lower beam', 0.91, 0.24, 0.11]
    ].forEach(function (r) { squareBeam(THREE, g, r[0], pale, [-1.22, r[1], r[2]], [1.22, r[1], r[2]], r[3] * 1.8, r[3] * 1.5); });
    // Hanging wooden beater/reed frame and its fine vertical reed lines.
    box(THREE, g, 'reed frame top rail', wood, [2.12, 0.10, 0.13], [0, 1.62, 0.64]);
    box(THREE, g, 'reed frame lower rail', pale, [2.12, 0.08, 0.13], [0, 1.30, 0.64]);
    [-1, 1].forEach(function (s) {
      box(THREE, g, 'reed frame side upright', wood, [0.11, 0.40, 0.14], [s * 1.01, 1.46, 0.64]);
    });
    var reed = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.005, 0.005, 0.27, 4), yarn, 110);
    reed.name = 'fine white heddle panel';
    var threadMatrix = new THREE.Matrix4();
    for (var r = 0; r < 110; r++) {
      threadMatrix.makeTranslation(-0.96 + r * 1.92 / 109, 1.46, 0.66);
      reed.setMatrixAt(r, threadMatrix);
    }
    g.add(reed);
    var clothMat = new THREE.MeshStandardMaterial({color: 0xffffff, map: textures.loomCloth, roughness: 0.94, side: THREE.DoubleSide});
    clothMat.userData.surface='fabric';
    mesh(THREE, loomCloth(THREE), clothMat, g, 'continuous photographed blue white cloth');
    // The seat is a full-width plank carried by the long base frame.
    box(THREE, g, 'loom seat plank', pale, [1.97, 0.12, 0.52], [0, 0.70, 1.25]);
    [-1.08, 1.08].forEach(function (x) {
      box(THREE, g, 'projecting bench bearer', wood, [0.18, 0.15, 1.05], [x, 0.68, 0.99]);
    });
    box(THREE, g, 'wooden foot treadle', wood, [1.38, 0.09, 0.18], [0.03, 0.31, 0.1]);
    between(THREE, g, 'treadle suspension cord', cord, [-0.62, 0.39, 0.1], [-0.75, 1.26, 0.2], 0.018, 5);
    between(THREE, g, 'treadle suspension cord', cord, [0.68, 0.39, 0.1], [0.75, 1.26, 0.2], 0.018, 5);
    // Shuttle and small tie cords visible around the front beam.
    squareBeam(THREE, g, 'wooden shuttle', dark, [-0.33, 1.58, 0.46], [0.33, 1.58, 0.46], 0.07, 0.09);
    [[-1.02, 1.31, 0.43], [1.02, 1.31, 0.43], [-0.95, 1.18, 0.48], [0.92, 1.2, 0.5]].forEach(function (p, n) {
      between(THREE, g, 'loom lashing cord', n % 2 ? cord : mat(THREE, 0x98584a), p, [p[0] * 0.96, p[1] - 0.25, p[2] + 0.015], 0.014, 5);
    });
    g.userData.referenceIds = [226];
    g.userData.referenceMode = 'reference-shaped';
    return g;
  }

  function makeFlowerBatch(THREE, parent, records, material, geometry, name, scaleFor) {
    if (!records.length) return;
    var batch = new THREE.InstancedMesh(geometry, material, records.length);
    batch.name = name;
    var dummy = new THREE.Object3D();
    records.forEach(function (record, i) {
      dummy.position.set(record.p[0], record.p[1], record.p[2]);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), record.n);
      dummy.rotateZ(record.angle || 0);
      var s = scaleFor(record);
      dummy.scale.set(s[0], s[1], s[2]);
      dummy.updateMatrix();
      batch.setMatrixAt(i, dummy.matrix);
    });
    batch.instanceMatrix.needsUpdate = true;
    parent.add(batch);
  }

  function foldedPetal(THREE) {
    var positions = [], uvs=[], indices = [], rows = 12, columns = 8;
    for (var row = 0; row <= rows; row++) {
      var t = row / rows, width = Math.sin(Math.PI * t * 0.88) * 0.52 + 0.015;
      for (var col = 0; col <= columns; col++) {
        var s = col / columns * 2 - 1;
        positions.push(s * width, t,
          0.38 * t * t + 0.20 * Math.abs(s) * Math.sin(t * Math.PI) - 0.08 * (1 - Math.abs(s)) * Math.sin(t * Math.PI)+0.035*Math.sin(s*9+t*13)*Math.sin(t*Math.PI));
        uvs.push(col/columns,t);
        if (row < rows && col < columns) {
          var a = row * (columns + 1) + col, b = a + columns + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geo.setIndex(indices); geo.computeVertexNormals();
    return geo;
  }

  function planterPanel(THREE, group, name, map, angle) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.214, 0.105, 0.411, 0.214, 0.105, 0.411,
      0.295, 0.616, 0.558, -0.295, 0.616, 0.558
    ], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,1], 2));
    geo.setIndex([0,1,2,0,2,3]); geo.computeVertexNormals();
    var material = new THREE.MeshStandardMaterial({color:0xffffff, map:map, roughness:0.82});
    material.userData.surface='ceramic';
    mesh(THREE, geo, material, group, name).rotation.y = angle;
  }

  function paperTree(THREE, textures) {
    var g = new THREE.Group();
    g.name = '橙色纸花盆景 · 参考照片结构';
    var canopy = new THREE.Group();
    canopy.name = 'asymmetric flowering crown';
    g.add(canopy);
    function treePath(path) {
      return path.map(function(p){
        var height=Math.max(0,Math.min(1,(p[1]-0.67)/2.4));
        return [p[0],p[1],p[2]*1.7+0.34*Math.sin(p[0]*2.3)*height+0.12*height];
      });
    }
    function treeTube(name,material,path,radius,sides,taper) {
      return curvedTube(THREE,canopy,name,material,treePath(path),radius,sides,taper);
    }
    var bark = new THREE.MeshStandardMaterial({color:0xb5917e, map:textures.paperBark, roughness:0.96});
    bark.userData.surface='wood';
    var twig = mat(THREE, 0x49362b,0.9,'wood'), pot = mat(THREE, 0x30372e,0.7,'ceramic'), rim = mat(THREE, 0x686947,0.7,'ceramic'), pebble = mat(THREE, 0xd7d0b8,1,'mineral'), leaf = mat(THREE, 0x73764a,1,'paper');
    var orange = mat(THREE, 0xe9a16e,1,'paper'), paleOrange = mat(THREE, 0xe9b983,1,'paper'), darkOrange = mat(THREE, 0xbe794f,1,'paper');
    [orange, paleOrange, darkOrange].forEach(function (material) { material.side = THREE.DoubleSide; });
    // Six-sided, flared ceramic planter with thick angular lip and visible pale gravel.
    var body = mesh(THREE, new THREE.CylinderGeometry(0.66, 0.45, 0.62, 6, 1, false), pot, g, 'six sided dark green planter');
    body.position.set(0, 0.36, 0); body.rotation.y = Math.PI / 6;
    planterPanel(THREE, g, 'photographed left planter painting', textures.paperPotLeft, -Math.PI / 3);
    planterPanel(THREE, g, 'photographed central planter inscription', textures.paperPotCenter, 0);
    planterPanel(THREE, g, 'photographed right planter painting', textures.paperPotRight, Math.PI / 3);
    var lip = mesh(THREE, new THREE.CylinderGeometry(0.71, 0.68, 0.1, 6, 1, true), rim, g, 'wide hexagonal planter rim');
    lip.position.set(0, 0.68, 0); lip.rotation.y = Math.PI / 6;
    var soil = mesh(THREE, new THREE.CircleGeometry(0.61, 6), mat(THREE, 0x4c4935), g, 'planter soil');
    soil.rotation.x = -Math.PI / 2; soil.rotation.z = Math.PI / 6; soil.position.y = 0.61;
    for (var stone = 0; stone < 28; stone++) {
      var angle = stone * 2.399, radius = 0.12 + 0.43 * Math.sqrt((stone + 0.5) / 28);
      var p = mesh(THREE, new THREE.IcosahedronGeometry(0.065 + (stone % 3) * 0.012, 1), pebble, g, 'pale gravel in planter');
      p.position.set(Math.cos(angle) * radius, 0.64 + (stone % 2) * 0.018, Math.sin(angle) * radius); p.scale.set(1.25, 0.52, 0.9);
    }
    // The trunk sweeps from the pot to the left, then turns up and right.
    treeTube('continuous S-curved paper-tree trunk', bark,
      [[0.28,0.67,0.02],[0.08,0.85,0.01],[-0.33,1.00,0],[-0.62,1.30,0.01],[-0.62,1.58,0.02],[-0.34,1.83,0.04],[0.06,2.09,0.06],[0.38,2.48,0.06]], 0.16, 10, 0.53);
    treeTube('low left spreading branch', bark,
      [[-0.48,1.21,0],[-0.88,1.10,0],[-1.38,1.13,0.04]], 0.05, 7, 0.50);
    treeTube('low right spreading branch', bark,
      [[-0.51,1.40,0],[-0.03,1.46,-0.01],[0.45,1.31,0.01],[0.62,1.50,0.03]], 0.05, 7, 0.62);
    treeTube('upper right crooked branch', bark,
      [[0.14,2.14,0.05],[0.57,2.10,0.07],[0.81,1.80,0.05],[1.25,1.88,0.06]], 0.065, 8, 0.57);
    var branches = [
      [[-0.30,1.88,0.04],[-0.65,2.13,0.05],[-0.76,2.55,0.08],[-1.08,3.07,0.12]],
      [[-0.30,2.00,0.03],[-0.26,2.48,0.10],[-0.16,3.02,0.12]],
      [[-0.66,1.65,0.04],[-0.95,1.94,0.01],[-1.17,2.24,0.03]],
      [[1.02,1.87,0.07],[0.91,2.27,0.06],[1.05,2.56,0.04]],
      [[1.16,1.90,0.06],[1.51,1.91,0.10],[1.70,2.08,0.08]],
      [[0.41,1.35,0.01],[0.83,1.57,0.16],[1.45,1.90,0.19]],
      [[-1.04,1.13,0.04],[-1.16,1.55,0.11],[-1.27,1.91,0.12]],
      [[-0.34,1.83,0.03],[-0.68,2.43,-0.17],[-0.69,2.80,-0.19]],
      [[0.56,2.09,0.05],[0.76,2.48,-0.17],[0.90,2.75,-0.18]],
      [[-0.02,1.45,0],[0.01,1.74,0.10],[0.13,2.05,0.13]]
    ];
    branches=branches.map(treePath);
    var flowerPoints = [];
    branches.forEach(function (path, bi) {
      curvedTube(THREE, canopy, 'continuous tapered flowering twig', twig, path, bi < 2 ? 0.024 : 0.017, 5, 0.76);
      var count = [7,6,4,5,4,5,5,4,4,4][bi];
      for (var k = 0; k < count; k++) {
        var t = (k + 0.45) / (count + 0.6) * (path.length - 1), seg = Math.min(path.length - 2, Math.floor(t)), f = t - seg;
        var a = path[seg], b = path[seg + 1];
        var side = bi % 2 ? 1 : -1;
        flowerPoints.push([a[0] * (1 - f) + b[0] * f + side * (0.08 + (k % 3) * 0.03), a[1] * (1 - f) + b[1] * f + ((k % 2) ? 0.07 : -0.035), a[2] * (1 - f) + b[2] * f + (bi % 3 - 1) * 0.025]);
      }
    });
    // Fine dark stems and sparse olive buds make the papercraft blossoms sit on visible twigs.
    flowerPoints.forEach(function (p, i) {
      var out = [p[0] + (i % 2 ? 0.09 : -0.08), p[1] + 0.12 + (i % 3) * 0.025, p[2] + (i % 3 - 1) * 0.045];
      between(THREE, canopy, 'fine paper flower stem', twig, p, out, 0.012, 5);
      between(THREE, canopy, 'small olive paper bud', leaf, [out[0], out[1] - 0.03, out[2]], [out[0] + 0.045, out[1] + 0.035, out[2]], 0.018, 5);
      p._tip = out;
    });
    var petalGeom = foldedPetal(THREE);
    var orangePetals = [], lightPetals = [], darkPetals = [];
    flowerPoints.forEach(function (p, fi) {
      var c = p._tip, direction=(fi%7)*Math.PI*2/7;
      var norm = new THREE.Vector3(Math.sin(direction)*0.75, 0.22+(fi%2)*0.24, Math.cos(direction)).normalize();
      var u = new THREE.Vector3(0, 1, 0).cross(norm).normalize();
      if (u.lengthSq() < 0.1) u.set(1, 0, 0);
      var v = norm.clone().cross(u).normalize();
      var radius = 0.083 + (fi % 5) * 0.010;
      for (var layer = 0; layer < 3; layer++) {
        var petals = layer === 0 ? 6 : 5;
        for (var pet = 0; pet < petals; pet++) {
          var ang = pet * Math.PI * 2 / petals + layer * 0.58 + fi * 0.73;
          var radial = u.clone().multiplyScalar(Math.sin(ang)).add(v.clone().multiplyScalar(Math.cos(ang)));
          var pos = new THREE.Vector3(c[0], c[1], c[2]).addScaledVector(radial, radius * 0.06).addScaledVector(norm, layer * 0.013);
          var size = radius * (1 - layer * 0.25)*(0.9+0.13*Math.sin(fi*4.7+pet*2.1));
          var rec = {p:pos.toArray(), n:norm, angle:ang+0.12*Math.sin(fi+pet*1.8), size:size};
          (layer === 2 ? darkPetals : fi % 4 === 0 ? lightPetals : orangePetals).push(rec);
        }
      }
    });
    function scalePetal(r) { return [r.size, r.size, r.size]; }
    makeFlowerBatch(THREE, canopy, orangePetals, orange, petalGeom, 'orange paper blossom petals', scalePetal);
    makeFlowerBatch(THREE, canopy, lightPetals, paleOrange, petalGeom, 'pale orange paper blossom petals', scalePetal);
    makeFlowerBatch(THREE, canopy, darkPetals, darkOrange, petalGeom, 'rust orange paper blossom petals', scalePetal);
    g.userData.referenceIds = [204, 206, 207];
    g.userData.referenceMode = 'reference-shaped';
    g.userData.reconstruction='保留正面S形主干与六角花盆，合理补充枝条纵深及朝不同方向开放的纸花';
    return g;
  }

  function bambooWeaveGeometry(THREE, radius, dishDepth, stripWidth, count, direction, phase) {
    var positions = [], uvs=[],colors=[],indices = [];
    var diagonal = Math.PI / 4 * direction;
    var normalX = -Math.sin(diagonal), normalZ = Math.cos(diagonal);
    for (var i = 0; i < count; i++) {
      var offset = (i - (count - 1) / 2) * (radius * 1.75 / count);
      if (Math.abs(offset) >= radius) continue;
      var half = Math.sqrt(radius * radius - offset * offset);
      var p0x = normalX * offset - Math.cos(diagonal) * half, p0z = normalZ * offset - Math.sin(diagonal) * half;
      var p1x = normalX * offset + Math.cos(diagonal) * half, p1z = normalZ * offset + Math.sin(diagonal) * half;
      var steps = Math.max(8, Math.ceil(half * 24));
      var start = positions.length / 3;
      for (var s = 0; s <= steps; s++) {
        var t = s / steps, cx = p0x + (p1x - p0x) * t, cz = p0z + (p1z - p0z) * t;
        var along = cx * Math.cos(diagonal) + cz * Math.sin(diagonal);
        var phaseLift = direction * Math.cos(along * 86 + phase + i * Math.PI) * 0.009;
        var y = 0.12 + dishDepth * ((cx * cx + cz * cz) / (radius * radius)) + phaseLift;
        var halfW = stripWidth / 2*(1+0.05*Math.sin(i*3.7+s*0.33));
        var bx = normalX * halfW, bz = normalZ * halfW;
        positions.push(cx - bx, y, cz - bz, cx + bx, y, cz + bz, cx - bx, y - 0.018, cz - bz, cx + bx, y - 0.018, cz + bz);
        var tint=0.9+0.09*Math.sin(i*2.37);
        for(var k=0;k<4;k++){uvs.push(k%2,s/steps*4);colors.push(tint,tint,tint);}
        if (s > 0) {
          var prev = start + (s - 1) * 4, cur = start + s * 4;
          indices.push(prev, cur, prev + 1, cur, cur + 1, prev + 1, prev + 2, prev + 3, cur + 2, cur + 2, prev + 3, cur + 3);
          indices.push(prev, prev + 2, cur, cur, prev + 2, cur + 2, prev + 1, cur + 1, prev + 3, cur + 1, cur + 3, prev + 3);
        }
      }
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
  }

  function circularTray(THREE) {
    var g = new THREE.Group(); g.name = '圆竹筛 · 参考照片结构';
    var bamboo = mat(THREE, 0xbcaa88,0.85,'bamboo'), pale = mat(THREE, 0xcfbf9c,0.9,'bamboo'), dark = mat(THREE, 0x917954,0.9,'bamboo');
    bamboo.vertexColors=pale.vertexColors=true;
    var radius = 1.03;
    var base = mesh(THREE, bambooWeaveGeometry(THREE, radius, 0.12, 0.031, 35, 1, 0), bamboo, g, 'open diagonal bamboo strips one direction');
    var cross = mesh(THREE, bambooWeaveGeometry(THREE, radius, 0.12, 0.031, 35, -1, Math.PI), pale, g, 'open diagonal bamboo strips crossing direction');
    base.renderOrder = 0; cross.renderOrder = 1;
    // Several bent hoops bind the round shallow wall and form the thick rolled rim.
    [0.105, 0.185, 0.235].forEach(function (y, i) {
      var tube = i === 2 ? 0.04 : 0.022;
      var hoop = mesh(THREE, new THREE.TorusGeometry(radius - (i === 0 ? 0.01 : 0.035), tube, 6, 80), i === 1 ? pale : dark, g, 'round bamboo binding hoop');
      hoop.rotation.x = Math.PI / 2; hoop.position.y = y;
    });
    var wall = mesh(THREE, new THREE.CylinderGeometry(radius, radius * 0.91, 0.14, 64, 1, true), bamboo, g, 'shallow curved bamboo tray wall');
    wall.position.y = 0.15;
    for (var spoke = 0; spoke < 32; spoke++) {
      var a = spoke * Math.PI * 2 / 32;
      between(THREE, g, 'radial tray rim stitch', spoke % 2 ? pale : dark,
        [Math.cos(a) * 0.98, 0.13, Math.sin(a) * 0.98], [Math.cos(a) * 1.04, 0.19, Math.sin(a) * 1.04], 0.012, 5);
    }
    g.userData.referenceIds = [243, 244];
    g.userData.referenceMode = 'reference-shaped';
    return g;
  }

  function coneWeave(THREE, parent, name, material, radius, height, turns, offset, direction) {
    var positions = [], uvs=[],colors=[], indices = [], segments = 140, paths = 16;
    for (var i = 0; i < paths; i++) {
      var baseAngle = i * Math.PI * 2 / paths + offset;
      var start = positions.length / 3;
      for (var s = 0; s <= segments; s++) {
        var v = s / segments;
        var angle = baseAngle + direction * turns * Math.PI * 2 * v;
        var r = radius * (1 - v * 0.88);
        var cx = Math.cos(angle) * r, cz = Math.sin(angle) * r, y = height * v;
        var w = 0.0125*(1+0.04*Math.sin(i*2.1+s*0.27));
        // Narrow ribbon width follows the local circumferential direction of the conical surface.
        var wx = -Math.sin(angle) * w, wz = Math.cos(angle) * w;
        positions.push(cx - wx, y, cz - wz, cx + wx, y, cz + wz, cx - wx, y - 0.012, cz - wz, cx + wx, y - 0.012, cz + wz);
        var tint=0.9+0.09*Math.sin(i*2.37);
        for(var k=0;k<4;k++){uvs.push(k%2,v*5);colors.push(tint,tint,tint);}
        if (s > 0) {
          var prev = start + (s - 1) * 4, cur = start + s * 4;
          indices.push(prev, cur, prev + 1, cur, cur + 1, prev + 1, prev + 2, prev + 3, cur + 2, cur + 2, prev + 3, cur + 3);
        }
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geo.setIndex(indices); geo.computeVertexNormals();material.vertexColors=true;
    var obj = mesh(THREE, geo, material, parent, name); obj.material.side = THREE.DoubleSide;
    return obj;
  }

  function bambooHat(THREE, root, label, position, rotation, scale) {
    var hat = new THREE.Group(); hat.name = label; hat.position.set(position[0], position[1], position[2]); hat.rotation.set(rotation[0], rotation[1], rotation[2]); hat.scale.set(scale[0], scale[1], scale[2]); root.add(hat);
    var tan = mat(THREE, 0xc0af8d,0.85,'bamboo'), light = mat(THREE, 0xd5c7a7,0.9,'bamboo'), shadow = mat(THREE, 0x99815d,0.9,'bamboo');
    coneWeave(THREE, hat, 'open hexagonal bamboo lattice diagonal family A', tan, 0.66, 0.54, 1.2, 0, 1);
    coneWeave(THREE, hat, 'open hexagonal bamboo lattice diagonal family B', light, 0.66, 0.54, 1.2, Math.PI / 16, -1);
    // Polygonal mouth binding, plus a small crown knot and a red tie visible in the reference display.
    var rim = mesh(THREE, new THREE.TorusGeometry(0.66, 0.027, 7, 64), shadow, hat, 'reinforced circular open hat edge');
    rim.rotation.x = Math.PI / 2;
    for (var k = 0; k < 20; k++) {
      var a = k * Math.PI * 2 / 20;
      between(THREE, hat, 'edge binding stitch', k % 2 ? tan : light,
        [Math.cos(a) * 0.638, 0.006, Math.sin(a) * 0.638], [Math.cos(a) * 0.681, 0.016, Math.sin(a) * 0.681], 0.009, 5);
    }
    var knot = mesh(THREE, new THREE.SphereGeometry(0.034, 8, 6), mat(THREE, 0x9b392b), hat, 'red cord knot');
    knot.position.set(0.12, 0.31, 0.08);
    between(THREE, hat, 'red hat tie', mat(THREE, 0x9b392b), [0.12, 0.31, 0.08], [0.31, 0.14, 0.12], 0.012, 5);
  }

  function singleBambooHat(THREE) {
    var g = new THREE.Group(); g.name = '竹编斗笠 · 开放编织锥帽';
    bambooHat(THREE, g, 'single large open woven conical hat based on photo right-hand hat', [0, 0.04, 0], [-0.08, -0.42, -0.28], [1, 1, 1]);
    g.userData.referenceIds = [249];
    g.userData.referenceMode = 'reference-shaped';
    return g;
  }

  var builders = { zhiji: loom, zhiyi: paperTree, boji: circularTray, liangmao: singleBambooHat };
  root.CraftModels = {
    textures: {
      loomCloth: 'assets/model-textures/craft-loom-cloth.jpg',
      paperPotLeft: 'assets/model-textures/craft-pot-left.jpg',
      paperPotCenter: 'assets/model-textures/craft-pot-center.jpg',
      paperPotRight: 'assets/model-textures/craft-pot-right.jpg',
      paperBark: 'assets/model-textures/craft-paper-bark.jpg'
    },
    build: function (id, THREE, textures) {
      return builders[id] ? builders[id](THREE, textures) : null;
    }
  };
}(window));
