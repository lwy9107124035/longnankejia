# codex 存储升级记录

本轮仅升级 codex。main 继续使用原数据库和已发布代码；客户密码、邀请码、服务端密钥及资料不随预览迁移复制或重置。最终提交、部署和迁移结果见 `codex-admin-checkpoint.md` 最后一节。

## 已实现

- 正文按条保存在 D1，不再把整站正文及历史塞进一个16MiB快照。保存使用条目摘要、全局条件事务及操作回执；不同条目可合并，同一条目的冲突保留草稿。
- 科普、知识、方言列表按页加载，详情按需读取，搜索在服务器查询。管理员显示云端总数，审查明细按50条分页；回滚按批执行，保留他人的后续修改。
- 导出前读取全部目标正文。分页读取遇到新版本会停止，不生成缺条备份。大图超过浏览器64MiB打包预算时，界面明确标注只备份文字和媒体链接；维护工具采用分文件备份。
- R2 二进制图片、影音分片上传、断点续传、摘要校验及最终回执已实现。影音单文件上限250MiB，分片8MiB；上传确认后才把链接写入表单。换号、会话到期和文件不一致均停止续传。
- 原D1独立图片可每批最多3张复制到R2，保留原始Base64编码身份、链接和原D1块。失败不删除源图；重试复用已核验对象。旧链接在R2无对象时仍可读取D1；R2故障不会被伪装成迁移成功。
- 30天以前的历史前值可分批归档到R2，读回核对后才替换引用，恢复时校验摘要。原始回滚历史不自动删除。
- 图片和影音支持HTTP Range；维护工具能读取所有正文页，并流式备份本站影音。基线缺条仍报警，同时继续保护格式有效的现有数据。

## 迁移方式

工具为 `scripts/migrate-content-records.mjs`，默认只读演练。它保存不覆盖的内容/历史备份及凭据摘要；不会建立新数据库、启用订阅或清空旧数据。

```powershell
# ACCOUNT_ID 为账户ID，非API密钥；授权使用本机已有Wrangler登录。
node scripts/migrate-content-records.mjs --target=codex --account-id=ACCOUNT_ID
# 审查演练结果后，REV 填演练看到的版本。
node scripts/migrate-content-records.mjs --target=codex --account-id=ACCOUNT_ID --apply --expect-revision=REV
```

先暂存逐条记录并逐项核对，再以内容版本和凭据前值为条件切换入口；期间若有人修改内容、密码或邀请码，切换失败，保留新数据并重新演练。旧快照及分块仍保留。不可在已经产生新内容后直接回退旧整库。

R2接入使用已有桶的GitHub变量 `CODEX_ADMIN_R2_BUCKET`，main对应 `MAIN_ADMIN_R2_BUCKET`；两者必须分开。部署脚本只绑定已有桶，不开户或创建订阅。不配置时保留现有D1图片路径，禁用大文件上传能力。

## 验证与原始证据

| 范围 | 结果与证据 |
| --- | --- |
| Node/API/数据迁移与安全回归 | 188/188，`.cache/storage-all-node-release.txt`；旧图迁移接口最后补充4/4，`.cache/storage-copy-api-tests.txt` |
| 完整页面回归 | 320/320，`.cache/storage-full-browser-final.txt`；最后兼容补修另跑相关流程 |
| 管理员 Chrome/WebKit 组合 | 44/44，`.cache/storage-admin-ui.txt` |
| WebKit 桌面、手机与微信UA模拟 | 33/33，`.cache/storage-webkit-verified.txt`；不等同苹果真机/真实微信 |
| 新模式完整应用界面 | Chrome/WebKit各12项，`.cache/records-browser-complete.txt`、`records-browser-results.json` |
| 三设备协作及草稿恢复 | 17/17，`.cache/storage-collaboration-verified.txt`；另见同步、安全、管理员专项 |
| 流式上传控件 | Chrome/WebKit共22项，`.cache/media-upload-browser-20261028.json` |
| 250MiB影音 | 本地workerd/R2实传32片、最终摘要及读回通过，`.cache/media-250mib-check-20261028.txt` |
| 规模、完整公开备份与隔离恢复 | 一万条长正文和一万张250KB合成JPEG，综合演练结果以`.cache/records-browser-scale-results.json`为准；未取得成功结果前不标作完成 |
| 静态、负向验证、Functions编译 | `.cache/storage-static.txt`、`storage-negative.txt`、`storage-functions-build-final.txt` |

保留的实际失败：旧测试漏载共享schema；异步表单测试过早访问DOM；方言名称含徽章导致精确文本定位失败。均调整夹具/等待方式后验证。WebKit还发现了真实的旧模式问题：历史恢复后使用过期摘要删除、服务器拒绝时反复重试；已修正旧模式摘要使用，并保留服务器明确返回的冲突。新增两项Node回归和WebKit完整恢复流程通过。

旧规模测试确实在同一进程中完成过2.5GB媒体校验，但旧夹具使用的`r2Persist`被新运行时忽略，关闭进程后无法复用；不是持久化验收。已按安装的官方运行时代码改用`resourcePersistencePath`，重新生成持久化数据，综合备份再逐图校验。合成图共用同一种子JPEG并加入不同合法注释段，是字节规模测试，不是一万幅不同文化照片。

## 当前外部条件与范围

2026-10-30只读探测及Wrangler均返回10042，平台明确要求先在控制台启用R2。本轮没有启用订阅或改变账单设置。R2云端、实际网络分片上传和真实设备验收须在账户启用、桶绑定后完成，不能拿本地模拟代替。[官方启用流程](https://developers.cloudflare.com/r2/get-started/)

R2存在免费用量，也会按实际存储与操作超额计费；不是无限免费空间。是否启用及费用处理由账户所有者决定。[官方计费](https://developers.cloudflare.com/r2/pricing/)

公开备份涵盖正文和本站独立媒体，不包含外站媒体、私有审计、R2历史归档或明文凭据。迁移工具单独保留私有内容历史快照，凭据只保存摘要。容量预警是维护预算，不代表已查询到账户套餐余量；公众号正式开放前仍需真实设备、实际媒体云端及预期并发验收。
