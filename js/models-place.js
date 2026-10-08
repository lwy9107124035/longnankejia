(function () {
  'use strict';
  var indigoPattern = 'rings';

  function buildIndigo(THREE, textures) {
    var g = new THREE.Group();
    g.name = 'indigo_sample_236';
    var geo = new THREE.PlaneGeometry(1.95, 1.95, 64, 64);
    var p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i);
      p.setZ(i, fabricZ(x,y));
    }
    geo.computeVertexNormals();
    var cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: textures[indigoPattern === 'rings' ? 'indigoRings' : 'indigoRays'],
      side: THREE.DoubleSide, roughness: 0.99
    }));
    cloth.name = 'photo_rectified_indigo_fabric'; cloth.castShadow = true;
    g.add(cloth);
    function fabricZ(x,y) {
      return 0.045*Math.sin(x*4+y*2) + 0.012*Math.cos(y*16-x*3)
        + 0.055*Math.pow(Math.abs(x)/0.975,8)*Math.sin(y*7);
    }
    var backGeo=geo.clone(),back=backGeo.attributes.position;
    for(var b=0;b<back.count;b++)back.setZ(b,back.getZ(b)-0.008);
    backGeo.computeVertexNormals();
    var reverse=new THREE.Mesh(backGeo,new THREE.MeshStandardMaterial({
      map:cloth.material.map,color:0xcbd4d6,roughness:1,side:THREE.BackSide
    }));
    reverse.name='indigo_fabric_reverse';reverse.castShadow=true;g.add(reverse);
    var hemPoints=[],hemIndices=[];
    for(var h=0;h<4;h++){
      var origin=hemPoints.length/3;
      for(var k=0;k<=64;k++){
        var t=-0.975+k/64*1.95;
        var hx=h<2?t:(h===2?-0.975:0.975),hy=h<2?(h===0?-0.975:0.975):t,hz=fabricZ(hx,hy);
        hemPoints.push(hx,hy,hz,hx,hy,hz-0.008);
        if(k<64){var a=origin+k*2;hemIndices.push(a,a+1,a+2,a+1,a+3,a+2);}
      }
    }
    var hemGeo=new THREE.BufferGeometry();hemGeo.setAttribute('position',new THREE.Float32BufferAttribute(hemPoints,3));
    hemGeo.setIndex(hemIndices);hemGeo.computeVertexNormals();
    var hem=new THREE.Mesh(hemGeo,new THREE.MeshStandardMaterial({color:0x314a77,roughness:1,side:THREE.DoubleSide}));
    hem.name='indigo_thin_closed_hem';g.add(hem);
    var edge = new THREE.MeshStandardMaterial({color: 0xd6ded7, roughness: 1});
    var stitchGeo = new THREE.CylinderGeometry(0.0015, 0.0015, 0.014, 4);
    var stitches = new THREE.InstancedMesh(stitchGeo, edge, 400);
    stitches.name = 'overlocked_fabric_edges';
    var dummy = new THREE.Object3D(), n=0;
    for (var side=0;side<4;side++) for (var j=0;j<100;j++) {
      var q=-0.966+j*0.0195;
      var sx=side<2?q:(side===2?-0.969:0.969);
      var sy=side<2?(side===0?-0.969:0.969):q;
      dummy.position.set(sx,sy,fabricZ(sx,sy)+0.004);
      dummy.rotation.set(0,0,side<2?0:Math.PI/2); dummy.updateMatrix();
      stitches.setMatrixAt(n++,dummy.matrix);
    }
    g.add(stitches);
    g.userData.referenceIds = [236,237,239,241];
    g.userData.referenceMode = 'photo-textured';
    g.traverse(function(o){if(o.material)o.material.userData.surface='fabric';});
    return g;
  }

  function buildWeiwu(THREE, textures, canvasTex) {
    var g = new THREE.Group(); g.name = 'GuanxiXinwei';
    var earth = new THREE.MeshStandardMaterial({map:canvasTex('rammedLoam',3,1), color:0xb1b2aa, roughness:1});
    var brick = new THREE.MeshStandardMaterial({map:canvasTex('qingBrick',5,2), color:0xa6a89f, roughness:1});
    var stone = new THREE.MeshStandardMaterial({map:textures.stonePaving, color:0xb1a68f, roughness:1});
    var paving = new THREE.MeshStandardMaterial({map:canvasTex('cobbleCourt',4,4), color:0xcfc6b0, roughness:1});
    var tile = new THREE.MeshStandardMaterial({map:canvasTex('qingwaRoof',3,2),color:0x73746c,roughness:0.96,side:THREE.DoubleSide});
    var tileFine = new THREE.MeshStandardMaterial({color:0x4c4d47,roughness:0.95});
    var timber = new THREE.MeshStandardMaterial({color:0x6a4830,roughness:0.96});
    var dark = new THREE.MeshStandardMaterial({color:0x352e26,roughness:1});
    var lime = new THREE.MeshStandardMaterial({color:0xe0d9c5,roughness:1});
    var pondWater = new THREE.MeshStandardMaterial({color:0x365e57, roughness:0.18, metalness:0.15});
    [earth,brick,stone,paving,tile,tileFine,lime,pondWater].forEach(function(m){m.userData.surface='mineral';});
    timber.userData.surface='wood';
    var W=5.2, D=5.2, wallH=0.61, towerH=0.88, foundation=0.075;
    function box(name,w,h,d,mat,x,y,z) {
      var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
      m.name=name;m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
    }
    function instances(name,geo,mat,transforms) {
      var m=new THREE.InstancedMesh(geo,mat,transforms.length), o=new THREE.Object3D();
      transforms.forEach(function(t,i){
        o.position.set(t[0],t[1],t[2]);o.rotation.set(t[3]||0,t[4]||0,t[5]||0);
        o.updateMatrix();m.setMatrixAt(i,o.matrix);
      });m.name=name;m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
    }
    function roof(name,x,z,w,d,y,rise,turn) {
      var r=new THREE.Group();r.name=name;var ex=w/2+0.04,ez=d/2+0.035;
      var points=[-ex,y,-ez, ex,y,-ez,ex,y+rise,0, -ex,y,-ez,ex,y+rise,0,-ex,y+rise,0,
        -ex,y+rise,0,ex,y+rise,0,ex,y,ez, -ex,y+rise,0,ex,y,ez,-ex,y,ez];
      var uvs=[0,0,1,0,1,1,0,0,1,1,0,1,0,1,1,1,1,0,0,1,1,0,0,0];
      var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.computeVertexNormals();
      var face=new THREE.Mesh(geo,tile);face.name='continuous_tile_slopes';face.castShadow=true;r.add(face);
      var ridge=new THREE.Mesh(new THREE.CylinderGeometry(0.009,0.009,w+0.035,8),tileFine);
      ridge.rotation.z=Math.PI/2;ridge.position.y=y+rise+0.01;ridge.name='grey_ridge_caps';r.add(ridge);
      var across=Math.max(8,Math.floor(w/0.034)), rows=Math.max(3,Math.floor(ez/0.06));
      var roofTiles=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012,0.013,0.078,6,1,true,0,Math.PI),tileFine,across*rows*2);
      roofTiles.name='overlapping_qingwa_courses';var o=new THREE.Object3D(),n=0,slope=Math.atan2(rise,ez);
      for(var s=0;s<2;s++)for(var j=0;j<rows;j++)for(var k=0;k<across;k++){
        var v=(j+0.5)/rows,sign=s?1:-1;
        o.position.set(-w/2+(k+0.5)*w/across,y+rise*v+0.012,sign*ez*(1-v));
        o.rotation.set(Math.PI/2+sign*slope,0,0);o.updateMatrix();roofTiles.setMatrixAt(n++,o.matrix);
      }r.add(roofTiles);
      [-1,1].forEach(function(s){
        var beam=new THREE.Mesh(new THREE.BoxGeometry(w+0.03,0.016,0.025),timber);
        beam.position.set(0,y-0.007,s*ez);r.add(beam);
      });
      r.position.set(x,0,z);r.rotation.y=turn||0;g.add(r);
    }
    function wall(name,x,z,length,axis,gate) {
      var thickness=0.105;
      function piece(center,len){
        var ww=axis==='x'?len:thickness,dd=axis==='x'?thickness:len;
        box(name+'_weathered_earth',ww,wallH*0.68,dd,earth,axis==='x'?center:x,foundation+wallH*0.34,axis==='x'?z:center);
        box(name+'_upper_brick',ww,wallH*0.32,dd*0.98,brick,axis==='x'?center:x,foundation+wallH*0.84,axis==='x'?z:center);
      }
      if(gate){
        var gateC=0.82,gap=0.28,min=-length/2,max=length/2;
        piece((min+gateC-gap/2)/2,gateC-gap/2-min);
        piece((gateC+gap/2+max)/2,max-gateC-gap/2);
        var portal=new THREE.Group();portal.name=name+'_side_gate';
        var arch=new THREE.Shape();arch.moveTo(-gap/2,0);arch.lineTo(-gap/2,0.28);
        arch.absarc(0,0.28,gap/2,Math.PI,0,true);arch.lineTo(gap/2,0);arch.closePath();
        var door=new THREE.Mesh(new THREE.ShapeGeometry(arch,16),dark);door.name='arched_gate_opening';portal.add(door);
        var curve=new THREE.EllipseCurve(0,0.28,gap/2+0.018,gap/2+0.018,0,Math.PI,false,0);
        var pts=curve.getPoints(24).map(function(p){return new THREE.Vector3(p.x,p.y,0);});
        var arc=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),24,0.014,6,false),lime);portal.add(arc);
        [-1,1].forEach(function(s){var jamb=new THREE.Mesh(new THREE.BoxGeometry(0.029,0.28,0.035),lime);jamb.position.set(s*(gap/2+0.014),0.14,0);portal.add(jamb);});
        var plaque=new THREE.Mesh(new THREE.BoxGeometry(0.39,0.067,0.017),lime);plaque.position.set(0,0.48,0);portal.add(plaque);
        portal.position.set(x+(x>0?0.06:-0.06),foundation,gateC);portal.rotation.y=x>0?Math.PI/2:-Math.PI/2;g.add(portal);
        box(name+'_gate_wall_over',thickness,0.15,gap,brick,x,foundation+wallH-0.075,gateC);
      }else piece(axis==='x'?x:z,length);
      roof(name+'_wall_coping',x,z,length,0.12,foundation+wallH,0.028,axis==='x'?0:Math.PI/2);
    }
    // 围屋整体扩展基台（禾坪晒谷场与后庭，保持严格 5.98 × 5.98 正方形对称包围盒）
    var totalBase = 5.98;
    box('granary_stone_platform', totalBase, foundation * 0.7, totalBase, stone, 0, foundation * 0.35, 0);
    box('stone_plinth',W+0.13,foundation,D+0.13,stone,0,foundation/2,0);
    box('courtyard_ground',W-0.16,0.018,D-0.16,paving,0,foundation+0.01,0);
    wall('north_wall',0,-D/2,W,'x',false);wall('south_wall',0,D/2,W,'x',false);
    wall('east_wall',W/2,0,D,'z',true);wall('west_wall',-W/2,0,D,'z',true);

    // 南侧正门楼（“西林第”正大门楼与石额，客家围屋核心中轴大门）
    var mainGate = new THREE.Group(); mainGate.name = 'south_main_gate';
    box('main_gate_jamb_left', 0.08, 0.42, 0.14, brick, -0.22, foundation + 0.21, D / 2 + 0.06);
    box('main_gate_jamb_right', 0.08, 0.42, 0.14, brick, 0.22, foundation + 0.21, D / 2 + 0.06);
    box('main_gate_drum_left', 0.045, 0.12, 0.08, stone, -0.19, foundation + 0.06, D / 2 + 0.14);
    box('main_gate_drum_right', 0.045, 0.12, 0.08, stone, 0.19, foundation + 0.06, D / 2 + 0.14);
    box('main_gate_doors', 0.36, 0.32, 0.018, timber, 0, foundation + 0.16, D / 2 + 0.04);
    box('main_gate_xilindi_plaque', 0.42, 0.075, 0.02, lime, 0, foundation + 0.38, D / 2 + 0.09);
    roof('main_gate_roof', 0, D / 2 + 0.08, 0.62, 0.22, foundation + 0.44, 0.08, 0);
    g.add(mainGate);

    // 围前客家半月塘（月池）：客家围屋风水灵魂与蓄水防火之池
    var pondRadius = 0.96;
    var pondShape = new THREE.Shape();
    pondShape.absarc(0, 0, pondRadius, 0, Math.PI, false);
    pondShape.closePath();
    var pondGeo = new THREE.ShapeGeometry(pondShape, 24);
    var pondMesh = new THREE.Mesh(pondGeo, pondWater);
    pondMesh.name = 'crescent_moon_pond_surface';
    pondMesh.rotation.x = -Math.PI / 2;
    pondMesh.position.set(0, foundation * 0.72 + 0.005, D / 2 + 0.38);
    pondMesh.receiveShadow = true;
    g.add(pondMesh);
    var pondCurve = new THREE.EllipseCurve(0, 0, pondRadius + 0.03, pondRadius + 0.03, 0, Math.PI, false, 0);
    var pondPts = pondCurve.getPoints(24).map(function (p) {
      return new THREE.Vector3(p.x, foundation * 0.76, D / 2 + 0.38 - p.y);
    });
    var pondCoping = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pondPts), 24, 0.018, 6, false), stone);
    pondCoping.name = 'moon_pond_stone_coping';
    pondCoping.castShadow = true;
    g.add(pondCoping);
    // 北侧后庭对景地台（保持前后左右对称）
    box('rear_dragon_terrace', 2.4, 0.03, 0.50, paving, 0, foundation * 0.72 + 0.015, -D / 2 - 0.14);
    var slits=[],towerSlits=[];
    for(var side=0;side<4;side++)for(var j=0;j<20;j++){
      var q=(j-9.5)*0.22;
      slits.push(side<2?[q,foundation+0.43,side===0?D/2+0.054:-D/2-0.054,0,side===0?0:Math.PI]
        :[side===2?W/2+0.054:-W/2-0.054,foundation+0.43,q,0,Math.PI/2]);
    }
    instances('defensive_slit_windows',new THREE.BoxGeometry(0.026,0.009,0.003),dark,slits);
    [-1,1].forEach(function(sx){[-1,1].forEach(function(sz){
      var x=sx*(W/2-0.055),z=sz*(D/2-0.055),w=0.31;
      box('corner_tower_earth',w,towerH*0.58,w,earth,x,foundation+towerH*0.29,z);
      box('corner_tower_brick',w*0.97,towerH*0.42,w*0.97,brick,x,foundation+towerH*0.79,z);
      roof('watchtower_'+sx+'_'+sz,x,z,w+0.02,w+0.02,foundation+towerH,0.095,0);
      for(var lv=0;lv<3;lv++)for(var f=0;f<4;f++){
        var a=f*Math.PI/2;towerSlits.push([x+Math.sin(a)*0.158,foundation+0.22+lv*0.22,z+Math.cos(a)*0.158,0,a]);
      }
    });});
    instances('watchtower_loopholes',new THREE.BoxGeometry(0.028,0.035,0.003),dark,towerSlits);
    // Perimeter rooms and their inward-facing roofs form the outer ring visible in the aerial photograph.
    [-1,1].forEach(function(s){
      box('perimeter_rooms_NS',4.45,0.42,0.36,earth,0,foundation+0.21,s*2.34);
      roof('perimeter_roof_NS_'+s,0,s*2.34,4.48,0.43,foundation+0.43,0.13,0);
      box('perimeter_rooms_EW',0.36,0.42,3.98,earth,s*2.34,foundation+0.21,0);
      roof('perimeter_roof_EW_'+s,s*2.34,0,4.02,0.43,foundation+0.43,0.13,Math.PI/2);
    });
    var columns=[],doors=[];
    // Five parallel building ranges, three cross halls: a diagram of the documented symmetric organization.
    [-1.44,-0.72,0,0.72,1.44].forEach(function(x,ci){
      [-1.15,0,1.15].forEach(function(z,ri){
        var w=ci===2?0.78:0.62,d=0.83,eave=ci===2?0.51:0.44;
        var name=ci===2&&ri===1?'central_ancestral_hall':'hall_'+ci+'_'+ri;
        box(name+'_body',w,eave,d,earth,x,foundation+eave/2,z);
        roof(name+'_roof',x,z,w+0.045,d+0.045,foundation+eave,ci===2?0.145:0.12,0);
        [-1,1].forEach(function(s){doors.push([x+s*w*0.22,foundation+0.19,z+d/2+0.005]);});
        for(var k=0;k<3;k++)columns.push([x+(k-1)*w*0.37,foundation+eave/2,z+d/2+0.052]);
      });
    });
    instances('timber_doors_and_windows',new THREE.BoxGeometry(0.10,0.25,0.008),timber,doors);
    instances('veranda_columns',new THREE.CylinderGeometry(0.008,0.010,0.39,6),timber,columns);
    var courtFrames=[];
    [-1.44,-0.72,0,0.72,1.44].forEach(function(x){[-0.57,0.57].forEach(function(z){
      box('open_sky_court',0.51,0.014,0.19,stone,x,foundation+0.027,z);
      courtFrames.push([x,foundation+0.038,z-0.10],[x,foundation+0.038,z+0.10]);
    });});
    instances('court_drains',new THREE.BoxGeometry(0.54,0.008,0.012),dark,courtFrames);
    var partitions=[];
    [-1.8,-1.08,-0.36,0.36,1.08,1.8].forEach(function(x){
      [-0.58,0.58].forEach(function(z){partitions.push([x,foundation+0.15,z]);});
    });
    instances('internal_court_partition_walls',new THREE.BoxGeometry(0.035,0.3,0.55),earth,partitions);
    g.userData.referenceMode='documented-form';
    g.userData.wallHeightRatio=wallH/W;g.userData.towerHeightRatio=towerH/W;
    g.userData.sourceUrl='https://www.ganzhou.gov.cn/zfxxgk/c144214/202211/8dcc8823a68742bf8fb3c4f5afff641a.shtml';
    return g;
  }

  window.PlaceModels = {
    textures: {indigoRings:'assets/model-textures/indigo-rings.jpg',indigoRays:'assets/model-textures/indigo-rays.jpg'},
    setIndigoPattern:function(value){indigoPattern=value==='rays'?'rays':'rings';},
    build:function(id,THREE,textures,canvasTex){
      if(id==='landye')return buildIndigo(THREE,textures);
      if(id==='weiwu')return buildWeiwu(THREE,textures,canvasTex);
      return null;
    }
  };
})();
