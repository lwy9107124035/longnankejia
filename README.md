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
  showcase3d.js         3D 模型（虎头帽 / 客家围屋 / 蓝染布）
  textures.js           程序化贴图辅助
  config.js             全局配置（AI 模式、模型参数、公网地址）
  secrets.js            API 密钥，已在 .gitignore 中，不入库
  vendor/three.min.js   Three.js r128

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
python tests/run_all.py            # 静态检查 + 真实 Chrome 端到端
python tests/run_all.py --static   # 只跑静态检查，不需要 Chrome
node tests/run_site_tests.mjs      # 只跑浏览器套件（--headed 可观看）
```

- `tests/check_static.py`：引用完整性（改目录后有没有漏改路径）、典藏页码是否都有对应图片、
  JS 语法、CSS 变量是否有悬空引用、`.gitignore` 是否仍忽略密钥、贴图角标回归，
  以及"代码里不得再出现二维码渲染器"的守卫。
- `tests/run_site_tests.mjs`：驱动本机 Chrome，共 86 项断言，覆盖四个 Tab 切换与连点、
  六条快捷提问与自由提问、本地知识库引擎与线上大模型引擎两条问答路径、接口失败时的
  知识库回落、科普详情与「问问阿蓝」跳转、三个 3D 模型逐个渲染、自动旋转角度收敛、
  典藏翻页与详情、客家话讲解视频弹层、访问地址面板、方言语音库、hash 深链与未知路由回落、
  答案携带原声讲解、管理面板登录与知识库增改及刷新后持久化、360px 与 1280px 布局、
  页脚 AI 生成声明，最后断言无未捕获异常、无子资源加载失败。

## 已知边界

- **没有联网搜索。** 硅基流动的 OpenAI 兼容端点在这个 key 下不提供搜索：
  `enable_search` 被静默忽略，`/v1/models` 返回的 95 个模型无一带搜索，
  `/search`、`/web/search` 均 404。探测脚本留在 `scripts/probe_search.mjs`，
  换 key 或换供应商可以直接重跑。宁可不放这个按钮，也不放一个假装能搜的。
- **全站不渲染二维码。** 顶栏「访问地址」面板把站点地址做成可点链接，
  并把书里每个展品二维码背后的 14 条客家话讲解页直接列出来。
- 第三方方言视频页（hlcode.pro）与线上大模型接口的可达性不计入测试失败。

浏览器套件需要 `C:/Program Files/Google/Chrome/Application/chrome.exe`，无需安装任何依赖。

## 素材构建

```
python scripts/build_avatar.py      # 数字人形象.png → 抠图 / 裁切 → assets/avatar/
python scripts/strip_watermark.py   # 从 .cache 原始图重建去角标贴图，可重复执行
```

两个脚本都是幂等的：`strip_watermark.py` 每次都从 `.cache/texture-originals/` 里的原始图重新生成，
反复运行不会叠加处理痕迹。

## 问答引擎

`js/config.js` 里 `ai.mode` 决定走哪条路：

- `'rules'`：本地知识库，离线可用，演示时最稳。
- `'api'`：调用硅基流动 OpenAI 兼容接口，密钥从 `js/secrets.js` 读取；请求失败会自动回落本地库。

页面底部的「⚙ 管理入口」可在运行时切换（存 localStorage，不改源码）。

## 部署

推送到 GitHub 后由 Netlify 自动构建，详见 `docs/部署说明.txt`。
`netlify.toml` 中 `publish = "."`，因此 `index.html` 必须留在仓库根目录。
