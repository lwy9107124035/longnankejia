# 龙南客家非遗数字助手 · 阿蓝

世界客家非物质文化遗产展示馆的移动端讲解助手：问答、科普、3D 模型、文化典藏四合一。
纯静态站点，无构建步骤，直接托管即可运行。

## 本地运行

```
双击 qidong.bat          # 起本地服务并打印扫码地址
双击 zhanting.bat        # 停止服务
```

或手动：`python -m http.server 8787`，浏览器打开 `http://127.0.0.1:8787`。

## 目录结构

```
index.html              页面骨架（四个 Tab + 五个弹层）
css/style.css           全部样式，配色变量集中在 :root

js/
  app.js                入口，装配问答流程
  router.js             视图路由：#/chat #/science #/model3d #/diancang #/dialect
  ui.js                 聊天窗口、打字机、虚拟形象状态、访问地址面板
  answer-engine.js      问答引擎：本地知识库 / 线上大模型，可切换
  knowledge-base.js     内置非遗知识库
  store.js              localStorage 覆盖层（管理员改动存这里）
  admin.js              管理面板
  diancang.js           典藏模块
  diancang-data.js      典藏数据 + QR 视频链接 + 讲解触发词
  dialect.js            客家方言语音库
  showcase3d.js         3D 模型（7 件，见下）
  textures.js           程序化贴图生成器（canvas 现画，无外部图片）
  config.js             全局配置（AI 模式、模型参数、公网地址）
  qr.js                 入口二维码（把站点地址画成可扫的码）
  secrets.js            API 密钥，已在 .gitignore 中，不入库
  vendor/three.min.js   Three.js r128
  vendor/qrcode.js      qrcode-generator 2.0.4（MIT，Kazuhiko Arase）—— 二维码编码器

assets/
  avatar/               数字人形象：alan-full.png 全身、alan-face.png 头像
  textures/             3D 模型贴图（已去除生成平台角标）
  pdf-imgs/             文化典藏逐页图 page-01..69.jpg
  source/               原始素材，不参与页面加载

data/                   二维码抓取中间产物，供 diancang-data.js 溯源
docs/                   比赛通知、实践报告、部署说明、典藏 PDF 原件
scripts/                素材构建脚本
tests/                  自动化检查
_archive/               历史克隆副本，仅供追溯
```

## 测试

```
python tests/run_all.py            # 静态检查 + Chrome 端到端 + 二维码解码（三段）
python tests/run_all.py --static   # 只跑静态检查，不需要 Chrome
node tests/run_site_tests.mjs      # 只跑浏览器套件（113 项，--headed 可观看）
python tests/decode_entry_qr.py    # 只解码入口二维码（需先跑浏览器套件）
```

三段是有意分开的：浏览器里「屏上的码等于面板那条链接」只是自证一致，
`decode_entry_qr.py` 用 OpenCV 把导出的 PNG 真的解回一个 URL，才算证明馆内手机扫得出来。
手写编码器就是在这一步暴露出问题的——图看着完全正常，解码返回空字符串。

两个专用排查工具：

```
node tests/probe_framing.mjs          # 量每个 3D 模型是否被视口裁切，输出 NDC 上下极值
python scripts/scan_history_secrets.py  # 扫全部历史 blob 找 sk- 形态密钥
```

`scan_history_secrets.py` 的由来：`js/secrets.js` 一直在 `.gitignore` 里，但三个
一次性调试脚本曾把密钥硬编码后提交进历史，后来虽删掉文件，blob 仍可从中间历史读出。
**把整份历史备份传到任何外部存储之前都应先跑一次**——忽略某个文件不等于它没在
别的文件里出现过。

- `tests/check_static.py`：引用完整性（改目录后有没有漏改路径）、典藏页码是否都有对应图片、
  JS 语法、CSS 变量是否有悬空引用、`.gitignore` 是否仍忽略密钥、贴图角标回归，
  以及"入口二维码的生成器、加载顺序、容器、渲染四处必须在位"的守卫。
- `tests/run_site_tests.mjs`：驱动本机 Chrome，共 113 项断言，覆盖四个 Tab 切换与连点、
  六条快捷提问与自由提问、本地知识库引擎与线上大模型引擎两条问答路径、接口失败时的
  知识库回落、科普详情与「问问阿蓝」跳转、七个 3D 模型逐个渲染、自动旋转角度收敛、
  典藏翻页与详情、客家话讲解视频弹层、访问地址面板（入口二维码已渲染、黑白比例合理、
  内容与面板链接逐像素一致）、方言语音库、hash 深链与未知路由回落、
  答案携带原声讲解、管理面板登录与知识库增改及刷新后持久化、360px 与 1280px 布局、
  页脚 AI 生成声明，最后断言无未捕获异常、无子资源加载失败。

## 3D 模型

共 7 件，全部用 Three.js 手工建模，贴图一律由 `js/textures.js` 在 canvas 上现画
（竹篾经纬、织带菱形纹、酱釉垂流与开片、靛蓝棉麻），**不引入任何外部图片**，
因此不存在生成平台角标，也不涉及 AI 内容标识义务。

| id | 物件 | 贴图 |
|---|---|---|
| hutoumao | 虎头帽 | 典藏刺绣照片（已去角标） |
| weiwu | 客家围屋 | 夯土墙 / 瓦顶 / 条石（已去角标） |
| landye | 蓝染布 | 蓝染纹样（已去角标） |
| liangmao | 客家凉帽 | canvas 竹编 + 靛蓝垂布 |
| boji | 竹编簸箕 | canvas 竹编 |
| zhidai | 客家织带 | canvas 织带纹样 |
| mijiutan | 客家米酒坛 | canvas 酱釉 |

`tests/run_site_tests.mjs` 会逐个渲染并断言：新增模型没有发起任何贴图图片请求。

## 已知边界

- **没有联网搜索。** 硅基流动的 OpenAI 兼容端点在这个 key 下不提供搜索：
  `enable_search` 被静默忽略，`/v1/models` 返回的 95 个模型无一带搜索，
  `/search`、`/web/search` 均 404。探测脚本留在 `scripts/probe_search.mjs`，
  换 key 或换供应商可以直接重跑。宁可不放这个按钮，也不放一个假装能搜的。
- **入口二维码可扫。** 顶栏「扫码访问」把站点地址画成二维码，馆内观众扫一下即开本站；
  面板里同时保留可点链接，照顾不方便扫码的场合。注意区分：典藏 PDF 每页旁印刷的二维码
  指向客家话讲解视频，那些内容已在面板中直接列成 14 条链接，不要求任何人去扫码。
  编码器用 MIT 授权的 qrcode-generator（`js/vendor/qrcode.js`）——原先手写的 500 行
  实现画得出看似合法的图，OpenCV 却解不出内容。
- 第三方方言视频页（hlcode.pro）与线上大模型接口的可达性不计入测试失败。

浏览器套件需要 `C:/Program Files/Google/Chrome/Application/chrome.exe`，无需安装任何依赖。

## 素材构建

```
python scripts/build_avatar.py      # 数字人形象.png → 抠图 / 裁切 / 表情层 → assets/avatar/
python scripts/strip_watermark.py   # 就地去除贴图角标，可重复执行
python scripts/sync_diancang_pages.py  # 重建展品的 PDF 页序映射 + data/exhibit-openings.json
python scripts/sync_diancang_text.py   # 从 PDF 注入展品原文全文到 diancang-data.js
```

`strip_watermark.py` 不依赖任何缓存目录：它先用 `tests/badge-template.npy` 量每张图与角标
的相关度，只处理仍然命中的那些，已干净的跳过。模板缺失时直接拒绝运行，以免把处理过的
贴图再补一遍。

两个 `sync_*` 脚本直接读 `docs/世界客家非遗展示馆文化典藏.pdf`（PyMuPDF），PDF 不在就报错退出。

`.cache/` 是纯临时目录（测试截图、构建预览），随时可删，脚本不依赖它；已在 `.gitignore` 中。
带角标的贴图原件不入库，另存于 OneDrive 备份目录。

## 问答引擎

`js/config.js` 里 `ai.mode` 决定走哪条路：

- `'rules'`：本地知识库，离线可用，演示时最稳。
- `'api'`：调用硅基流动 OpenAI 兼容接口，密钥从 `js/secrets.js` 读取；请求失败会自动回落本地库。

页面底部的「⚙ 管理入口」可在运行时切换（存 localStorage，不改源码）。

## 部署

推送到 GitHub 后由 Netlify 自动构建，详见 `docs/部署说明.txt`。
`netlify.toml` 中 `publish = "."`，因此 `index.html` 必须留在仓库根目录。

生产站：**https://prismatic-syrniki-1e0e96.netlify.app**

只有 `main` 会自动部署。其他分支不再由 push 触发——别名部署会在 Netlify 上留下一个
公开、且冻结在最后一次构建的预览站，不会随后续修改更新；需要预览时用
`workflow_dispatch` 手动跑一次。`tests/check_static.py` 会守住这条规则。

注意：历史上 `dev` 分支留下的 `dev--prismatic-syrniki-1e0e96.netlify.app` 仍是旧版本
（内联 SVG 头像、未去水印的贴图，入口二维码用的是后来发现解不出内容的手写编码器），
而 `dev` 分支已删除，它不会再更新。
要清掉需在 Netlify 控制台删除该 deploy 或别名，本机未登录 Netlify CLI 所以无法代做。
