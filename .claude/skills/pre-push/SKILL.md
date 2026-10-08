---
name: pre-push
description: 推送到 GitHub 前的檢查：作者 email 必須是 noreply 地址，並對每一個要推送的 commit 執行素材檢查（不只 HEAD），全部通過才推送。
disable-model-invocation: true
---

推送前檢查。任何一項不通過就**停下來回報，不要推送**，也不要自行改寫歷史（rebase、amend、filter-repo），先問我。

1. **決定要推送的範圍**
   - `git fetch origin`，然後用 `git rev-list origin/main..HEAD` 列出要推送的 commit。
   - 遠端還沒有這個分支時，範圍是 `git rev-list HEAD`（全部歷史）。
   - 沒有要推送的 commit 就回報「沒有需要推送的內容」並結束。

2. **作者與 committer**
   - 對範圍內每個 commit 執行 `git log --format='%h %an <%ae> | %cn <%ce>'`。
   - 作者與 committer 的 email 都必須是 GitHub noreply 地址（`@users.noreply.github.com`）。
   - `Co-Authored-By` 只允許 noreply 地址（例如 `noreply@anthropic.com`）。
   - 一併掃描 commit 訊息與 diff，確認沒有私人 email、token（`ghp_`、`github_pat_`）、私鑰（`BEGIN ... PRIVATE KEY`）。

3. **逐一檢查每個 commit 的素材**（每一個都要查，不能只查 HEAD）
   - 對每個 commit 執行 `git ls-tree -r -l <commit>`，確認沒有：
     - 原版副檔名：`mkf`、`exe`、`dll`、`avi`、`mid`、`wav`、`iso`（大小寫不拘；`tools/**/fixtures/` 除外）
     - `.env` 或 `.env.*`（`.env.example` 除外）
     - `local-assets/` 底下的任何檔案
     - 超過 1 MB（1,048,576 bytes）的檔案
   - 列出每個 commit 的檔案數與最大檔，作為佐證。
   - 這一步輸出很長，交給 subagent 執行，只回報結論與違規項目。

4. **工作區與目前狀態**
   - `git status --short` 應為空；有未提交的變更就列出來問我。
   - 執行 `pnpm check:assets`。

5. **推送**
   - 全部通過才執行 `git push`。
   - 推送後交給 subagent 用 `gh run watch` 等 CI 跑完，回報 ubuntu-latest 與 windows-latest 兩個 job 的結果與警告。
   - 回報格式：檢查了哪些 commit、各項結果、推送結果、CI 結果。
