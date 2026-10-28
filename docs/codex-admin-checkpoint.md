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

## 2026-10-27 容量、历史恢复与 WebKit 兼容改进（进行中，仅 codex）

- 用户要求修复上述明确边界，且暂时没有苹果设备。只在 codex 完成改进和预览验证；main 仍为已发布基线 `7324ed3`，本轮不改正式资料、密码、邀请码和密钥。
- 当前未提交实现：D1 独立图片块及不可变图片 GET/HEAD；新编辑按最多 8 条/约 4 MiB 请求分批上传；历史图片引用归档；单项误删/编辑历史恢复且拒绝覆盖后续版本；导出带图片的可迁移完整备份；旧图片整理和容量显示；移除客户端 Object.hasOwn 依赖。
- 独立图片可累计超过原整库 16 MiB 限制。正文/配置/历史元数据快照、单请求和单文件仍保留安全限制，服务器套餐亦有容量上限，不宣称无限空间。没有原文或备份的未上传历史资料无法重建。
- 初轮本地 Node 127/127（`.cache/capacity-all-node.txt`）；Chrome 相关 58/58（`.cache/capacity-browser-first.txt`）。之后增加旧图整理/恢复规范化/镜像路径兼容，须最终复验。测试曾因旧容量断言预期失败、匿名大请求预期 401（实际按流预算先 413）失败，已调整为新行为断言，保留原日志。
- Playwright 1.64.1/WebKit 27.2 build 2370 已下载到本机 cache；准备 WebKit 桌面和手机模拟实测，不能替代实际 iPhone/微信。新共享本地站点夹具 `tests/helpers/site-server.mjs` 用二进制响应图片，不向生产写入。
- 待办：新增旧图整理/异步读取竞争测试及多引擎完整上传恢复检查；最终 Node/浏览器/Functions 构建；仅提交推送 codex，确认 CI 与真实预览，保存发布证据。
- 2026-10-28 最终本地验证：Node 130/130、Chrome 全量 319/319、最终相关专项 58/58、WebKit 桌面/手机/微信 UA 模拟 33/33；3 项负向变异、静态检查和 Functions 构建通过。误判 beforeunload 的 WebKit 断言和缺少 location 的知识库夹具兼容问题均已修正，保留实际失败记录。审核回滚改为仅展开所选历史的图片，避免一次读入全部历史图片。
- 发布前只读 `.cache/capacity-release-before.json`：main revision 220/科普 118；codex revision 42/科普 0；两库密码 revision 1。当前 main 的客户录入量比上轮增加，不复制预览库或覆盖新资料。详细实现、验证、保留容量保护和真实设备限制见 `docs/capacity-recovery-2026-10-28.md`。
- 首批 `4b2d6bb566ed3ddd306da1a13aceee2b01955bc7` 已只推 codex，[CI 40636024076](https://github.com/lwy9107124035/longnankejia/actions/runs/40636024076) 成功。最后操作核对复现“删除成功但历史列表仍旧”延迟，补充确认包中的超管恢复摘要和 Store 即时更新，新增断言修复前失败；最终 Node 131/131、Functions 构建通过，WebKit 移除手动同步后复验中。
- 最终产品提交 `9a68420d34a91d89e5b9790929c739c7898647c9` 仅推 codex，[CI 40636281954](https://github.com/lwy9107124035/longnankejia/actions/runs/40636281954) 91/91 成功，部署 `https://37522869.longnankejia-dev.pages.dev/`，固定入口 `https://codex.longnankejia-dev.pages.dev/`；WebKit 不额外同步直接恢复的 33 项全部通过。
- 真实 codex D1 `.cache/capacity-preview-smoke-result.json`：三独立会话共享一张 57,118 bytes 图片，去重及二进制逐字核验通过；并发新增 3 条均成功，同条并发仅一方保存、另一方得到冲突。全部临时条目删除，三会话退出，预览从 revision 42 到 47/科普仍 0，原公开内容摘要相同。保留一份内容摘要图片及少量测试历史供可追溯，无生产写入和整库清理。
- 最终 `.cache/verify-capacity-release.mjs after`、`.cache/capacity-release-after.json`：codex 3 份关键前端文件与已验收本地源码逐字一致；main 3 文件未变化，main revision 220/科普 118，内容及密码派生记录指纹与发布前相同，两库密码 revision 1。main 远端仍 `7324ed3`，API 密钥及邀请设置未改。`地址.html` 的两条稳定入口已核验，无需随每次部署更改 URL。
- 本轮已完成 codex 改进和预览验收；main 尚未发布本轮存储升级。元数据/单文件/套餐容量保护和真实 iOS/微信未验收等限制如实保留；详见整改报告。后续发布 main 须沿用正式库并先取得新快照，不复制预览资料。

## 2026-10-28 客户上传中断与长期维护（进行中）

- 新反馈截图明确显示“内容达到容量上限”及暂未响应；客户称只见 114 项、怀疑另缺几十条。不能把被拒绝上传直接认定为已上传后丢失。上轮独立图片存储仅部署 codex，main 仍旧版，须先核实现网版本、快照字节和真实 D1 占用。
- 用户要求组建 AI 维护小组。主代理负责故障诊断、修复和发布，一名有界只读审查成员核对本地历史快照与缺失 ID；共享本记录，不并发改业务文件。准备建立单一定期巡检，异常或需处理时通知，避免重复任务。
- 保护：先取得最新正式完整内容备份和密码指纹；不复制预览库，不清理正式历史或客户条目，不重设密码、邀请码和密钥。基于实测决定容量迁移，使用条件写入保护客户并发录入。恢复上传优先。
- 当前工作分支 codex，原 HEAD `f673efd`；待正式只读诊断、历史对比、复现新旧接口/迁移行为后决定修复。证据和后续实际结果在此续记。
- 已确认 `.cache/incident-20261028-diagnosis.json`：正式 revision 220/118 条且 ID 全唯一；私有内容快照 16,714,197 bytes（含历史/审计），公开响应 16,587,806 bytes，80 条内嵌图片。D1 文件 16,818,176 bytes；触发的是应用整库快照限制。完整正式私有备份 `.cache/incident-20261028-main-private.json`，公开备份 `incident-20261028-main-public.json`，密码仅留指纹，revision 1。
- 独立历史核查 `.cache/history-audit-20261028.json`：旧26、102、114条 ID 在118条中全部仍在，当前118条与上次118条逐项规范化相同。无法以服务器证据证明另几十条曾上传；不编造或重复导入未知内容。
- 最新正式备份在隔离 SQLite 演练旧图迁移：80 条完成，118条文字、归属及创建时间不变，图片对应同一摘要；快照从16,714,197 bytes降至449,620 bytes，图片独立16,309,248 bytes，单请求最大47条SQL（超管夹具）。证据 `.cache/incident-20261028-migration-rehearsal.json`。初始夹具已含content默认行，第一次重复INSERT失败，改为隔离库的INSERT OR REPLACE后演练通过，没有线上执行此替换。
- 为已打开的旧网页补充服务端图片分离：先校验提交内容，再规范图片引用，沿用旧版本哈希兼容；同请求重复图片复用存储结果。新增旧页面保存探针，相关API36项通过。准备完整回归后部署codex并原样发布main，随后按条目条件整理正式旧图；不改密码密钥、不替换正式库。
- 新增只读巡检 `scripts/maintenance-health.mjs`、118个ID基线 `docs/production-baseline.json` 和维护手册；公开接口返回不含内容的容量数字，85% 预警。巡检支持不覆盖的版本快照、所有本站独立图片去重缓存和摘要校验，失败不冒充完整备份。Node 140/140、相关 Chrome58/58、Functions 构建通过；其中维护工具8项本地HTTP测试通过。准备发布，尚未执行正式旧图迁移。
- 已发布产品 `0a25be43d13c2a40e28393535c73f7715584c165`：codex [CI40638331002](https://github.com/lwy9107124035/longnankejia/actions/runs/40638331002)100/100，正式 [CI40638589892](https://github.com/lwy9107124035/longnankejia/actions/runs/40638589892)100/100、部署 `https://a7a7e672.longnankejia.pages.dev/`，main沿用原D1并明确保留服务端密钥。
- 预览专项第一次 TLS 35 导致 finally 清理未完成，遗留4条自建临时数据；重试专项通过图片逐字校验、三会话并发、冲突保护和旧页面自动图片分离。已按已知精确前缀清理第一次遗留4条，预览 revision59/科普0，证据 `.cache/incident-20261028-preview-smoke-result.json`、`incident-20261028-preview-cleanup-result.json`。没有删除客户数据或清理私有历史。
- 正式普通API迁移先完成12条、下一轮再完成8条后遇503。第二轮保留的错误页明确为 Cloudflare“Worker exceeded resource limits”，不再归因为普通网络。两次均保留原始日志、结果和备份，维护会话已退出；20条迁移成功，没有用旧稿覆盖。证据 `incident-20261028-migration-attempt1.json`、`-attempt2.json`、`incident-20261028-http-failures.jsonl`。
- 剩余迁移改为维护环境处理大JSON、先上传并逐张校验独立图片，再用单条D1 UPDATE且WHERE revision条件原子切换content行；所有前值与归属由原服务器更新/归档helper生成，其他配置严格相同，旧版本写入被拒绝。隔离正式备份演练已通过：118条、快照445,223 bytes、过期CAS拒绝、正常API新增删除及恢复标准分块存储全部通过（`.cache/incident-20261028-atomic-rehearsal.json`）。实际执行中，待取得最终图片、ID、密码邀请码指纹和上传回归结果。
- 已创建本聊天维护巡检 `automation-2`，ACTIVE、每6小时；首次因缺destination参数被拒绝后修正为thread成功。定期只读巡检及备份，异常才通知，不自动生产批量变更或改密钥。该调度依赖本机及Codex运行，不能宣称服务器全天值守。
- 原子迁移准备阶段首次因本机TLS35未开始读取；只读Cloudflare调用增加有界重试后，剩余图片已全部存入独立块。切换前实际逐张 GET 校验在第9张遇503，保留的图片响应明确为 `error code: 1102`，因此尚未执行content行切换，维护会话已关闭。额外定位图片响应中的逐字节回调耗时：本机300,000 bytes测得约16.65ms，对应普通循环约0.80ms；这是本机对比，不冒充线上CPU时长。改用无回调循环，新增750,000 bytes跨块精确读回测试，最终Node142/142、Functions构建通过。真实大图复验及迁移仍待完成。
- 维护工具提前在2MiB元数据或85%限额（取先到者）预警，避免等16MiB才处理运行压力；专项9/9通过。D1只读info成功，文件28,352,512 bytes，未知账户套餐额度仍标未知，不开付费服务。
- 最终图片性能修复 `a6b87f668db533e50ec0253875dd128db86da39b`：预览CI40640865919、正式CI40641147688均成功，正式102/102；主站部署 `https://b6c859ed.longnankejia.pages.dev/`。真实预览757,118 bytes图片逐字读回通过。最终Node142/142、相关Chrome58/58和Functions构建通过；没有将最初142项通过当成平台资源验收，实际大图已补实测。
- `.cache/incident-20261028-atomic-result.json`：先校验80张独立图片，剩余60条按revision240条件原子切换到241；随后正常接口新增、读回、删除维护验证记录，恢复标准分块存储，正式最终revision243/118条，metadata449,911 bytes。无缺失ID、无并发改动覆盖、密码及邀请码指纹不变、维护会话已关闭。前20条正常API迁移加剩余60条共80条完成。
- `.cache/incident-20261028-final-verification.json` 将原118条逐项规范图片后比较，正文、所有其他字段、归属及配置相同；3份线上前端源码与本地一致。`.cache/incident-20261028-production-visitor.json` 全新Chrome profile在手机/电脑视图均实际渲染118条，含矮守围，异常0；手机截图已查看。
- 首次维护巡检已真实运行：`.cache/maintenance/latest.json` problems/warnings均空，容量2.68%，全部80张本站独立图片校验复用，完整公开快照保存在 `.cache/maintenance/backups/revision-243-cf07511f851c1a128c9aeac3b035b81d41e787a7774cb93ef639438a7e7fdf13.json`，snapshotComplete=true。私有完整备份独立保留，不能将公开备份当作含审计及密钥的整库备份。
- 本轮事故处理完成，正式上传已恢复；维护组和6小时巡检已启用。完整报告 `docs/upload-incident-2026-10-28.md`，维护手册 `docs/maintenance-runbook.md`。客户旧26/102/114均仍在118条中；另几十条无已上传证据，需保留原设备草稿，不能编造恢复结果。仅真实iOS/微信及公开负载验收等未做的边界保留。文档记录以skip ci提交并同步main/codex，不再重复部署未改变的网站代码。

## 2026-10-28 再次取证、完整管理员验收和持续容量（已发布并收尾）

- 用户要求继续追查另外几十条成功上传证据，并详测全部功能尤其管理员及持续容量。正式站仅取证和只读核查；所有故障、并发及增长测试使用隔离环境，保护现有密码、邀请码、密钥和客户资料。
- 最新只读取证 `.cache/deep-review-forensics-20261028.json`：正式revision245/118条，保留历史237项，涉及120个自定义科普ID。当前缺少的两ID中一条是本次已清理的维护验证；另一条标题“1”，有明确新增（本地14:10:16）和删除（14:11:03）记录，保留删除前值，不擅自恢复。23份历史快照未发现旧客户ID缺失；完整范围限制须写报告，不能把没日志当作用户没上传。
- 官方Time Travel当前只能覆盖原库恢复，尚不支持安全克隆历史库；未对正式库执行时间回退。账户订阅读取被权限10000拒绝，套餐上限未知；D1实际文件16,936,960 bytes，图片块16,309,248 bytes，不能把元数据余量当数据库无限余量。
- 独立核查成员新增 `tests/admin-comprehensive.test.mjs`，6项本地API组合通过；新增UI `tests/admin-browser-comprehensive.mjs` 首次24项通过、3项确认失败：方言失败后关闭表单、AI保存和AI重置失败仍成功提示。已要求成员补齐审核通知、锁定解锁及双页冲突的真实UI流程；主代理负责修业务源码。
- 初步本地增长测试 `.cache/deep-review-growth-local.json`：118/500/1000/2000/5000条的单条修改耗时随整库增长（本机约9/21/36/71/182ms）；不是Cloudflare CPU验收。仍有整库正文/历史快照和10000条集合保护，需真实平台验证后决定扩展，不承诺无限资源。
- 创建纯合成QA D1 `longnankejia-qa-20261028-6218` / `8656c6c3-3fcc-4d47-a515-67726879d711`，独立Pages别名codex-qa-20261028用于真实平台增长测试，未绑定main/codex数据库，不设置或改写共享项目密钥。测试后清理仅此资源；所有生产内容未复制到QA库。QA配置/日志在.cache/deep-qa-*，当前在构建部署。
- QA部署已完成，118/500/1000/2000/5000长正文规模的45次真实平台操作全部200成功，最大初始元数据11,292,995 bytes，已确认ID无缺失；证据 `.cache/deep-review-qa-baseline-results.json`。该组无图片且历史少，另由同一独立成员执行2000基础记录+100不同图片+三协管会话持续上传和编辑，不把初始规模当成多年持续运行保证。
- QA部署曾将预览项目的默认绑定模板改为QA；当前codex既有部署仍为原f5库，main仍为317库。**清理QA库前必须通过正常codex发布恢复并核验preview模板ADMIN_DB=f5a18460-1926-4c5f-846e-fbb11d686bd0**；不更改production模板或密钥。QA别名仅用于本轮，收尾删精确QA部署与库，保存证据。
- 主代理修复方言失败留稿/刷新恢复/复用ID、AI保存与重置和KB重置的假成功及旧内存复活、协管AI只读；另发现AI模型配置因原地对象修改与媒体比较缓存而漏传，改为新对象更新且媒体缓存跳过非媒体配置。三类新建草稿带原始空版本，防云端已成功但草稿清理失败时覆盖同事新改版本。
- 最终本地152/152 Node、完整浏览器319/319、管理员Chrome/WebKit专项17组44项0失败；3项负向变异、静态和Functions构建通过。新增Node7项已进CI；新增UI测试及修复前失败记录保留。证据见 `docs/full-admin-review-2026-10-28.md`。
- 巡检新增可选 `--d1-database`，读取实际D1文件大小，350MiB维护预算预警（不是账户配额），授权不可用明确警告仍继续公开备份；3项新测试及真实CLI检查通过。`.cache/maintenance/deep-review-before.json`：正式rev245/118，全部80媒体已校验复用，备份完整，元数据450,864 bytes，D1文件16,936,960 bytes，problems/warnings均空。已有automation-2原地更新命令和阈值，仍每6小时、状态不变安静。
- 发布前 `.cache/deep-review-release-before.json`：main245/118、codex59/0，原密码/邀请码摘要及两站应用摘要已保存。业务修复尚未提交；待持续带图测试完成后提交codex、等待CI、核验预览源码与绑定，再发布同一main、只读比较内容/凭据。用户询问扩容费用，已说明未开通收费扩容，未来超额先给具体费用，不假定当前订阅或无限容量。
- 实际已完成：产品提交 `26392dbdc3ebe3201524974f978ff678e5b7a9c1` 先codex再快进main，两站CI均112/112成功（codex40652739232，main40657865273）；正式部署 `https://71adc3f3.longnankejia.pages.dev/`，固定 `https://longnankejia.pages.dev/`，预览 `https://f5181182.longnankejia-dev.pages.dev/`。`.cache/deep-review-release-{before,codex,after}.json` 确认3关键文件与测试源码一致，main245/118、codex59/0，公开内容和password/tokens记录摘要均未变；main保留原服务端密钥。
- 持续QA最终：2000长正文+100不同图片、13批新增全部200，最大请求2,489,279 bytes；三协管会话读回100/100编辑和图片引用一致，最终2100唯一记录/201历史，实库36,323,328 bytes；5图片GET二进制摘要核验、媒体幂等、同ID并发1接受2冲突通过。最初第13编辑批curl传输失败，读库确认96成功，续跑补4条；续跑脚本曾拼双媒体前缀命中HTML，已修正只读抽图全绿，保留初始及superseded失败记录，不冒称请求全无失败。证据 `.cache/deep-review-qa-endurance-{results,initial-results}.json`。
- 生产只读Chrome两个独立匿名context桌面/390px均实际渲染118、含矮守围、异常0，截图已目视（`.cache/deep-review-production-smoke.json`）；最新`.cache/maintenance/latest.json`备份完整、80媒体校验复用、物理容量读取正常、problems/warnings均空。真实iOS/微信及公网高并发仍未验收，不能承诺未来零故障或无限资源。
- QA精确资源已清理，`.cache/deep-review-qa-cleanup-verified.json`确认临时库与部署均删除，main317/codexf5原库和绑定正常，preview模板已恢复f5。未删生产历史/客户条目；本轮全部已授权实施和发布完成，仅补文档skip ci同步两分支。完整报告 `docs/full-admin-review-2026-10-28.md`。
