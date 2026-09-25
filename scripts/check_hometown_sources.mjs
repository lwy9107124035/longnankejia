/**
 * 复核「家乡」地图上的每个地点都能在《文化典藏》里找到出处。
 *
 * 地图上的点不是装饰：观众点了就得有书里的原句可讲。判据直接调用页面上同一个
 * js/hometown.js 的 exhibitsFor（而不是在这里另写一遍），这样两边不可能判得不一样。
 * 生成脚本以后加了地名却忘了依据，这里会红。
 *
 *   node scripts/check_hometown_sources.mjs          # 0=每个点都有出处
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = {};
const ctx = vm.createContext({ window: win, console });
ctx.globalThis = ctx;

// hometown.js 的 data 只在 init() 里赋值，而 init() 要摸 DOM。这里给一个最小替身，
// 目的只是把数据装进去并跑一遍点位计算，不渲染任何东西。
const el = () => ({
  innerHTML: '', textContent: '', hidden: false, style: {},
  classList: { toggle() {} }, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, appendChild() {}, getAttribute: () => null,
});
ctx.document = {
  getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
  createElement: () => el(), addEventListener() {}, head: el(),
};

for (const f of ['js/diancang-data.js', 'js/diancang.js', 'js/data-hometown.js', 'js/hometown.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
try { win.Diancang.init(); } catch { /* 没有 document，data 已经赋好，检索可用 */ }
win.Hometown.init();

const places = win.Hometown.places();
if (!places.length) {
  console.error('家乡地图没有点位（js/data-hometown.js 没生成？）');
  process.exit(1);
}
let bad = 0;
for (const p of places) {
  const hits = win.Hometown.exhibitsFor(p.name);
  const audio = hits.filter((h) => h.item.videoUrl).length;
  const quoted = hits.filter((h) => h.sentence).length;
  const ok = hits.length > 0 && quoted > 0;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${p.name.padEnd(5)} 出处 ${hits.length} 处`
    + `（带原句 ${quoted}）· 原声 ${audio}` + (ok ? '' : ' ← 点了没东西可讲'));
}
if (bad) {
  console.error(`\n${bad} 个地点在书里查不到可讲的原文：要么补出处，要么从地图上拿掉，别留着空点。`);
  process.exit(1);
}
console.log(`\n家乡地图 ${places.length} 个地点全部有书内出处。`);
