/**
 * 用站点自己的编码器把一段文本画成模块矩阵，打到 stdout。
 *
 * 存在的理由：印展板的成品二维码必须与 js/config.js 里的 canonicalUrl 一致，
 * 而浏览器截图只能编出「当前访问地址」。这里直接调 js/vendor/qrcode.js
 * （和页面上同一个编码器），所以展板与网页不会出现两套地址。
 *
 *   node scripts/qr_matrix.mjs <text>      # 首行是边长，其后每行 0/1
 */
import fs from 'node:fs';
import vm from 'node:vm';

const text = process.argv[2];
if (!text) {
  console.error('用法：node scripts/qr_matrix.mjs <要编码的文本>');
  process.exit(1);
}

const ctx = { window: {}, console };
ctx.global = ctx;
vm.createContext(ctx);
for (const f of ['js/vendor/qrcode.js', 'js/vendor/qrcode-utf8.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const gen = ctx.window.qrcode || ctx.qrcode;

const qr = gen(0, 'M');
qr.addData(text);
qr.make();
const n = qr.getModuleCount();
const rows = [];
for (let r = 0; r < n; r++) {
  let line = '';
  for (let c = 0; c < n; c++) line += qr.isDark(r, c) ? '1' : '0';
  rows.push(line);
}
process.stdout.write(n + '\n' + rows.join('\n') + '\n');
