---
name: wrap-up
description: 結束 session 前的收尾：確認沒有未提交的變更、更新 ROADMAP 的下一步與未解問題、整理該寫進 CLAUDE.md 或 DECISIONS.md 的規則，commit 後給出新 session 的開場 prompt。
disable-model-invocation: true
---

結束這次 session 前的收尾。依序執行，需要我決定的地方先停下來問。

1. **未提交的變更**
   - 執行 `git status --short`。
   - 若有未 commit 的變更，列出檔案與簡短說明，問我要 commit、捨棄還是保留，不要自行決定。
   - 一併確認本地分支是否領先或落後 `origin`（`git status -sb`），有未推送的 commit 也列出來。

2. **ROADMAP**
   - 確認這次完成的項目在 `docs/ROADMAP.md` 都已勾選；漏掉的補上。
   - 在**目前階段**底下寫（或更新）一行 `**下一步**：…`，具體到下個 session 開頭就能動手的程度。
   - 若有未解問題，在同一處列成 `**未解問題**：` 清單（例如待我確認的規則、卡住的格式分析、CI 警告）。
   - 舊的「下一步／未解問題」已過時就改寫，不要累積。

3. **這次 session 學到的規則**
   - 回顧這次 session：我給過的指示、修正過的做法、踩到的坑、做出的技術決策。
   - 分成兩類列給我看，**先問我，不要自己寫入**：
     - 以後每次都要遵守的工作規則 → 建議寫進 `CLAUDE.md`（附上建議的段落與文字）。
     - 有原因、有替代方案的技術決策 → 建議寫進 `docs/DECISIONS.md`（依該檔格式）。
   - 已經寫進文件的、只跟這次 session 有關的，不要列。

4. **Commit 與回報**
   - 我確認後，把文件變更 commit（Conventional Commits，例如 `docs: session 收尾，更新 ROADMAP 下一步`），並推送到 `origin`。
   - 最後回報：
     - `可以 /clear`
     - 一句給新 session 的開場 prompt，放在 code block 裡，內容包含：要先讀哪些文件、目前階段、下一步要做什麼。
