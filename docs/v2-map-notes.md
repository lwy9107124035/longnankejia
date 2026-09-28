# 家乡地图 v2

`js/hometown.js` 保留 `window.Hometown.init() / select() / exhibitsFor() / places()`，以及现有真实县界、坐标、书内引文和音频关联。交互层只使用 `window.HOMETOWN` 中已有的 7 个点；没有补造地名或坐标。

在 `index.html` 的 `css/style.css` 后加载 `css/v2-map.css`。新版地图提供按钮缩放、滚轮缩放、双指缩放、拖动平移、重置、按地点类型筛选和地点快捷列表。地图点位 tap 与 pan/pinch 分开识别：手势移动超过 6 个屏幕像素后不触发地点选择；地图命中按屏幕像素在邻近点中选最近标记，命中半径为 23px。地点列表按钮高度至少 44px，窄屏时自动换行。

缩放不会改写坐标数据或标签锚点；标签、县界和点位一起缩放，近距离查看时减少原始视图中的拥挤。地图取数说明仍从 `HOMETOWN.source` 与 `HOMETOWN.retrieved` 显示。地点说明和引用继续由原有 `exhibitsFor()` 计算。

验证：`node scripts/check_hometown_sources.mjs`；`node tests/run_site_tests.mjs --only=7d`。集成后还需由主代理完成样式集成与浏览器验收。
