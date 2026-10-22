# Commit 前的檢查流程

`CLAUDE.md` 開發流程第 4 條的細節。

- **每個 commit 前**先跑 `pnpm format`，把格式修正一併 add 到暫存區；再執行 `pnpm test && pnpm lint && pnpm typecheck`，全部通過才 commit。任務完成時再整體跑一次。
- 工作目錄有不屬於這個 commit 的變更時，format 並 add 完成後才 `git stash push -k -u`，跑完檢查再 `git stash pop`。
- 要暫存整個工作目錄另做別的 commit 時，stash 前先把改動（未追蹤的檔案先 `git add -N`，匯出後 `git reset`）用 `git diff` 匯出 patch 備份到 scratch，pop 後和備份逐行比對，確認沒有遺失。
- pop 若衝突就停下回報，不要丟棄任何變更。
- 用管線過濾輸出（`| grep`、`| tail`）時先 `set -o pipefail`，否則失敗的 exit code 會被吃掉；過濾條件要保留失敗的測試名稱（例：`FAIL`、`Timed out`），偶發失敗也要記下是哪個測試再重跑，不要只看總數。
- 測試逾時先量耗時找原因：被測程式是線性時間就改演算法（另開 perf commit），慢在迴圈內大量 `expect` 就改成收集不一致的項目、最後比對一次；仍不夠才調個別時限。
- 背景跑長時間的模擬器（例：1000 局 × 多組）時，不要同時跑 `pnpm test`（負載可能讓測試逾時），也不要修改 `packages/shared`、`tools/sim` 的原始碼（模擬器每組用 tsx 從原始碼重新編譯，後面幾組會跑到改過的程式）。輸出寫到 scratchpad 的檔案，每組記下 exit code；跑完先確認每組的 exit code（2 = 參數或輸入檔無法使用，該組沒有數字），再讀統計與 commit。
