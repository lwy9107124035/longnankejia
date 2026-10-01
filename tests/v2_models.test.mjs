import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const context={window:{},console};vm.createContext(context);
for(const file of ['vendor/three.min.js','models-textiles.js','models-crafts.js','models-place.js','model-references.js'])
  vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),context);
const T=context.THREE,W=context.window;
const ids=['hutoumao','weiwu','zhidai','dongtoupa','dajinshan','zisundai','bowei','landye','boji','liangmao','zhiji','zhiyi'];
const textures=Object.fromEntries(Object.keys({...W.TextileModels.textures,...W.CraftModels.textures,...W.PlaceModels.textures}).map(key=>[key,new T.Texture()]));
textures.stonePaving=new T.Texture();
function build(id){return W.TextileModels.build(id,T,textures)||W.CraftModels.build(id,T,textures)||W.PlaceModels.build(id,T,textures,()=>new T.Texture());}
for(const id of ids)test(id+' has valid geometry, bounded rendering work and a traceable reference',()=>{
  const group=build(id);assert.ok(group);group.updateMatrixWorld(true);
  let meshes=0,triangles=0,instances=0;const point=new T.Vector3(),matrix=new T.Matrix4();
  group.traverse(object=>{
    if(!object.isMesh)return;meshes++;
    const geometry=object.geometry,count=object.isInstancedMesh?object.count:1;
    triangles+=(geometry.index?geometry.index.count:geometry.attributes.position.count)/3*count;instances+=count;
    for(let k=0;k<count;k++){
      if(object.isInstancedMesh){object.getMatrixAt(k,matrix);matrix.premultiply(object.matrixWorld);}else matrix.copy(object.matrixWorld);
      for(let v=0;v<geometry.attributes.position.count;v++){
        point.fromBufferAttribute(geometry.attributes.position,v).applyMatrix4(matrix);
        assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z),'nonfinite transformed vertex');
      }
    }
  });
  assert.ok(meshes>=2&&meshes<300,meshes+' mesh draw units');assert.ok(triangles>100&&triangles<200000,triangles+' triangles');
  assert.ok(group.userData.referenceMode);assert.ok(W.ModelReferences[id]?.length);
  for(const ref of W.ModelReferences[id])if(ref.src)assert.ok(fs.existsSync(path.join(root,ref.src)),ref.src);
});
test('all photograph texture files exist and have usable dimensions',()=>{
  for(const filename of Object.values({...W.TextileModels.textures,...W.CraftModels.textures,...W.PlaceModels.textures}))assert.ok(fs.statSync(path.join(root,filename)).size>1000,filename);
});
test('dongtoupa front fabric is the first surface hit across its interior',()=>{
  const g=build('dongtoupa');g.updateMatrixWorld(true);
  const front=textures.dongtoupaFront, raycaster=new T.Raycaster();
  for(const y of [0.22,0.80,1.38])for(const x of [-0.48,-0.20,0.20,0.48]){
    raycaster.set(new T.Vector3(x,y,1),new T.Vector3(0,0,-1));
    const hits=raycaster.intersectObject(g,true);
    assert.ok(hits.length,`no front hit at x=${x}, y=${y}`);
    assert.equal(hits[0].object.material.map,front,`front fabric was occluded at x=${x}, y=${y}`);
  }
});
test('circular tray diagonal bamboo strips retain substantial projected width',()=>{
  const g=build('boji');g.updateMatrixWorld(true);
  const strips=[];g.traverse(o=>{if(o.isMesh&&o.name.startsWith('open diagonal bamboo strips'))strips.push(o);});
  assert.equal(strips.length,2);
  let projectedArea=0;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),matrix=new T.Matrix4();
  for(const mesh of strips){
    const geometry=mesh.geometry,positions=geometry.attributes.position,index=geometry.index;
    const count=index?index.count:positions.count;matrix.copy(mesh.matrixWorld);
    for(let i=0;i<count;i+=3){
      const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
      a.fromBufferAttribute(positions,ia).applyMatrix4(matrix);
      b.fromBufferAttribute(positions,ib).applyMatrix4(matrix);
      c.fromBufferAttribute(positions,ic).applyMatrix4(matrix);
      projectedArea+=Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x))*0.5;
    }
  }
  assert.ok(projectedArea>3,`XZ projected triangle area is only ${projectedArea.toFixed(3)}`);
});
test('Guanxi enclosure and wall proportions match the documented low square form',()=>{
  const g=build('weiwu');const b=new T.Box3().setFromObject(g);const s=b.getSize(new T.Vector3());
  assert.ok(Math.abs(s.x/s.z-1)<0.05);assert.ok(g.userData.wallHeightRatio>0.08&&g.userData.wallHeightRatio<0.15);
  assert.ok(g.getObjectByName('east_wall_side_gate')&&g.getObjectByName('west_wall_side_gate'));
  assert.ok(g.getObjectByName('central_ancestral_hall_body'));
});
test('bowei keeps an open center instead of covering the hole with a photograph plane',()=>{
  const g=build('bowei');g.updateMatrixWorld(true);
  const ray=new T.Raycaster(new T.Vector3(0,2,0),new T.Vector3(0,-1,0));
  assert.equal(ray.intersectObject(g,true).length,0);
});
test('blue dye samples switch actual photograph textures',()=>{
  const one=build('landye').getObjectByName('photo_rectified_indigo_fabric').material.map;
  W.PlaceModels.setIndigoPattern('rays');
  const two=build('landye').getObjectByName('photo_rectified_indigo_fabric').material.map;
  assert.notEqual(one,two);
});

test('shirt and bag retain curved fabric on the back and real depth without backing plates',()=>{
 for(const [id,map,minDepth,y] of [['dajinshan',textures.dajinshanBody,0.4,1],['zisundai',textures.zisundaiFront,0.3,0.7]]){
  const g=build(id);g.updateMatrixWorld(true);const hits=[];
  for(const sign of [-1,1]){
   const ray=new T.Raycaster(new T.Vector3(0.1,y,sign*3),new T.Vector3(0,0,-sign));
   const first=ray.intersectObject(g,true)[0];assert.ok(first,id+' has an exposed back and front');assert.equal(first.object.material.map,map);hits.push(first.point.z);
  }
  assert.ok(Math.abs(hits[0]-hits[1])>minDepth,id+' is a volume rather than a photo plane');
  g.traverse(o=>{if(o.isMesh)assert.notEqual(o.geometry.type,'BoxGeometry',id+' must not use a rectangular backing');});
 }
});
test('shirt collar and bag mouth are open, and hat has visible inside fabric',()=>{
 const shirt=build('dajinshan');shirt.updateMatrixWorld(true);
 const ray=new T.Raycaster(new T.Vector3(0,3,0),new T.Vector3(0,-1,0));
 assert.equal(ray.intersectObject(shirt,true).length,0,'no solid cap across the collar or hem');
 const bag=build('zisundai');bag.updateMatrixWorld(true);
 const hit=ray.intersectObject(bag,true)[0];assert.ok(!hit||hit.point.y<0.2,'bag mouth must not be capped by a board');
 const hat=build('hutoumao');hat.updateMatrixWorld(true);
 ray.set(new T.Vector3(0,-0.2,0),new T.Vector3(0,1,0));assert.equal(ray.intersectObject(hat,true)[0]?.object.name,'帽内衬');
});
test('bowei has cloth thickness and a curved surface; blue dye fabric has an actual reverse',()=>{
 const g=build('bowei'),surface=g.getObjectByName('四分之一照片布片-1'),back=g.getObjectByName('脖围曲面底衬');
 assert.ok(back);const p=surface.geometry.attributes.position;let low=Infinity,high=-Infinity;
 for(let i=0;i<p.count;i++){low=Math.min(low,p.getY(i));high=Math.max(high,p.getY(i));}assert.ok(high-low>0.1,'cloth should drape around the center opening');
 assert.ok(build('landye').getObjectByName('indigo_fabric_reverse'));
});
test('paper tree canopy has longitudinal branches and blossoms facing several directions',()=>{
 const g=build('zhiyi'),canopy=g.getObjectByName('asymmetric flowering crown');
 const bounds=new T.Box3().setFromObject(canopy),size=bounds.getSize(new T.Vector3());assert.ok(size.z>0.8,'canopy is still confined to one flat plane');
 const petals=canopy.getObjectByName('orange paper blossom petals'),matrix=new T.Matrix4(),normal=new T.Vector3();let front=0,rear=0;
 for(let i=0;i<petals.count;i++){petals.getMatrixAt(i,matrix);normal.set(0,0,1).transformDirection(matrix);if(normal.z>0.25)front++;if(normal.z<-.25)rear++;}
 assert.ok(front>20&&rear>20,'paper flowers must face forward and backward');
});
