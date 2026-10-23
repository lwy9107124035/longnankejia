# codex 管理登录与跨设备同步整改

## 已核实的起点

- 2026-10-20：原 codex（83f091f）保存在本地分支 `backup-codex-before-antigravity-20261020`。
- 当前 codex 从 antigravity 的 23473f7 完整复制；未修改 antigravity/main。
- 旧同步数据库域名返回 ENOTFOUND；旧接口吞掉异常并使用实例内存，返回空数据与成功状态。
- 正式站和 antigravity 的接口返回 JSON 空状态；旧 codex 的同步接口返回 HTML。
- 旧版浏览器本地验密与后台异步拉取存在竞态；默认口令及 URL 参数还能绕过改密和登录。

## 已完成

- 改用 Cloudflare D1，使用数据库版本比较防止旧设备覆盖新数据。
- 登录、会话、邀请和锁定统一由服务器管理，删除凭证二维码、本地验密和数据库硬编码密钥。
- 前端处理接口 HTML 回退、超时、断网、存储被禁用、会话失效；编辑先保存在本机，失败不冒充云端成功。
- 冲突保留本机草稿，提供完整备份和明确确认后的云端重新加载。
- 修复 style.css 中 `.admin-lock-countdown` 缺少 `}`，该错误导致其后上传组件、桌面样式和新后台样式被嵌套而失效。桌面后台宽 960px，手机按钮换行。
- CI 增加 codex 专用 D1 初始化和绑定、服务端初始密码绑定，以及管理接口回归守卫。初始化 SQL 幂等，不重置已改密码。
- 配置与部署边界见 `docs/admin-login-and-sync.md`。

## 验证证据

- `node --test tests/admin-sync.test.mjs tests/v3_admin_ux.test.mjs tests/pages-functions.test.mjs`：29/29 通过。后续私有记录缓存与导出修复后，再次运行受影响的管理接口/前端测试：16/16 通过。
- `node tests/run_site_tests.mjs --only=admin,8`：25/25 通过，电脑和 360px 手机使用隔离浏览器上下文。截图在 `.cache/test-shots/admin-desktop.png`、`admin-phone.png`，已实际查看。
- 样式修复前，两项实际 computedStyle 断言失败；补齐大括号后通过，证明确实捕捉样式失效。
- `node tests/admin-negative-checks.mjs`：3 个反例被捕获（验密绕过、旧版本覆盖、存储故障报成功），不修改工作文件。
- `node --test tests/v2_knowledge.test.mjs tests/v2_models.test.mjs`：40/40 通过。
- `python tests/check_static.py`：通过；永久印刷二维码仍指向 main。
- `python tests/decode_entry_qr.py`：独立解码本地预览页生成的二维码为 codex 入口，通过。
- `wrangler.cmd pages functions build --outfile=.cache/admin-worker.mjs`：4.137.0 编译成功。
- `git diff --check`：通过。源文件语法检查通过。
- 最初 npx 拉取编译工具因用户 npm 代理 127.0.0.1:31181 拒绝连接而失败，随后使用现有全局 Wrangler 完成编译；未修改用户代理配置。
- `node tests/run_site_tests.mjs`：全站浏览器回归 292/292 通过，包含管理表单增改、隔离手机会话、360px/1280px 布局、全部 3D、地图、知识库、语音与童谣；无未捕获脚本异常及意外子资源失败。

## 第二轮：用户授权推送 codex 供验收

- 用户指定初始管理员密码，已通过 stdin 写入仓库 secret `ADMIN_BOOTSTRAP_PASSWORD`，不写入源码。
- 通过现有 Wrangler OAuth 登录创建 codex 专用 D1：`longnankejia-admin-codex`，ID `f5a18460-1926-4c5f-846e-fbb11d686bd0`，APAC/HKG；远程迁移 5 条 SQL 成功，初始仅有 content/tokens 两行共享状态。
- 仓库变量 `CODEX_ADMIN_D1_ID` 已配置，CI 直接绑定已有数据库，避免要求扩大现有部署令牌权限。
- `prepare_admin_d1.mjs` 已用真实数据库 ID 验证已有库绑定模式；使用生成的配置再次编译 Worker 成功。
- 当前 codex 可直接快进推送到 origin/codex，无须重写远程历史；推送前核实 main 仍是 23473f7。
- 已提交并推送 `9c0156f` 到 codex。首轮 CI 39368737962 的测试和配置通过，但发布步骤失败：wrangler-action 默认安装 3.90.0，且 Pages 部署不接受自定义配置路径。
- 修复部署：明确固定 Wrangler 4.137.0，并生成标准 `wrangler.jsonc` 供 Pages 自动发现，不再传 `--config`。待修复后的 CI 完成再记录在线结果。真实手机 Safari/微信验收交由用户。
- 修复提交 `41bc560` 已推送；[CI 39368977261](https://github.com/lwy9107124035/longnankejia/actions/runs/39368977261) 全部成功（36 秒），部署别名为 `https://codex.longnankejia-dev.pages.dev/`，不可变部署地址为 `https://c9beb644.longnankejia-dev.pages.dev/`。
- 线上实际验证：公共接口返回 JSON 且不泄露凭据；用户指定初始密码可分别建立两个独立超级管理员会话；退出其一后另一会话仍有效；页面返回 no-cache。检查结束已注销测试会话，没有修改共享内容。
- 在线检查脚本为 `.cache/check-codex-admin-live.mjs`。当前真实手机 Safari/微信交互由用户自行验收。
- 部署后核实远程 main 仍为 `23473f71a5f8a28b8f51bd9091ad268a2f724a2a`。用户明确要求验收确认后再推 main；未获得确认前不得合并或推送 main。
- 本地验证生成的忽略配置 `wrangler.jsonc` / `wrangler.admin.json` 随后清理，避免切换其他分支时误用 codex 数据库；CI 在干净检出中按分支重新生成配置。
- 原用户未跟踪资料保持原样，不加入提交。
- 正式展板二维码指向 main，codex 改动不会自动更新该入口；后续若要上线正式站需单独验收和部署。

## 第三轮：用户验收通过，授权发布 main

- 用户确认 codex 体验通过，要求同步到 main，并保留现有密码、密钥设置；此前等待验收的限制已由该明确授权解除。
- 原 main 23473f7 已备份到本地分支 `backup-main-before-admin-release-20261020`。本地 main 快进到已验收的 codex a559d95，应用代码保持一致。
- 正式站原有 `SILICONFLOW_API_KEY` 为 Cloudflare encrypted secret；发布流程针对 main 跳过密钥覆盖，也不写入或重设管理员初始密码。
- 已创建独立正式 D1 `longnankejia-admin-main`，ID `31744e43-aed6-4440-a551-21c35054b89d`，APAC；仓库变量 `MAIN_ADMIN_D1_ID` 已配置。
- 从 codex 导出并复制 admin_state 的 content/password/tokens 三行，再补齐会话和锁定表。逐行 revision 与 value SHA-256 比较全部相同，保留现有密码派生值、邀请及管理配置；未复制临时会话和锁定状态。
- 迁移证据：`.cache/main-admin-migration-verification.json`；敏感状态快照仅存忽略目录 `.cache/admin-state-main-release.sql`，不提交或发布。
- 生产绑定必须指定已经迁移的数据库 ID，缺失时拒绝创建空库；已绑定的生产库不再要求初始化密码，避免部署重置现有密码。
- 新增部署配置测试 4 项均通过，覆盖 main/codex 分库、无初始化密码绑定、生产库缺失拒绝、无效分支/ID 拒绝。原有接口与前端 29 项仍通过，静态检查通过。
- 正式发布提交 `8ca9e0c` 已推送 main；[CI 39370633004](https://github.com/lwy9107124035/longnankejia/actions/runs/39370633004) 成功，33 项测试全部通过，日志确认 main 保留原服务端密钥。
- 正式部署地址 `https://2bcb3b69.longnankejia.pages.dev/`，固定入口 `https://longnankejia.pages.dev/` 已更新。
- 正式入口在线验收通过：原密码可建立两端独立超级管理员会话，退出其中一端不影响另一端；公开接口不泄露凭据、页面 no-cache。测试会话已清理，共享内容未修改。
- 正式 AI 代理真实调用返回 HTTP 200 且有回复；发布后 secret 列表仍只有原有加密 `SILICONFLOW_API_KEY`，没有写入或重设初始化密码。
- 原二维码保持 main 固定网址，因此直接访问更新后的正式站。codex 远程分支保持 a559d95，不受本次正式数据库迁移和发布影响。
- 本地生成的生产绑定配置已清理；正式迁移的核验文件和临时 SQL 留在忽略目录，未发布。

## 第四轮：2026-10-21 科普后台新增重复反馈

- 用户要求核查老师反馈：新增一条同时出现两个副本，删除一个时两个副本同时消失。截图对应“科普管理”的自定义卡片。
- 已完整复现。`Heritage.list()` 在 `js/ui.js:736` 已返回内置数据与自定义数据合并后的列表，`renderKepu()` 原先再次调用 `Store.getHeritageCards(Heritage.list())`，把自定义数据追加第二次。
- 修复前浏览器实际结果：新增西昌围和关西围各保存 1 条，各显示 2 条；云端每个新增 ID 都只有 1 条。刷新和手机宽度下仍重复，删除一个 ID 后该 ID 的两份显示一起消失，另一个 ID 的真实数据保持 1 条。
- 线上只读检查：main 当时 revision 32，自定义科普共 1 条（西昌围），没有重复 ID；codex revision 6，自定义科普为 0 条。未对线上执行新增、编辑或删除。
- 本地最小修复：`js/admin.js:651` 直接使用 `Heritage.list()` 的结果，不再重复合并；保留 Heritage 模块尚未初始化时的自定义列表回退。
- 新增浏览器回归 `node tests/run_site_tests.mjs --only=kepu-crud`，通过真实本地接口验证新增、统计、云端条数、刷新、手机宽度、编辑和独立删除。修复前 8 项断言失败，修复后 13/13 通过（含原有冷启动 2 项）。
- `node --test tests/admin-sync.test.mjs tests/v3_admin_ux.test.mjs`：16/16 通过；`git diff --check` 通过。
- 复现截图 `.cache/test-shots/kepu-duplicate-before.png`；修复截图 `.cache/test-shots/kepu-single-after.png`。
- 最初排查阶段仅在本地 main 修复并完成回归，未提交、推送或部署；线上密码、密钥、老师数据均未修改。
- 用户随后明确授权“发布线上”。本次发布仅修复后台重复合并，并加入回归检查，不运行数据库迁移、数据清理或密码/密钥重设。
- 发布前正式接口快照：revision 32、自定义科普 1 条，摘要保存在 `.cache/kepu-release-before.json`，用于部署后核对现有内容未变。
- 修复提交 `c97d1ed342369f4b7b7127a74df32710decdcdf8` 已推送 main；[CI 39566905960](https://github.com/lwy9107124035/longnankejia/actions/runs/39566905960) 成功，33 项检查全部通过，日志确认保留正式站现有服务端密钥。
- 正式部署地址 `https://3916334a.longnankejia.pages.dev/`，固定入口 `https://longnankejia.pages.dev/` 已更新。线上 `js/admin.js` 与本地已验证源码逐字一致，并返回 no-cache。
- `.cache/check-kepu-release.mjs` 在线只读核验通过：发布前后共享内容 SHA-256 完全相同，revision 仍为 32、自定义科普仍为 1 条；结果保存在 `.cache/kepu-release-after.json`。此次没有对线上内容执行增删改，也没有重设密码或密钥。

## 第五轮：2026-10-23 上传缺失、多端不一致与正文换行

- 用户要求首先将 codex 与已发布 main 对齐，再仅在 codex 修改。已 fetch 并快进本地 codex 到 main 的 `e8ba30b`，修改前 `git diff origin/main HEAD` 为空；最近成功正式部署仍为 `c97d1ed`，其后仅有记录文档。
- 正式接口只读检查：revision 67，自定义科普 26 条，响应 JSON 约 1.39 MB；codex 独立库 revision 6、自定义科普 0 条。分支代码同步不等于复制数据库，未修改正式数据或密码密钥。
- 新增四个实际前端存储回归均在修复前失败：旧本机草稿阻止游客读取云端、多设备独立新增无法合并、延迟旧 GET 覆盖新上传、本机存储写满后静默读取旧值。
- 进一步确认整站内容存于单一 D1 行、每次全量上传，原接口上限 2 MiB；D1 单行官方硬上限为 2,000,000 bytes。
- 已修复：IndexedDB 原子缓存与草稿、内存优先避免配额失败回读旧值、游客公开读取与草稿隔离、基于共同版本合并不同条目、同条冲突保留草稿、拒绝延迟旧响应覆盖新上传、按版本轻量轮询。新旧缓存迁移中也验证旧草稿不丢失。
- 服务端内容分块写入现有表，D1 batch 事务保持版本检查与全部分块原子提交，单 SQL 读取快照；兼容旧存储，无新增迁移、无密码或令牌修改。接口当前支持 16 MiB，超限明确提示扩容并保留草稿。
- 科普保存、知识批量入库和导入等待服务器确认；图片提示函数名错误已修复，处理图片时禁用保存，压缩后再上传。游客/后台导入卡片分类改为按内置 ID 集合判定。普通正文回车换行、空行分段，原 HTML 兼容。
- 本地验证：Node 管理、接口、知识与模型共 80/80；浏览器 `--only=kepu-crud,content-sync,admin` 共 43/43，包含 60 条真实可解码图片约 6.8 MB 上传、刷新、全新手机游客、旧草稿合并、离线 API 下刷新恢复、独立删除及管理员会话。服务端另验证 60 条数据跨冷重启完整和分块失败事务回滚。3 个负向变异被捕获；静态检查和语法检查通过。
- 大响应原样经 CDP 返回曾导致测试工具超时，测试改为只返回断言所需计数/布尔值，并关闭大上传正文的 CDP 追踪，实际保存与另一设备读取仍使用真实接口。手机截图 `.cache/test-shots/content-sync-phone-paragraphs.png` 已查看。
- 本轮修复提交 `f56f7b6bcd29be0aa237419382c266b052449c2e` 已推送 codex；[CI 39918183132](https://github.com/lwy9107124035/longnankejia/actions/runs/39918183132) 成功，40 项管理与接口检查通过。部署 `https://39a51371.longnankejia-dev.pages.dev/`，预览固定入口 `https://codex.longnankejia-dev.pages.dev/`。
- 线上逐字核对 store/admin/ui/CSS/index 五份源码与本地一致。`.cache/check-content-sync-live.mjs` 以真实 codex D1 验证 60 条、超过 2 MB 的内容完整保存和游客读回，以及未变化版本的小响应；随后只清除本轮随机前缀测试记录、注销测试会话。codex revision 6→8，恢复后全部公开内容摘要与测试前一致，自定义科普仍 0 条。
- `.cache/content-sync-release-before.json` 与 `content-sync-release-after.json` 证明正式站始终 revision 67、自定义科普 26 条，全部公开内容 SHA-256 不变。远程 main 仍为 `e8ba30b008d0c9ff4e97b89be3ef6b88bf2c7bae`；没有向 main 推送代码、迁移或修改正式数据库，也未改动原密码和密钥。Wrangler 4.137.0 编译成功。
- 预览库与正式库继续独立，没有把老师正式数据复制到预览库。下一步等待用户在 codex 验收后明确授权 main；旧设备未上传内容需保留原浏览器数据，待正式站升级后从原设备恢复上传，无法凭服务器推测从未上传的内容。

## 第六轮：codex 登录密码与正式站对齐

- 用户反馈自己设置的管理员密码在预览站被拒。通过不回显的内存输入核验：该密码匹配正式库的密码派生值（revision 1），不匹配预览库仍保留的旧值（revision 0）。原因是两库独立，之前只同步了代码，没有同步正式站后来修改的密码。
- 仅把正式库当前的 salt/hash 原样复制到 codex 的 password 行，预览密码 revision 0→1，随后读取确认两库派生值相同，清理测试站旧超级管理员会话及当前锁定；正式数据库只读。未把用户明文密码写入源码、文件或命令输出。
- 首次 Wrangler 文件执行虽已写入成功，但输出的进度行导致临时校验脚本解析 JSON 失败；修复解析后先重新读取，确认已对齐，没有重复改密。
- 使用用户提供的密码调用 codex 真实登录接口成功，角色为超级管理员，验证会话已退出。前后内容摘要完全相同：正式站 revision 67、自定义科普 26 条；codex revision 8、自定义科普 0 条。没有修改 API 密钥、main 分支或正式站密码。
- 非敏感核验记录：`.cache/codex-password-alignment-verification.json`。本次仅在线修正预览密码，不需要重新部署应用。

## 2026-10-23 codex 安全与质量审查（完成）

- 用户要求对 codex 详细审查、排查漏洞；当前只做审查及隔离复现，不修改产品实现，不向线上写入测试数据。已切换本地 codex `7405e03`，与正式 main `bce4c6b` 的应用代码相同，仅发布记录不同。
- 基线 Node 管理、接口、知识和模型 80/80 通过，负向变异 3 项及静态检查通过；完整浏览器回归 318/318 通过，输出保存在 `.cache/codex-audit-full-browser-output.txt`。这些基线没有覆盖下述对抗场景，不能当成安全验收结论。
- 复用真实 SQLite 管理接口和现有 Store VM 测试夹具，新增 `tests/audit_codex_20261023.mjs`。9 个探针已复现：无效记录入库、重复 ID 删除连带、审计及归属伪造、回滚遗漏内置修改/删除、日志泄漏有效邀请码、跨设备审核通知缺失、重新加载竞态丢草稿、sessionStorage 仅写失败导致新会话丢失、匿名超大请求整包读取后才限长。结果在 `.cache/codex-audit-api.json`，该探针退出码 1 表示发现缺陷，不能解释为普通测试通过。
- 原浏览器脚本新增仅手动运行的 `--only=security-audit`，使用正式 CSP 配置在本地复现：协管员卡片图标脚本借超管会话改密成功、正文 HTML 事件执行、null 记录导致渲染异常、正常压缩 DOCX 读取不到正文、同源双标签页离线草稿互相覆盖。结果 `.cache/codex-audit-browser.json`；“7 passed”包含 2 项冷启动和 5 个复现探针，不是安全通过，确认缺陷时脚本退出码为 1。Word 样本通过 `tests/helpers/create-audit-word-fixture.py` 自动生成。线上注入和改密均未执行，测试使用隔离后端的合成口令。
- 正式/预览只读快照 `.cache/codex-audit-online-before.json` 与 `codex-audit-online-after.json` 内容摘要相同：正式 revision 67、科普 26 条，预览 revision 10、科普 0 条。API 顶层未直接暴露密码、会话或令牌字段；线上 CSP 确实允许 unsafe-inline/unsafe-eval。漏洞均在本地真实接口/浏览器复现，没有对线上执行攻击或写入。
- 最终报告 `docs/codex-security-review-2026-10-23.md`：14 个对抗探针归并 12 项确认问题，4 项 P1、7 项 P2、1 项 P3，逐项含源码行号、条件、复现、影响、建议及验收标准。待环境核对的分布式限流、上游超时、真实 iOS/微信等没有计为确认漏洞。
- 本轮本地只修改审查报告/记录和测试工具，没有业务实现变更，没有提交或推送。后续优先修复 F01–F04，再做其他修复及回归；用户尚未要求本轮实施修复。

## 2026-10-23 全部 12 项整改（代码完成，待预览部署）
- 用户授权：只在 codex 修复全部审查问题，main 不动。当前分支 codex。
- 已实现：共享结构验证（前后端）、DOMPurify 3.4.17 与 fflate 0.8.3（npm sha512 校验后本地 vendor），收紧 CSP；服务器记录内容归属、审计、回滚前后版本、审核通知及已读状态；限制请求流读取；独立页面草稿与恢复；重载 generation 守卫、会话内存优先；DOCX ZIP/XML 正文解析。
- 修改路径：functions/_lib/admin-content.js、read-limited.js、api/admin/sync.js、js/content-schema.js/store.js/ui.js/admin.js/dialect.js/diancang.js/app.js、index.html、_headers。无真实账号、密码、密钥或线上数据操作。
- 初次 50 项相关 Node 回归：两处失败是新增服务端归属字段及更严格必填校验导致旧测试数据不适用；已更新断言/有效夹具，50 项已通过。
- 回归：新增 19 项安全/启动测试；原 80 项仍通过。真实 CSP 完整浏览器 319/319、浏览器安全 13/13、独立手机/电脑管理 18/18；静态、3 项负向变异和 Wrangler Functions 构建通过。曾发现初始化竞态与测试等待不足，已修复并重跑。
- 细节与边界：docs/codex-security-fixes-2026-10-23.md。旧审查命令转为防回归断言；测试 fixture 提取至 tests/helpers/store-harness.mjs。
- 最终合并 Node 99/99 已通过，最后浏览器同步/安全专测通过，Functions 编译再次成功；待检查 staged diff 后提交并只推送 codex，观察 CI 部署，不改变 main。本机 Node/urllib 在线读取出现 fetch failed/403，改用 curl GET 成功取得只读快照（.cache/codex-fix-online-before.json）：codex revision 10/自定义科普 0、main revision 67/自定义科普 26。HEAD 不经过 Functions 会返回静态 HTML，在线核验必须用 GET JSON。
