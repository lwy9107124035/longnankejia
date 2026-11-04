# 家乡地图

## 2026-11-04 文保分布图校正

`龙南市地图.jpg` 为2023年9月《龙南市文物保护单位分布图》。本轮复核现有22个地点，原160点行政轮廓与包围盒逐项一致。

- 杨村镇、燕翼围、乌石围和太平桥移至西南部，太平桥位于燕翼围北侧。
- 关西镇与关西新围移至东部，里仁镇、栗园围与渔仔潭围位于城区东侧，渔仔潭围介绍纠正为里仁镇新里村。
- 程龙、汶龙、九连山、武当及其余乡镇按公开坐标复核。东江采用现行名称“东江镇”，旧称“东江乡”继续参与典藏检索。
- 栗园围与玉石仙岩按主图像素配准估算，页面明确显示约公里级精度。玉石仙岩对应图中的“玉石岩石刻”。控制点、原图尺寸、仿射参数、逐点来源均保存在 `data/hometown-places.json`。
- 南武当山与渔仔潭围的高德原始GCJ-02坐标及其换算后的WGS84坐标均记录在清单中。其余公开条目坐标使用带区县限定的条目名称，避免同名乡镇。
- `scripts/build_hometown_map.py` 从已复核清单生成 `js/data-hometown.js`，保留22个地点的介绍、亮点和来源。旧脚本的7点清单与错误兜底坐标已移除。

东江现行名称与渔仔潭围归属分别核对龙南市政府的[基层政务公开目录](https://www.jxln.gov.cn/lnzf/c104729/jczwgkbzh.shtml)和[沙坝围与渔仔潭围的位置关系](https://www.jxln.gov.cn/lnzf/c104708/202205/02724f31a0a14ef4b2f8f778c51f7966.shtml)。各地点坐标链接随清单保留，详情页可打开来源。

## 交互与关联介绍

保留 `window.Hometown.init() / select() / exhibitsFor() / places()`。地图支持按钮、滚轮和双指缩放、拖动、重置、分类筛选与地点列表。移动超过6个屏幕像素后不触发点选。地理坐标固定，标签使用引线避让，直接点击标签优先选中该地点。

典藏原文与地点介绍分别标注。数字表示关联介绍条目数，风景名胜和文保单位共同显示在“文保名胜”筛选中。近似定位说明在选择地点后继续显示。

页面使用地图正式名称和地点介绍，来源说明采用中性表述。近似位置提示仍在地图和地点详情中显示。

## 验证记录

- 中性文案调整后，已逐项核对地图首页与22个地点详情，清理角色来源和内部制图过程表述。5项地图回归与静态检查通过，静态检查记录在 `.cache/map-reference-review/neutral-copy-static.txt`。
- `node --test tests/hometown-map.test.mjs` 已通过5项，覆盖生成清单一致性、七处文保点的独立区域断言、全部点位落在多边形内、配准复算与近似提示、东江旧称检索。
- `node tests/run_site_tests.mjs --only=7d` 最终通过30项，证据在 `.cache/map-reference-review/browser-tests-final.txt`。
- `python tests/check_static.py` 通过。`node scripts/check_hometown_sources.mjs` 校验逐点坐标来源与关联介绍。
- `node tests/v2_visual_review.mjs --map-only` 最终通过32项，包含360px下全部22个地名逐一触屏模拟点选、拖动、双指缩放、筛选与320px布局。首次检查发现标签点击误选，原失败证据保留为 `touch-review-before.txt`。修正标签指针事件和命中优先级后，`touch-review-final.txt`、`report.json` 记录32/32通过与零脚本异常。另修复该脚本地图模式误等待3D初始化的问题。
- `.cache/map-reference-review/map-detail.png` 与 `mobile-map.png` 已实际查看。生成脚本重跑后逐字一致，轮廓与包围盒对照HEAD逐项一致。5项数据回归、30项地图浏览器检查、32项触屏模拟合计67项通过。
