/**
 * 复核家乡地图每个地点都有关联介绍和明确的坐标来源。
 *
 * 直接调用页面的 exhibitsFor，区分典藏引文与地点介绍。
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
  const book = hits.filter((h) => !h.isHometown).length;
  const source = p.coordinateSource;
  const located = !!source?.label && (!!source.url || (p.approximate && source.pixel?.length === 2));
  const ok = hits.length > 0 && quoted > 0 && located;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${p.name.padEnd(5)} 典藏 ${book} 条 · 地点介绍 ${hits.length - book} 条`
    + ` · 原声 ${audio} · 定位来源${located ? '完整' : '缺失'}`);
}
if (bad) {
  console.error(`\n${bad} 个地点缺少关联介绍或坐标来源。`);
  process.exit(1);
}
console.log(`\n家乡地图 ${places.length} 个地点全部有关联介绍与定位来源。`);
