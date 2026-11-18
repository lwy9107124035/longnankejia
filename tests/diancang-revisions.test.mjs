import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { setupEnvironment } from './helpers/store-harness.mjs';
import { migrateRecordStorage } from '../functions/_lib/admin-records.js';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const source = { window: {} }; vm.createContext(source); vm.runInContext(read('js/diancang-data.js'), source);
const collection = source.window.DIANCANG, items = collection.chapters.flatMap(ch => ch.items);

test('enterprise review preserves six numbered chapters and the requested science subjects', () => {
  assert.deepEqual(Array.from(collection.chapters, ch => ch.num), ['壹', '贰', '叁', '肆', '伍', '陆']);
  assert.equal(items.length, 48); assert.equal(new Set(items.map(item => item.id)).size, 48);
  const expected = ['客家围屋', '关西新围', '燕翼围', '乌石围', '过山溜', '采茶戏', '采茶舞', '莲花调', '客家吹打乐',
    '龙南客家织带制作技艺', '杨村池塘龙舟赛', '香火龙', '板凳龙', '添丁炮习俗', '龙南大漆制作技艺', '龙南杨村米酒酿造技艺', '龙南辣腐乳制作技艺'];
  assert.deepEqual(Array.from(items.filter(item => item.science), item => item.name).sort(), expected.sort());
  assert.ok(!items.some(item => /杖头木偶|九狮拜象/.test(item.name)));
  for (const name of ['中三弦', '头弦', '椰胡', '采茶扇', '落地花鼓', '冬头帕', '子孙袋', '火笼']) assert.ok(items.some(item => item.name === name), name);
});

test('the revised menu contains exactly twelve mains, four sides and four staples', () => {
  const menu = items.find(item => item.id === 'dc-yizhuocai').text;
  const groups = menu.split(/[一二三]、龙南特色(?:主菜|配菜|主食)\n/).slice(1);
  assert.deepEqual(groups.map(group => group.trim().split(/[、\n]/).length), [12, 4, 4]);
  assert.match(menu, /临塘浸菜、土香猪汤、凤眼珍珠/);
  assert.match(menu, /大碗捶鱼面、龙南春卷/);
  const context = { window: {} }; vm.runInNewContext(read('js/knowledge-base.js'), context);
  for (const id of ['hakka-food-overview', 'dc-yizhuocai']) assert.equal(context.window.KNOWLEDGE_BASE.find(entry => entry.id === id).answer, menu);
});

test('provided illustrations and corrected text replace the old exhibits without changing verified video attribution', () => {
  const origin = items.find(item => item.id === 'dc-hakka-origin'), convention = items.find(item => item.id === 'dc-shikehui');
  assert.equal(fs.readFileSync(new URL('../' + origin.image, import.meta.url)).readUInt32BE(16), 974);
  assert.ok(fs.statSync(new URL('../' + convention.image, import.meta.url)).size > 50000);
  assert.match(origin.text, /罗香林/); assert.match(convention.text, /第32届恳亲大会于2023年11月7日至9日/);
  for (const item of items) assert.doesNotMatch(item.text || '', /[。！？；”」]\s*[a-z0-9]{2,12}$/);
  for (const name of ['采茶扇', '落地花鼓', '中三弦', '头弦', '椰胡']) {
    const text = items.find(item => item.name === name).text;
    assert.ok(text.endsWith('。'), name + ' has a complete final sentence without an OCR title/code');
    assert.doesNotMatch(text.slice(-30).replace(/\d{4}年/g, ''), /[a-z0-9]{2,}/);
  }
  const codes = JSON.parse(read('data/qr-content.json'));
  for (const item of items.filter(item => item.videoUrl)) {
    assert.equal(item.videoUrl, codes[String(item.sheet)].url);
    assert.equal(item.bookName || item.name, codes[String(item.sheet)].exhibit);
  }
});

function fakeDocument() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', hidden: true, handlers: {},
      querySelectorAll: () => [], addEventListener(type, callback) { this.handlers[type] = callback; } });
    return elements.get(id);
  };
  return { getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
}

for (const records of [false, true]) test(`collection reads published science and survives source navigation races (${records ? 'records' : 'legacy'})`, async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  const content = structuredClone(globalThis.HeritageContent.defaults);
  const linked = items.find(item => item.name === '燕翼围');
  content.kepuCustom = Array.from({ length: 110 }, (_, i) => ({ id: 'a-' + i, name: '无关测试条目' + i, detail: '其他内容' }));
  content.kepuCustom.push({ id: linked.science.id, name: '燕翼围', detail: '<p>燕翼围最新测试原文，始建于1650年。</p>' });
  content.kepuCustom.push({ id: 'kepu-1792980951543-ffofe6i7', name: '客家一桌菜', detail: '旧科普测试说十三道菜。' });
  content.kepuEdited.guanxi = { id: 'guanxi', name: '关西新围', detail: '关西新围最新测试原文，1798年始建。', videoUrl: source.window.QR_VIDEOS['15'] };
  if (records) {
    backend.sqlite.exec(read('migrations/admin/0002_content_records.sql'));
    await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  } else backend.sqlite.prepare("UPDATE admin_state SET value=? WHERE key='content'").run(JSON.stringify(content));
  const document = fakeDocument(), device = setupEnvironment(backend, { globals: { document, URL },
    windowProperties: { APP_CONFIG: { app: { canonicalUrl: 'https://longnankejia.pages.dev/' } } } });
  for (const file of ['knowledge-base.js', 'diancang-data.js', 'answer-engine.js']) vm.runInContext(read('js/' + file), device.sandbox);
  device.window.UI = { Heritage: { list: () => device.store.getHeritageCards([{ id: 'guanxi', name: '关西新围' }]) } };
  vm.runInContext(read('js/diancang.js'), device.sandbox); device.window.Diancang.init();
  await device.store.syncWithCloud();
  assert.equal(device.window.Diancang.openItem('燕翼围'), true);
  for (let i = 0; i < 40 && !document.getElementById('dcDetailBody').innerHTML.includes('燕翼围最新测试原文'); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(document.getElementById('dcDetailBody').innerHTML, /燕翼围最新测试原文/);
  assert.equal(device.window.Diancang.search('燕翼围最新测试原文')[0].item.name, '燕翼围');
  assert.equal(device.window.Diancang.findRelatedVideos('花带').some(item => item.name === '龙南客家织带制作技艺'), true);
  assert.equal(device.window.Diancang.videoExhibits().some(rec => rec.item.name === '关西新围'), false, 'cannot borrow the 乌石围 recording');
  const ranked = new device.window.AnswerEngine.RulesEngine().rank('客家一桌菜');
  assert.ok(ranked.chunks.length); assert.doesNotMatch(ranked.chunks.map(chunk => chunk.text).join(''), /十三道/);
  assert.match(ranked.chunks.map(chunk => chunk.text).join(''), /12道/);
  assert.ok(ranked.chunks.every(chunk => chunk.sources.some(ref => ref.url.includes('dc-yizhuocai'))));
  const load = device.store.loadRecord;
  let release;
  device.store.loadRecord = async (...args) => { await new Promise(resolve => { release = resolve; }); return load(...args); };
  device.window.Diancang.openItem('关西新围');
  device.window.Diancang.openItem('一桌菜'); release();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(document.getElementById('dcDetailBody').innerHTML, /12道/);
  assert.doesNotMatch(document.getElementById('dcDetailBody').innerHTML, /关西新围最新测试原文/);
});
