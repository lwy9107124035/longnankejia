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
    var g=new THREE.Group();g.name='GuanxiXinwei';
    var scale=5.2/92.2,W=92.2*scale,D=83.5*scale,wallH=8*scale,towerH=10*scale;
    var foundation=.036,towerW=8.4*scale,towerRise=.085,towerEave=towerH-towerRise,thickness=scale;
    var hallRows=[-1.28,-.29,.70],wingDepth=.60,frontWingZ=1.47,frontWingDepth=.57;
    var sideGate={center:(hallRows[2]+wingDepth/2+frontWingZ-frontWingDepth/2)/2,width:.15,spring:.145};
    var plaster=new THREE.MeshStandardMaterial({map:canvasTex('guanxiWall'),color:0xdeddd3,roughness:1});
    var inner=new THREE.MeshStandardMaterial({map:plaster.map,color:0xe4e1d4,roughness:1});
    var brick=new THREE.MeshStandardMaterial({map:canvasTex('qingBrick'),color:0xc8ccc5,roughness:1});
    var stone=new THREE.MeshStandardMaterial({map:textures.stonePaving,color:0xd3d0c4,roughness:1});
    var paving=new THREE.MeshStandardMaterial({map:canvasTex('guanxiPaving'),color:0xc0bfb6,roughness:1});
    var tile=new THREE.MeshStandardMaterial({map:canvasTex('guanxiTiles'),color:0xb2b7b2,roughness:.95,side:THREE.DoubleSide});
    var tileFine=new THREE.MeshStandardMaterial({color:0x61645f,roughness:.96,side:THREE.DoubleSide});
    var timber=new THREE.MeshStandardMaterial({color:0x575247,roughness:.96});
    var dark=new THREE.MeshStandardMaterial({color:0x302f29,roughness:1});
    var lime=new THREE.MeshStandardMaterial({color:0xbec2b9,roughness:1});
    var frieze=new THREE.MeshStandardMaterial({color:0x8d9992,roughness:1});
    var pondWater=new THREE.MeshStandardMaterial({map:canvasTex('pondWater'),color:0xb1ae73,roughness:.7,metalness:.02});
    [plaster,inner,brick,stone,paving,tile,tileFine,lime,frieze].forEach(function(m){m.userData.surface='mineral';m.userData.bumpScale=.001;});
    tile.userData.bumpScale=.0005;tileFine.userData.bumpScale=.0003;
    timber.userData.surface='wood';timber.userData.bumpScale=.0005;
    var batches={},unitBox=new THREE.BoxGeometry(1,1,1);
    function block(name,mat,w,h,d,x,y,z,turn,tilt) {
      if(!batches[name])batches[name]={material:mat,items:[]};
      batches[name].items.push([x,y,z,w,h,d,turn||0,tilt||0]);
    }
    function metricUV(geo,unit) {
      var p=geo.attributes.position,n=geo.attributes.normal,uv=[];
      for(var i=0;i<p.count;i++){
        var a=Math.abs(n.getX(i)),b=Math.abs(n.getY(i)),c=Math.abs(n.getZ(i));
        uv.push((a>c?p.getZ(i):p.getX(i))/unit,(b>a&&b>c?p.getZ(i):p.getY(i))/.5);
      }
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return geo;
    }
    function box(name,w,h,d,mat,x,y,z,turn) {
      var m=new THREE.Mesh(metricUV(new THREE.BoxGeometry(w,h,d),mat===paving ? .6 : 1.3),mat);
      m.name=name;m.position.set(x,y,z);m.rotation.y=turn||0;m.castShadow=m.receiveShadow=true;g.add(m);return m;
    }
    // Open half-round tiles run down each roof slope; individual courses remain visible when zoomed in.
    function barrel(radius,length) {
      var p=[],uv=[],indices=[],steps=4;
      for(var j=0;j<2;j++)for(var k=0;k<=steps;k++){
        var a=k/steps*Math.PI;p.push(-radius*Math.cos(a),radius*Math.sin(a),(j-.5)*length);uv.push(k/steps,j);
      }
      for(var i=0;i<steps;i++){var b=i+steps+1;indices.push(i,b,i+1,i+1,b,b+1);}
      var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();return geo;
    }
    function roof(name,x,z,w,d,y,rise,turn,hardGable) {
      var r=new THREE.Group();r.name=name;r.position.set(x,y,z);r.rotation.y=turn||0;
      var ex=w/2+(hardGable?0:.014),ez=d/2+(hardGable?0:.018),segments=6,points=[],uv=[],indices=[];
      function height(v){return rise*(1-v)-.006*Math.sin(v*Math.PI);}
      for(var side=0;side<2;side++){
        var sign=side?1:-1,offset=points.length/3;
        for(var j=0;j<=segments;j++){
          var v=j/segments;
          points.push(-ex,height(v),sign*ez*v,ex,height(v),sign*ez*v);
          uv.push(0,v*Math.hypot(ez,rise)/.9,ex*2/.416,v*Math.hypot(ez,rise)/.9);
          if(j<segments){var a=offset+j*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
        }
      }
      var geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
      var face=new THREE.Mesh(geo,tile);face.name='continuous_tile_slopes';face.castShadow=face.receiveShadow=true;r.add(face);
      var across=Math.max(6,Math.floor(ex*2/.026)),rows=Math.max(3,Math.ceil(Math.hypot(ez,rise)/.05));
      var course=Math.hypot(ez,rise)/rows,tiles=new THREE.InstancedMesh(barrel(.0048,course*.90),tileFine,across*rows*2);
      tiles.name='overlapping_qingwa_courses';var o=new THREE.Object3D(),color=new THREE.Color(),n=0;
      for(var s=0;s<2;s++)for(var row=0;row<rows;row++)for(var col=0;col<across;col++){
        var v=(row+.5)/rows,sgn=s?1:-1;
        o.position.set(-ex+(col+.5)*ex*2/across,height(v)+.002,sgn*ez*v);
        o.rotation.set(sgn*Math.atan2(rise+.006*Math.PI*Math.cos(v*Math.PI),ez),0,0);o.updateMatrix();tiles.setMatrixAt(n,o.matrix);
        var shade=.88+((col*17+row*13+s*3)%19)/90;color.setRGB(shade,shade,shade*.97);tiles.setColorAt(n++,color);
      }
      tiles.castShadow=tiles.receiveShadow=true;r.add(tiles);
      var caps=Math.max(3,Math.floor(w/.032)),ridge=new THREE.InstancedMesh(barrel(.008,w/caps*.98),tileFine,caps);
      ridge.name='grey_ridge_caps';
      for(var cap=0;cap<caps;cap++){
        o.position.set(-w/2+(cap+.5)*w/caps,rise+.002,0);o.rotation.set(0,Math.PI/2,0);o.updateMatrix();ridge.setMatrixAt(cap,o.matrix);
        ridge.setColorAt(cap,color.setRGB(1,1,1));
      }
      ridge.castShadow=true;r.add(ridge);
      var beams=new THREE.InstancedMesh(unitBox,timber,2);beams.name='eave_fascia';
      [-1,1].forEach(function(sign,i){o.position.set(0,-.004,sign*(ez-.004));o.rotation.set(0,0,0);o.scale.set(w,.009,.008);o.updateMatrix();beams.setMatrixAt(i,o.matrix);});r.add(beams);
      if(hardGable){
        var end=new THREE.Shape();end.moveTo(-ez,0);end.lineTo(ez,0);end.lineTo(0,rise);end.closePath();
        [-1,1].forEach(function(sign){
          var wall=new THREE.Mesh(metricUV(new THREE.ExtrudeGeometry(end,{depth:.012,bevelEnabled:false}),.8),plaster);
          wall.name='flush_gable_wall';wall.rotation.y=Math.PI/2;wall.position.x=sign*ex-(sign>0?.012:0);wall.castShadow=true;r.add(wall);
        });
      }
      g.add(r);return r;
    }
    function passageBody(name,length,height,depth,mat,x,z,turn,center) {
      var half=sideGate.width/2,outline=new THREE.Shape();
      // The arch is a notch in the bottom boundary, open through the full depth of the building.
      outline.moveTo(-length/2,0);outline.lineTo(center-half,0);outline.lineTo(center-half,sideGate.spring);
      outline.absarc(center,sideGate.spring,half,Math.PI,0,true);outline.lineTo(center+half,0);
      outline.lineTo(length/2,0);outline.lineTo(length/2,height);outline.lineTo(-length/2,height);outline.closePath();
      var geo=new THREE.ExtrudeGeometry(outline,{depth:depth,bevelEnabled:false,curveSegments:12});geo.translate(0,0,-depth/2);
      var body=new THREE.Mesh(metricUV(geo,1.3),mat);body.name=name;body.rotation.y=turn;body.position.set(x,foundation,z);
      body.castShadow=body.receiveShadow=true;g.add(body);return body;
    }
    function wall(name,x,z,length,axis,gate) {
      var gateC=sideGate.center,gap=sideGate.width,spring=sideGate.spring,gateTop=spring+gap/2;
      if(gate){
        passageBody(name+'_weathered_earth',length,wallH,thickness,plaster,x,z,Math.PI/2,-gateC);
        var portal=new THREE.Group();portal.name=name+'_side_gate';portal.position.set(x+(x>0?1:-1)*(thickness/2+.002),foundation,gateC);portal.rotation.y=x>0?Math.PI/2:-Math.PI/2;
        var curve=new THREE.EllipseCurve(0,spring,gap/2+.007,gap/2+.007,0,Math.PI,false,0);
        var pts=curve.getPoints(20).map(function(p){return new THREE.Vector3(p.x,p.y,0);});
        var arch=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),20,.008,5,false),lime);arch.name='stone_gate_arch';portal.add(arch);
        [-1,1].forEach(function(sign){var jamb=new THREE.Mesh(new THREE.BoxGeometry(.015,spring,.012),lime);jamb.position.set(sign*(gap/2+.008),spring/2,0);portal.add(jamb);});
        var plaque=new THREE.Mesh(new THREE.BoxGeometry(.22,.032,.009),lime);plaque.position.set(0,gateTop+.04,0);portal.add(plaque);g.add(portal);
      }else box(name+'_weathered_earth',length,wallH,thickness,plaster,x,foundation+wallH/2,z);
      block('wall_eave_frieze',frieze,axis==='x'?length:thickness+.002,.026,axis==='x'?thickness+.002:length,x,foundation+wallH-.027,z);
      if(gate){
        var before=gateC-gap/2+length/2,after=length/2-gateC-gap/2;
        block('stone_wall_footings',stone,thickness+.006,.028,before,x,foundation+.014,-length/2+before/2);
        block('stone_wall_footings',stone,thickness+.006,.028,after,x,foundation+.014,length/2-after/2);
        block('side_gate_thresholds',stone,thickness+.014,.008,gap,x,foundation+.004,gateC);
      }else block('stone_wall_footings',stone,axis==='x'?length:thickness+.006,.028,axis==='x'?thickness+.006:length,x,foundation+.014,z);
    }
    box('ground_apron',W+.78,.018,D+1.02,paving,0,.009,.30);
    box('stone_plinth',W+.20,foundation,D+.20,stone,0,foundation/2,0);
    box('courtyard_ground',W-.10,.008,D-.10,paving,0,foundation+.004,0);
    wall('north_wall',0,-D/2,W,'x',false);wall('south_wall',0,D/2,W,'x',false);
    wall('east_wall',W/2,0,D,'z',true);wall('west_wall',-W/2,0,D,'z',true);

    function facadeBlock(name,mat,w,h,d,localX,y,localZ,cx,cz,turn,tilt) {
      block(name,mat,w,h,d,cx+localX*Math.cos(turn)+localZ*Math.sin(turn),y,cz-localX*Math.sin(turn)+localZ*Math.cos(turn),turn,tilt);
    }
    function house(name,x,z,w,d,eave,rise,bays,turn,gallery,passageCenter) {
      turn=turn||0;var passage=passageCenter!==undefined;
      if(passage)passageBody(name+'_body',w,eave,d,inner,x,z,turn,passageCenter);
      else box(name+'_body',w,eave,d,inner,x,foundation+eave/2,z,turn);
      roof(name+'_roof',x,z,w+.035,d+.075,foundation+eave,rise,turn,false);
      block('hall_stone_platforms',stone,w+.045,.016,d+.10,x,foundation+.008,z,turn);
      var f=function(kind,mat,ww,hh,dd,xx,yy,zz){facadeBlock(kind,mat,ww,hh,dd,xx,yy,zz,x,z,turn);};
      var step=w/bays;
      for(var bay=0;bay<bays;bay++){
        var xx=(bay-(bays-1)/2)*step,door=gallery||bay%3===1,pw=Math.min(step*.64,.14),ph=gallery?.125:door?.20:.105;
        if(passage&&Math.abs(xx-passageCenter)<sideGate.width/2+pw/2+.012)continue;
        var yy=foundation+(gallery?.27:door?.12:.22);
        f('recessed_timber_panels',dark,pw,ph,.005,xx,yy,d/2+.003);
        [-1,1].forEach(function(sign){f('timber_door_frames',timber,.007,ph+.015,.010,xx+sign*(pw/2+.003),yy,d/2+.009);});
        f('timber_door_frames',timber,pw+.02,.009,.010,xx,yy+ph/2+.006,d/2+.009);
        for(var bar=-1;bar<=1;bar++)f('timber_lattice_bars',lime,.0035,ph-.01,.006,xx+bar*pw/4,yy,d/2+.010);
        f('timber_lattice_bars',lime,pw,.0035,.006,xx,yy,d/2+.010);
      }
      for(var i=0;i<=bays;i++){
        var columnX=-w/2+i*step;
        if(passage&&Math.abs(columnX-passageCenter)<sideGate.width/2+.012)continue;
        f('veranda_columns',timber,.012,eave-.015,.012,columnX,foundation+(eave-.015)/2,d/2+.035);
      }
      f('veranda_lintels',timber,w+.018,.019,.020,0,foundation+eave-.018,d/2+.035);
      f('veranda_stone_steps',stone,w+.04,.012,.052,0,foundation+.012,d/2+.034);
      if(gallery){
        if(passage){
          var left=passageCenter-sideGate.width/2-.01,right=passageCenter+sideGate.width/2+.01;
          f('gallery_floor_beams',timber,left+w/2,.016,.027,(left-w/2)/2,foundation+.19,d/2+.012);
          f('gallery_floor_beams',timber,w/2-right,.016,.027,(right+w/2)/2,foundation+.19,d/2+.012);
          f('gate_passage_floors',paving,sideGate.width,.006,d+.12,passageCenter,foundation+.016,0);
        }else f('gallery_floor_beams',timber,w,.016,.027,0,foundation+.19,d/2+.012);
      }
    }
    // The photograph shows broad, low corner towers rather than narrow stacks above the enclosure.
    [-1,1].forEach(function(sx){[-1,1].forEach(function(sz){
      var x=sx*(W/2-towerW/2+.09),z=sz*(D/2-towerW/2+.09),id=sx+'_'+sz;
      box('corner_tower_'+id+'_body',towerW,towerEave,towerW,plaster,x,foundation+towerEave/2,z);
      box('corner_tower_'+id+'_stone_base',towerW+.006,.042,towerW+.006,stone,x,foundation+.021,z);
      roof('watchtower_'+id,x,z,towerW,towerW,foundation+towerEave,towerRise,0,true);
      for(var side=0;side<4;side++){
        var turn=side*Math.PI/2;
        [.145,.29,.405].forEach(function(y,level){[-1,1].forEach(function(sign){
          facadeBlock('watchtower_loopholes',dark,.014,level===2?.026:.032,.004,sign*.09,foundation+y,towerW/2+.002,x,z,turn);
          facadeBlock('loophole_stone_lintels',lime,.024,.005,.007,sign*.09,foundation+y+.019,towerW/2+.004,x,z,turn);
        });});
        [.15,.31,towerEave-.025].forEach(function(y){facadeBlock('tower_string_courses',frieze,towerW+.004,.006,.007,0,foundation+y,towerW/2,x,z,turn);});
        [-1,1].forEach(function(sign){facadeBlock('tower_corner_quoins',lime,.013,towerEave-.045,.007,sign*(towerW/2-.012),foundation+towerEave/2,towerW/2+.001,x,z,turn);});
      }
    });});
    var ring=.255,ringEave=.355;
    house('perimeter_north',0,-D/2+ring,W-towerW*2+.12,.43,ringEave,.095,24,0,true);
    house('perimeter_south',0,D/2-ring,W-towerW*2+.12,.43,ringEave,.095,24,Math.PI,true);
    house('perimeter_west',-W/2+ring,0,D-towerW*2+.12,.43,ringEave,.095,21,Math.PI/2,true,-sideGate.center);
    house('perimeter_east',W/2-ring,0,D-towerW*2+.12,.43,ringEave,.095,21,-Math.PI/2,true,sideGate.center);
    hallRows.forEach(function(z,row){
      house(row===1?'central_ancestral_hall':'cross_hall_'+row,0,z,2.80,.59,.31,row===1?.135:.12,9,0,false);
      [-1,1].forEach(function(sign){house('wing_'+sign+'_'+row,sign*1.77,z,.66,wingDepth,.275,.10,3,0,false);});
    });
    [-1,1].forEach(function(sign){
      house('front_wing_'+sign,sign*1.77,frontWingZ,.66,frontWingDepth,.25,.105,3,0,false);
      house('forecourt_pavilion_'+sign,sign*.88,1.43,.62,.46,.235,.10,4,Math.PI/2,false);
    });
    var courts=0;
    [-1.77,-.87,0,.87,1.77].forEach(function(x){[-.785,.205].forEach(function(z){
      box('open_sky_court_'+courts++,.69,.006,.235,paving,x,foundation+.010,z);
      [-1,1].forEach(function(sign){block('court_drains',dark,.70,.004,.010,x,foundation+.015,z+sign*.12);});
    });});
    [-1,1].forEach(function(sign){
      block('forecourt_screen_walls',inner,.92,.14,.033,sign*.93,foundation+.07,1.16);
      block('forecourt_wall_coping',frieze,.95,.012,.043,sign*.93,foundation+.147,1.16);
      block('forecourt_cross_walls',inner,.032,.16,.37,sign*1.39,foundation+.08,1.37);
    });
    [-1.3,-.44,.44,1.3].forEach(function(x){[-.785,.205].forEach(function(z){block('skywell_partition_walls',inner,.025,.18,.25,x,foundation+.09,z);});});
    for(var step=0;step<3;step++)block('ancestral_hall_steps',stone,.55,.009,.037,0,foundation+.005+step*.009,1.095-step*.031);

    // Small pierced lattice vents sit in the grey-green band below the outer eaves.
    function vent(x,z,turn) {
      facadeBlock('outer_lattice_recesses',dark,.108,.037,.003,0,foundation+wallH-.03,0,x,z,turn);
      [-1,1].forEach(function(sign){
        facadeBlock('outer_lattice_frames',lime,.114,.004,.005,0,foundation+wallH-.03+sign*.021,0,x,z,turn);
        facadeBlock('outer_lattice_frames',lime,.004,.039,.005,sign*.055,foundation+wallH-.03,0,x,z,turn);
      });
      for(var j=-1;j<=1;j++)[-1,1].forEach(function(sign){facadeBlock('outer_diamond_lattice',lime,.003,.033,.005,j*.028,foundation+wallH-.03,.002,x,z,turn,sign*Math.PI/4);});
    }
    [-1,1].forEach(function(sign){
      for(var j=0;j<6;j++)vent((j-2.5)*.66,sign*(D/2+thickness/2+.003),sign>0?0:Math.PI);
      for(var k=0;k<5;k++)vent(sign*(W/2+thickness/2+.003),(k-2)*.65,sign>0?Math.PI/2:-Math.PI/2);
    });
    var pond=[[-W/2-.15,D/2+.16],[-W/2+.08,D/2+.72],[W/2-.08,D/2+.72],[W/2+.22,D/2+.42],[W/2+.12,D/2+.16]];
    var outline=new THREE.Shape();pond.forEach(function(p,i){if(i)outline.lineTo(p[0],-p[1]);else outline.moveTo(p[0],-p[1]);});outline.closePath();
    var water=new THREE.Mesh(new THREE.ShapeGeometry(outline),pondWater);water.name='front_pond_surface';water.rotation.x=-Math.PI/2;water.position.y=.019;water.receiveShadow=true;g.add(water);
    pond.forEach(function(p,i){var q=pond[(i+1)%pond.length],dx=q[0]-p[0],dz=q[1]-p[1];block('pond_stone_edging',stone,Math.hypot(dx,dz),.015,.018,(p[0]+q[0])/2,.026,(p[1]+q[1])/2,-Math.atan2(dz,dx));});
    Object.keys(batches).forEach(function(name){
      var batch=batches[name],m=new THREE.InstancedMesh(unitBox.clone(),batch.material,batch.items.length),o=new THREE.Object3D();m.name=name;
      batch.items.forEach(function(t,i){o.position.set(t[0],t[1],t[2]);o.rotation.set(0,t[6],t[7],'YXZ');o.scale.set(t[3],t[4],t[5]);o.updateMatrix();m.setMatrixAt(i,o.matrix);});
      m.castShadow=m.receiveShadow=true;g.add(m);
    });
    g.userData.referenceMode='photo-informed-form';g.userData.wallHeightRatio=wallH/W;g.userData.towerHeightRatio=towerH/W;
    g.userData.dimensions={width:92.2,depth:83.5,wallHeight:8,towerHeight:10};
    g.userData.estimatedDetails=['tower footprint','individual bays','courtyard partitions','pond outline'];
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
