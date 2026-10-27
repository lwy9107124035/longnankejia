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

## 第七轮：用户授权将内容同步与换行修复发布 main

- 用户明确要求“推送到 main 分支”，此前等待预览验收的限制已解除。发布前远程 main 为 `e8ba30b`，codex 为 `7405e03`；将 main 快进到 codex，应用代码与已验证预览完全相同。
- 发布前正式站只读核验：内容 revision 67、自定义科普 26 条，密码 revision 1；内容摘要及密码派生记录的指纹保存在 `.cache/main-content-sync-before.json`，不保存明文密码。
- 正式发布提交 `7c4f0cd9efebb63b6da261415f80285b397f1ef3` 已推送 main；[CI 39920128872](https://github.com/lwy9107124035/longnankejia/actions/runs/39920128872) 成功，40 项检查全部通过，日志确认保留原正式站服务端密钥。部署地址 `https://99030e39.longnankejia.pages.dev/`，固定正式入口 `https://longnankejia.pages.dev/` 已更新。
- `.cache/check-main-content-sync-release.mjs after` 核验通过：store/admin/ui/CSS/index 五份源码与已验收版本逐字一致，版本未变化时的轻量 API 响应有效；发布前后正式内容摘要和密码派生记录指纹完全相同，内容 revision 67、自定义科普 26 条、密码 revision 1。证据在 `.cache/main-content-sync-after.json`。
- 本次继续绑定原正式 D1，没有复制预览库、迁移或清理正式内容，没有重设密码或覆盖 API 密钥。codex 仍使用独立预览库，正式网址和原二维码均可继续使用；原设备草稿可在正式站登录后恢复同步，若同条冲突则先导出备份核对。

## 2026-10-23 codex 安全与质量审查（完成）

- 用户要求对 codex 详细审查、排查漏洞；当前只做审查及隔离复现，不修改产品实现，不向线上写入测试数据。已切换本地 codex `7405e03`，与正式 main `bce4c6b` 的应用代码相同，仅发布记录不同。
- 基线 Node 管理、接口、知识和模型 80/80 通过，负向变异 3 项及静态检查通过；完整浏览器回归 318/318 通过，输出保存在 `.cache/codex-audit-full-browser-output.txt`。这些基线没有覆盖下述对抗场景，不能当成安全验收结论。
- 复用真实 SQLite 管理接口和现有 Store VM 测试夹具，新增 `tests/audit_codex_20261023.mjs`。9 个探针已复现：无效记录入库、重复 ID 删除连带、审计及归属伪造、回滚遗漏内置修改/删除、日志泄漏有效邀请码、跨设备审核通知缺失、重新加载竞态丢草稿、sessionStorage 仅写失败导致新会话丢失、匿名超大请求整包读取后才限长。结果在 `.cache/codex-audit-api.json`，该探针退出码 1 表示发现缺陷，不能解释为普通测试通过。
- 原浏览器脚本新增仅手动运行的 `--only=security-audit`，使用正式 CSP 配置在本地复现：协管员卡片图标脚本借超管会话改密成功、正文 HTML 事件执行、null 记录导致渲染异常、正常压缩 DOCX 读取不到正文、同源双标签页离线草稿互相覆盖。结果 `.cache/codex-audit-browser.json`；“7 passed”包含 2 项冷启动和 5 个复现探针，不是安全通过，确认缺陷时脚本退出码为 1。Word 样本通过 `tests/helpers/create-audit-word-fixture.py` 自动生成。线上注入和改密均未执行，测试使用隔离后端的合成口令。
- 正式/预览只读快照 `.cache/codex-audit-online-before.json` 与 `codex-audit-online-after.json` 内容摘要相同：正式 revision 67、科普 26 条，预览 revision 10、科普 0 条。API 顶层未直接暴露密码、会话或令牌字段；线上 CSP 确实允许 unsafe-inline/unsafe-eval。漏洞均在本地真实接口/浏览器复现，没有对线上执行攻击或写入。
- 最终报告 `docs/codex-security-review-2026-10-23.md`：14 个对抗探针归并 12 项确认问题，4 项 P1、7 项 P2、1 项 P3，逐项含源码行号、条件、复现、影响、建议及验收标准。待环境核对的分布式限流、上游超时、真实 iOS/微信等没有计为确认漏洞。
- 本轮本地只修改审查报告/记录和测试工具，没有业务实现变更，没有提交或推送。后续优先修复 F01–F04，再做其他修复及回归；用户尚未要求本轮实施修复。

## 2026-10-23 全部 12 项整改（已推送 codex，预览部署完成）
- 用户授权：只在 codex 修复全部审查问题，main 不动。当前分支 codex。
- 已实现：共享结构验证（前后端）、DOMPurify 3.4.17 与 fflate 0.8.3（npm sha512 校验后本地 vendor），收紧 CSP；服务器记录内容归属、审计、回滚前后版本、审核通知及已读状态；限制请求流读取；独立页面草稿与恢复；重载 generation 守卫、会话内存优先；DOCX ZIP/XML 正文解析。
- 修改路径：functions/_lib/admin-content.js、read-limited.js、api/admin/sync.js、js/content-schema.js/store.js/ui.js/admin.js/dialect.js/diancang.js/app.js、index.html、_headers。无真实账号、密码、密钥或线上数据操作。
- 初次 50 项相关 Node 回归：两处失败是新增服务端归属字段及更严格必填校验导致旧测试数据不适用；已更新断言/有效夹具，50 项已通过。
- 回归：新增 19 项安全/启动测试；原 80 项仍通过。真实 CSP 完整浏览器 319/319、浏览器安全 13/13、独立手机/电脑管理 18/18；静态、3 项负向变异和 Wrangler Functions 构建通过。曾发现初始化竞态与测试等待不足，已修复并重跑。
- 细节与边界：docs/codex-security-fixes-2026-10-23.md。旧审查命令转为防回归断言；测试 fixture 提取至 tests/helpers/store-harness.mjs。
- 最终合并 Node 99/99 已通过，最后浏览器同步/安全专测通过，Functions 编译再次成功；待检查 staged diff 后提交并只推送 codex，观察 CI 部署，不改变 main。本机 Node/urllib 在线读取出现 fetch failed/403，改用 curl GET 成功取得只读快照（.cache/codex-fix-online-before.json）：codex revision 10/自定义科普 0、main revision 67/自定义科普 26。HEAD 不经过 Functions 会返回静态 HTML，在线核验必须用 GET JSON。
- 修复提交 `a4da1579fdfd03b6106c2203d29cb6955020eb63` 已只推送 codex。[CI 39937924225](https://github.com/lwy9107124035/longnankejia/actions/runs/39937924225) 成功，CI 管理/接口 59/59；部署 `https://512f574d.longnankejia-dev.pages.dev/`，固定预览 `https://codex.longnankejia-dev.pages.dev/`。
- `.cache/verify-codex-security-release.mjs` 在线只读核验通过，结果 `.cache/codex-fix-online-after.json`：首页及 6 份关键 JS 与本地已测试源码一致，script-src 不含 unsafe-inline/unsafe-eval，API 返回 JSON/no-store。首次对 `/index.html` 检查遇 Cloudflare 308 规范跳转，改用实际首页 `/` 后通过，并非应用故障。
- 对两站公开接口 JSON 全量规范化比较，部署前后完全相同：codex revision 10/科普 0，main revision 67/科普 26。没有向线上执行攻击或增删改测试，没有重设密码、邀请码或密钥；两库仍独立。远端 main 保持 `bce4c6b1bccb0325c0b086edc73273e8d76c0a24`。
- 本轮已完成，等待用户验收 codex 后明确授权 main；旧数据恢复和真实 iOS/微信验证等边界见整改文档。

## 2026-10-23 用户授权将全部安全整改发布 main

- 用户已明确要求“推送到 main 分支”，解除上一轮等待 codex 验收的限制。合并已验证的 codex `863fecf` 到 main，保留正式分支原发布记录；冲突只发生在本记录末尾，两边历史均保留，应用代码没有冲突。
- 发布前正式接口只读快照 `.cache/security-main-before.json`：revision 67、自定义科普 26 条；现有公开内容通过新版本共享 schema 验证，不需要清理或改写内容。
- 检查 `地址.html`：五个分支 URL 已是稳定入口，无需每次发布修改 URL；说明仍停留在旧版本并错误地只标 antigravity 为当前主力，本次更新说明、顺序和快捷入口。今后继续保留稳定分支地址，部署成功后该地址提供最新已部署版本。
- 正式发布提交 `4d7506d4d262172e6057e98760c9b7c2bfbfb68d` 已推送 main；[CI 39940146769](https://github.com/lwy9107124035/longnankejia/actions/runs/39940146769) 成功，59 项管理/接口检查全部通过。正式部署 `https://5873aade.longnankejia.pages.dev/`，固定入口 `https://longnankejia.pages.dev/`。
- `.cache/verify-security-main-release.mjs before/after` 全部通过，证据 `.cache/security-main-release-before.json` 和 `security-main-release-after.json`：首页及 9 份关键 JS 与验收源码一致，script-src 禁止 inline/eval，版本轻量查询正常，API 返回 JSON/no-store；正式内容 revision 67、科普 26 条、内容完整指纹与管理员密码派生记录指纹均未变化，密码 revision 仍为 1。没有输出或保存明文密码。
- 发布核验中遇到两种暂态问题并完成处理：本机 Wrangler 的 Node 直连请求 fetch failed，改为使用现有授权经 curl 只读查询取得密码指纹；新依赖 fflate 首次在固定入口返回 SPA 兜底，独立部署文件正常，稍后固定入口带参数与不带参数请求均与本地完全一致，完整发布核验重跑通过。没有因此改写业务数据或重新发布未验收代码。
- 正式部署沿用原 main D1，日志确认保留正式站服务端密钥，不迁移、不清理、不复制预览内容，不重设密码或邀请码。main 与 codex 应用源码完全相同；将本轮合并和入口说明以快进方式同步回 codex，保证后续切换分支不会恢复旧入口说明。记录提交使用 skip ci，避免为文档和本地导航重复部署。
- `地址.html` 后续维护原则：保留稳定分支入口，避免写易过期的版本号和主力分支断言；URL、分支用途变化时同步更新说明。代码发布通过原固定地址自动生效，需要部署成功；文件不是每次发布都需要重写的程序副本。

## 2026-10-26 客户三人录入反馈（正式发布完成）

- 用户要求先处理本机 ERR_CONNECTION_CLOSED，随后自行换 IP 恢复，明确暂停网络问题排查；未修改系统网络配置。继续负责资料缺失、多设备显示不同、新建被旧冲突阻止、错误的未部署提示，并精简页面文案。
- 正式公开 GET 已读成功：revision 174、自定义科普 102 条，包含矮守围，约 8.35 MB；全部通过 schema。快照 `.cache/incident-main-public.json`。不能将旧截图 26 条当成当前数据库条数，也不能保证这 102 条包含所有未成功上传的草稿。用户无法提供具体缺失名称，要求从源头修好。
- 已确认代码问题：syncStatus=conflict 时上传整批直接退出；pending 上传失败又使 syncWithCloud 在读取其他设备新内容前退出；每次新增仍上送全库大图；任意非 JSON 响应均误报未部署。计划按条目条件保存，隔离冲突并保留草稿、持续读取云端、缩小请求、重试暂态网关错误并修正文案。
- 新回归 `tests/content-collaboration.test.mjs` 覆盖冲突与新建共存、共享同邀请码三设备协作、临时 HTML 网关恢复。当前尚未实施产品修复、尚未重新部署。`.cache/cf-incident-readonly.mjs` 用现有 Wrangler 授权只读 D1；过期授权已通过 Wrangler whoami 刷新，没有重设客户凭据。
- 实现已完成：共享 cell 摘要和 patch 操作；服务端按条目条件合并、事务重试、幂等确认；客户端隔离并持久化冲突，独立上传其他修改，持续读取云端；打开表单版本守卫；未保存科普表单自动草稿；读取云端时归档本机未上传副本；后台列表轮询自动更新及云端/待上传数量；非 JSON 不再误报未部署，安全请求可重试；正常收发增量，旧版本接口仍兼容。
- D1 只读证据补充：当前 102 = 原有 26 + 今日新增 76；历史 106 项，无删除、回滚。正式库只有一个有效邀请码（名称 1），客户凭据未变。`.cache/incident-20261026-main-d1.json` / `main-content.json` 保存当前快照，不提交 Git。
- 最终本地结果：Node 110/110、完整浏览器 319/319、同步/安全/独立电脑手机/三设备 63/63，静态、3 个负向变异、Functions 构建通过。最终浏览器用真实同邀请码的三个独立上下文，包含手机表单刷新找回；截图已目视。真实现有 8.35 MB 资料在隔离库新增记录仅需不足 1 KB 上传，无真实线上数据增删。
- 细节和边界 `docs/collaboration-fixes-2026-10-26.md`。下一步只推 codex，验证真实 D1 的批量带图和并发条件保存，再将同一验收版本同步 main；发布前后只读比较内容及密码指纹，不重设密钥。
- 真实预览验收中补充发现：原脚本 Buffer 分块逐段转字符串会在中文边界产生替代字符，导致一条摘要不匹配；脚本改用 UTF-8 流式解码。批量 102 张图片请求已提交，但大响应在连接读完前超时，属于“实际保存、界面误报失败”的另一条路径；改为保存只返回条目确认与服务端归属字段，不回传已上传大图，云端其他更新后台读取，列表未完整时明确提示正在更新。
- 减少服务端重复序列化/复制全库及回滚大图，仅复制变动记录，旧快照不可变回归通过。此前一次非 JSON 503 未取得平台内存日志，不能断言根因就是 OOM；内存优化和小响应已分别验证。最新 Node 111/111、确认响应协议相关浏览器 52/52、Functions 编译通过。
- 临时测试只在 codex：通过正常接口删除全部本轮维护前缀记录；为避免反复测试占满 16 MiB，仅以带 revision 条件的单条原子 UPDATE 清理这些测试记录的回滚历史，先保存完整快照，校验其他内容/审计不变。证据 `.cache/incident-preview-history-cleanup-21.json`、`-24.json`，预览 revision 25/科普 0。正式 main revision 174/科普 102，密码指纹与原记录一致，尚未发布本轮改动。
- 最终应用提交 `49ca4b0fb439d6a7fad014cd6b117cdcee6ba2e4`，含减少历史复制的 `b37816f` / `fb26b96`。预览 [CI 40342106163](https://github.com/lwy9107124035/longnankejia/actions/runs/40342106163) 成功，71 项部署检查通过，部署 `https://fffb7634.longnankejia-dev.pages.dev/`。
- `.cache/preview-collaboration-smoke.mjs` 真实 codex D1 验收成功：102 条有效 JPEG 图片、7,802,825 bytes 请求全部保存并读回；确认包 25,906 bytes；同一邀请码三独立会话并发 3 条各自成功；旧稿冲突和独立新增同请求返回 accepted=1/conflict=1，云端旧稿未被覆盖。共 106 条本轮测试记录已全部按前缀删除，三会话退出；公开内容摘要与前置快照完全相同。证据 `.cache/incident-preview-smoke-result.json` / `incident-preview-http-trace.jsonl`。
- 最终清理仅移除本轮测试记录的 213 项回滚副本，其他审计/配置/内容不变，预览恢复 revision 33/科普 0，历史副本 0；保存完整回滚前快照和 `.cache/incident-preview-history-cleanup-32.json`。现开始将同一验收源码发布 main。
- 正式发布提交 `2fb1e2c8af64a1aedc20746b004d162806932cc2` 合并已验收 codex，应用源码没有额外变更。[CI 40342993603](https://github.com/lwy9107124035/longnankejia/actions/runs/40342993603) 成功，71 项部署检查全部通过。部署 `https://3b79a15c.longnankejia.pages.dev/`，固定正式入口 `https://longnankejia.pages.dev/`。
- `.cache/verify-collaboration-main-release.mjs before/after` 通过：10 份关键文件与验收源码一致，脚本 CSP、API JSON/no-store、轻量版本查询正常。main revision 174/自定义科普 102，全部公开内容和管理员密码派生记录指纹与发布前完全相同（密码 revision 1）；CI 明确保留现有正式服务端密钥，不复制预览库，不重设凭据。
- 正式站全新 Chrome profile 只读验收 `.cache/check-production-collaboration-visitor.mjs`：390px 手机模拟及 1280px 电脑下，未登录游客实际渲染 102 张自定义卡片，含矮守围，revision 174，页面未捕获异常 0。证据 `.cache/incident-production-visitor.json`；截图 `.cache/test-shots/production-collaboration-visitor-phone.png` 已查看。
- 本轮完成：最终本地 Node 111/111、完整浏览器 319/319、变更专项 63/63 及最终确认响应协议相关 52/52；真实 codex D1 102 张带图/三会话并发/冲突隔离/清理验收通过；main 只读验证通过。发布记录以 skip ci 提交并快进同步 codex，保持两分支相同，稳定地址页无需换 URL。原设备旧稿可从“找回草稿”恢复，未提交且无副本的历史文字无法凭空重建。

## 2026-10-27 严格独立复审（已补修并正式发布）

- 用户要求再次确认全部问题并严格详细审查。原 111 项 Node 回归绿，但新探针发现 R01–R08，细节见 `docs/collaboration-recheck-2026-10-27.md`。均在本地复现与补修，不向生产注入攻击或改写客户资料。
- 已修复：复制页面清理原快照加版本条件；旧版本地待上传数据独立备份；IndexedDB 失败恢复降级草稿；编辑期间被删除的自定义条目保留为冲突；旧版整库接口仅改元数据的归属伪造；过期及退出响应不得清除后来的新会话；知识库保存等待确认并自动表单草稿；本机备份失败不允许用云端覆盖唯一内存草稿。
- 改进 SQLite 测试夹具事务原子性：去掉 batch 内人为 await 间隙。原本本地 15→7 复现数不能单独当作生产 D1 丢失证据；真实预览 D1 读回证据独立有效。
- 当前正式只读快照 `.cache/recheck-20261027-before.json`：revision 211、自定义科普 114，含矮守围且 114 个唯一 ID。客户持续录入，发布前重新获取快照，不覆盖其间修改。现仍在 codex 本地，尚未部署本轮补修。
- 已通过完整浏览器 319、专项 68；Node 119 在新增最后一个“内存草稿备份失败”探针之前通过；该新增探针修复前明确失败，已加拒绝覆盖守卫，待最终 Node/相关浏览器复验。静态、负向变异、Functions 构建已通过，若后续源码变化只复验相关路径。
- 最终本地复验：Node 120/120，最后守卫改动相关浏览器 57/57；此前完整浏览器 319/319、扩展专项 68/68。全部通过，Functions 重新构建成功。准备只推 codex 先验证真实旧接口归属保护、并发和冲突，再原样发布 main。
- 首批补修 `e91840a` 已经 codex [CI 40500630800](https://github.com/lwy9107124035/longnankejia/actions/runs/40500630800) 验收，真实预览 3 条带图、三会话并发、旧接口元数据伪造拒绝、冲突隔离均通过；7 条临时记录和 15 条测试历史已清理，预览恢复 revision 42/科普 0，公开内容不变。合并 main `a24cd6e`，[CI 40501151991](https://github.com/lwy9107124035/longnankejia/actions/runs/40501151991) 的 80 项检查通过，正式只读内容和密码指纹不变，页面实际渲染 114 条。
- 继续交叉复审发现 R03 另一条件：“IndexedDB 失败→恢复可用”后未读上次降级草稿，浏览器修复前断言失败。现初始化与找回草稿合并两类存储，按快照时间选副本，确认后跨存储清理仍按快照版本保护。相关 Node 51、浏览器 42 通过；待推送此最后补修并核对正式发布。
- 最后补修 `e11d91a01562947b784890e2d62ea7f7261b31c1` 经 codex [CI 40502380217](https://github.com/lwy9107124035/longnankejia/actions/runs/40502380217) 成功；正式合并 `2adfb5ab6f3dc823928aa23d864e77d0a68e44b3`，[CI 40502623731](https://github.com/lwy9107124035/longnankejia/actions/runs/40502623731) 80/80 通过，部署 `https://c7428e58.longnankejia.pages.dev/`。
- 最终只读核验 `.cache/recheck-20261027-main-release-after.json`：10 份关键文件一致，正式 revision 211/科普 114，完整公开内容及密码派生记录指纹与发布前相同。密钥保留，邀请码未变，不复制预览数据、不改生产资料。
- `.cache/recheck-20261027-record-lineage.json` 逐项比对旧 26 条、旧 102 条的 ID，当前 114 条全部包含，缺失 ID 0、重复 ID 0。`.cache/recheck-20261027-production-visitor.json` 全新浏览器手机/电脑视图实际渲染 114，含矮守围，脚本异常 0；手机截图已查看。
- 本轮 R01–R08 均闭合；详细证据和限制见 `docs/collaboration-recheck-2026-10-27.md`。文档记录 skip ci 推送 main，并快进 codex 保持一致。保留实际失败记录，不声称所有未来环境绝无缺陷；同邀请码多人归属按邀请码汇总、16 MiB 总容量和真实 iOS/微信边界已明确。
