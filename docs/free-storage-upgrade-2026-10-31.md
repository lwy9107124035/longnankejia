# codex 免费存储升级

2026年10月31日。仅升级 codex，main 暂不发布；R2保持关闭，不开通付费服务。

## 调整

- 保留原正文、管理员和历史库，新增一个独立图片库。新图片写新库，旧图片仍从原库读取；链接、摘要、原图片字节不变。不搬动或清理客户原图。
- 读取顺序为已绑定的对象存储（可选）、独立图片库、原库。图片库故障返回服务错误，不冒充“图片不存在”，也不偷偷把新图片写回正文库。失败保留本机草稿，重试按图片摘要去重。
- 编辑、历史恢复、批量回滚和备份可跨两库读取。公共备份仍需包含所有被引用的本站图片；私有历史不属于公共备份。
- 后台分别显示正文与历史、新库图片、原库旧图占用。巡检可用 `--media-d1-database` 独立检查图片库；350 MiB提前预警，授权失效则报告未知。
- CI使用预先创建的数据库ID绑定，不会自行创建收费存储。main没有配置图片库变量时继续使用原库。

## 容量范围

[Cloudflare D1官方限制](https://developers.cloudflare.com/d1/platform/limits/)：免费档最多10个数据库，每库500 MB，账户总存储5 GB。两库额度独立，不表示任一库能单独存1 GB。正文库里的旧图仍占原库空间，SQLite文件、索引和历史也有开销。

创建前只读清单为2库，共35,692,544 bytes，证据 `.cache/free-upgrade-account-preflight-20261031.json`。本次只增加 `longnankejia-media-codex` 一个库，ID `7704b0bf-1598-44cb-9cb6-28e9c1281557`。未查到实际账户套餐，按免费限额保守规划；没有更改账单或订阅。

图片目前在D1中以Base64分块保存，约比原二进制多三分之一。250 KB/图时，500 MB仅图片理论约1500张，实际还需扣除数据库开销；不能作为篇数保证。现有1200px压缩和去重是原有功能，本次没有进一步降低画质。

[D1免费每日额度](https://developers.cloudflare.com/d1/platform/pricing/)为500万行读取、10万行写入。数据库分开不会增加账户每日额度；公众号访问量上升仍需单独压测和容量规划。后续可在剩余免费库数内增加图片分库，但需先实现定位、独立监控和备份，不能直接宣称现有5 GB均已可供网页使用。大音视频不适合本方案，继续使用已有可用链接。

## 验证

- 全部Node测试195/195：`.cache/free-media-all-node.txt`。
- 其中双库、旧图兼容、HEAD/Range、编辑及恢复、容量耗尽、断线重试、部署隔离和巡检相关37/37：`.cache/free-media-targeted.txt`。
- Chrome和WebKit页面10/10：真实后台文件上传、刷新、旧图显示、完整导出，两库图片备份恢复到空库并逐字节核对。结果 `.cache/media-database-browser-results.json`；不冒充真实iPhone或微信验收。
- 静态检查、3项负向变异和Pages Functions构建通过。
- 首次匿名大图请求预期401，但接口按既有8KiB未登录请求限制先返回413；改为分别验证小请求401和大请求413，权限未放宽。首轮页面测试退出清理重复关闭SQLite，修正为由服务器单次关闭后全部通过；这些是测试夹具问题，未因此放宽业务断言。

## 发布与线上核验

业务提交 `6b775a40228b1f11e0c65a4724affed7953b9dc8` 已仅推codex，[CI41157002310](https://github.com/lwy9107124035/longnankejia/actions/runs/41157002310)成功。预览地址仍为 `https://codex.longnankejia-dev.pages.dev/`，地址页无需换链接。

真实预览验收 `.cache/free-media-cloud-smoke-1793411363680.json`：新图片只写独立库，旧图仍从原库读取；两图字节、Range、重复上传、正文编辑及跨库历史恢复通过。临时条目与会话已清理，revision78→82，原自定义科普0→0。两张合成图片合计114,316原始bytes，随测试审计历史保留，避免验收历史引用失效；不混入公开科普列表。

独立只读核对 `.cache/free-media-final-readonly-1793411401034.json`：79条原内容/私有元数据行digest不变，密码和tokens原值摘要与revision不变，临时条目/会话均0。原ADMIN_DB继续f5库，新ADMIN_MEDIA_DB绑定7704库；main仍317库且没有新图片库绑定。正式公开响应核对 `.cache/free-media-data-verification.txt` 为revision385/188，与发布前逐字一致；该文件记录的codex80/1为并发验收过程值，最终稳定值使用下面的82/0报告。

最终完整分页巡检 `.cache/free-media-preview-health.json`：HTTP200/JSON/no-store，revision82/0，元数据31,772 bytes，正文库实际1,433,600 bytes，图片库94,208 bytes；两库套餐上限仍未知，预警均未触发，problems/warnings为空，公开快照备份完整。公开列表没有自定义图片，mediaArchived=0不表示私有验收历史图片也已被公开备份。账户数据库数量从2增至3，仍须同时遵守账户总存储和每日读写额度。

本次没有推main、修改正式内容/凭据、开通R2或更改收费设置。共同检查点为 `docs/codex-admin-checkpoint.md`。
