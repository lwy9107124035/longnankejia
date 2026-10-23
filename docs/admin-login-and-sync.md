# 管理员登录与手机同步

本次代码在 `codex` 分支，来自 `antigravity` 的 23473f7。旧 codex 已保存在本地备份分支 `backup-codex-before-antigravity-20261020`。

## 为什么电脑能用，手机不行

2026-10-20 的检查发现，旧版共享数据库地址无法解析（ENOTFOUND）。接口没有把数据库故障告诉用户，而是使用某一台服务器的临时内存，继续返回成功。电脑可能还有旧密码和内容缓存，新手机则没有。原来的登录还直接依赖浏览器缓存，云端同步并未完成时也能开始判断密码。

Cloudflare 明确说明，请求不保证落到同一个实例，不应使用全局变量保存共享状态：[Workers 的运行方式](https://developers.cloudflare.com/workers/reference/how-workers-works/)。

## 现在的行为

- 手机和电脑都由服务器验证密码。会话分别保存在各自标签页，退出一端不会退出另一端；会话有效期为 12 小时，浏览器禁止存储时仍可在当前页面使用。
- 密码大小写严格区分，处理全角字母、数字、零宽字符与首尾空格。邀请码另外兼容手机智能连接号。
- 更改密码后，旧密码和原来的默认密码失效；其他超级管理员会话需要重新登录。邀请账号的会话会在暂停、撤销或过期后被服务器拒绝。
- 不再通过公开二维码传递管理员密码、密码哈希或整批邀请令牌。旧的自校验邀请需要重新签发，旧的 `admin-auth=super` 链接不能免密登录。
- D1 保存密码派生值、会话和内容，服务器重新启动不丢失。数据库未配置或发生故障时，界面明确报错。
- 大容量内容和未上传草稿使用 IndexedDB 原子保存，避免图片占满 localStorage 后静默回退到旧值。科普保存、批量知识入库及导入仅在服务器确认后提示上传成功；断网时保留草稿并明确报错。页面可见时每 15 秒检查版本，版本未变时不重复下载全部图片；回到页面或恢复网络时立即同步。
- 多台设备独立新增或修改不同条目时，基于上次云端版本自动合并并重试。若同一条目被双方修改，或一端删除、一端修改，则停止上传，保留本机草稿并提示冲突。可先点“导出本机备份”，核对后再点“重新加载云端内容”，不会默默覆盖另一位老师的修改。
- 升级前已有的本机内容会保留，登录后尝试上传；若云端已有新内容，会进入上述冲突流程。备份包含各模块的原始覆盖和删除记录，不包含密码或会话。
- 游客无需登录即可读取最新云端馆藏，本机未上传草稿不再拦截公开读取；草稿仍可导出，登录后恢复合并。加载或网络失败会在科普页提示并提供重试，不再静默显示最初 15 条。
- 科普正文直接按回车换行、空一行分段，后台游客预览与前台详情使用同一排版，保留原有 HTML 正文兼容。

2026-10-23 容量修复：原先整站内容挤在单一 D1 行，D1 [单行上限为 2,000,000 bytes](https://developers.cloudflare.com/d1/platform/limits/)。现在在现有 `admin_state` 表中分块保存内容，以 [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) 原子替换所有分块与版本；读取时用一条 SQL 获取完整快照。兼容旧单行格式，不需要迁移、清空数据库或重设密码。当前接口上限为 16 MiB，超限会明确报错并保留草稿；“分批上传”无法解决全站总量超限，因此不再给出该误导提示。达到此上限后应扩展媒体存储。

## codex 预览部署配置

2026-10-20，按用户要求准备推送 codex 供手机与电脑验收，main 等用户确认后再更新。已经使用本机现有的 Cloudflare 登录创建独立数据库 `longnankejia-admin-codex`（APAC），执行 `migrations/admin/0001_admin.sql`，并将数据库 ID 保存为仓库变量 `CODEX_ADMIN_D1_ID`。

初始管理员密码已按用户指定值设置到 [仓库 Actions secret](https://github.com/lwy9107124035/longnankejia/settings/secrets/actions) `ADMIN_BOOTSTRAP_PASSWORD`，由 CI 写入 Cloudflare preview 的服务端密钥，不写入浏览器源码。它仅用于数据库第一次初始化；后台改密后不会被部署重置。

CI 根据 `CODEX_ADMIN_D1_ID` 生成 `ADMIN_DB` 绑定，复用已初始化的数据库，现有部署令牌可继续只持有 Pages 权限。以后新增 SQL 迁移时，使用具备 D1 写权限的登录执行迁移；在没有该仓库变量的新环境，脚本也支持通过具备 `Account → D1 → Edit` 的令牌创建和初始化数据库。数据库、绑定或密钥出错时会停止部署，不会降级成假成功。

推送后等待 Cloudflare 工作流成功，再用两台设备访问 [codex 预览入口](https://codex.longnankejia-dev.pages.dev/)。可验证同一密码登录、内容同步、独立退出、邀请暂停等行为。验收期间若更改主密码，后续应使用更改后的密码登录。

配置依据：[Pages 的 D1 绑定](https://developers.cloudflare.com/pages/functions/bindings/)、[Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。

上述数据库只供 codex 预览使用，不迁移或修改 main 的正式站数据。部署结果记录在 `docs/codex-admin-checkpoint.md`。

本轮已部署成功：[Cloudflare 工作流](https://github.com/lwy9107124035/longnankejia/actions/runs/39368977261)。线上已核实初始密码登录和两端会话互不影响，main 保持原样；等待用户实际验收后再更新 main。

2026-10-20 后续：用户已确认验收通过并授权发布 main。正式站使用独立数据库 `longnankejia-admin-main`，通过 `MAIN_ADMIN_D1_ID` 绑定，原样迁移已验收版本的密码派生值、邀请和管理配置。main 发布时保留 Cloudflare 现有 API 密钥，不上传初始化管理员密码或重设数据库密码。main 与 codex 的后续编辑分别保存在各自数据库中。

正式站已完成发布：[正式部署工作流](https://github.com/lwy9107124035/longnankejia/actions/runs/39370633004)。原密码登录、两端独立会话和实际 AI 请求均通过线上检查，原网址与展板二维码可继续使用。

## 二维码入口要对应版本

展板永久二维码指向 `https://longnankejia.pages.dev/`（main），无需重新制作。codex 修改先在预览网址验收，用户确认后发布到 main；正式部署完成后，原网址和原展板二维码即可访问更新版本。

普通 `python -m http.server` 仅提供静态页面，不运行管理接口。管理员测试使用下述带真实 SQL 的本地测试服务；不能把静态预览下的接口错误当成密码错误。

## 验证命令

```text
node --test tests/admin-sync.test.mjs tests/v3_admin_ux.test.mjs tests/pages-functions.test.mjs
node tests/admin-negative-checks.mjs
node tests/run_site_tests.mjs --only=admin,8
node --test tests/v2_knowledge.test.mjs tests/v2_models.test.mjs
python tests/check_static.py
wrangler pages functions build --outfile=.cache/admin-worker.mjs
```

浏览器测试使用实际管理接口和 SQLite，电脑与手机使用两个隔离的浏览器上下文。手机环境是 Chromium 的 iPhone 用户代理及 360px 触屏尺寸模拟，不能替代真实 iOS Safari、微信和蜂窝网络的上线验收。

2026-10-20 本地结果：管理与代理测试 29 项、知识库与模型测试 40 项、完整浏览器回归 292 项全部通过；3 个负向变异均被捕获。静态检查、二维码独立解码与 Wrangler 4.137.0 服务端编译通过。
