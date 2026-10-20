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
- 尚待本轮 main 提交、自动部署及正式网址在线验收；codex 远程分支不改动。
