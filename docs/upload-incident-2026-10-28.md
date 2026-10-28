# 2026-10-28 上传中断处理

正式站已恢复上传，本次处理未重设密码、邀请码或服务端密钥。

## 原因和处理

1. 正式站仍运行旧存储版本。118 条自定义科普中，80 条图片内嵌在共享 JSON 内，私有内容快照达到 16,714,197 bytes，接近应用的 16 MiB 上限，新图片上传被拒绝。
2. 迁移前的大快照还触发了 Cloudflare 的运行资源限制，实际错误页为 `Worker exceeded resource limits`。逐条整理先完成 12 条、再完成 8 条，随后都安全停止，没有回退客户资料。
3. 逐张校验又发现大图片响应的逐字节回调成本较高，实际图片请求返回了 `error code: 1102`。改成普通字节循环，并增加跨多个存储块的 750,000 bytes 完整性测试。线上预览已完整读回 757,118 bytes 的测试图片，正式站的 80 张独立图片也逐一通过摘要校验。

Cloudflare 的 1102 可来自 CPU 或内存资源超限，不能仅凭错误页确定具体一种；本机转换对比约 16.65ms 与 0.80ms，仅用于定位热点，不冒充线上 CPU 测量。优化和将大包处理移出请求路径后，实际上传及图片读回验证成功。[Cloudflare 官方资源限制说明](https://developers.cloudflare.com/workers/platform/limits/)

剩余 60 条迁移先独立保存并校验图片，再在维护环境复用服务器的归属、历史和审计逻辑生成新快照。单条条件 UPDATE 只在正式 revision 仍为 240 时生效，切换到 241；若有并发新版本就拒绝旧快照。随后通过正常管理接口新增、读回并删除一条维护验证记录，标准分块存储也随正常写入恢复。没有复制预览数据库或清空正式历史。

## 最终核验

| 项目 | 结果 |
| --- | --- |
| 正式版本 | revision 243 |
| 自定义科普 | 118 条，118 个唯一 ID |
| 原有记录 | 118 条逐项比较，正文、其他字段及归属不变，仅图片表示改为独立引用 |
| 图片 | 80 张逐一验证并存入本机备份 |
| 元数据快照 | 449,911 bytes，较处理前减少 97.31%，占 16 MiB 额度约 2.68% |
| 保存 | 正式站真实新增、读回、删除验证成功，临时记录已移除 |
| 凭据 | 密码和邀请码的版本及指纹不变；部署保留原服务端密钥 |
| 页面 | 全新 Chrome profile，390px 手机模拟与电脑视图均显示 118 条，脚本异常 0 |
| 备份 | 版本 JSON 和全部 80 张本站独立图片已校验归档，备份完整标志为 true |

历史 26、102、114 条的 ID 均仍在当前 118 条内；与上次 118 条快照相比，迁移前没有 ID 增减或记录内容变化。现有服务器和快照没有证据证明另几十条曾成功上传，不能宣称已找回不存在的服务端记录。未提交成功的资料仍应从原设备草稿、页面草稿找回或已有备份恢复；应先导出草稿再刷新，保留原设备本地资料。

## 验证和发布

- 最终本地 Node 142/142；本轮 Chrome 同步、安全、协作和管理专项 58/58；Functions 构建通过。
- 修复提交 `a6b87f668db533e50ec0253875dd128db86da39b`。预览 [CI 40640865919](https://github.com/lwy9107124035/longnankejia/actions/runs/40640865919) 与正式 [CI 40641147688](https://github.com/lwy9107124035/longnankejia/actions/runs/40641147688) 均成功，正式检查 102/102。
- [正式入口](https://longnankejia.pages.dev/)，[本次正式部署](https://b6c859ed.longnankejia.pages.dev/)。`地址.html` 的稳定入口无需修改。
- 旧 16 MiB 是应用保护额度；独立图片仍占 D1，实际套餐额度不得按未知值推断。本轮 D1 只读文件占用约 27 MiB，没有开通付费服务。

## 原始证据

- `.cache/incident-20261028-diagnosis.json`：发布前正式数据及空间统计。
- `.cache/incident-20261028-main-private.json`：发布前完整私有内容快照，不提交 Git。
- `.cache/history-audit-20261028.json`：独立成员核对历史 ID 和内容。
- `.cache/incident-20261028-http-failures.jsonl`、图片备份目录中的 `.failure.body/.failure.headers`：保留的实际超限错误。
- `.cache/incident-20261028-atomic-rehearsal.json`：隔离备份演练、过期版本拒绝及正常接口恢复。
- `.cache/incident-20261028-atomic-result.json`：实际条件切换、图片、凭据和上传核验。
- `.cache/incident-20261028-final-verification.json`：原有 118 条与配置逐项核验、线上源码一致。
- `.cache/incident-20261028-production-visitor.json`：实际页面渲染结果。
- `.cache/maintenance/latest.json` 及 `backups/`：完整公开内容与本站图片的追加式备份。

维护组分工和每 6 小时巡检见 `docs/maintenance-runbook.md`。元数据达到 2 MiB 或额度的 85%（取先到者）即预警。巡检依赖本机与 Codex 调度，尚不能称为全天服务器监控；真实 iPhone/微信和公众号公开流量仍需独立验收。
