/**
 * 程序化纹理生成器
 * ------------------------------------------------------------
 * 用 Canvas 2D 生成各种材质贴图（布料、刺绣、木纹等），
 * 作为 Three.js 材质的 map / roughnessMap / bumpMap 使用。
 */
(function () {
  'use strict';

  function createCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { canvas: c, ctx: c.getContext('2d') };
  }

  /* ---------- 红色织物纹理 ---------- */
  function redFabric() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    // 底色
    ctx.fillStyle = '#B8452A';
    ctx.fillRect(0, 0, 512, 512);

    // 布纹（细密经纬线）
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = 0.5;
    for (var i = 0; i < 512; i += 2) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }
    // 粗纹理
    ctx.strokeStyle = 'rgba(0,0,0,0.03)';
    ctx.lineWidth = 1;
    for (var j = 0; j < 512; j += 8) {
      ctx.beginPath(); ctx.moveTo(j, 0); ctx.lineTo(j, 512); ctx.stroke();
    }

    // 噪点（织物颗粒感）
    var imgData = ctx.getImageData(0, 0, 512, 512);
    var d = imgData.data;
    for (var p = 0; p < d.length; p += 4) {
      var n = (Math.random() - 0.5) * 16;
      d[p] += n; d[p + 1] += n; d[p + 2] += n;
    }
    ctx.putImageData(imgData, 0, 0);

    return t.canvas;
  }

  /* ---------- 虎脸刺绣纹理 ---------- */
  function tigerFaceTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    // 白色底（脸部）
    ctx.fillStyle = '#F5EDE0';
    ctx.fillRect(0, 0, 512, 512);

    // 织物纹理叠加
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 0.5;
    for (var i = 0; i < 512; i += 3) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
    }

    // 虎脸轮廓（粗黑线刺绣效果）
    ctx.strokeStyle = '#2A1A10';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    // 脸部轮廓
    ctx.beginPath();
    ctx.ellipse(256, 280, 180, 160, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 王字纹（额头）
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#2A1A10';
    // 横
    ctx.beginPath(); ctx.moveTo(196, 130); ctx.lineTo(316, 130); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(186, 165); ctx.lineTo(326, 165); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(196, 200); ctx.lineTo(316, 200); ctx.stroke();
    // 竖
    ctx.beginPath(); ctx.moveTo(256, 110); ctx.lineTo(256, 220); ctx.stroke();

    // 眼睛
    // 左眼白
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(190, 260, 42, 35, -0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2A1A10'; ctx.lineWidth = 3; ctx.stroke();
    // 左眼珠
    ctx.fillStyle = '#1A1008';
    ctx.beginPath(); ctx.ellipse(195, 262, 18, 20, 0, 0, Math.PI * 2); ctx.fill();
    // 左眼高光
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(200, 255, 6, 5, 0, 0, Math.PI * 2); ctx.fill();

    // 右眼白
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(322, 260, 42, 35, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2A1A10'; ctx.lineWidth = 3; ctx.stroke();
    // 右眼珠
    ctx.fillStyle = '#1A1008';
    ctx.beginPath(); ctx.ellipse(317, 262, 18, 20, 0, 0, Math.PI * 2); ctx.fill();
    // 右眼高光
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(322, 255, 6, 5, 0, 0, Math.PI * 2); ctx.fill();

    // 鼻子
    ctx.fillStyle = '#E8A0A0';
    ctx.beginPath();
    ctx.moveTo(256, 310);
    ctx.lineTo(236, 340);
    ctx.lineTo(276, 340);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2A1A10'; ctx.lineWidth = 2.5; ctx.stroke();

    // 嘴巴
    ctx.strokeStyle = '#2A1A10';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(256, 340);
    ctx.lineTo(256, 365);
    ctx.stroke();
    // 左嘴角
    ctx.beginPath();
    ctx.moveTo(256, 365);
    ctx.quadraticCurveTo(230, 385, 200, 370);
    ctx.stroke();
    // 右嘴角
    ctx.beginPath();
    ctx.moveTo(256, 365);
    ctx.quadraticCurveTo(282, 385, 312, 370);
    ctx.stroke();

    // 胡须（左右各三根）
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2A1A10';
    var whiskers = [
      [150, 330, 80, 310], [148, 350, 75, 350], [150, 370, 80, 390],
      [362, 330, 432, 310], [364, 350, 437, 350], [362, 370, 432, 390]
    ];
    whiskers.forEach(function (w) {
      ctx.beginPath();
      ctx.moveTo(w[0], w[1]);
      ctx.quadraticCurveTo((w[0] + w[2]) / 2, w[1] + (Math.random() - 0.5) * 10, w[2], w[3]);
      ctx.stroke();
    });

    // 腮红
    ctx.fillStyle = 'rgba(232, 160, 160, 0.35)';
    ctx.beginPath(); ctx.ellipse(155, 320, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(357, 320, 30, 18, 0, 0, Math.PI * 2); ctx.fill();

    // 额头花纹装饰（金色小花）
    ctx.fillStyle = '#D4A843';
    for (var f = 0; f < 5; f++) {
      var fx = 170 + f * 44;
      var fy = 95;
      // 花瓣
      for (var petal = 0; petal < 5; petal++) {
        var pa = (petal / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(pa) * 8, fy + Math.sin(pa) * 8, 5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#B8860B';
      ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#D4A843';
    }

    return t.canvas;
  }

  /* ---------- 蓝染布纹理 ---------- */
  function landyeTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    // 深蓝底色（渐变）
    var grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1A3A30');
    grad.addColorStop(0.5, '#2F5D50');
    grad.addColorStop(1, '#1E4538');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 扎染圆圈图案
    var circles = [
      { x: 128, y: 128, r: 60 }, { x: 384, y: 128, r: 45 },
      { x: 256, y: 256, r: 80 }, { x: 128, y: 384, r: 50 },
      { x: 384, y: 384, r: 55 }, { x: 64, y: 256, r: 35 },
      { x: 448, y: 256, r: 40 }
    ];
    circles.forEach(function (c) {
      // 外圈渐变（扎染扩散效果）
      for (var ring = 5; ring >= 0; ring--) {
        var alpha = 0.08 * (6 - ring);
        var radius = c.r + ring * 6;
        ctx.fillStyle = 'rgba(200, 220, 210, ' + alpha + ')';
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      // 中心白点
      ctx.fillStyle = 'rgba(230, 240, 235, 0.5)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    });

    // 蜡染裂纹效果
    ctx.strokeStyle = 'rgba(200, 220, 210, 0.12)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 30; i++) {
      ctx.beginPath();
      var sx = Math.random() * 512, sy = Math.random() * 512;
      ctx.moveTo(sx, sy);
      for (var seg = 0; seg < 5; seg++) {
        sx += (Math.random() - 0.5) * 80;
        sy += (Math.random() - 0.5) * 80;
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // 布纹
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    for (var w = 0; w < 512; w += 3) {
      ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(w, 512); ctx.stroke();
    }

    return t.canvas;
  }

  /* ---------- 土墙纹理（围屋） ---------- */
  function wallTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    ctx.fillStyle = '#C4A882';
    ctx.fillRect(0, 0, 512, 512);

    // 夯土层纹理
    for (var layer = 0; layer < 16; layer++) {
      var y = layer * 32;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.02 + Math.random() * 0.04) + ')';
      ctx.fillRect(0, y, 512, 32);
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }

    // 斑驳效果
    var imgData = ctx.getImageData(0, 0, 512, 512);
    var d = imgData.data;
    for (var p = 0; p < d.length; p += 4) {
      var n = (Math.random() - 0.5) * 20;
      d[p] += n; d[p + 1] += n * 0.8; d[p + 2] += n * 0.5;
    }
    ctx.putImageData(imgData, 0, 0);

    // 小石子
    for (var s = 0; s < 80; s++) {
      var sx = Math.random() * 512, sy = Math.random() * 512;
      var sr = 1 + Math.random() * 3;
      ctx.fillStyle = 'rgba(160, 140, 110, ' + (0.3 + Math.random() * 0.3) + ')';
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }

    return t.canvas;
  }

  /* ---------- 青砖：细砂灰砖与浅灰勾缝 ---------- */
  function qingBrick() {
    var t=createCanvas(512,512),ctx=t.ctx;
    ctx.fillStyle='#8b9291';ctx.fillRect(0,0,512,512);
    var bw=64,bh=30;
    for(var row=0;row<Math.ceil(512/bh);row++){
      var off=row%2?bw/2:0;
      for(var col=-1;col<9;col++){
        var x=col*bw+off,y=row*bh;
        var shade=12+Math.floor(Math.random()*22);
        ctx.fillStyle='rgb('+(122+shade)+','+(129+shade)+','+(130+shade)+')';
        ctx.fillRect(x+2,y+2,bw-4,bh-4);
        ctx.fillStyle='rgba(220,220,207,.15)';ctx.fillRect(x+5,y+4,bw-10,1);
        ctx.fillStyle='rgba(28,34,36,.17)';ctx.fillRect(x+4,y+bh-5,bw-8,2);
        for(var p=0;p<8;p++){
          ctx.fillStyle=Math.random()>.5?'rgba(219,216,199,.12)':'rgba(20,27,29,.10)';
          ctx.fillRect(x+Math.random()*(bw-8)+4,y+Math.random()*(bh-8)+4,1+Math.random()*4,1);
        }
      }
    }
    return t.canvas;
  }

  /* ---------- 小青瓦：中灰瓦垄、瓦头与苔痕 ---------- */
  function qingwaRoof() {
    var t=createCanvas(512,512),ctx=t.ctx;
    ctx.fillStyle='#8d9498';ctx.fillRect(0,0,512,512);
    var pan=32,course=26;
    for(var c=0;c<16;c++){
      var x=c*pan,grd=ctx.createLinearGradient(x,0,x+pan,0);
      grd.addColorStop(0,'#6d7478');grd.addColorStop(.5,'#9ba2a6');grd.addColorStop(1,'#6d7478');
      ctx.fillStyle=grd;ctx.fillRect(x,0,pan,512);
      ctx.fillStyle='rgba(38,44,46,.5)';ctx.fillRect(x,0,1.5,512);
    }
    for(var r=0;r<Math.ceil(512/course);r++){
      var y=r*course;
      ctx.fillStyle='rgba(36,42,44,.45)';ctx.fillRect(0,y+course-3,512,3);
      for(var c2=0;c2<16;c2++){
        ctx.fillStyle='#7b8286';ctx.beginPath();ctx.arc(c2*pan+pan/2,y+course-4,5.4,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='rgba(44,50,52,.55)';ctx.lineWidth=1;ctx.stroke();
      }
    }
    for(var i=0;i<280;i++){
      ctx.fillStyle='rgba(72,86,66,'+(0.04+Math.random()*0.07)+')';
      ctx.fillRect(Math.random()*512,Math.random()*512,2+Math.random()*10,1+Math.random()*3);
    }
    return t.canvas;
  }

  /* ---------- 三合土夯墙：暖黄土色、水平夯层、砂砾与流水痕 ---------- */
  function rammedLoam() {
    var t=createCanvas(512,512),ctx=t.ctx;
    ctx.fillStyle='#b4afa2';ctx.fillRect(0,0,512,512);
    for(var y=0;y<512;y+=42){
      ctx.fillStyle='rgba(92,88,77,.25)';ctx.fillRect(0,y,512,2.5);
      ctx.fillStyle='rgba(221,218,207,.20)';ctx.fillRect(0,y+3,512,2);
      for(var k=0;k<9;k++){
        ctx.fillStyle='rgba(93,90,80,.15)';ctx.beginPath();
        ctx.arc(Math.random()*512,y+10+Math.random()*24,3+Math.random()*3,0,Math.PI*2);ctx.fill();
      }
    }
    for(var i=0;i<900;i++){
      ctx.fillStyle=Math.random()>.5?'rgba(230,226,217,.35)':'rgba(89,86,77,.30)';
      ctx.fillRect(Math.random()*512,Math.random()*512,1+Math.random()*2,1+Math.random()*2);
    }
    for(var s=0;s<26;s++){ctx.fillStyle='rgba(223,217,204,.10)';ctx.fillRect(Math.random()*512,0,2+Math.random()*5,512);}
    return t.canvas;
  }

  /* ---------- 半月池水面：青灰底、横向水纹与浮萍 ---------- */
  function pondWater() {
    var t=createCanvas(512,512),ctx=t.ctx;
    ctx.fillStyle='#3b5a57';ctx.fillRect(0,0,512,512);
    for(var i=0;i<70;i++){
      ctx.strokeStyle='rgba(198,216,207,'+(0.05+Math.random()*0.10)+')';
      ctx.lineWidth=1+Math.random()*2.5;
      var y=Math.random()*512,amp=4+Math.random()*10;
      ctx.beginPath();ctx.moveTo(0,y);
      for(var x=0;x<=512;x+=16) ctx.lineTo(x,y+Math.sin(x/40+i)*amp*.3);
      ctx.stroke();
    }
    for(var k=0;k<24;k++){
      ctx.fillStyle='rgba(84,116,80,.32)';
      ctx.beginPath();ctx.arc(Math.random()*512,Math.random()*512,3+Math.random()*7,0,Math.PI*2);ctx.fill();
    }
    return t.canvas;
  }

  /* ---------- 禾坪卵石：不规则卵石铺地，中间拼铜钱纹与万字纹 ---------- */
  function cobbleCourt() {
    var t=createCanvas(512,512),ctx=t.ctx;
    ctx.fillStyle='#948d80';ctx.fillRect(0,0,512,512);
    for(var r=0;r<26;r++) for(var c=0;c<26;c++){
      var x=c*20+(r%2)*10+(Math.random()*4-2), y=r*20+(Math.random()*4-2);
      ctx.fillStyle='rgb('+(126+Math.floor(Math.random()*40))+','+(124+Math.floor(Math.random()*38))+','+(116+Math.floor(Math.random()*34))+')';
      ctx.beginPath();ctx.ellipse(x,y,7+Math.random()*3,5.5+Math.random()*3,Math.random()*Math.PI,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='rgba(78,68,54,.22)';ctx.beginPath();ctx.ellipse(x+1.5,y+1.8,7,5.2,Math.random()*Math.PI,0,Math.PI*2);ctx.fill();
    }
    // 资料：天井与门坪常用鹅卵石/砖块拼出铜钱纹、万字纹。拼花用深浅两色卵石走线。
    function pebbleLine(x0,y0,x1,y1,w){
      var n=Math.max(2,Math.round(Math.hypot(x1-x0,y1-y0)/8));
      for(var i=0;i<=n;i++){
        var px=x0+(x1-x0)*i/n, py=y0+(y1-y0)*i/n;
        ctx.fillStyle=i%2?'rgba(228,220,203,.85)':'rgba(72,66,56,.75)';
        ctx.beginPath();ctx.ellipse(px,py,w,w*.78,Math.atan2(y1-y0,x1-x0),0,Math.PI*2);ctx.fill();
      }
    }
    for(var cy=64;cy<512;cy+=128) for(var cx=64;cx<512;cx+=128){
      ctx.strokeStyle='rgba(228,220,203,.55)';ctx.lineWidth=7;
      ctx.beginPath();ctx.arc(cx,cy,34,0,Math.PI*2);ctx.stroke();
      pebbleLine(cx-11,cy-11,cx+11,cy-11,5);pebbleLine(cx+11,cy-11,cx+11,cy+11,5);
      pebbleLine(cx+11,cy+11,cx-11,cy+11,5);pebbleLine(cx-11,cy+11,cx-11,cy-11,5);
    }
    // 铜钱纹之间夹一组万字纹，两种拼花错列
    for(var wy=128;wy<512;wy+=128) for(var wx=128;wx<512;wx+=128){
      var h=22;ctx.strokeStyle='rgba(60,55,47,.8)';ctx.lineWidth=6;ctx.beginPath();
      ctx.moveTo(wx,wy-h);ctx.lineTo(wx,wy+h);
      ctx.moveTo(wx-h,wy);ctx.lineTo(wx+h,wy);
      ctx.moveTo(wx,wy-h);ctx.lineTo(wx-h*.7,wy-h);
      ctx.moveTo(wx,wy+h);ctx.lineTo(wx+h*.7,wy+h);
      ctx.moveTo(wx-h,wy);ctx.lineTo(wx-h,wy+h*.7);
      ctx.moveTo(wx+h,wy);ctx.lineTo(wx+h,wy-h*.7);
      ctx.stroke();
    }
    return t.canvas;
  }

  /* ---------- 瓦片屋顶纹理 ---------- */
  function roofTexture() {
    var t = createCanvas(512, 512);
    var ctx = t.ctx;

    ctx.fillStyle = '#4A3828';
    ctx.fillRect(0, 0, 512, 512);

    // 瓦片（鱼鳞状排列）
    var tileW = 32, tileH = 20;
    for (var row = 0; row < 28; row++) {
      var offset = (row % 2) * tileW / 2;
      for (var col = -1; col < 18; col++) {
        var x = col * tileW + offset;
        var y = row * tileH;
        // 瓦片形状
        ctx.fillStyle = 'rgba(90, 70, 50, ' + (0.6 + Math.random() * 0.2) + ')';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + tileW / 2, y + tileH * 1.4, x + tileW, y);
        ctx.lineTo(x + tileW, y + tileH * 0.3);
        ctx.quadraticCurveTo(x + tileW / 2, y + tileH * 1.6, x, y + tileH * 0.3);
        ctx.closePath();
        ctx.fill();
        // 瓦片高光
        ctx.strokeStyle = 'rgba(120, 100, 70, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    return t.canvas;
  }

  /* ---------- 环境贴图（简易 HDR 模拟） ---------- */
  function envMap() {
    var t = createCanvas(256, 256);
    var ctx = t.ctx;

    // 天空渐变
    var skyGrad = ctx.createLinearGradient(0, 0, 0, 256);
    skyGrad.addColorStop(0, '#87CEEB');
    skyGrad.addColorStop(0.4, '#B0D4E8');
    skyGrad.addColorStop(0.5, '#D4C4A0');
    skyGrad.addColorStop(1, '#8B7355');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 256, 256);

    // 太阳光斑
    var sunGrad = ctx.createRadialGradient(200, 40, 0, 200, 40, 60);
    sunGrad.addColorStop(0, 'rgba(255,255,240,0.9)');
    sunGrad.addColorStop(0.3, 'rgba(255,250,220,0.3)');
    sunGrad.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(140, 0, 120, 100);

    return t.canvas;
  }

  /* ---------- 竹编：经纬交错的篾片 ---------- */
  function bambooWeave() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    ctx.fillStyle = '#B98A4E';
    ctx.fillRect(0, 0, 512, 512);
    var cell = 32;
    for (var y = 0; y < 512 / cell; y++) {
      for (var x = 0; x < 512 / cell; x++) {
        // 一压一挑：奇偶格决定谁在上面，露出的那截颜色略深形成阴影
        var over = (x + y) % 2 === 0;
        var gx = x * cell, gy = y * cell;
        if (over) {
          ctx.fillStyle = '#C79A5C';
          ctx.fillRect(gx, gy + 3, cell, cell - 6);
          ctx.strokeStyle = 'rgba(90,60,25,0.35)';
          ctx.beginPath(); ctx.moveTo(gx, gy + 3); ctx.lineTo(gx + cell, gy + 3);
          ctx.moveTo(gx, gy + cell - 3); ctx.lineTo(gx + cell, gy + cell - 3); ctx.stroke();
        } else {
          ctx.fillStyle = '#AE7F43';
          ctx.fillRect(gx + 3, gy, cell - 6, cell);
          ctx.strokeStyle = 'rgba(90,60,25,0.3)';
          ctx.beginPath(); ctx.moveTo(gx + 3, gy); ctx.lineTo(gx + 3, gy + cell);
          ctx.moveTo(gx + cell - 3, gy); ctx.lineTo(gx + cell - 3, gy + cell); ctx.stroke();
        }
      }
    }
    // 篾青的丝缕
    ctx.globalAlpha = 0.12;
    for (var i = 0; i < 900; i++) {
      ctx.strokeStyle = Math.random() > 0.5 ? '#8A5F2C' : '#E0BC86';
      var lx = Math.random() * 512, ly = Math.random() * 512, len = 6 + Math.random() * 16;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + len, ly + (Math.random() - 0.5) * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return s.canvas;
  }

  /* ---------- 客家织带：靛底上的菱形与锯齿纹 ---------- */
  function wovenBelt() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    // 资料记载的架线顺序：中间至少 11 根白线，两边依次红 5、蓝 2、绿 2、黑 2。
    // 一根经线一份宽度，色带比例按根数摊，不再凭感觉调色块宽窄。
    var seq = [['#151619',2],['#2c6d4a',2],['#2a5f96',2],['#b5272c',5],['#f0e8d7',11],
               ['#b5272c',5],['#2a5f96',2],['#2c6d4a',2],['#151619',2]];
    var unit = 512/33, x = 0;
    seq.forEach(function (g) { ctx.fillStyle = g[0]; ctx.fillRect(x, 0, unit*g[1]+1, 512); x += unit*g[1]; });
    // 逐根经线一道高光一道阴影：织面要看得出"线"，不是印上去的色块
    for (var w = 0; w < 33; w++) {
      var wx = w*unit;
      ctx.fillStyle='rgba(255,255,255,.13)'; ctx.fillRect(wx+unit*.22,0,Math.max(1,unit*.16),512);
      ctx.fillStyle='rgba(0,0,0,.18)'; ctx.fillRect(wx+unit*.74,0,Math.max(1,unit*.18),512);
    }
    // 纬线压经，每隔三像素一道横纹
    for (var yy = 0; yy < 512; yy += 3) {
      ctx.fillStyle = (yy/3)%2 ? 'rgba(255,252,242,.13)' : 'rgba(24,20,18,.13)';
      ctx.fillRect(0,yy,512,1.4);
    }
    // 万字纹：十字加四个回钩，深蓝打底、朱红压线，在白芯上错列排下去
    function wan(cx,cy,h,col,lw){
      ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.lineCap='butt';ctx.beginPath();
      ctx.moveTo(cx,cy-h);ctx.lineTo(cx,cy+h);
      ctx.moveTo(cx-h,cy);ctx.lineTo(cx+h,cy);
      ctx.moveTo(cx,cy-h);ctx.lineTo(cx-h*.72,cy-h);
      ctx.moveTo(cx,cy+h);ctx.lineTo(cx+h*.72,cy+h);
      ctx.moveTo(cx-h,cy);ctx.lineTo(cx-h,cy+h*.72);
      ctx.moveTo(cx+h,cy);ctx.lineTo(cx+h,cy-h*.72);
      ctx.stroke();
    }
    var ccx = unit*11 + unit*11/2;
    for (var k = 0; k < 8; k++) {
      var cy = k*64+32;
      wan(ccx,cy,unit*3.3,'#2f4a63',unit*.9);
      wan(ccx,cy,unit*2.1,'#a5322c',unit*.55);
    }
    // 两侧红带上的锯齿菱格挑花
    [unit*5.5, unit*27.5].forEach(function(bx){
      for (var k2 = 0; k2 < 16; k2++) {
        var y2 = k2*32+16, r = unit*1.9;
        ctx.strokeStyle='rgba(244,236,220,.82)'; ctx.lineWidth=unit*.42;
        ctx.beginPath();
        ctx.moveTo(bx,y2-r);ctx.lineTo(bx+r*1.4,y2);ctx.lineTo(bx,y2+r);ctx.lineTo(bx-r*1.4,y2);ctx.closePath();ctx.stroke();
      }
    });
    // 布边收口：最外一列黑线再压一道深色
    ctx.fillStyle='rgba(8,9,11,.55)';ctx.fillRect(0,0,unit*.5,512);ctx.fillRect(512-unit*.5,0,unit*.5,512);
    for (var f = 0; f < 900; f++) {
      var fx=Math.random()*512,fy=Math.random()*512;
      ctx.strokeStyle=Math.random()>.5?'rgba(255,250,235,.16)':'rgba(28,24,20,.12)';
      ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(fx,fy);ctx.lineTo(fx+(Math.random()-.5)*4,fy+1+Math.random()*3);ctx.stroke();
    }
    return s.canvas;
  }

  /* ---------- 酱釉陶：米酒坛的釉面 ---------- */
  function glazeJar() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    var grd = ctx.createLinearGradient(0, 0, 512, 0);
    grd.addColorStop(0, '#4A2B18'); grd.addColorStop(0.35, '#8C5528');
    grd.addColorStop(0.55, '#A9682F'); grd.addColorStop(0.75, '#7A451F');
    grd.addColorStop(1, '#3E2414');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 512, 512);
    // 釉垂流痕
    for (var i = 0; i < 40; i++) {
      var x = Math.random() * 512;
      ctx.strokeStyle = 'rgba(30,15,8,' + (0.05 + Math.random() * 0.14) + ')';
      ctx.lineWidth = 2 + Math.random() * 7;
      ctx.beginPath(); ctx.moveTo(x, Math.random() * 120);
      ctx.lineTo(x + (Math.random() - 0.5) * 12, 260 + Math.random() * 250); ctx.stroke();
    }
    // 铁质斑点与开片
    for (var k = 0; k < 700; k++) {
      ctx.fillStyle = 'rgba(24,12,6,' + (0.10 + Math.random() * 0.3) + ')';
      var r = Math.random() * 2.2;
      ctx.beginPath(); ctx.arc(Math.random() * 512, Math.random() * 512, r, 0, 6.284); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,235,205,0.10)'; ctx.lineWidth = 1;
    for (var c = 0; c < 26; c++) {
      ctx.beginPath();
      var cx0 = Math.random() * 512, cy0 = Math.random() * 512;
      ctx.moveTo(cx0, cy0);
      ctx.lineTo(cx0 + (Math.random() - 0.5) * 90, cy0 + (Math.random() - 0.5) * 90);
      ctx.stroke();
    }
    return s.canvas;
  }

  /* ---------- 凉帽垂布：靛蓝棉麻 ---------- */
  function hatCloth() {
    var s = createCanvas(512, 512), ctx = s.ctx;
    ctx.fillStyle = '#2F4858'; ctx.fillRect(0, 0, 512, 512);
    for (var y = 0; y < 512; y += 4) {
      ctx.strokeStyle = y % 8 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }
    for (var x = 0; x < 512; x += 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
    }
    // 蓝染不匀的晕色
    for (var i = 0; i < 60; i++) {
      var r = 30 + Math.random() * 90;
      var g2 = ctx.createRadialGradient(Math.random() * 512, Math.random() * 512, 0,
        Math.random() * 512, Math.random() * 512, r);
      g2.addColorStop(0, 'rgba(120,160,180,0.07)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, 512, 512);
    }
    return s.canvas;
  }

  window.Textures = {
    redFabric: redFabric,
    tigerFace: tigerFaceTexture,
    landye: landyeTexture,
    wall: wallTexture,
    qingBrick: qingBrick,
    qingwaRoof: qingwaRoof,
    rammedLoam: rammedLoam,
    pondWater: pondWater,
    cobbleCourt: cobbleCourt,
    roof: roofTexture,
    envMap: envMap,
    bambooWeave: bambooWeave,
    wovenBelt: wovenBelt,
    glazeJar: glazeJar,
    hatCloth: hatCloth
  };
})();
