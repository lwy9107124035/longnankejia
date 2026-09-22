/**
 * 入口二维码：把本站地址渲染成可扫描的码，供馆内观众扫码打开。
 *
 * 编码器来自 js/vendor/qrcode.js（qrcode-generator, MIT），本文件只是适配层——
 * 原先手写的 500 行编码器能画出看似合法的图，却解不出内容，已废弃。
 * 这与典藏 PDF 里的印刷二维码无关：展品讲解在「访问地址」面板中列成可点链接。
 */
(function () {
  'use strict';

  function encode(text) {
    var gen = window.qrcode || (typeof qrcode === 'function' ? qrcode : null);
    var qr = gen(0, 'M'); // 0 = 版本自适应
    qr.addData(text);
    qr.make();
    return qr;
  }

  function render(text, canvas, scale) {
    var qr;
    try {
      qr = encode(text);
    } catch (e) {
      return false;
    }
    var n = qr.getModuleCount();
    var quiet = 4; // 规范要求的静默区，缺失会让多数扫描器认不出码
    var px = Math.max(1, scale || 4);
    canvas.width = canvas.height = (n + quiet * 2) * px;
    var g = canvas.getContext('2d');
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#1F2E2A';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) g.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
      }
    }
    return true;
  }

  window.QR = { render: render, encode: encode };
})();
