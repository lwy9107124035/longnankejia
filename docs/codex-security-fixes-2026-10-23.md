# codex 安全与同步整改验收

对应审查：[2026-10-23 原始问题报告](codex-security-review-2026-10-23.md)。本轮仅在 codex 实施，正式 main 等用户测试确认后再发布。测试使用隔离 SQLite、合成账号及本地 Chromium，没有用攻击样本操作线上数据库。

| 问题 | 实施内容 | 回归证据 |
|---|---|---|
| F01 脚本注入 | 卡片纯文本转义；正文使用本地 DOMPurify 白名单净化，保留段落、列表、强调、表格；限制媒体协议；CSP 移除 inline/eval；替换旧图片 inline 事件 | 实际协管员上传原攻击样本，超管浏览后脚本不执行、指定测试口令仍不能登录；正文保留合法强调 |
| F02 双标签草稿覆盖 | 发布缓存与各页面待上传快照分开；持久化草稿账号归属；新增“找回其他页面草稿”；恢复副本上传确认后，按快照版本清理已确认副本，不删除原页后来的编辑 | 同一浏览器上下文两页离线录入；刷新、关闭原页、恢复及联网合并后，两份资料都保留；localStorage 降级也有独立快照测试 |
| F03 重载期间丢编辑 | 请求发起前保存草稿，返回时比较编辑代数，期间出现新编辑则拒绝覆盖 | 延迟 GET 后新增草稿，重载明确报错，草稿仍可显示及导出 |
| F04 无效条目 | 前后端共享逐条结构、类型、长度、URL 校验；导入先完整验证后写入；历史坏记录隔离显示、提示具体错误，原始副本可导出修复 | 多种无效包返回 400，revision 和已发布资料不变；null 历史记录不会再使整页报错 |
| F05 邀请凭据泄漏 | 日志只由服务端生成；协管员不读取他人日志；历史日志脱敏；旧 creatorTokenId 凭据转换为非凭据 ID；通知按接收人提供；本地移除旧日志/通知缓存 | 其他协管员拿不到邀请凭据；历史日志对超管也脱敏；通知与备份不携带系统生成的完整邀请凭据 |
| F06 重复 ID 连带删除 | 服务器及导入拒绝重复、自定义与内置 ID 冲突；新增先预检；对历史重复 ID 停止编辑和删除，保留备份供修正 | 重复写入失败；历史两条同 ID 资料不会因一次删除一起消失；内置保留 ID 与实际 85 条知识/15 张科普卡一致 |
| F07 归属/日志伪造 | 服务端从验证后的会话赋予创建者和操作身份；保留原创建归属；忽略客户端日志和历史替换；协管员不得执行审核、回滚或清日志 | 伪造超管日志不落库；创建者不能转移给他人；真实邀请 ID 能追溯及回滚 |
| F08 回滚不完整 | 服务器保存新增、编辑、删除的前值及结果摘要；回滚支持知识、科普、方言及内置覆盖/删除；发现其他人员后续改动则跳过并报告 | 同一人多次修改可逆序撤回；他人后续修改保留；重复回滚不重复撤销；修改标题不重复储存大图片 |
| F09 会话存储异常 | 当前页面最新内存会话优先，退出后不从旧落盘值复活 | sessionStorage 只写失败、退出删除也失败时，正确登录仍可同步，退出保持失效 |
| F10 通知跨端缺失 | 审核通知由服务器与回滚同一内容版本提交；按当前账号读取；已读状态云端保存 | 两台独立设备收到同一驳回理由；其他账号无法读取或标记他人通知；新设备已读状态一致 |
| F11 请求体限流读取 | 复用 AI 接口有界读取；按实际字节数提前 cancel；无有效会话仅 8 KiB，已验证会话 16 MiB；失效 bearer 不阻碍重新登录 | 无长度或虚报长度的持续流提前停止读取并返回 413；大图批量上传仍通过 |
| F12 Word 导入失败 | 本地 fflate 真正读取 DOCX ZIP 的 document.xml；解析 WordprocessingML 段落、实体、换行、表格；16 MiB 文件/8 MiB 解压正文上限；失败保留草稿 | 真实文件选择器导入压缩中文 DOCX；损坏、空文件和解压超限都提示错误且不覆盖原草稿 |

实现与测试：

- API：functions/api/admin/sync.js、functions/_lib/admin-content.js、functions/_lib/read-limited.js。
- 共享验证与客户端：js/content-schema.js、js/store.js、js/ui.js、js/admin.js。
- 服务器不要求数据库清空、密码重设或新表迁移。现有 D1 内容行仍通过事务及 revision 条件更新；操作前值保存在服务端私有字段，公共接口/普通备份不返回回滚历史。
- DOMPurify 3.4.17、fflate 0.8.3 从 npm 固定版本归档下载，核对 SHA-512 integrity 后本地部署，并保留许可证。来源：[DOMPurify](https://github.com/cure53/DOMPurify)、[fflate](https://github.com/101arrowz/fflate)。
- 内容容量达到上限时仍明确拒绝并保留草稿。回滚历史只记录变动字段，避免每次改标题都复制大图片。
- 额外修复启动竞态：草稿恢复早于方言 DOM 初始化时刷新不会再访问未初始化列表；测试登录也等待存储恢复完成后再输入。
- CI 已加入 tests/admin-security.test.mjs。

复验命令：

```text
node --test tests/admin-deployment.test.mjs tests/admin-sync.test.mjs tests/admin-security.test.mjs tests/v3_admin_ux.test.mjs tests/pages-functions.test.mjs tests/v2_knowledge.test.mjs tests/v2_models.test.mjs
node tests/admin-negative-checks.mjs
python tests/check_static.py
node tests/run_site_tests.mjs --only=security-regression
node tests/run_site_tests.mjs
wrangler pages functions build functions --outdir .cache/codex-functions-build --compatibility-date 2026-10-23
```

--only=security-audit 和旧 tests/audit_codex_20261023.mjs 命令现转为防回归断言，不再要求漏洞复现成功。原始审查证据保留在 .cache/codex-audit-*；整改证据保存在 .cache/codex-fix-*、.cache/codex-security-regression-browser.json。

上线后的使用与边界：

1. 原有密码、邀请码和服务端密钥继续使用。这里没有批量撤销邀请或重设密码；若旧版本的邀请码曾被他人取得，修补泄漏入口不能收回已取得的凭据，管理员应按实际暴露情况换发受影响邀请。
2. “找回其他页面草稿”可找回本浏览器、本来源仍保存的副本。旧版本已经被覆盖且没有备份的内容无法凭修复代码重建；浏览器清站点数据也会删除本机草稿。
3. 版本化回滚适用于本次整改后记录的操作。历史自定义新增仍可按归属撤回；旧版本没有记录前值的内置编辑/删除无法可靠自动还原，界面明确说明该限制，不会声称已全量恢复。
4. 本轮手机使用 Chromium 设备模拟；真实 iOS Safari/微信、平台级分布式额度与线上压力测试仍属后续环境验证，不作已完成承诺。

验证结果（2026-10-23）：

- Node：原 80 项加新增 19 项安全/启动回归，共 99 项通过、0 失败。
- 浏览器完整回归：启用同线上 CSP，319 项通过、0 失败，未捕获页面异常和本站子资源失败均为 0。
- 浏览器安全专测：13 项通过、0 失败。独立手机/电脑登录专测：18 项通过、0 失败。
- 3 项负向变异检查与静态检查通过，Cloudflare Pages Functions 构建成功。
- 测试中发现并修复的失败：服务端新增归属字段使旧断言不适用；更严格格式校验要求更新无标题夹具；真实内置 ID 列表比源码字面匹配多出动态生成条目，改为执行数据脚本建立完整列表；方言初始化竞态已修复并补测试；手机测试等待表单就绪后再输入；服务器补充归属字段不再让同步误判冲突，延迟上传及其他设备后续编辑场景均保留。
