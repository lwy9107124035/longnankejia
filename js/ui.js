/**
 * UI 模块：聊天渲染 / 打字机 / 虚拟形象状态 / 语音 / 二维码 / 弹层
 */
(function () {
  'use strict';

  /* ================================================================
     二维码生成（纯前端，无依赖）—— Byte Mode, ECC M, 版本自适应
     ================================================================ */
  var QR = (function () {
    // GF(256) 对数表与反对数表
    var EXP = new Array(512);
    var LOG = new Array(256);
    (function initGF() {
      var x = 1;
      for (var i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11D;
      }
      for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
    })();

    function gfMul(a, b) {
      if (a === 0 || b === 0) return 0;
      return EXP[LOG[a] + LOG[b]];
    }

    function rsDivisor(degree) {
      var result = [];
      for (var i = 0; i < degree - 1; i++) result.push(0);
      result.push(1);
      var root = 1;
      for (var i2 = 0; i2 < degree; i2++) {
        for (var j = 0; j < result.length; j++) {
          result[j] = gfMul(result[j], root);
          if (j + 1 < result.length) result[j] ^= result[j + 1];
        }
        root = gfMul(root, 0x02);
      }
      return result;
    }

    function rsRemainder(data, divisor) {
      var result = divisor.map(function () { return 0; });
      data.forEach(function (b) {
        var factor = b ^ result.shift();
        result.push(0);
        divisor.forEach(function (d, i) {
          result[i] ^= gfMul(d, factor);
        });
      });
      return result;
    }

    // 版本 1-10，ECC M：[每块纠错码字数, 组1块数, 组1数据码字, 组2块数, 组2数据码字]
    var ECC_M = {
      1: [10, 1, 16, 0, 0],
      2: [16, 1, 28, 0, 0],
      3: [26, 1, 44, 0, 0],
      4: [18, 2, 32, 0, 0],
      5: [24, 2, 43, 0, 0],
      6: [16, 4, 27, 0, 0],
      7: [18, 4, 31, 0, 0],
      8: [22, 2, 38, 2, 39],
      9: [22, 3, 36, 2, 37],
      10: [26, 4, 43, 1, 44]
    };

    var ALIGN_POS = {
      1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
      6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
    };

    function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

    function utf8Bytes(str) {
      var out = [];
      for (var i = 0; i < str.length; i++) {
        var c = str.codePointAt(i);
        if (c > 0xFFFF) i++;
        if (c < 0x80) {
          out.push(c);
        } else if (c < 0x800) {
          out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
        } else if (c < 0x10000) {
          out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        } else {
          out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        }
      }
      return out;
    }

    function encodeData(bytes, dataCodewords) {
      var bits = [];
      function push(val, len) {
        for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
      }
      push(0x4, 4);                 // Byte mode
      push(bytes.length, 8);        // 版本 1-9 用 8 位长度
      bytes.forEach(function (b) { push(b, 8); });
      // 终止符
      var cap = dataCodewords * 8;
      for (var i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
      while (bits.length % 8 !== 0) bits.push(0);
      // 填充
      var pads = [0xEC, 0x11];
      var pi = 0;
      var cw = [];
      for (var b = 0; b < bits.length; b += 8) {
        var v = 0;
        for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
        cw.push(v);
      }
      while (cw.length < dataCodewords) {
        cw.push(pads[pi % 2]);
        pi++;
      }
      return cw;
    }

    function buildMatrix(version, dataCw, eccCw, numBlocks, dataPerBlock) {
      var size = version * 4 + 17;
      var modules = [];
      var reserved = [];
      for (var r = 0; r < size; r++) {
        modules.push(new Array(size).fill(false));
        reserved.push(new Array(size).fill(false));
      }

      function setFn(r, c, dark) {
        modules[r][c] = dark;
        reserved[r][c] = true;
      }

      // 探测图形
      function drawFinder(row, col) {
        for (var dr = -1; dr <= 7; dr++) {
          for (var dc = -1; dc <= 7; dc++) {
            var rr = row + dr, cc = col + dc;
            if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
            var dark = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                       (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                       (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
            setFn(rr, cc, dark);
          }
        }
      }
      drawFinder(0, 0);
      drawFinder(0, size - 7);
      drawFinder(size - 7, 0);

      // 定位图形
      for (var i = 8; i < size - 8; i++) {
        setFn(6, i, i % 2 === 0);
        setFn(i, 6, i % 2 === 0);
      }

      // 校正图形
      var pos = ALIGN_POS[version] || [];
      pos.forEach(function (pr) {
        pos.forEach(function (pc) {
          if ((pr <= 8 && pc <= 8) || (pr <= 8 && pc >= size - 9) || (pr >= size - 9 && pc <= 8)) return;
          for (var dr = -2; dr <= 2; dr++) {
            for (var dc = -2; dc <= 2; dc++) {
              var dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
              setFn(pr + dr, pc + dc, dark);
            }
          }
        });
      });

      // 预留格式信息区域
      for (var f = 0; f <= 8; f++) {
        if (f !== 6) { setFn(8, f, false); setFn(f, 8, false); }
      }
      for (var f2 = 0; f2 < 8; f2++) {
        setFn(8, size - 1 - f2, false);
        setFn(size - 1 - f2, 8, false);
      }
      setFn(size - 8, 8, true); // 固定黑模块

      // 版本信息（版本 ≥ 7）
      if (version >= 7) {
        var vBits = version << 12;
        for (var i2 = 0; i2 < 12; i2++) {
          vBits = (vBits & ~(1 << 12)) | (((vBits >>> 12) ^ getBit(version << 12, i2)) << 12);
        }
        // 简化：用标准 BCH
        var rem = version;
        for (var d = 0; d < 12; d++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        var vBitsFull = (version << 12) | rem;
        for (var i3 = 0; i3 < 18; i3++) {
          var bit = getBit(vBitsFull, i3);
          var a = size - 11 + (i3 % 3);
          var b = Math.floor(i3 / 3);
          setFn(a, b, bit);
          setFn(b, a, bit);
        }
      }

      // ---- 数据放置 ----
      // 分块
      var blocks = [];
      var offsets = [];
      var idx = 0;
      var g1 = eccCw, g2 = 0, b1 = numBlocks, b2 = 0; // placeholder — 由参数传入结构
      // 实际上参数已拆好：numBlocks 块，每块 dataPerBlock 数据码字
      // 但 v8-10 有两组不同长度。这里把混合结构在调用方拼好后传入 blocksData。
      return { size: size, modules: modules, reserved: reserved };
    }

    // 完整编码流程
    function encode(text) {
      var bytes = utf8Bytes(text);

      // 选择版本
      var version = 0;
      var meta = null;
      var dataCwTotal = 0;
      for (var v = 1; v <= 10; v++) {
        var m = ECC_M[v];
        var totalData = m[1] * m[2] + m[3] * m[4];
        var headerBits = 4 + 8; // mode + length (v1-9) — v10 用 16 位
        var lenBits = v <= 9 ? 8 : 16;
        var needed = Math.ceil((4 + lenBits + bytes.length * 8) / 8);
        if (needed <= totalData) {
          version = v;
          meta = m;
          dataCwTotal = totalData;
          break;
        }
      }
      if (!version) return null; // 超长，放弃

      var eccCw = meta[0];
      var groups = [];
      if (meta[1] > 0) groups.push({ count: meta[1], dataLen: meta[2] });
      if (meta[3] > 0) groups.push({ count: meta[3], dataLen: meta[4] });

      // 数据码字
      var dataBits = [];
      function pushBits(val, len) {
        for (var i = len - 1; i >= 0; i--) dataBits.push((val >>> i) & 1);
      }
      pushBits(0x4, 4);
      pushBits(bytes.length, version <= 9 ? 8 : 16);
      bytes.forEach(function (b) { pushBits(b, 8); });
      var cap = dataCwTotal * 8;
      for (var t = 0; t < 4 && dataBits.length < cap; t++) dataBits.push(0);
      while (dataBits.length % 8 !== 0) dataBits.push(0);
      var dataCw = [];
      for (var bi = 0; bi < dataBits.length; bi += 8) {
        var byteVal = 0;
        for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | dataBits[bi + k];
        dataCw.push(byteVal);
      }
      var padBytes = [0xEC, 0x11];
      var pIdx = 0;
      while (dataCw.length < dataCwTotal) {
        dataCw.push(padBytes[pIdx % 2]);
        pIdx++;
      }

      // 分块 + 纠错
      var blocksData = [];
      var blocksEcc = [];
      var cursor = 0;
      groups.forEach(function (g) {
        for (var n = 0; n < g.count; n++) {
          var chunk = dataCw.slice(cursor, cursor + g.dataLen);
          cursor += g.dataLen;
          blocksData.push(chunk);
          blocksEcc.push(rsRemainder(chunk, rsDivisor(eccCw)));
        }
      });

      // 交错
      var finalCw = [];
      var maxData = Math.max.apply(null, blocksData.map(function (b) { return b.length; }));
      for (var i4 = 0; i4 < maxData; i4++) {
        blocksData.forEach(function (b) {
          if (i4 < b.length) finalCw.push(b[i4]);
        });
      }
      for (var i5 = 0; i5 < eccCw; i5++) {
        blocksEcc.forEach(function (b) { finalCw.push(b[i5]); });
      }

      // 矩阵
      var size = version * 4 + 17;
      var mods = [];
      var isFn = [];
      for (var r0 = 0; r0 < size; r0++) {
        mods.push(new Array(size).fill(false));
        isFn.push(new Array(size).fill(false));
      }

      function place(r, c, dark) {
        mods[r][c] = dark;
        isFn[r][c] = true;
      }

      function finder(row, col) {
        for (var dr = -1; dr <= 7; dr++) {
          for (var dc = -1; dc <= 7; dc++) {
            var rr = row + dr, cc = col + dc;
            if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
            var dark = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                       (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                       (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
            place(rr, cc, dark);
          }
        }
      }
      finder(0, 0);
      finder(0, size - 7);
      finder(size - 7, 0);

      for (var i6 = 8; i6 < size - 8; i6++) {
        place(6, i6, i6 % 2 === 0);
        place(i6, 6, i6 % 2 === 0);
      }

      var apos = ALIGN_POS[version] || [];
      apos.forEach(function (pr) {
        apos.forEach(function (pc) {
          if ((pr <= 8 && pc <= 8) || (pr <= 8 && pc >= size - 9) || (pr >= size - 9 && pc <= 8)) return;
          for (var dr = -2; dr <= 2; dr++) {
            for (var dc = -2; dc <= 2; dc++) {
              place(pr + dr, pc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
            }
          }
        });
      });

      // 预留格式位
      for (var f = 0; f <= 8; f++) {
        if (f !== 6) { place(8, f, false); place(f, 8, false); }
      }
      for (var f2 = 0; f2 < 8; f2++) {
        place(8, size - 1 - f2, false);
        place(size - 1 - f2, 8, false);
      }
      place(size - 8, 8, true);

      // 版本信息
      if (version >= 7) {
        var rem = version;
        for (var d = 0; d < 12; d++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        var vBits = (version << 12) | rem;
        for (var i7 = 0; i7 < 18; i7++) {
          var bit = ((vBits >>> i7) & 1) !== 0;
          var aa = size - 11 + (i7 % 3);
          var bb = Math.floor(i7 / 3);
          place(aa, bb, bit);
          place(bb, aa, bit);
        }
      }

      // 数据位填充（Z 字形）
      var bitIdx = 0;
      var totalBits = finalCw.length * 8;
      function dataBitAt(i) {
        return ((finalCw[i >> 3] >>> (7 - (i & 7))) & 1) !== 0;
      }
      var upward = true;
      for (var col = size - 1; col >= 1; col -= 2) {
        if (col === 6) col--;
        for (var cnt = 0; cnt < size; cnt++) {
          var row = upward ? size - 1 - cnt : cnt;
          for (var cOff = 0; cOff < 2; cOff++) {
            var cc2 = col - cOff;
            if (!isFn[row][cc2]) {
              mods[row][cc2] = bitIdx < totalBits ? dataBitAt(bitIdx) : false;
              bitIdx++;
            }
          }
        }
        upward = !upward;
      }

      // 掩码选择（8 种，罚分最低）
      function applyMask(maskId) {
        var out = mods.map(function (row) { return row.slice(); });
        for (var r = 0; r < size; r++) {
          for (var c = 0; c < size; c++) {
            if (isFn[r][c]) continue;
            var invert = false;
            switch (maskId) {
              case 0: invert = (r + c) % 2 === 0; break;
              case 1: invert = r % 2 === 0; break;
              case 2: invert = c % 3 === 0; break;
              case 3: invert = (r + c) % 3 === 0; break;
              case 4: invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
              case 5: invert = ((r * c) % 2) + ((r * c) % 3) === 0; break;
              case 6: invert = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
              case 7: invert = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
            }
            if (invert) out[r][c] = !out[r][c];
          }
        }
        return out;
      }

      function drawFormat(matrix, maskId) {
        // ECC M = 0b00
        var data = (0 << 3) | maskId;
        var rem2 = data;
        for (var i = 0; i < 10; i++) rem2 = (rem2 << 1) ^ ((rem2 >>> 9) * 0x537);
        var bitsF = ((data << 10) | rem2) ^ 0x5412;
        function gb(i) { return ((bitsF >>> i) & 1) !== 0; }
        for (var i8 = 0; i8 <= 5; i8++) matrix[8][i8] = gb(i8);
        matrix[8][7] = gb(6);
        matrix[8][8] = gb(7);
        matrix[7][8] = gb(8);
        for (var i9 = 9; i9 < 15; i9++) matrix[14 - i9][8] = gb(i9);
        for (var i10 = 0; i10 < 8; i10++) matrix[size - 1 - i10][8] = gb(i10);
        for (var i11 = 8; i11 < 15; i11++) matrix[8][size - 15 + i11] = gb(i11);
        matrix[size - 8][8] = true;
      }

      function penalty(m) {
        var p = 0, r, c, run, color;
        // 规则1：行/列同色连续
        for (r = 0; r < size; r++) {
          run = 1;
          for (c = 1; c < size; c++) {
            if (m[r][c] === m[r][c - 1]) { run++; } else { if (run >= 5) p += 3 + (run - 5); run = 1; }
          }
          if (run >= 5) p += 3 + (run - 5);
        }
        for (c = 0; c < size; c++) {
          run = 1;
          for (r = 1; r < size; r++) {
            if (m[r][c] === m[r - 1][c]) { run++; } else { if (run >= 5) p += 3 + (run - 5); run = 1; }
          }
          if (run >= 5) p += 3 + (run - 5);
        }
        // 规则2：2x2 同色
        for (r = 0; r < size - 1; r++) {
          for (c = 0; c < size - 1; c++) {
            var v = m[r][c];
            if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
          }
        }
        // 规则3：类似定位图案
        var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
        var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
        function matchAt(getter, start) {
          var ok1 = true, ok2 = true;
          for (var i = 0; i < 11; i++) {
            var val = getter(start + i);
            if (val !== pat1[i]) ok1 = false;
            if (val !== pat2[i]) ok2 = false;
          }
          return ok1 || ok2;
        }
        for (r = 0; r < size; r++) {
          for (c = 0; c <= size - 11; c++) {
            if (matchAt(function (i) { return m[r][i]; }, c)) p += 40;
          }
        }
        for (c = 0; c < size; c++) {
          for (r = 0; r <= size - 11; r++) {
            if (matchAt(function (i) { return m[i][c]; }, r)) p += 40;
          }
        }
        // 规则4：黑白比例
        var dark = 0;
        for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
        var total = size * size;
        var k = Math.floor(Math.abs(dark * 20 - total * 10) / total);
        p += k * 10;
        return p;
      }

      var best = null, bestScore = Infinity;
      for (var mask = 0; mask < 8; mask++) {
        var cand = applyMask(mask);
        drawFormat(cand, mask);
        var sc = penalty(cand);
        if (sc < bestScore) { bestScore = sc; best = cand; }
      }

      return { size: size, modules: best, version: version };
    }

    function render(text, canvas, scale) {
      scale = scale || 8;
      var qr = encode(text);
      if (!qr) return false;
      var quiet = 4;
      var total = qr.size + quiet * 2;
      var px = total * scale;
      canvas.width = px;
      canvas.height = px;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = '#1F2E2A';
      for (var r = 0; r < qr.size; r++) {
        for (var c = 0; c < qr.size; c++) {
          if (qr.modules[r][c]) {
            ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
          }
        }
      }
      return true;
    }

    return { render: render, encode: encode };
  })();

  /* ================================================================
     聊天 UI
     ================================================================ */
  var Chat = (function () {
    var windowEl, inputEl, sendBtn;
    var emptyHtml = '' +
      '<div class="chat-empty">' +
      '  <div class="chat-empty-icon">💬</div>' +
      '  <div class="chat-empty-title">问问阿蓝吧</div>' +
      '  <div class="chat-empty-hint">关于蓝染、竹编、织带、围屋的任何问题<br>都可以在这里得到回答</div>' +
      '</div>';

    var botAvatarSvg = '<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg"><circle cx="34" cy="24" r="12" fill="#3A2F2A"/><circle cx="86" cy="24" r="12" fill="#3A2F2A"/><ellipse cx="60" cy="50" rx="32" ry="31" fill="#FFDDB8"/><path d="M28 44 C30 22 50 14 60 14 C70 14 90 22 92 44 C88 36 82 32 74 36 C70 28 64 26 58 30 C52 26 44 28 40 36 C34 32 30 36 28 44 Z" fill="#3A2F2A"/><ellipse cx="47" cy="52" rx="5" ry="6" fill="#2A2A2A"/><ellipse cx="73" cy="52" rx="5" ry="6" fill="#2A2A2A"/><circle cx="49" cy="50" r="1.8" fill="#fff"/><circle cx="75" cy="50" r="1.8" fill="#fff"/><path d="M53 63 Q60 69 67 63" stroke="#B0563A" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M38 82 C38 78 48 75 60 75 C72 75 82 78 82 82 L88 108 C89 112 87 116 83 116 L37 116 C33 116 31 112 32 108 Z" fill="#2F5D50"/><path d="M50 76 L60 90 L70 76" stroke="#FFF6E8" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>';

    function el(tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      return e;
    }

    function ensureNotEmpty() {
      if (windowEl.querySelector('.chat-empty')) return;
      if (!windowEl.querySelector('.msg')) {
        windowEl.innerHTML = emptyHtml;
      }
    }

    function scrollToBottom() {
      windowEl.scrollTop = windowEl.scrollHeight;
    }

    function addUser(text) {
      ensureNotEmpty();
      var m = el('div', 'msg msg-user');
      m.appendChild(el('div', 'msg-avatar', '🧑'));
      var bubble = el('div', 'msg-bubble');
      bubble.textContent = text;
      m.appendChild(bubble);
      windowEl.appendChild(m);
      scrollToBottom();
      return bubble;
    }

    function addBotShell() {
      ensureNotEmpty();
      var m = el('div', 'msg msg-bot');
      m.appendChild(el('div', 'msg-avatar', botAvatarSvg));
      var bubble = el('div', 'msg-bubble');
      bubble.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span>';
      m.appendChild(bubble);
      windowEl.appendChild(m);
      scrollToBottom();
      return bubble;
    }

    // 打字机效果，返回 Promise
    function typewrite(bubble, text, onProgress) {
      return new Promise(function (resolve) {
        var lines = String(text).split('\n');
        bubble.textContent = '';
        var cursor = el('span', 'typing-cursor');
        bubble.appendChild(cursor);

        var flat = lines.map(function (l) { return l; });
        var li = 0, ci = 0;
        var timer = null;

        function step() {
          if (li >= flat.length) {
            if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
            if (onProgress) onProgress('done');
            scrollToBottom();
            resolve();
            return;
          }
          if (ci === 0 && li > 0) {
            bubble.insertBefore(document.createElement('br'), cursor);
          }
          var line = flat[li];
          if (ci < line.length) {
            cursor.insertAdjacentText('beforebegin', line.charAt(ci));
            ci++;
            // 标点稍作停顿，更自然
            var ch = line.charAt(ci - 1);
            var delay = '，。！？；：'.indexOf(ch) !== -1 ? 90 : 18;
            timer = setTimeout(step, delay);
          } else {
            li++;
            ci = 0;
            timer = setTimeout(step, 40);
          }
          scrollToBottom();
        }

        step();

        // 暴露取消（用户提前发新消息时可打断）
        bubble._cancelTypewriter = function () {
          if (timer) clearTimeout(timer);
          if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
          bubble.textContent = text;
          resolve();
        };
      });
    }

    function init() {
      windowEl = document.getElementById('chatWindow');
      inputEl = document.getElementById('chatInput');
      sendBtn = document.getElementById('sendBtn');
      ensureNotEmpty();
    }

    return {
      init: init,
      addUser: addUser,
      addBotShell: addBotShell,
      typewrite: typewrite,
      scrollToBottom: scrollToBottom
    };
  })();

  /* ================================================================
     虚拟形象状态
     ================================================================ */
  var Avatar = (function () {
    var wrap;
    function init() {
      wrap = document.getElementById('avatarWrap');
    }
    function talking(on) {
      if (!wrap) return;
      wrap.classList.toggle('is-talking', !!on);
    }
    function thinking(on) {
      if (!wrap) return;
      wrap.classList.toggle('is-thinking', !!on);
    }
    return { init: init, talking: talking, thinking: thinking };
  })();

  /* ================================================================
     语音朗读
     ================================================================ */
  var Voice = (function () {
    var supported = typeof window.speechSynthesis !== 'undefined';
    var checkbox;

    function init() {
      checkbox = document.getElementById('voiceToggle');
      if (!supported) {
        var row = document.querySelector('.voice-row');
        if (row) row.style.display = 'none';
      }
    }

    function enabled() {
      return supported && checkbox && checkbox.checked;
    }

    function speak(text) {
      if (!enabled()) return;
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(String(text).replace(/\n+/g, '，'));
        var cfg = (window.APP_CONFIG && window.APP_CONFIG.voice) || {};
        u.lang = cfg.lang || 'zh-CN';
        u.rate = cfg.rate || 1;
        u.pitch = cfg.pitch || 1;
        window.speechSynthesis.speak(u);
      } catch (e) {
        /* 忽略语音异常，不影响主流程 */
      }
    }

    function stop() {
      if (supported) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
    }

    return { init: init, speak: speak, stop: stop, enabled: enabled };
  })();

  /* ================================================================
     非遗卡片
     ================================================================ */
  var Heritage = (function () {
    var CARDS = [
      {
        id: 'landye',
        name: '客家蓝染',
        icon: '🧵',
        tag: '草木染 · 靛蓝匠心',
        accent: '#2F5D50',
        bg: '#E4EFEA',
        detail:
          '<p>以板蓝根（蓼蓝）为原料，经浸泡制靛、布料浸染、氧化显色、晾晒固色等工序，染出深沉温润的蓝。</p>' +
          '<p>传承人李洁春老师向团队完整演示了制靛到晾晒的全流程，并展示扎染纹样设计——以扎缝防染，形成深浅相间的传统花纹。</p>' +
          '<p>2026 年暑期，团队专访蓝染传承人，采集工艺影像与口述资料，形成数字档案与双语宣传片素材。</p>',
        ask: '什么是客家蓝染？'
      },
      {
        id: 'zhubian',
        name: '客家竹编',
        icon: '🎋',
        tag: '就地取材 · 匠心编织',
        accent: '#6B8F4E',
        bg: '#EDF3E6',
        detail:
          '<p>赣南竹编历史悠久，多取三年生毛竹，经刮青、剖篾、编织、打磨等工序，化竹为器。</p>' +
          '<p>成品既有竹篮、竹筛、竹席等生活器具，也有工艺精巧的摆件，编织纹样蕴含吉祥寓意，体现客家人就地取材的生活智慧。</p>' +
          '<p>团队走访竹编传承人，记录了编制方法与代表性竹器，相关素材已进入数字助手知识库。</p>',
        ask: '竹编有什么工艺特色？'
      },
      {
        id: 'zhidai',
        name: '客家织带',
        icon: '🧶',
        tag: '女红技艺 · 纹样寄情',
        accent: '#C45C26',
        bg: '#FBEDE4',
        detail:
          '<p>客家织带是客家女红的重要技艺，常用木质织带机编织，图案以几何纹、花草纹为主。</p>' +
          '<p>不同纹样承载不同寓意：有的象征吉祥如意，有的祝福多子多福。织带广泛用于腰带、背带与节庆装饰，在客家婚俗中尤为常见——把祝福织进带子里。</p>' +
          '<p>团队专访织带传承人，记录织带机操作与多种传统纹样，留存珍贵的工艺影像。</p>',
        ask: '客家织带有什么寓意？'
      },
      {
        id: 'weiwu',
        name: '客家围屋',
        icon: '🏯',
        tag: '世界围屋之都 · 龙南',
        accent: '#8B6B4A',
        bg: '#F3EDE4',
        detail:
          '<p>龙南素有「世界围屋之都」美誉，现存客家围屋 376 座，是赣南客家文化的核心承载地。</p>' +
          '<p>围屋是客家先民聚族而居、御外自保的城堡式建筑，代表有关西新围、燕翼围等，中轴对称、方正厚重，融合中原营造技艺与客家智慧。</p>' +
          '<p>2006 年，客家围（龙南）被列入全国重点文物保护单位，如今也是重要的文旅打卡地。</p>',
        ask: '龙南为什么叫世界围屋之都？'
      }
    ];

    function init(onOpen) {
      var grid = document.getElementById('heritageGrid');
      if (!grid) return;
      CARDS.forEach(function (card) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'h-card';
        btn.style.setProperty('--card-accent', card.accent);
        btn.style.setProperty('--card-bg', card.bg);
        btn.innerHTML =
          '<div class="h-icon">' + card.icon + '</div>' +
          '<div class="h-name">' + card.name + '</div>' +
          '<div class="h-tag">' + card.tag + '</div>';
        btn.addEventListener('click', function () {
          if (onOpen) onOpen(card);
        });
        grid.appendChild(btn);
      });
    }

    function list() { return CARDS; }

    return { init: init, list: list };
  })();

  /* ================================================================
     二维码弹层
     ================================================================ */
  var QrModal = (function () {
    var modal, box, urlText, modeHint;
    var publicInput, publicSave, publicHint;
    var LS_KEY = 'nfyj_public_url';

    function currentUrl() {
      return window.location.href.split('#')[0];
    }

    // 读取公网地址：localStorage > config.app.publicUrl
    function getPublicUrl() {
      try {
        var saved = localStorage.getItem(LS_KEY);
        if (saved) return saved;
      } catch (e) {}
      var cfg = window.APP_CONFIG && window.APP_CONFIG.app;
      return (cfg && cfg.publicUrl) || '';
    }

    function setPublicUrl(url) {
      try {
        if (url) localStorage.setItem(LS_KEY, url);
        else localStorage.removeItem(LS_KEY);
      } catch (e) {}
    }

    function normalizeUrl(raw) {
      var u = String(raw || '').trim();
      if (!u) return '';
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      // 去尾部斜杠，避免二维码内容不一致
      return u.replace(/\/+$/, '');
    }

    function isHttpUrl(u) {
      return /^https?:\/\/[^\s]+\.[^\s]+/i.test(u);
    }

    function init() {
      modal = document.getElementById('qrModal');
      box = document.getElementById('qrBox');
      urlText = document.getElementById('qrUrlText');
      modeHint = document.getElementById('qrModeHint');
      publicInput = document.getElementById('qrPublicInput');
      publicSave = document.getElementById('qrPublicSave');
      publicHint = document.getElementById('qrPublicHint');

      document.getElementById('qrBtn').addEventListener('click', open);
      document.getElementById('qrClose').addEventListener('click', close);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) close();
      });

      publicSave.addEventListener('click', function () {
        var u = normalizeUrl(publicInput.value);
        if (u && !isHttpUrl(u)) {
          publicHint.textContent = '地址格式不正确，请以 https:// 开头';
          publicHint.classList.remove('is-public');
          return;
        }
        setPublicUrl(u);
        render();
        publicHint.textContent = u
          ? '已保存，二维码已切换为公网地址（任何网络可扫）'
          : '已清除公网地址，恢复局域网模式';
        publicHint.classList.toggle('is-public', !!u);
      });

      publicInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          publicSave.click();
        }
      });
    }

    function render() {
      var pub = normalizeUrl(getPublicUrl());
      var local = currentUrl();
      var localOk = /^https?:\/\//i.test(local);
      var target = pub || local;
      var isPublic = !!pub;

      // 展示当前使用的地址
      urlText.textContent = target || '尚未生成可扫码的地址';

      // 输入框回填
      publicInput.value = pub;

      // 模式提示
      if (isPublic) {
        modeHint.textContent = '当前：公网模式（任何网络均可扫码）';
        modeHint.style.background = 'var(--primary-soft)';
        modeHint.style.color = 'var(--primary-deep)';
        publicHint.textContent = '已启用公网地址，重启隧道后地址可能变化，需重新粘贴';
        publicHint.classList.add('is-public');
      } else {
        modeHint.textContent = localOk
          ? '当前：局域网模式（需手机与电脑同一 Wi-Fi）'
          : '当前：本地文件预览（请先运行 qidong.bat）';
        modeHint.style.background = '';
        modeHint.style.color = '';
        publicHint.textContent = '部署到 Netlify 后粘贴网址，二维码全网永久可扫';
        publicHint.classList.remove('is-public');
      }

      // 生成二维码
      box.innerHTML = '';
      if (target && isHttpUrl(target)) {
        var canvas = document.createElement('canvas');
        box.appendChild(canvas);
        var ok = QR.render(target, canvas, 5);
        if (!ok) {
          box.innerHTML =
            '<div class="qr-placeholder">内容过长，无法生成二维码<br>请直接访问：<br><strong>' +
            target +
            '</strong></div>';
        }
      } else {
        box.innerHTML =
          '<div class="qr-placeholder">先运行 qidong.bat 本地预览<br>或部署后粘贴公网网址</div>';
      }
    }

    function open() {
      render();
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
    }

    return { init: init };
  })();

  /* ================================================================
     非遗详情弹层
     ================================================================ */
  var DetailModal = (function () {
    var modal, titleEl, bodyEl, iconEl, askBtn;
    var currentAsk = '';

    function init() {
      modal = document.getElementById('detailModal');
      titleEl = document.getElementById('detailTitle');
      bodyEl = document.getElementById('detailBody');
      iconEl = document.getElementById('detailIcon');
      askBtn = document.getElementById('askMoreBtn');

      document.getElementById('detailClose').addEventListener('click', close);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) close();
      });
      askBtn.addEventListener('click', function () {
        close();
        if (window.App && window.App.ask) {
          window.App.ask(currentAsk);
        }
      });
    }

    function open(card) {
      titleEl.textContent = card.name;
      bodyEl.innerHTML = card.detail;
      iconEl.textContent = card.icon;
      iconEl.style.background = card.bg;
      currentAsk = card.ask;
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
    }

    return { init: init, open: open };
  })();

  /* ---------- 导出 ---------- */
  window.UI = {
    init: function () {
      Chat.init();
      Avatar.init();
      Voice.init();
      QrModal.init();
      DetailModal.init();
      Heritage.init(function (card) {
        DetailModal.open(card);
      });
    },
    Chat: Chat,
    Avatar: Avatar,
    Voice: Voice,
    QR: QR
  };
})();
