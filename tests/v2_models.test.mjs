import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scene=fs.readFileSync(new URL('../js/showcase3d.js',import.meta.url),'utf8');
const texture=fs.readFileSync(new URL('../js/textures.js',import.meta.url),'utf8');

test('all seven 3D exhibit entries still dispatch to a builder',()=>{
  const ids=[...scene.matchAll(/\{ id: '([^']+)'/g)].map(x=>x[1]).slice(0,7);
  assert.deepEqual(ids,['hutoumao','weiwu','landye','liangmao','boji','zhidai','mijiutan']);
  for(const id of ids) assert.match(scene,new RegExp("case ['\\\"]"+id+"['\\\"]:"));
});

test('Guanxi model keeps rectangular Hakka structure and ground contact',()=>{
  const start=scene.indexOf('function buildGuanxiWeiwu()');
  const end=scene.indexOf('function buildLandye()',start);
  const model=scene.slice(start,end);
  for(const feature of ['pebble_rubble_foundation','two_gates','watchtower_','three_courts','ancestral_hall','defensive_slit_windows','overlapping_qingwa_courses']) assert.ok(model.includes(feature),feature);
  // 这一轮按实地形制补的构件：收分墙、墙顶垛口与走马廊、角楼两层歇山、檐廊列柱
  for(const feature of ['parapet_crenellations','wall_walk_paving','lower_hip_skirt','covered_corridor_columns','gate_door_studs','gate_drum_piers']) assert.ok(model.includes(feature),feature);
  assert.match(model,/g\.position\.y\s*=\s*-1\.15/);
  assert.match(scene,/ground\.position\.y\s*=\s*-1\.15/);
  assert.match(model,/new THREE\.InstancedMesh/);
  assert.match(model,/qingBrick/);
  // 瓦与夯土走程序化贴图：那两张 PNG 偏黑，直接乘色会把屋顶糊成炭黑
  assert.match(model,/canvasTex\('qingwaRoof',/);
  assert.match(model,/canvasTex\('rammedLoam',/);
});

test('Dongtoupa belt carries white core, colored selvedges, drape and tied fringe',()=>{
  const start=scene.indexOf('function buildDongtoupaBelt()');
  const end=scene.indexOf('function buildMijiutan()',start);
  const model=scene.slice(start,end);
  for(const feature of ['left_woven_ribbon','right_woven_ribbon','continuous_silk_warp_fibres','black_selvedge','hand_tied_knot','silk_fringe_threads','left_yada_plain_twist','black_cotton_headband']) assert.ok(model.includes(feature),feature);
  assert.match(model,/g\.position\.y\s*=\s*-1\.15/);
  // 架线顺序照资料：黑2 绿2 蓝2 红5，白 11 居中，再镜像回去。顺序或根数被改动就得重新对资料。
  const warpSeq=[...texture.matchAll(/\['(#[0-9a-f]{6})',(\d+)\]/g)].map(m=>m[1]+':'+m[2]).slice(0,9);
  assert.deepEqual(warpSeq,['#151619:2','#2c6d4a:2','#2a5f96:2','#b5272c:5','#f0e8d7:11','#b5272c:5','#2a5f96:2','#2c6d4a:2','#151619:2'],'织带架线顺序与资料不符');
  assert.match(texture,/function wovenBelt\(\)/);
  // 经线细丝与贴图共用同一份架线顺序，改一处漏另一处时这里会红
  assert.match(model,/var lanes=\[\],wq=\[\['#151619',2\],\['#2c6d4a',2\],\['#2a5f96',2\],\['#b5272c',5\],\['#f0e8d7',11\]/);
});

test('renderer reports current WebGL work and viewport tracks actual container height',()=>{
  assert.match(scene,/debugRendererStats: function\s*\(\)[\s\S]*?calls:[^,]+, triangles:[^,]+,[\s\S]*?geometries:[^,]+, textures:/);
  assert.match(scene,/container\.clientHeight\s*\|\|\s*300/);
  assert.match(scene,/new ResizeObserver/);
  // 画布越方水平视野越窄：默认取景按画布宽高比自动拉远，否则手机上围屋左右出框
  assert.match(scene,/var aspect = vw \/ vh, back = 1\.28/);
});
