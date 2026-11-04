import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const catalog = JSON.parse(read('data/hometown-places.json'));

function loadMap(search = () => []) {
  const element = () => ({
    innerHTML: '', querySelector: () => null, querySelectorAll: () => [],
  });
  const map = element(), text = element();
  const window = { Diancang: { search } };
  const context = vm.createContext({
    window,
    document: { getElementById: (id) => id === 'hmMap' ? map : text },
  });
  vm.runInContext(read('js/data-hometown.js'), context);
  vm.runInContext(read('js/hometown.js'), context);
  window.Hometown.init();
  return { window, map, text, data: JSON.parse(JSON.stringify(window.HOMETOWN)) };
}

test('生成文件保留全部22个复核点位、介绍与逐点来源', () => {
  const { data } = loadMap();
  assert.equal(data.places.length, 22);
  assert.deepEqual(data.places, catalog.places);
  assert.equal(data.retrieved, catalog.verified);
  assert.equal(data.source.points, catalog.source);
  for (const p of data.places) {
    assert.ok(p.desc && p.coordinateSource.label, p.name);
    assert.equal(p.coordinateSystem, 'WGS84');
    assert.ok(p.coordinateSource.url || (p.approximate && p.coordinateSource.pixel), p.name);
  }
});

test('分布图中的七处文保点分别落在正确区域', () => {
  // 独立于生成清单，防止杨村点群再次移到城区北面、关西和里仁再次移到西侧。
  const regions = {
    '燕翼围': [114.62, 24.63, 114.64, 24.645],
    '太平桥': [114.62, 24.65, 114.64, 24.665],
    '乌石围': [114.66, 24.625, 114.68, 24.64],
    '关西新围': [114.93, 24.84, 114.95, 24.86],
    '栗园围': [114.85, 24.89, 114.88, 24.915],
    '渔仔潭围': [114.88, 24.88, 114.91, 24.90],
    '玉石仙岩': [114.79, 24.925, 114.81, 24.945],
  };
  const { data } = loadMap();
  for (const [name, b] of Object.entries(regions)) {
    const p = data.places.find((p) => p.name === name);
    assert.ok(p.lon >= b[0] && p.lat >= b[1] && p.lon <= b[2] && p.lat <= b[3], name);
  }
  const byName = Object.fromEntries(data.places.map((p) => [p.name, p]));
  assert.ok(byName['太平桥'].lat > byName['燕翼围'].lat);
  assert.ok(byName['乌石围'].lon > byName['燕翼围'].lon);
  assert.ok(byName['栗园围'].lon < byName['渔仔潭围'].lon);
  assert.ok(byName['栗园围'].lat > byName['渔仔潭围'].lat);
  assert.match(byName['渔仔潭围'].desc, /里仁镇新里村/);
});

test('所有点位在行政轮廓内，乡镇分布符合分布图', () => {
  const { data } = loadMap();
  for (const p of data.places) {
    let inside = false;
    for (let i = 0, j = data.outline.length - 1; i < data.outline.length; j = i++) {
      const a = data.outline[i], b = data.outline[j];
      if ((a[1] > p.lat) !== (b[1] > p.lat)
          && p.lon < (b[0] - a[0]) * (p.lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    assert.ok(inside, p.name);
  }
  const byName = Object.fromEntries(data.places.map((p) => [p.name, p]));
  assert.ok(byName['杨村镇'].lat < 24.66 && byName['杨村镇'].lon < 114.65);
  assert.ok(byName['汶龙镇'].lon > 114.88 && byName['汶龙镇'].lat < 24.80);
  assert.ok(byName['程龙镇'].lon < 114.70 && byName['程龙镇'].lat > 24.82);
  assert.ok(byName['里仁镇'].lon > 114.85);
  assert.ok(byName['九连山镇'].lon < byName['杨村镇'].lon);
  assert.ok(byName['南武当山'].lon > byName['杨村镇'].lon);
});

test('两处配准点可由参考像素复算，并明确显示近似定位', () => {
  const { window, data, map, text } = loadMap();
  const matrix = catalog.reference.registration.coefficients;
  const approximate = data.places.filter((p) => p.approximate);
  assert.deepEqual(approximate.map((p) => p.name), ['栗园围', '玉石仙岩']);
  for (const p of approximate) {
    const [x, y] = p.coordinateSource.pixel;
    const lon = x * matrix[0][0] + y * matrix[1][0] + matrix[2][0];
    const lat = x * matrix[0][1] + y * matrix[1][1] + matrix[2][1];
    assert.ok(Math.abs(lon - p.lon) < 0.0005 && Math.abs(lat - p.lat) < 0.0005, p.name);
    window.Hometown.select(window.HOMETOWN.places.find((v) => v.name === p.name));
    assert.match(text.innerHTML, /近似位置，约公里级/);
    assert.ok(text.innerHTML.includes('约 ' + p.lat.toFixed(3)));
  }
  assert.match(map.innerHTML, /栗园围、玉石仙岩为近似位置/);
});

test('东江镇保留旧称检索，地点介绍与典藏引文分别标注', () => {
  const hit = { item: { name: '东江乡风物', desc: '东江乡的客家文化' }, sentence: '东江乡的客家文化' };
  const { window, map, text } = loadMap((word) => word === '东江乡' ? [hit] : []);
  assert.match(text.innerHTML, /客家围屋360余座/);
  assert.match(text.innerHTML, /各级文物保护单位与保护点达60余处/);
  assert.match(text.innerHTML, /精选收录典藏重点记载的名胜与全域乡镇/);
  assert.doesNotMatch(text.innerHTML, /其中包含 8 处文保与名胜/);
  const p = window.Hometown.places().find((p) => p.name === '东江镇');
  assert.equal(window.Hometown.exhibitsFor('东江镇')[0], hit);
  window.Hometown.select(p);
  assert.match(text.innerHTML, /旧称“东江乡”/);
  assert.match(text.innerHTML, /《文化典藏》/);
  window.Hometown.select(window.Hometown.places().find((p) => p.name === '临塘乡'));
  assert.match(text.innerHTML, /——地点介绍/);
  assert.doesNotMatch(text.innerHTML, /——龙南文保与地方志收录/);
  assert.match(map.innerHTML, /重点文保 8/);
  assert.match(map.innerHTML, /重点文保（全域60余处）/);
});
