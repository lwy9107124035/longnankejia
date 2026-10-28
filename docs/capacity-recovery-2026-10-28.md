# 图片容量、历史恢复和兼容性改进

本轮在 codex 验证。正式 main 的资料、密码、邀请码、API 密钥保持原设置。

## 已完成

| 问题 | 处理 | 验证 |
| --- | --- | --- |
| 多张图片把整库快照撑到 16 MiB，后续保存失败 | 图片按内容摘要独立存入现有 D1；编辑请求按最多 8 项、约 4 MiB 分批，只有服务器确认才清理本机草稿 | 约 19.5 MB 图片保存后，新设备读取全部条目；图片实际字节相同 |
| 旧页面仍带着内嵌图片，迁移后误报内容冲突 | 图片引用和原图片按同一身份比较，接受原版本的校验摘要；整理旧图使用逐条条件写入 | 旧页面仍能保存，整理不改变正文、归属和创建时间 |
| 误删、误改后只能整体回滚 | 超管“系统备份→云端历史”可恢复单项；校验后续修改，过期历史停止恢复 | 恢复误删图文，保留同事其他条目；已有后续编辑返回冲突 |
| 图片改为链接后，备份离开原数据库会缺图 | 完整备份下载时打包图片；恢复时重新保存图片。网络失败时明确下载“文字与图片链接”版本 | 带图备份导入空数据库；WebKit 下载、选文件和图文恢复 |
| 历史图片继续占正文空间 | 新历史只保存独立图片引用，按需读取；恢复也维持独立图片 | 删除、编辑、审核回滚的旧图片均可恢复且不塞回正文快照 |
| 没有苹果设备进行现场验收 | 补充 WebKit 桌面、手机和微信 UA 模拟，关闭 Object.hasOwn 验证旧 API 条件 | 每组 11 项，共 33 项通过；不能标为真实 iPhone 或微信已验收 |

存储面板可查看正文快照和独立图片占用，并整理旧版内嵌图片。整理时同事若已修改同条，条件写入会保留对方版本。

## 验证记录

- Node：131/131，`.cache/capacity-all-node-final.txt`。含 11 项新增存储、恢复、迁移与异步竞争测试。
- Chrome 全量：319/319，`.cache/capacity-full-browser.txt`；最终同步、安全、协作和管理专项 58/58，`.cache/capacity-browser-final.txt`。实际 CSP，未捕获异常和失败子资源均为 0。
- WebKit：33/33，`.cache/webkit-final.txt`、`.cache/browser-engine-results.json`。真实选图、Canvas 压缩、跨设备游客读取、普通换行、断网刷新、联网续传、误删恢复、下载与导入全部经过浏览器操作。
- 3 项负向变异均捕获；静态检查、Cloudflare Pages Functions 构建通过。日志分别为 `.cache/capacity-negative.txt`、`capacity-static.txt`、`capacity-functions-build.txt`。
- 初轮 WebKit 最后一项把刷新时的 beforeunload 空消息当成异常弹窗，业务流程已成功；修正测试按弹窗类型识别后 33 项全过。
- 最终 Node 曾发现镜像图片显示逻辑在没有 location 的知识库测试环境中抛错；增加环境判断后 130 项全过。保留实际失败记录，不把最初失败描述成一次通过。
- 发布前再查发现删除成功后恢复列表需等下一次读取；新增断言明确复现失败（`.cache/capacity-history-before-fix.txt`）。确认响应现即时更新超管恢复列表，最终 131 项全过；WebKit 也移除额外手动同步步骤验证实际操作。

## 仍需明确的限制

1. 解除的是**图片累计占满原整库快照**这一限制。正文、配置及历史元数据快照仍限制 16 MiB；单张图片、请求体和导入文件也保留保护。触顶时拒绝保存并保留草稿，不承诺无限容量。
2. 独立图片及历史会占用现有 D1，未启用新付费服务。数据库容量和查询额度取决于实际套餐；上线前后均不得为了测试修改套餐。[Cloudflare D1 官方限制](https://developers.cloudflare.com/d1/platform/limits/)
3. 已上传且保留前值的记录可恢复；从未上传、原设备和备份均无副本的文字无法重建。Cloudflare 数据库时间恢复有套餐对应窗口，整库恢复会影响其他人的新内容，不能直接对客户库执行。[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
4. 本机 WebKit 是浏览器引擎兼容检查，微信 UA 仅模拟标识。真实 iOS 系统、微信内置浏览器和客户网络尚未验收。[Playwright 浏览器说明](https://playwright.dev/docs/browsers#webkit)

## 复验方式

运行现有 Node 和 Chrome 测试。WebKit 需要安装 Playwright 及其 WebKit 浏览器；若装在项目外，设置 `PLAYWRIGHT_MODULE` 为模块 URL，再运行 `node tests/browser-engines.mjs`。本轮模块位于 `.cache/browser-check/node_modules/playwright/index.mjs`，依赖和浏览器不提交仓库。

最终产品提交 `9a68420d34a91d89e5b9790929c739c7898647c9`，仅发布 codex；[CI 40636281954](https://github.com/lwy9107124035/longnankejia/actions/runs/40636281954) 的 91 项检查通过。[固定预览入口](https://codex.longnankejia-dev.pages.dev/)，[本次部署](https://37522869.longnankejia-dev.pages.dev/)。

真实预览 D1 验证图片字节相同、重复上传去重、三会话并发保存及同条冲突保护，随后删除全部临时条目、退出临时会话。预览科普仍为 0，公开内容摘要不变。证据 `.cache/capacity-preview-smoke-result.json`。

发布前后正式站均 revision 220/科普 118，完整公开内容、密码指纹及三份前端源码未变化；预览密码指纹也未变化。没有修改正式密钥、邀请码或复制两库资料。发布核验 `.cache/capacity-release-before.json`、`capacity-release-after.json`；完整发布记录在 `docs/codex-admin-checkpoint.md`。
