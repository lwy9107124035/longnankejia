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
index.html              页面骨架（六个 Tab + 五个弹层）
css/style.css           全部样式，配色变量集中在 :root

js/
  app.js                入口，装配问答流程
  router.js             视图路由：#/chat #/science #/model3d #/diancang #/hometown #/dialect
  ui.js                 聊天窗口、打字机、虚拟形象状态、访问地址面板
  answer-engine.js      问答引擎：本地知识库 / 线上大模型，可切换
  knowledge-base.js     内置非遗知识库
  store.js              localStorage 覆盖层（管理员改动存这里）
  admin.js              管理面板
  diancang.js           典藏模块：正文检索「指哪打哪」在这里（Diancang.search）
  diancang-data.js      典藏数据 + 书内国际音标 + QR 视频链接 + 讲解触发词
  dialect.js            客家方言语音库（16 段原声的播放列表）
  voice-input.js        问答框的语音输入：MediaRecorder 录音 + 国内 ASR 转写
  hometown.js           家乡地图：点真实坐标的乡镇/文保点，看书里怎么讲它
  data-hometown.js      龙南市真实县界 + 点位坐标（含来源与取数日期）
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
node tests/run_site_tests.mjs      # 只跑浏览器套件（193 项，--headed 可观看）
node tests/run_site_tests.mjs --only=7c,7d,4e    # 只跑某几节（反向用例要反复跑，整套 4 分钟跑不起）
python tests/check_copy_tells.py     # 界面文案套话计数（守卫要求 0）
python tests/decode_entry_qr.py    # 只解码入口二维码（需先跑浏览器套件）
python tests/negative_checks.py    # 反向用例：逐个把逻辑改坏，要求对应断言真的报 FAIL
python tests/check_hometown_sources.mjs 2>/dev/null || node scripts/check_hometown_sources.mjs  # 地图上每个点都要有书内出处
```

`negative_checks.py` 是给"典藏检索 / 家乡地图 / 语音输入"这三节配的：**每条新断言都必须能失败一次**。
跑出来的经验很直白：这一轮新写的断言里有六条在对应逻辑被改坏之后仍然通过——
详情弹层留着上一次的内容、搜索框没清空就判定"回车生效"、数据顺序恰好和正确顺序一致、
封顶规则挑的输入根本触不到上限、"以最后一次为准"两次的先后全看运气、以及一条把整节跑崩
而不是判失败的空节点访问。每一条都已改成能真的失败的样子。

三段是有意分开的：浏览器里「屏上的码等于面板那条链接」只是自证一致，
`decode_entry_qr.py` 用 OpenCV 把导出的 PNG 真的解回一个 URL，才算证明馆内手机扫得出来。
手写编码器就是在这一步暴露出问题的——图看着完全正常，解码返回空字符串。

两个专用排查工具：

```
node tests/probe_framing.mjs          # 量每个 3D 模型是否被视口裁切，输出 NDC 上下极值
python scripts/scan_history_secrets.py  # 扫全部历史 blob 找 sk- 形态密钥
```

部署之后另跑一次线上核验（本地全绿不代表线上那一份也换了）：

```
node scripts/check_live_qr.mjs            # 抓生产站入口码 → .cache/live-entry-qr.png
node scripts/check_live_qr.mjs https://longnankejia-dev.pages.dev/   # 抓 dev 预览那份
QR_PNG=.cache/live-entry-qr.png python tests/decode_entry_qr.py   # 解码，应等于被核验的那个网址
```

`scan_history_secrets.py` 的由来：`js/secrets.js` 一直在 `.gitignore` 里，但三个
一次性调试脚本曾把密钥硬编码后提交进历史，后来虽删掉文件，blob 仍可从中间历史读出。
**把整份历史备份传到任何外部存储之前都应先跑一次**——忽略某个文件不等于它没在
别的文件里出现过。

- `tests/check_static.py`：引用完整性（改目录后有没有漏改路径）、典藏页码是否都有对应图片、
  JS 语法、CSS 变量是否有悬空引用、`.gitignore` 是否仍忽略密钥、贴图角标回归，
  以及"入口二维码的生成器、加载顺序、容器、渲染四处必须在位"的守卫。
- `tests/run_site_tests.mjs`：驱动本机 Chrome，共 200 项断言，覆盖六个 Tab 切换与连点、
  六条快捷提问与自由提问、本地知识库引擎与线上大模型引擎两条问答路径、接口失败时的
  知识库回落、"本地命中就不调接口 / 未命中转大模型 / 三条路径都不拒答"、
  科普详情与「问问阿蓝」跳转、七个 3D 模型逐个渲染、自动旋转角度收敛、
  典藏翻页与详情、典藏正文检索（打分、命中句、标记、点进详情）、客家话讲解视频弹层、
  家乡地图（真实县界顶点数、点位是否落在县界内、标签是否压字、引文是否逐字出自书里、
  没录音就不给播放键）、语音输入（录音到转写的状态机、四条失败路径的提示、不自动发送）、
  访问地址面板（入口二维码已渲染、黑白比例合理、内容与面板链接逐像素一致）、
  方言语音库、hash 深链与未知路由回落、答案携带原声讲解、管理面板登录与知识库增改及
  刷新后持久化、360px 与 1280px 布局、页脚 AI 生成声明，
  最后断言无未捕获异常、无子资源加载失败（第三方的 404 不计）。

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
  指向客家话讲解视频，那些内容已在面板中直接列成 16 条链接，不要求任何人去扫码。
  编码器用 MIT 授权的 qrcode-generator（`js/vendor/qrcode.js`）——原先手写的 500 行
  实现画得出看似合法的图，OpenCV 却解不出内容。
- **`docs/龙南客家非遗数字助手二维码入口.png` 已作废。** 那是旧弹层的截图，码正是坏编码器
  画的，裁切放大到 6 倍仍解不出内容；要印展板请用 `docs/入口二维码.png`
  （`python scripts/make_entry_qr_png.py` 生成，脚本写完会自己解码验一遍）。
- 第三方方言视频页（hlcode.pro）与线上大模型接口的可达性不计入测试失败。
  测试过滤的是这些主机名，不是"状态码 404 一律放过"。
- **语音输入要三样齐全：** HTTPS（或 localhost）、用户允许麦克风、能连上
  `api.siliconflow.cn`。缺任何一样，按钮会说明原因并保持置灰，文字输入不受影响。
- **家乡地图的精度如实标注。** 四个文保点（乌石围/燕翼围/关西新围/太平桥）条目里
  本身就是两位小数坐标，约合 1 公里，界面上写着"条目坐标只精确到约 1 公里"；
  乡镇级点位是五位小数。取数脚本对"坐标落在县界外"的点直接丢弃而不是硬画。
- **`js/data-hometown.js` 是生成物**，不要手改；维基百科取不到坐标时脚本退回内置的
  取数快照，并拒绝写出少于 6 个点位的数据。

浏览器套件需要 `C:/Program Files/Google/Chrome/Application/chrome.exe`，无需安装任何依赖。

## 素材构建

```
python scripts/build_avatar.py      # 数字人形象.png → 抠图 / 裁切 / 表情层 → assets/avatar/
python scripts/strip_watermark.py   # 就地去除贴图角标，可重复执行
python scripts/sync_diancang_pages.py  # 重建展品的 PDF 页序映射 + data/exhibit-openings.json
python scripts/sync_diancang_text.py   # 从 PDF 注入展品原文全文到 diancang-data.js
python scripts/make_entry_qr_png.py    # 按 config.js 的 canonicalUrl 画展板成品图并自检解码
node   scripts/check_hometown_sources.mjs  # 复核地图上每个地点都还有书内出处（构建时由静态检查调用）
python scripts/build_hometown_map.py   # 取龙南市县界 + 乡镇坐标，生成 js/data-hometown.js
node   scripts/qr_matrix.mjs <文本>     # 用页面上同一个编码器把文本打成模块矩阵（上面那脚本调它）
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

## 典藏检索、方言原声与家乡地图

**检索放在典藏，不放方言。** 观众打一个词，多半是想找"书里哪件展品讲了它"，
而不是"哪条视频里说过它"。所以 `Diancang.search` 挂在典藏：42 件展品全文都能查，
展品名命中权重远高于正文顺带提到，每条命中带回到底是哪句话说了它，点一条直接翻到那页。

**方言面板只做一件事：16 段原声的播放列表。** 中途做过一版"打一个字给客家话读音"
（书内国际音标 + 萌典台湾六腔 + 原声出处，三层分开标注），验收时被否了：拼音不是
本地读法，观众要的是听本地人怎么说。那一版连同简繁转换表一起删掉了，
探测记录留在 `scripts/probe_tts.mjs`、`scripts/probe_search.mjs`：馆方没有客家话
语音合成模型，所以这里不合成、不假装会念。

**家乡地图**（`js/hometown.js`）用真实地理数据，不画示意图：底图是龙南市行政边界
（阿里云 DataV.GeoAtlas，源自国家基础地理信息中心公开数据，adcode 360783，简化到 160 个
顶点），点位坐标取自中文维基百科条目 infobox 的 coordinate 字段（Wikidata 上这些乡镇级
条目恰好没有 P625）。来源与取数日期写进 `js/data-hometown.js` 并显示在界面上。

两条刻意的克制：地图上**只画《文化典藏》真的写到的 7 个地方**（龙南镇、杨村镇、程龙镇、
里仁镇、汶龙镇、九连山镇、乌石围），书里没记的乡镇不标，点了没东西可讲的点等于让观众白点；
地点关联必须字面提到这个名字（"汶龙镇"可退到"汶龙"，只撞上"太平"两个字的不算）。
点一个地点给出书里的原句、页码和展品，配了录音的直接点开听；没录音就不给播放键。
`node scripts/check_hometown_sources.mjs` 会在构建时复核每个点都还有出处。

## 语音输入

问答框左边的麦克风：按一下说话，再按一下把话填进输入框（不自动发送，说错了能改）。
录音用 `MediaRecorder`，转写用硅基流动的 `SenseVoiceSmall`，与问答同一个 key。

刻意不用 Chrome 自带的 `webkitSpeechRecognition`：那套要把音频发到谷歌服务器，
馆内网络连不通，点了只会转到超时。`tests/run_site_tests.mjs` 里有一条断言盯着这件事
（剥掉注释后，模块代码里不许再出现 `SpeechRecognition`）。

四条失败路径都要说清楚原因，不许静默：麦克风被拒、设备没有麦克风、服务没回应、
没配密钥。没配密钥时（比如不带密钥的预览地址）按钮置灰并说明，文字输入照常可用——密钥只随部署
注入 `js/secrets.js`，管理面板里没有填密钥的地方，提示语也不许指错路。

## 界面文案的去 AI 处理

按社区技能 `humanizer-zh`（blader/humanizer 的汉化版）的判据过了一遍界面文案：
删掉句尾拔高与格言式收尾、把当万能连接用的破折号改成冒号或拆句、去掉"匠心/环保无害"
这类无内容的赞美词，并把提示词里"可适当使用一个 emoji"这条**主动制造 AI 味**的指令删了。
《文化典藏》的引文（`js/diancang-data.js` 的 `text`/`desc`）一个字没动，事实、数字、
年代、限定语全部保留。

`tests/check_copy_tells.py` 把这套判据里能机械匹配的部分固化成守卫：剥掉注释与引文后，
20 个套话词在 8 个界面文件里必须为 0；`check_static.py` 每次构建都跑它。
反向用例 `S1` 会把"靛蓝匠心"塞回文案，确认这道守卫真的会红。

**这道守卫管的是套话，不是检测器分数。** 没有任何办法保证第三方 AI 检测工具的读数，
它也不该是目标：文案的目标是读者读着像人写的。

## 部署

生产站：**https://longnankejia.pages.dev/**（`main`，Cloudflare Pages）
开发预览：**https://longnankejia-dev.pages.dev/**（`dev`，豆包的工作分支）
镜像：https://lwy9107124035.github.io/longnankejia/ 与 …/dev/（GitHub Pages）
备用宿主：https://prismatic-syrniki-1e0e96.netlify.app（Netlify，额度耗尽后只手动）

两条自动通道（`cf-pages.yml` 与 `pages.yml`）都只做一件事：**按白名单**把页面真正加载的
东西（`index.html`、`css/`、`js/`、`assets/{avatar,pdf-imgs,textures}`）搬进上线目录。
不是排除表——以前 Netlify 用 `publish = "."` 把整个仓库推上公网，实测
`tests/badge-template.npy`、`scripts/scan_history_secrets.py` 和 8MB 的 `assets/source/`
原图都能直接下载，而 `docs/` 里是比赛通知与简历。注意 Cloudflare 对不存在的路径回的是
**200 + 一段 HTML 提示页**，所以核对上线集要比对 `Content-Type`，不能只看状态码。

三点约定，都有守卫且跑过反向用例：

- **dev 预览不注入 API Key**（`js/secrets.js` 写空 key，页面按设计回落到本地知识库引擎）。
  预览站是另一个公开域名，不该再带一份线上密钥——这个 key 之前已经泄露过一次。
- **CI 用的 Cloudflare 令牌只有一项权限**：`Account → Cloudflare Pages → Edit`。
  官方 "Edit Cloudflare Workers" 模板会连带 13 项（Workers KV/R2/Scripts、Memberships、
  Account Settings…），对只推静态站的 CI 太宽，所以走 Custom Token。
- **工作流文件只存在于 `main`**，靠显式 `ref: dev` 取开发分支内容（`pages.yml`）。GitHub 读的是
  「被 push 那个 ref」里的工作流，而 `dev` 是豆包的专属分支（见 dev 上的 `AI_OWNER.md`），
  不该由我提交——所以 **dev 的 CF/GitHub Pages 更新要等 dev 同步过 main 才会自动跑**，
  在那之前靠 `main` 的推送与每小时 `:17` 定时（仅 `pages.yml`）。

GitHub Pages 那条通道需要仓库 Settings → Pages 的 Source 选 **GitHub Actions**（已设好）。

### 为什么离开 Netlify

Netlify 2025 年起按 credits 计费。这个账号的免费额度用完且未绑卡，之后**任何新的生产部署**
都会被挡，报错原文是 `Account credit usage exceeded - new deploys are blocked until credits are added`
（CLI 只回一个 `Forbidden`，得直接打 REST 接口才看得到这句）。现网不受影响，仍返回 200
并停在上一次成功的部署上。额度周期从每月 14 日起算。

`deploy.yml` 因此改成**只手动触发**，留作额度恢复后的备用通道；它现在还挡住了非 main 分支，
避免重演 `dev--…` 那种永不更新的别名站（那个站已按 `branch == "dev"` 精确删掉 19 条 deploy）。

### 入口二维码与地址

页面上的码**跟随当前网址**：部署到哪儿就扫出哪儿，`app.publicUrl` 留空即可，
换宿主不用再改代码（`file://` 直接双击预览时才退回 `app.canonicalUrl`）。
印展板的成品图另说——它取 `js/config.js` 的 `app.canonicalUrl`，由
`python scripts/make_entry_qr_png.py` 用**页面上同一个编码器**（经 `scripts/qr_matrix.mjs`）
生成，写完自检解码；`check_static.py` 会核对成品图与 `canonicalUrl` 一致，脱节直接 FAIL。
