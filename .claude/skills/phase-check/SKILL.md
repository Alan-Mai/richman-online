---
name: phase-check
description: 檢查 docs/ROADMAP.md 目前階段的完成條件是否真的達成，並指出下一步。
disable-model-invocation: true
context: fork
---

檢查專案進度：

1. 讀 `docs/ROADMAP.md`，找出第一個尚未全部勾選的階段。
2. 對每個已勾選項目實際驗證（執行指令、找到對應程式碼與測試），不要只相信勾選。
3. 執行 `pnpm test && pnpm lint && pnpm typecheck`。
4. 檢查倉庫中是否誤入原版素材：`git ls-files` 中有沒有大型二進位檔、`local-assets/` 內容、或疑似原版的圖片音效。
5. 回報：
   - 已確認完成 / 勾了但未完成 / 未完成
   - 是否達成本階段「完成條件」
   - 建議接下來最該做的 3 件事（依風險排序）
