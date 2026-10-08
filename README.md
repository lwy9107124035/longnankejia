# 龙南客家非遗数字助手 · 阿蓝

当前工作版继续落实针对 v2 的修改意见：3D 展示扩为 12 件，提供逐件原图/原视频对照画廊；关西新围、织带和蓝染样布按可见参考细节补充；家乡地图加入缩放、平移和地点筛选；知识库补充非遗资料并区分蓝染“相似处”和“差异”问法。

模型按照片与公开资料制作，**不是扫描或测绘复原**。关西新围展示方形围合、低墙、四角炮楼和中央祠堂的总体关系，具体尺寸和内部结构不作实测断言。模型来源与表达范围见[12 件模型说明](docs/v2-model-notes.md)，实际意见和实施证据见[逐条需求审计](docs/v3-requirements-audit.md)。

2026-10-02 更新：大襟衫和子孙袋去除方盒背板，补全连续衣身和软布囊；其他布艺、花帽和纸艺补充曲面、内衬和纵深。问答采用多方检索、连续对话、模型选择证据句与原文事实呈现。用户下载的公众号文章17页已读取，整理为9个带页码的主题条目。模型、知识及代理45项、全页回归222项和静态检查通过；12件模型完成四向及手机核对。线上检查与真实接口记录见[逐条需求审计](docs/v3-requirements-audit.md)。

2026-10-03 更新：12件模型按布、木、竹、纸、矿物与陶瓷分别处理表面凹凸、粗糙度与反光，保留原图织纹和刺绣；衣身、袋囊与帽体衔接进一步柔化，竹篾加入细微宽度和色差。统一改用柔和展陈灯光、环境反射与接触阴影。程序生成的材质和由照片对比度估算的凹凸用于改善观感，不代表扫描数据。完整验证记录见[逐条需求审计](docs/v3-requirements-audit.md)。

2026-10-08 更新：先将 `codex` 的完整文件树同步为 `antigravity` 的 `e1a1ca4`，再细调虎头帽的额顶绣饰与后披下摆。修复《月光光》音频未被复制到发布目录的问题，保留 MP3 与 M4A 两种音频来源，增加加载失败提示与浏览器真实播放、暂停、跳转检查。

世界客家非物质文化遗产展示馆的移动端讲解助手：问答、科普、3D 模型、文化典藏四合一。
纯静态站点，无构建步骤，直接托管即可运行。

## 本地运行

```
双击 qidong.bat          # 起本地服务，并告诉你是哪个分支、线上四个地址各是什么
双击 地址.html           # 四个分支的入口页，点开即用（也能直接收藏到浏览器）
双击 zhanting.bat        # 停止服务
```

或手动：`python -m http.server 8788`，浏览器打开 `http://127.0.0.1:8788`。

**本地预览看的是这个文件夹当前检出（checkout）的那一份**，跟线上不一定是同一件事：
分支要 push 并且部署过，线上才会变。qidong.bat 会打印 `branch <名字> @ <commit>`
和工作区是否干净，就是为了回答"我现在看的到底是哪一份"。

## 各分支的线上地址（手机也能直接开，不必启动任何东西）

双击仓库根目录的 **`地址.html`** 就是这一页的可视化版本，四条地址做成大卡片，点一下就开。

| 分支 | 地址 | 谁在用 |
| --- | --- | --- |
| `main` | https://longnankejia.pages.dev/ | 正式入口，展板上印的就是它 |
| `qcode` | https://qcode.longnankejia-dev.pages.dev/ | 本次改动验收分支 |
| `doubao` | https://longnankejia-dev.pages.dev/ | 豆包的工作分支 |
| `codex` | https://codex.longnankejia-dev.pages.dev/ | v2 工作与预览分支 |

四条都是 Cloudflare Pages 的固定地址，不会每次部署换域名；带 `*.pages.dev` 的预览
属于同一个项目 `longnankejia-dev`，分支名就是子域名。想比较两个版本，开两个浏览器
窗口分别访问即可。四个分支的 API 参数一致；密钥只绑定在 Cloudflare Pages Functions
服务端，浏览器静态资源不包含密钥。codex 分支从 main 的 v2 基线开始并自动部署；
3D 模型和 v2 页面改动只进 codex。

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
  diancang.js           典藏模块：正文检索在这里（Diancang.search）
  diancang-data.js      典藏数据 + 书内国际音标 + QR 视频链接 + 讲解触发词
  dialect.js            客家方言语音库（16 段原声的播放列表）
  voice-input.js        问答框的语音输入：MediaRecorder 录音 + 国内 ASR 转写
  hometown.js           家乡地图：点真实坐标的乡镇/文保点，看书里怎么讲它
  data-hometown.js      龙南市真实县界 + 点位坐标（含来源与取数日期）
  showcase3d.js         3D 展示、旋转/缩放和原图对照画廊（12 件）
  models-place.js       围屋与蓝染样布模型
  models-textiles.js    花帽、织带、冬头帕、大襟衫、子孙袋、脖围模型
  models-crafts.js      竹编、织机和纸艺模型
  model-references.js   模型关联的原图、视频及原始路径
  textures.js           程序化贴图生成器
  config.js             全局配置（AI 模式、模型参数、公网地址）
  qr.js                 入口二维码（把站点地址画成可扫的码）
  secrets.js            API 密钥，已在 .gitignore 中，不入库
  vendor/three.min.js   Three.js r128
  vendor/qrcode.js      qrcode-generator 2.0.4（MIT，Kazuhiko Arase）—— 二维码编码器

assets/
  avatar/               数字人形象：alan-full.png 全身、alan-face.png 头像
  model-references/     供网页画廊展示的原图/视频副本
  model-textures/       由参考图裁切或程序生成的模型贴图
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
node tests/run_site_tests.mjs      # 浏览器套件（可加 --headed 查看过程）
node tests/run_site_tests.mjs --only=7c,7d,4e    # 只跑指定小节
python tests/check_copy_tells.py     # 界面文案套话计数（守卫要求 0）
python tests/decode_entry_qr.py    # 只解码入口二维码（需先跑浏览器套件）
python tests/negative_checks.py    # 反向用例：逐个把逻辑改坏，要求对应断言真的报 FAIL
python tests/check_hometown_sources.mjs 2>/dev/null || node scripts/check_hometown_sources.mjs  # 地图上每个点都要有书内出处
```

`negative_checks.py` 用反向用例核对断言是否能发现对应逻辑被破坏。维护这些测试时，新增或修改断言都应配套一个能触发失败的反例。

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
- `tests/run_site_tests.mjs`：驱动本机 Chrome，覆盖六个 Tab 切换与连点、
  六条快捷提问与自由提问、本地知识库引擎与线上大模型引擎两条问答路径、接口失败时的
  知识库回落、"明确概述本地回答 / 具体问题检索后整理 / 证据不足说明缺口"、
  科普详情与「问问阿蓝」跳转、12 个 3D 模型逐个渲染、原图对照画廊、自动旋转角度收敛、
  典藏翻页与详情、典藏正文检索（打分、命中句、标记、点进详情）、客家话讲解视频弹层、
  家乡地图（真实县界顶点数、点位是否落在县界内、标签是否压字、引文是否逐字出自书里、
  没录音就不给播放键）、语音输入（录音到转写的状态机、六条失败路径的提示、等待秒数如实报、
  不自动发送）、访问地址面板（入口二维码已渲染、黑白比例合理、内容与面板链接逐像素一致、
  面板里不许再长出解释性段落）、
  方言语音库、hash 深链与未知路由回落、答案携带原声讲解、管理面板登录与知识库增改及
  刷新后持久化、360px 与 1280px 布局，
  最后断言无未捕获异常、无子资源加载失败（第三方的 404 不计）。

## 3D 模型

当前 12 件模型由 Three.js 几何、Canvas 材质和参考图纹理组合而成：花帽、关西新围、客家织带、冬头帕、大襟衫、子孙袋、脖围、蓝染样布、竹编圆筛、竹编斗笠、传统织机、客家纸艺。模型 ID、原图来源和表达边界见[模型说明](docs/v2-model-notes.md)。

每个展品的“实物参考”栏显示与该模型关联的照片、原视频或公开资料链接；点卡片可放大图片或播放视频。蓝染样布可切换对照两类从原图提取的纹样。网页使用画廊展示副本，素材目录里的原图与源视频保持原样。

关西新围采用方形围合、低墙、四角炮楼和中央祠堂的总体关系。它是形制展示，不含实测建筑尺寸。鱼纹梳篦图 257 的细节不足，当前未建模；旧版米酒坛也不属于这 12 件模型。

## 已知边界

- **没有联网搜索。** 硅基流动的 OpenAI 兼容端点在这个 key 下不提供搜索：
  `enable_search` 被静默忽略，`/v1/models` 返回的 95 个模型无一带搜索，
  `/search`、`/web/search` 均 404。探测脚本留在 `scripts/probe_search.mjs`，
  换 key 或换供应商可以直接重跑。宁可不放这个按钮，也不放一个假装能搜的。
- **入口二维码可扫。** 顶栏「扫码访问」把站点地址画成二维码，馆内观众扫一下即开本站；
  面板里同时保留可点链接和复制按钮，照顾不方便扫码的场合，其余一概不放——讲解链接在
  「方言」模块整个列着（16 条），地址性质说明和展板永久地址这类解释性文字被认定多余。
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
- `'api'`：调用硅基流动 OpenAI 兼容接口；线上请求经 Pages Functions 服务端代理，密钥保存在 Cloudflare secret binding，不下发到浏览器。请求失败会自动回落本地库。

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

**16 段原声挂在哪件展品上，按风琴页页序（sheet），不按读者页码（page）。**
《文化典藏》是风琴折页，PDF 页序和印在页脚的页码不是一一对应（乌石围 page 10 / sheet 15，
龙舟 page 58 / sheet 60）。当初 `data/qr-content.json` 的键是 PDF 页序，而 `js/diancang-data.js`
按 page 去对展品，于是 16 件里有 13 件挂成了隔壁那件的讲解——观众点"客家话讲解"听到的是
别的东西。独立证据来自视频服务自己的接口：它返回的 `vodName` 是文件真名，
`Na61TLY → 线粉.mp4`、`Na61TL1 → 冬头帕.mp4`、`Na61TDk → 衫.mp4`，三件都对应 sheet 而不是 page。

重挂与核对的工具都在仓库里，全部离线：

```
python scripts/remap_videos.py --dry   # 看会改哪些挂载
python scripts/fix_video_links.py --dry # 同步修知识库的 📺 链接与挂卡触发词表
python scripts/audit_pdf_qr.py         # 解 PDF 上印的二维码（OpenCV，页码多、解出率低，仅作旁证）
python scripts/audit_video_pages.py    # 三份材料互相核对
```

`tests/check_static.py` 里的 `check_video_attribution` 盯着四件事：每件展品的视频必须是
它所在 sheet 上那个码、码表里不许有没人挂的码、`VIDEO_TRIGGERS` 的键必须是真有视频的展品、
触发词不许出现单字（原来的表里有"戏""唱""调""汤""鼓""炭"，答案里沾一个字就挂一段视频）。
问答挂卡改成两档：问题里点了名（含别名）才挂，问题没点则要求答复里出现展品全名；
只在答复里出现"织带""米果"这类门类词不算。

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

每条失败路径都要说清楚原因，不许静默：麦克风被拒、设备没有麦克风、等太久、连不上、
服务报错、代理未配置。每条失败路径都要说明原因；浏览器不保存或接收服务端密钥，管理面板里也没有填写密钥的地方。

等待上限不是拍脑袋定的。同一句 3.5 秒的普通话（离线合成，原文是
「客家蓝染的原料是板蓝根，染布要先浸泡制靛，再氧化显色。」）实测：

| 模型 | 往返 | 转写对不对 |
| --- | --- | --- |
| `FunAudioLLM/SenseVoiceSmall` | 40.7 / 97.4 秒 | 错，「蓝染」听成「兰染」，「制靛」听成「质垫」 |
| `Qwen/Qwen3-ASR-1.7B` | 0.7 / 12.0 秒 | 逐字相同 |

默认模型因此是 Qwen3-ASR，`ai.asr.timeoutMs` 仍留 30 秒余量（这个服务的延迟 0.7 秒到
12 秒都出现过）。转写期间提示语每秒报一次「已等 N 秒」，被新录音顶替的旧请求不许再改
提示语。静态检查钉住两件事：阈值不低于 30 秒、模型不许换回那个又慢又听错字的；浏览器端
另有一条「真链路一轮在 25 秒内结束」。反向用例 V12、V13、V15 各验一次会红。

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
验收分支：**https://qcode.longnankejia-dev.pages.dev/**（`qcode`）
开发预览：**https://longnankejia-dev.pages.dev/**（`doubao`，豆包的工作分支）
v2 预览：**https://codex.longnankejia-dev.pages.dev/**（`codex`）
镜像：https://lwy9107124035.github.io/longnankejia/ 与 …/doubao/（GitHub Pages）
备用宿主：https://prismatic-syrniki-1e0e96.netlify.app（Netlify，额度耗尽后只手动）

两条自动通道（`cf-pages.yml` 与 `pages.yml`）都只做一件事：**按白名单**把页面真正加载的
东西（`index.html`、`css/`、`js/`、`assets/{avatar,pdf-imgs,textures,model-references,model-textures}`）搬进上线目录。
不是排除表——以前 Netlify 用 `publish = "."` 把整个仓库推上公网，实测
`tests/badge-template.npy`、`scripts/scan_history_secrets.py` 和 8MB 的 `assets/source/`
原图都能直接下载，而 `docs/` 里是比赛通知与简历。注意 Cloudflare 对不存在的路径回的是
**200 + 一段 HTML 提示页**，所以核对上线集要比对 `Content-Type`，不能只看状态码。

- **API key 只在服务端。** `cf-pages.yml` 将 GitHub secret 通过 stdin 写入 Cloudflare Pages
  的 production/preview secret binding；四分支共享 API 参数，但 key 不写入浏览器静态资源。
  `pages.yml` 的 main 与 doubao 镜像以及手动 Netlify 备用站都生成空 `js/secrets.js`。本地
  开发可用被 `.gitignore` 忽略的 `js/secrets.js`。
- **分支范围固定为 main、qcode、codex、doubao。** Cloudflare 项目映射为 main→`longnankejia`
  production，doubao→`longnankejia-dev` production，qcode/codex→`longnankejia-dev` preview。
  v2 的模型和页面内容仅在 codex 修改；API 配置或部署代理需要同步时，逐一核实四个分支后
  对精确分支操作，禁止使用 `git push --all` 或通配 refspec。
- **CI 用的 Cloudflare 令牌只有一项权限**：`Account → Cloudflare Pages → Edit`。
  官方 "Edit Cloudflare Workers" 模板会连带 13 项（Workers KV/R2/Scripts、Memberships、
  Account Settings…），对只推静态站的 CI 太宽，所以走 Custom Token。
- **GitHub Pages 镜像工作流 `pages.yml` 只存在于 `main`**，显式 checkout `main` 与 `doubao`，每小时
  `:17` 定时或 main 推送时更新两个镜像。豆包原工作分支 `dev` 已改名为 `doubao`。

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
