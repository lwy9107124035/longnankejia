# AI 协作分支所有权声明（Antigravity）

## 分支信息
- 分支名：`antigravity`
- 专属助手：**Antigravity**
- 创建日期：2026-09-29
- 基线分支：`main`（切出时为 `88bcc4a`）

## 用途
本分支是 Antigravity 的**专属工作分支**。Antigravity 的全部改动只在此分支提交，与豆包（`doubao` 分支）、Qoder（`qcode` 分支）、Codex（`codex` 分支）以及仓库所有者相互隔离，避免多助手并行时互相覆盖或混淆改动来源。

## 与其他分支的关系
`antigravity` 属于 Antigravity。不写入任何其他分支；需要合流时一律由仓库所有者决定，任何时候都不得直接把本分支合并进 `main` 或改动其他助手的分支。

## 提交标识约定
- 提交信息正文里说明改动动机（为什么），不写"某某助手所做"这类归属噪声。
- 归属靠分支认定，不靠 commit message 前缀。
- 核对 `git branch --show-current`，绝不落错分支。

## 合并规则（强制）
1. Antigravity **不得**直接向 `main` 推送，也不得擅自把 `antigravity` 合并进 `main`。
2. `antigravity` → `main` 必须经仓库所有者明确批准后方可合并。
3. 未经批准不得执行 merge / rebase 到 `main`、强制推送等任何绕过审查的操作。
4. 每次合并都需单独获得批准，不视为一揽子授权。

## 部署口径
`cf-pages.yml` 支持 `antigravity` 分支，推送到远程后由 Cloudflare Pages 自动构建预览站点：
`https://antigravity.longnankejia-dev.pages.dev/`。
本地验证走 `qidong.bat`（`http://localhost:8787/`）与 `python tests/run_all.py --static`。
