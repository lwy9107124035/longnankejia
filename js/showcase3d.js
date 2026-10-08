/**
 * 3D 非遗展品：原图纹样、实物轮廓与交互查看
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
  var SEAT_CACHE = {}, defaultZoom = 4.5, userPaused = false;
  var booted = false, booting = null, pendingShow = null, activeId = 'landye';
  var ITEMS = [
    {id:'landye',name:'蓝染样布',subtitle:'双环与放射纹',icon:'🔵',angle:0.15,desc:'双环与放射两种纹样均提取自同一张实物近照，经透视校正映射到布面；保留靛蓝晕染、留白、折痕与锁边。'},
    {id:'zhidai',name:'客家织带',subtitle:'彩色挑花与带穗',icon:'🧵',angle:0.18,desc:'依据桌面上独立长织带的照片还原窄长轮廓、彩色边线、挑花纹样与末端穗线，可放大查看原图纹样。'},
    {id:'dongtoupa',name:'冬头帕',subtitle:'红底条纹首服',icon:'🧣',angle:0.20,desc:'对应展柜中的矩形冬头帕，保留红底、中央密排竖条与浅色边沿。与独立织带分别展示。'},
    {id:'dajinshan',name:'大襟衫',subtitle:'靛蓝布衫',icon:'👘',angle:0.15,desc:'按实物衣衫的宽袖、立领、右侧大襟与袖口色带构建，补充布面起伏和衣缘。模型比例由照片估计。'},
    {id:'zhiji',name:'传统织机',subtitle:'木架与经纬纱',icon:'🪵',angle:0.36,desc:'依据织机实物照片还原木架、横梁、踏板、坐凳、纱线和蓝色布面，展示构件关系。'},
    {id:'zisundai',name:'子孙袋',subtitle:'拼布与绣面',icon:'🪡',angle:0.18,desc:'按参考照片的袋身比例、蓝色侧片、红色上下边和中央绣面制作，绣面取自实物照片。'},
    {id:'boji',name:'竹编圆筛',subtitle:'细篾交织与圈口',icon:'🧺',angle:0.85,desc:'参照大圆竹器与浅口竹盘照片重做细密篾条、浅边与圈口。器物名称用于展示分类，具体用途以馆方说明为准。'},
    {id:'liangmao',name:'竹编斗笠',subtitle:'锥形开放编织',icon:'👒',angle:0.40,desc:'对应墙面悬挂的锥形竹编帽，以开放篾网、锥顶与圈口表达照片形制。'},
    {id:'bowei',name:'脖围',subtitle:'四瓣绣花围领',icon:'🌸',angle:0.55,desc:'依据四分花绣脖围照片重做外缘、中心圆孔、黑色分隔与白底花绣，中心孔贯通。'},
    {id:'zhiyi',name:'客家纸艺',subtitle:'橙花盆景',icon:'🌼',angle:0.23,desc:'依据纸艺盆景多角度照片构建弯曲树干、分枝、橙色花簇与多边盆，花朵分布按照片概括。'},
    {id:'hutoumao',name:'花帽',subtitle:'红金绣檐与金色饰件',icon:'🌺',angle:0.08,desc:'以223号实物照片为主，还原红金绣檐、七尊人物饰件、花形饰片与侧垂链；另参考224号照片的红布与外扩下摆。绣檐贴合帽体，后披以软布褶皱垂落；背面与内衬按结构补全。'},
    {id:'weiwu',name:'关西新围',subtitle:'客家围屋',icon:'🏯',angle:0.65,desc:'参照官方实景与形制介绍，修正长墙与炮楼比例，补充瓦面、围内厅堂和天井，采用东西侧门与连续墙顶。内部开间按对称布局表达，尚无测绘尺寸。'}
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
    return new Promise(function (resolve, reject) {
      if (!THREE) { resolve(); return; }
      var loader = new THREE.TextureLoader();
      var files = Object.assign({stonePaving:'assets/textures/stone-paving.png'},
        window.TextileModels.textures, window.CraftModels.textures, window.PlaceModels.textures);
      var loaded = 0, total = Object.keys(files).length;
      function done() { loaded++; if (loaded >= total) resolve(); }
      Object.keys(files).forEach(function (key) {
        loader.load(files[key], function (tex) {
          tex.wrapS = tex.wrapT = key === 'stonePaving' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
          if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
          textures[key] = tex;
          tex.anisotropy = Math.min(8, renderer ? renderer.capabilities.getMaxAnisotropy() : 4);
          done();
        }, undefined, function () { reject(new Error('无法加载实物纹样：' + files[key])); });
      });
    });
  }

  function canvasTex(gen, repeatX, repeatY) {
    var tex = new THREE.CanvasTexture(window.Textures[gen]());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    tex.repeat.set(repeatX || 1, repeatY || 1);
    tex.anisotropy = 4; generatedTextures.push(tex);
    return tex;
  }

  function initScene(container) {
    viewportContainer=container;
    var w = container.clientWidth || 360, h = container.clientHeight || 300;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeeeae3);
    scene.fog = new THREE.Fog(0xeeeae3, 18, 38);
    camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 50);
    camera.position.set(0, 0.4, zoom);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf6f5f0, 0x6a6258, 0.45));
    var main = new THREE.DirectionalLight(0xfffaf2, 1.05);
    main.position.set(-3, 7, 5);
    main.castShadow = true;
    main.shadow.mapSize.set(2048, 2048);
    main.shadow.camera.left=main.shadow.camera.bottom=-4;
    main.shadow.camera.right=main.shadow.camera.top=4;
    main.shadow.camera.near=0.5;main.shadow.camera.far=20;
    main.shadow.normalBias=0.006;main.shadow.bias=-0.00008;main.shadow.radius=8;
    scene.add(main);
    var fill = new THREE.DirectionalLight(0xe7edf5, 0.18);
    fill.position.set(-3, 2, -2);
    scene.add(fill);
    var bounce = new THREE.DirectionalLight(0xf3ede1, 0.28);
    bounce.position.set(2, 4, -4);
    scene.add(bounce);

    var env=new THREE.CanvasTexture(window.Textures.studioEnvironment());env.encoding=THREE.sRGBEncoding;
    var pmrem=new THREE.PMREMGenerator(renderer);
    scene.environment=pmrem.fromEquirectangular(env).texture;env.dispose();pmrem.dispose();
    prepareSurfaceMaps();
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0xe6e1d8, roughness: 1, envMapIntensity:0.1 }));
    ground.material.color.convertSRGBToLinear();
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

  var surfaceMaps={};
  var photoReliefs=new Map();
  var surfaceProfiles={fabric:[5,0.0018,0.97,0.12],wood:[1.5,0.005,0.79,0.28],bamboo:[2,0.002,0.86,0.22],paper:[3,0.0015,0.98,0.08],mineral:[3,0.008,1,0.1],ceramic:[2,0.002,0.67,0.42]};
  function prepareSurfaceMaps(){
    Object.keys(surfaceProfiles).forEach(function(kind){
      var canvases=window.Textures.surfaceDetail(kind),maps={};
      Object.keys(canvases).forEach(function(channel){
        var tex=new THREE.CanvasTexture(canvases[channel]);
        tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
        if(channel==='color')tex.encoding=THREE.sRGBEncoding;
        tex.repeat.set(surfaceProfiles[kind][0],surfaceProfiles[kind][0]);maps[channel]=tex;
      });
      surfaceMaps[kind]=maps;
    });
  }
  function finishSurface(material){
    var kind=material.userData.surface,profile=surfaceProfiles[kind],maps=surfaceMaps[kind];
    if(!profile)return;
    if(!material.map)material.map=maps.color;
    material.bumpMap=maps.height;material.bumpScale=profile[1];material.roughnessMap=maps.roughness;
    material.roughness=profile[2];material.envMapIntensity=profile[3];
    if(kind==='fabric'&&material.map.image instanceof HTMLImageElement){
      if(!photoReliefs.has(material.map)){
        var source=material.map.image,canvas=document.createElement('canvas');
        var scale=Math.min(1,1024/Math.max(source.naturalWidth,source.naturalHeight));
        canvas.width=Math.max(1,Math.round(source.naturalWidth*scale));canvas.height=Math.max(1,Math.round(source.naturalHeight*scale));
        var ctx=canvas.getContext('2d');ctx.drawImage(source,0,0,canvas.width,canvas.height);
        var pixels=ctx.getImageData(0,0,canvas.width,canvas.height),luma=new Float32Array(canvas.width*canvas.height);
        for(var p=0;p<luma.length;p++)luma[p]=pixels.data[p*4]*0.2126+pixels.data[p*4+1]*0.7152+pixels.data[p*4+2]*0.0722;
        for(var y=0;y<canvas.height;y++)for(var x=0;x<canvas.width;x++){
          var i=y*canvas.width+x,blur=(luma[y*canvas.width+Math.max(0,x-3)]+luma[y*canvas.width+Math.min(canvas.width-1,x+3)]+luma[Math.max(0,y-3)*canvas.width+x]+luma[Math.min(canvas.height-1,y+3)*canvas.width+x])/4;
          var value=128+(luma[i]-blur)*0.65;
          pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=value;pixels.data[i*4+3]=255;
        }
        ctx.putImageData(pixels,0,0);var relief=new THREE.CanvasTexture(canvas);relief.anisotropy=material.map.anisotropy;
        photoReliefs.set(material.map,relief);
      }
      material.bumpMap=photoReliefs.get(material.map);material.bumpScale=0.007;
    }
  }
  function addSurfaceUVs(geometry,material){
    var surface=material.userData.surface;
    if(geometry.attributes.uv&&(surface!=='wood'||material.map?.image instanceof HTMLImageElement))return;
    var p=geometry.attributes.position,n=geometry.attributes.normal,uv=[];
    geometry.computeBoundingBox();var size=new THREE.Vector3();geometry.boundingBox.getSize(size);
    for(var i=0;i<p.count;i++){
      var x=p.getX(i),y=p.getY(i),z=p.getZ(i),nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));
      var axes=ny>nx&&ny>nz?[0,2]:nx>nz?[2,1]:[0,1],coordinates=[x,y,z];
      if(surface==='wood'){
        if(size.getComponent(axes[0])>size.getComponent(axes[1]))axes.reverse();
        uv.push(coordinates[axes[0]]*3,coordinates[axes[1]]);
      }else uv.push(coordinates[axes[0]],coordinates[axes[1]]);
    }
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  }

  function resizeViewport() {
    if(!renderer||!camera||!viewportContainer)return;
    var w=viewportContainer.clientWidth,h=viewportContainer.clientHeight;
    // Hidden tabs report 0×0; preserve the last valid camera until they become visible.
    if(!w||!h)return;
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
    if (booted) fitCurrentModel();
  }

  function fitCurrentModel() {
    var seat = SEAT_CACHE[activeId];
    if (!seat) return;
    var lo=seat.lo,hi=seat.hi;
    var radial=Math.hypot(hi.x-lo.x,hi.z-lo.z)/2,halfHeight=(hi.y-lo.y)/2;
    var vertical=camera.fov*Math.PI/360, horizontal=Math.atan(Math.tan(vertical)*camera.aspect);
    var angle=Math.abs(ITEMS.find(function(item){return item.id===activeId;}).angle);
    var elevation=halfHeight*Math.cos(angle)+radial*Math.sin(angle),depth=halfHeight*Math.sin(angle)+radial*Math.cos(angle);
    defaultZoom=(Math.max(radial/Math.tan(horizontal),elevation/Math.tan(vertical))+depth)*1.10;
    targetZoom=defaultZoom;
  }

  function bindControls(canvas) {
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    function stopAuto() {
      autoRotate = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { autoRotate = !userPaused; }, 6000);
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
        targetRotX = Math.max(-0.45, Math.min(1.3, targetRotX + dy * 0.006));
      }
      prevMouse.x = e.clientX;
      prevMouse.y = e.clientY;
    });
    window.addEventListener('mouseup', function () { isDragging = false; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      stopAuto();
      targetZoom = Math.max(defaultZoom*0.35, Math.min(defaultZoom*2.5, targetZoom + e.deltaY * defaultZoom * 0.0007));
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
        targetRotX = Math.max(-0.45, Math.min(1.3, targetRotX + dy * 0.006));
        prevMouse.x = e.touches[0].clientX;
        prevMouse.y = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var nd = Math.hypot(dx, dy);
        var nmx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var nmy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (pinchDist > 0) targetZoom = Math.max(defaultZoom*0.35, Math.min(defaultZoom*2.5, targetZoom * pinchDist / Math.max(1, nd)));
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
    if (!ITEMS.some(function(it) { return it.id === id; })) return;
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
    var spec = ITEMS.find(function(it) { return it.id === id; });
    if (!spec) return;
    currentModel = window.TextileModels.build(id, THREE, textures)
      || window.CraftModels.build(id, THREE, textures)
      || window.PlaceModels.build(id, THREE, textures, canvasTex);
    if (!currentModel) throw new Error('模型构建失败：' + spec.name);
    var materials = new Set();
    currentModel.traverse(function(object) {
      if (!object.material) return;
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(function(material) {
        if (object.isMesh) addSurfaceUVs(object.geometry,material);
        if (materials.has(material)) return;
        materials.add(material);
        if (material.color) material.color.convertSRGBToLinear();
        finishSurface(material);
      });
      if (object.isMesh) { object.castShadow=true; object.receiveShadow=true; }
    });
    activeId = id;
    scene.add(currentModel); currentModel.updateMatrixWorld(true);
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
    currentModel.position.x -= (lo2.x + hi2.x) / 2;
    currentModel.position.z -= (lo2.z + hi2.z) / 2;
    currentModel.position.y += -1.15 - lo2.y;
    currentModel.updateMatrixWorld(true);
    cameraFocusY = -1.15 + (hi2.y - lo2.y) / 2;
    rotX = targetRotX = spec.angle;
    targetRotY = rotY + shortestTurnTo(rotY, 0.4);
    panX = targetPanX = 0; panY = targetPanY = 0;
    fitCurrentModel();
    zoom = defaultZoom;
    updateItemInfo(spec);

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
    if (autoRotate && !userPaused && !isDragging) targetRotY += 0.003;
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

  function updateItemInfo(item) {
    document.getElementById('c3dName').textContent=item.name+' · '+item.subtitle;
    document.getElementById('c3dDesc').textContent=item.desc;
    document.querySelectorAll('#c3dList .c3d-item').forEach(function(button){
      var active=button.dataset.id===item.id;
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    });
    document.getElementById('c3dPatterns').hidden=item.id!=='landye';
    var details=document.getElementById('c3dReferences');
    details.querySelector('summary').textContent='实物参考 · '+(window.ModelReferences[item.id]||[]).length+' 项';
    if(details.open) renderReferences(item.id);
  }

  function renderReferences(id) {
    var container=document.getElementById('c3dReferenceList');container.replaceChildren();
    (window.ModelReferences[id]||[]).forEach(function(ref){
      if(ref.url){
        var link=document.createElement('a');link.href=ref.url;link.target='_blank';link.rel='noopener noreferrer';
        link.className='c3d-source-link';link.textContent=ref.label;container.appendChild(link);return;
      }
      var card=document.createElement('button');card.type='button';card.className='c3d-reference';
      card.setAttribute('aria-label','查看'+ref.label);
      if(ref.video){var icon=document.createElement('span');icon.className='c3d-video-icon';icon.textContent='▶';card.appendChild(icon);}
      else{var img=document.createElement('img');img.src=ref.src;img.alt=ref.label;img.loading='lazy';card.appendChild(img);}
      var label=document.createElement('span');label.textContent=ref.label;card.appendChild(label);
      card.addEventListener('click',function(){
        var dialog=document.getElementById('c3dReferenceDialog'),body=document.getElementById('c3dReferenceBody');
        body.replaceChildren();document.getElementById('c3dReferenceTitle').textContent=ref.label;
        var media=document.createElement(ref.video?'video':'img');media.src=ref.src;
        if(ref.video){media.controls=true;media.playsInline=true;media.preload='metadata';}
        else media.alt=ref.label;
        body.appendChild(media);dialog.showModal();
      });container.appendChild(card);
    });
  }

  function bindToolbar() {
    document.getElementById('c3dReferences').addEventListener('toggle',function(){if(this.open)renderReferences(activeId);});
    var dialog=document.getElementById('c3dReferenceDialog');
    function clearReferenceMedia() {
      var body=document.getElementById('c3dReferenceBody');
      body.querySelectorAll('video').forEach(function(video){video.pause();});
      body.replaceChildren();
    }
    document.getElementById('c3dReferenceClose').addEventListener('click',function(){clearReferenceMedia();dialog.close();});
    dialog.addEventListener('cancel',clearReferenceMedia);
    dialog.addEventListener('close',clearReferenceMedia);
    document.getElementById('c3dPause').addEventListener('click',function(){
      userPaused=!userPaused;autoRotate=!userPaused;clearTimeout(idleTimer);
      if(userPaused){targetRotX=rotX;targetRotY=rotY;}
      this.textContent=userPaused?'继续旋转':'暂停旋转';this.setAttribute('aria-pressed',String(userPaused));
    });
    document.getElementById('c3dReset').addEventListener('click',function(){
      if(!booted)return;
      rotX=targetRotX=ITEMS.find(function(item){return item.id===activeId;}).angle;
      rotY=targetRotY=0.4;
      panX=targetPanX=0;panY=targetPanY=0;
      fitCurrentModel();zoom=targetZoom;
    });
    ['c3dZoomIn','c3dZoomOut'].forEach(function(id){document.getElementById(id).addEventListener('click',function(){
      if(!booted)return;
      targetZoom=Math.max(defaultZoom*0.35,Math.min(defaultZoom*2.5,targetZoom*(id==='c3dZoomIn'?0.82:1.22)));
    });});
    document.querySelectorAll('[data-indigo-pattern]').forEach(function(button){button.addEventListener('click',function(){
      window.PlaceModels.setIndigoPattern(this.dataset.indigoPattern);
      document.querySelectorAll('[data-indigo-pattern]').forEach(function(b){b.setAttribute('aria-pressed',String(b===button));});
      if(booted&&activeId==='landye')showModel('landye');
    });});
  }

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
        show(id);
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
    bindToolbar();
    var first = list.querySelector('.c3d-item');
    if (first) first.classList.add('active');
    var item0 = ITEMS[0];
    updateItemInfo(item0);
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
    if (booted) { if (!animationId) animate(); resizeViewport(); return Promise.resolve(); }
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
        setProgress('构建 3D 场景…');
        initScene(viewport);
        showModel(ITEMS[0].id);
        if (viewport.clientWidth && viewport.clientHeight) animate();
        settled = true;
        clearTimeout(timer);
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
    if (!ITEMS.some(function(it) { return it.id === id; })) return;
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
    items: function () { return ITEMS.map(function (it) { return { id: it.id, name: it.name, subtitle: it.subtitle }; }); },
    debugState: function () {
      return { rotX: rotX, rotY: rotY, targetRotX: targetRotX, targetRotY: targetRotY,
        autoRotate: autoRotate, paused: userPaused, modelId: activeId, zoom: zoom, defaultZoom: defaultZoom };
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
