---
name: wrap-up
description: 結束 session 前的收尾：確認沒有未提交的變更、更新 ROADMAP 的下一步與未解問題、把學到的規則歸類到 skill、程式碼註解、DECISIONS.md 或 CLAUDE.md，commit 後給出新 session 的開場 prompt。
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

3. **REVIEW_QUEUE**
   - `docs/REVIEW_QUEUE.md`「待審」中我已審過的項目：同意的刪除（影響架構、有替代方案可比較的轉寫成 `DECISIONS.md` 條目），不同意的確認已有修正 commit 後刪除。
   - 還沒審的保留，在回報中列出筆數。

4. **這次 session 學到的規則**
   - 回顧這次 session：我給過的指示、修正過的做法、踩到的坑、做出的技術決策。
   - 先自行把每一條依下列原則歸類，再整理成提案：
     | 性質 | 寫到哪裡 |
     |---|---|
     | 只在特定工作用到的規則 | 對應的 skill（例：素材分析 → `.claude/skills/asset-analyze/SKILL.md`） |
     | 單一函式或檔案的實作細節 | 該處的程式碼註解 |
     | 影響架構、有替代方案可比較的決定 | `docs/DECISIONS.md`（依該檔格式） |
     | 任何工作都要遵守的規則 | `CLAUDE.md`（先檢查能否併入現有條目，能併就改寫該條，不新增） |
     | 顯而易見的慣例 | 不寫 |
   - 提案時每一條都附上：歸類結果、目標檔案與段落、建議的文字（併入現有條目時，附上改寫後的整條）。我只需要回覆同意或修改。
   - **我確認前不要寫入。**
   - 已經寫進文件的、只跟這次 session 有關的，不要列。

5. **Commit 與回報**
   - 我確認後，把文件變更 commit（Conventional Commits，例如 `docs: session 收尾，更新 ROADMAP 下一步`）；不要自行推送，停下來提醒我輸入 `/pre-push`。
   - 最後回報：
     - `可以 /clear`
     - 一句給新 session 的開場 prompt，放在 code block 裡，內容包含：要先讀哪些文件、目前階段、下一步要做什麼。
