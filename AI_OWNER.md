# AI 协作分支所有权声明（AI Branch Ownership）

## 分支信息
- 分支名：`dev`
- 专属模型：**豆包 Doubao**（字节跳动 AI 助手）
- 创建日期：2026-09-23
- 基线分支：`main`

## 用途
本分支是豆包在多模型联动开发中的**专属工作分支**。豆包的全部改动只在此分支提交，
与其他模型的工作相互隔离，避免多模型并行时互相覆盖或混淆改动来源。

## 提交标识约定
- 提交者（author / committer）统一为：`Doubao 豆包 AI <doubao-ai@users.noreply.github.com>`
- 提交信息（commit message）统一加前缀：`[Doubao]`
- 凭以上两点即可在提交历史中识别“哪些改动由豆包做出”。

## 合并规则（强制）
1. 豆包**不得**直接向 `main` 推送，也不得擅自把 `dev` 合并进 `main`。
2. `dev` → `main` 必须通过 Pull Request 提交，并且**经仓库所有者（Liu Weiyi）明确批准**后才能合并。
3. 未经批准，豆包不得执行 merge / rebase 到 `main`、强制推送（force push）等任何绕过审查的操作。
4. 获得批准并合并后，豆包方可继续后续同步；每次合并都需单独获得批准，不视为一揽子授权。
