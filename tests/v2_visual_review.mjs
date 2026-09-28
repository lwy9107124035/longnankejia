/** Real Chrome renders for v2 review. Keeps screenshots and measured evidence. */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'.cache',process.argv.includes('--baseline')?'v2-before':'v2-review');
fs.mkdirSync(out,{recursive:true});
const port=9359;
const mapOnly=process.argv.includes('--map-only');
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new',`--remote-debugging-port=${port}`,'--no-first-run',
  '--no-default-browser-check','--enable-unsafe-swiftshader',
  '--user-data-dir='+path.join(root,'.cache','v2-review-profile-'+Date.now()),'about:blank'
],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try {
  for(let i=0;i<80;i++){
    try {if((await fetch(`http://127.0.0.1:${port}/json/version`)).ok)break;}catch{}
    await sleep(200);
  }
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let serial=0;const pending=new Map();const errors=[];
  ws.addEventListener('message',e=>{
    const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){
      const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);
      m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);
    }
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial;// 软件渲染下一次全顶点遍历就可能几十秒；30s 超时曾三次把没跑完的报告当成旧结论
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},90000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
  const ev=async(expression,awaitPromise=false)=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result?.value;
  };
  const shot=async(name,selector)=>{
    let clip;
    if(selector){clip=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()`);}
    const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,...(clip?{clip}:{})});
    fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));
  };
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8787/index.html#/'+(mapOnly?'hometown':'model3d')});
  if(!mapOnly)await ev(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.Showcase3D&&Showcase3D.booted()){clearInterval(t);resolve(true);}else if(++n>150){clearInterval(t);reject(new Error('3D boot failed'));}},200);})`,true);
  else await sleep(700);
  const report={models:[],errors,checks:[]};
  const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});if(!pass)process.exitCode=1;};
  const ids=mapOnly?[]:await ev('Showcase3D.items().map(x=>x.id)');
  for(const id of ids){
    await ev(`Showcase3D.show(${JSON.stringify(id)})`);await sleep(1600);
    // 七件全截：以前只截围屋与织带，另外五件没有任何可视证据，虎头帽那块戳在帽外的方形贴片和六件浮空才拖到现在
    // 不带 clip：带 clip 的截图路径会在 captureBeyondViewport 触发容器 resize 之后取图，
    // WebGL 画布已被 setSize 清空，七张 3D 图全成 3KB 空白；整页截图才有内容。
    await shot('desktop-'+id);
    const measurement=await ev(`(()=>{
      const g=Showcase3D.debugModel();let meshes=0,drawUnits=0,triangles=0;
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,finite=true;
      const camera=Showcase3D.debugCamera();g.updateMatrixWorld(true);camera.updateMatrixWorld(true);
      g.traverse(o=>{if(!o.isMesh)return;meshes++;drawUnits+=Array.isArray(o.material)?o.material.length:1;
        triangles+=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);
        const vertex=new THREE.Vector3(),matrix=new THREE.Matrix4();
        for(let k=0;k<(o.isInstancedMesh?o.count:1);k++){
          if(o.isInstancedMesh){o.getMatrixAt(k,matrix);matrix.premultiply(o.matrixWorld);}else matrix.copy(o.matrixWorld);
          for(let v=0;v<o.geometry.attributes.position.count;v++){
            vertex.fromBufferAttribute(o.geometry.attributes.position,v).applyMatrix4(matrix).project(camera);
            finite=finite&&Number.isFinite(vertex.x)&&Number.isFinite(vertex.y);
            minX=Math.min(minX,vertex.x);maxX=Math.max(maxX,vertex.x);minY=Math.min(minY,vertex.y);maxY=Math.max(maxY,vertex.y);
          }
        }
      });
      // 外轮廓按未旋转的局部包围盒量：收分系数乘错到墙长上时，东西墙会戳出围合之外
      const cam=camera.position, bbAll=new THREE.Box3().setFromObject(g);
      let tLo=1e9,tHi=-1e9;{const mm=new THREE.Matrix4(),vv=new THREE.Vector3();g.traverse((o)=>{if(!o.isMesh||!o.geometry||!o.geometry.attributes.position)return;const ps=o.geometry.attributes.position,nn=o.isInstancedMesh?o.count:1;for(let k=0;k<nn;k++){if(o.isInstancedMesh){o.getMatrixAt(k,mm);mm.premultiply(o.matrixWorld);}else mm.copy(o.matrixWorld);for(let i=0;i<ps.count;i++){vv.fromBufferAttribute(ps,i).applyMatrix4(mm);if(vv.y<tLo)tLo=vv.y;if(vv.y>tHi)tHi=vv.y;}}});}
      const seat={groupY:+g.position.y.toFixed(3), camY:+cam.y.toFixed(3), camZ:+cam.z.toFixed(3), trueMinY:+tLo.toFixed(3), trueMaxY:+tHi.toFixed(3)};
      const r0=g.rotation.y;g.rotation.y=0;g.updateMatrixWorld(true);
      const fb=new THREE.Box3().setFromObject(g);
      const footprint={x:+(fb.max.x-fb.min.x).toFixed(2),z:+(fb.max.z-fb.min.z).toFixed(2)};
      g.rotation.y=r0;g.updateMatrixWorld(true);
      return {id:${JSON.stringify(id)},meshes,drawUnits,triangles,finite,seat,footprint,extent:{minX,maxX,minY,maxY},stats:Showcase3D.debugRendererStats?.(),metadata:g.userData};
    })()`);
    report.models.push(measurement);
    check(id+' 的所有实际顶点与实例矩阵有效',measurement.finite);
    check(id+' 的实际绘制预算',measurement.stats?.calls<300&&measurement.triangles<200000,measurement.stats);
    check(id+' 默认视图完整',Object.values(measurement.extent).every(n=>Math.abs(n)<0.98),measurement.extent);
    // 必须真被画出来：逐顶点量的是场景图，模型忘了 scene.add 时它照样"完整"。
    // 上一次就是这个原因，七张截图全空白而断言全绿（那一帧只画了地面圆盘的 32 个三角面）。
    check(id+' 确实提交给渲染器绘制',measurement.stats?.calls>=Math.max(2,Math.floor(measurement.meshes*0.5)),{calls:measurement.stats?.calls,meshes:measurement.meshes});
    if(id==='weiwu'){
      // 外轮廓含角楼与檐口挑出，实地长宽比约 1.13:1；墙长被乘上收分系数时进深会冲到 5.5 以上
      const fp=measurement.footprint||{}, ratio=fp.x/fp.z;
      check('weiwu 仍是长方形围合（外轮廓 1.1~1.9:1，进深 3.0~4.3）', ratio>1.1&&ratio<1.9&&fp.z>3.0&&fp.z<4.3, fp);
    }
  }
  for(const id of (mapOnly?[]:['weiwu','zhidai'])){
    await ev(`Showcase3D.show('${id}')`);await sleep(1500);
    const rect=await ev(`(()=>{const r=document.querySelector('#c3dViewport canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    // Use the real controls; the model must respond without changing its internals.
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+Math.PI/0.008,y:rect.y,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+Math.PI/0.008,y:rect.y,button:'left',buttons:0,clickCount:1});
    await sleep(1200);await shot('desktop-'+id+'-reverse');
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.x,y:rect.y,deltaX:0,deltaY:-220});
    await sleep(1000);await shot('desktop-'+id+'-close');
  }
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  await send('Page.reload');await sleep(3500);
  for(const id of (mapOnly?[]:['weiwu','zhidai'])){
    await ev(`Showcase3D.show('${id}')`);await sleep(1400);await shot('mobile-'+id);
    if(!process.argv.includes('--baseline')){
      const framing=await ev(`(()=>{const g=Showcase3D.debugModel(),c=Showcase3D.debugCamera();g.updateMatrixWorld(true);let max=0;g.traverse(o=>{if(!o.isMesh)return;const m=new THREE.Matrix4(),v=new THREE.Vector3();for(let k=0;k<(o.isInstancedMesh?o.count:1);k++){if(o.isInstancedMesh){o.getMatrixAt(k,m);m.premultiply(o.matrixWorld);}else m.copy(o.matrixWorld);for(let j=0;j<o.geometry.attributes.position.count;j++){v.fromBufferAttribute(o.geometry.attributes.position,j).applyMatrix4(m).project(c);max=Math.max(max,Math.abs(v.x),Math.abs(v.y));}}});return max;})()`);
      check(id+' 手机默认视图完整',framing<0.98,framing);
    }
  }
  await ev(`location.hash='#/hometown'`);await sleep(800);
  await shot('mobile-map');
  report.mobile=await ev(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,mapWidth:document.querySelector('.hm-svg')?.getBoundingClientRect().width})`);
  if(!process.argv.includes('--baseline')){
    await ev(`document.querySelector('.hm-svg').scrollIntoView({block:'center'})`);await sleep(400);
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const spot=await ev(`(()=>{const i=Hometown.places().findIndex(x=>x.name==='九连山镇');const r=document.querySelector('.hm-place[data-i="'+i+'"] .hm-dot').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const touch=async(type,points)=>send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({x:p.x,y:p.y,id:p.id??i+1,radiusX:3,radiusY:3,force:1}))});
    await touch('touchStart',[spot]);await touch('touchEnd',[]);await sleep(600);
    check('真实触屏点击标记选中九连山镇',await ev(`document.querySelector('.hm-name')?.textContent==='九连山镇'`));
    await ev(`document.querySelector('[data-map-action="in"]').click()`);
    const zoomed=await ev(`document.querySelector('.hm-world').getAttribute('transform')`);
    check('放大按钮更新实际地图',zoomed.includes('1.250'),zoomed);
    const map=await ev(`(()=>{const r=document.querySelector('.hm-svg').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const beforeDrag=await ev(`document.querySelector('.hm-name').textContent`);
    await touch('touchStart',[map]);await touch('touchMove',[{x:map.x+35,y:map.y+25}]);await touch('touchEnd',[]);await sleep(600);
    const dragged=await ev(`document.querySelector('.hm-world').getAttribute('transform')`);
    check('真实触屏拖动平移地图',dragged!==zoomed,dragged);
    check('拖动没有误选地点',await ev(`document.querySelector('.hm-name').textContent`)===beforeDrag);
    await touch('touchStart',[{x:map.x-25,y:map.y,id:1},{x:map.x+25,y:map.y,id:2}]);
    await touch('touchMove',[{x:map.x-45,y:map.y,id:1},{x:map.x+45,y:map.y,id:2}]);
    const pinched=await ev(`document.querySelector('.hm-world').getAttribute('transform')`);
    await touch('touchEnd',[]);await sleep(600);
    check('真实双指缩放更新地图',pinched!==dragged,pinched);
    check('双指缩放没有误选地点',await ev(`document.querySelector('.hm-name').textContent`)===beforeDrag);
    await shot('mobile-map-zoom');
    await ev(`document.querySelector('[data-map-action="reset"]').click()`);
    check('重置还原100%及平移',await ev(`document.querySelector('.hm-world').getAttribute('transform')`) === 'translate(0.00 0.00) scale(1.000)');
    await ev(`document.querySelector('[data-kind="site"]').click()`);
    check('文保点筛选匹配真实数据',await ev(`document.querySelectorAll('.hm-place:not(.is-filtered)').length===Hometown.places().filter(p=>p.kind==='site').length`));
    check('移动端地图按钮触控高度至少44px',await ev(`[...document.querySelectorAll('.hm-zoom button,.hm-filter button,.hm-place-link:not([hidden])')].every(e=>e.getBoundingClientRect().height>=44)`));
    await ev(`document.querySelector('[data-kind="all"]').click()`);
    await send('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});await sleep(300);
    check('320px无横向溢出',await ev(`document.documentElement.scrollWidth===innerWidth`));
    await send('Emulation.setTouchEmulationEnabled',{enabled:false});
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await sleep(600);await shot('desktop-map');
  if(!process.argv.includes('--baseline')&&!mapOnly){
    await ev(`localStorage.setItem('nfyj_api_config',JSON.stringify({mode:'rules'}));AnswerEngine.reset();location.hash='#/chat';`);await sleep(300);
    await ev(`App.ask('客家蓝染和其他地方蓝染对比，有何区别？')`);
    await ev(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(!document.querySelector('#sendBtn').disabled){clearInterval(t);resolve(true);}else if(++n>150){clearInterval(t);reject(new Error('Chat did not finish'));}},100);})`,true);
    check('回答出处在独立可点击区域显示',await ev(`(()=>{const b=[...document.querySelectorAll('.msg-bot .msg-bubble')].at(-1);return b.querySelectorAll('.msg-sources a').length>=2;})()`));
    check('出处链接没有进入回答正文',await ev(`(()=>{const b=[...document.querySelectorAll('.msg-bot .msg-bubble')].at(-1).cloneNode(true);b.querySelector('.msg-sources')?.remove();return !b.textContent.includes('https://');})()`));
    await ev(`[...document.querySelectorAll('.msg-sources')].at(-1).open=true`);
    await shot('desktop-blue-comparison');
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  console.log('Review screenshots: '+out);
  if(errors.length||report.mobile.scrollWidth>report.mobile.width)process.exitCode=1;
} finally {
  ws?.close();chrome.kill();
}
