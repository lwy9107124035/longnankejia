# API 配置与分支部署

四个分支使用同一组 SiliconFlow 服务、模型与请求参数。浏览器只调用本站 Pages Functions，API key 由 GitHub Actions 从仓库 Secret `SILICONFLOW_API_KEY` 同步到 Cloudflare Pages secret binding；静态 `js/secrets.js` 始终为空。

| Git 分支 | Cloudflare Pages 项目 | 环境 | 固定入口 |
| --- | --- | --- | --- |
| `main` | `longnankejia` | production | `https://longnankejia.pages.dev/` |
| `doubao` | `longnankejia-dev` | production | `https://longnankejia-dev.pages.dev/` |
| `qcode` | `longnankejia-dev` | preview | `https://qcode.longnankejia-dev.pages.dev/` |
| `codex` | `longnankejia-dev` | preview | `https://codex.longnankejia-dev.pages.dev/` |

聊天请求走 `/api/ai/chat/completions`，语音转写走 `/api/ai/audio/transcriptions`。GitHub Pages 镜像上的请求转到 `main` 的 Cloudflare Functions；这条代理只接受规定的 GitHub Pages 来源。Functions 固定上游地址、校验请求字段与模型，并只从运行环境读取 API key。

API 配置或代理修改需要同步四个分支时，逐一检查并更新 `main`、`qcode`、`codex`、`doubao`。Codex 的 v2 页面、知识库和 3D 模型修改只进入 `codex`。改名后的 `doubao` 替代旧分支 `dev`。
