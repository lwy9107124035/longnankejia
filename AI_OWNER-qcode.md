# AI 协作分支所有权声明（Qoder）

## 分支信息
- 分支名：`qcode`
- 专属助手：**Qoder**
- 创建日期：2026-09-24
- 基线分支：`main`（切出时为 `fab406b`）

## 用途
本分支是 Qoder 的**专属工作分支**。Qoder 的全部改动只在此分支提交，与豆包（`dev` 分支）
以及仓库所有者相互隔离，避免多助手并行时互相覆盖或混淆改动来源。

## 与 dev 分支的关系
`dev` 属于豆包，`qcode` 属于 Qoder。两者互不写入对方的分支；需要合流时一律通过
Pull Request 由仓库所有者决定，任何一方都不得直接把另一方的分支合并进 `main`。

## 提交标识约定
- 提交信息正文里说明改动动机（为什么），不写"某某助手所做"这类归属噪声。
- 归属靠分支与 PR 认定，不靠 commit message 前缀。
- 因为 `git config user.name` 是**全仓库共享**的（谁最后设置就是谁），每次提交前后都要
  核对 `git branch --show-current` 与 `git log --format="%h A:%an C:%cn"`，发现落错分支或
  作者不对，立刻在未推送前修正。

## 合并规则（强制）
1. Qoder **不得**直接向 `main` 推送，也不得擅自把 `qcode` 合并进 `main`。
2. `qcode` → `main` 必须通过 Pull Request，并经仓库所有者（Liu Weiyi）明确批准后合并。
3. 未经批准不得执行 merge / rebase 到 `main`、强制推送等任何绕过审查的操作。
4. 每次合并都需单独获得批准，不视为一揽子授权。

## 部署口径
`cf-pages.yml` 只跟 `main` 与 `dev`，所以 **qcode 上的改动不会自动上线**。
要在公网看效果，需先按上面的规则合入 `main`；本地验证走 `python tests/run_all.py`。
