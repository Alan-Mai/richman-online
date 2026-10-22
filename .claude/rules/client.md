---
paths:
  - "apps/client/**"
---

# 客戶端專用規則

- 客戶端畫面檢查：內建瀏覽器窗格隱藏時，截圖是舊畫面、`requestAnimationFrame` 停止（Phaser 不會跑），先用 `tabs_context` 確認窗格顯示，否則改用 DOM 與程式狀態檢查。為檢查加的暫時程式（例如 `fps.forceSetTimeOut`、掛在 `window` 的除錯 handle）標 `TEMP-DEBUG`，commit 前移除。我自己開著的 dev server 不要動，需要時另開埠，用完關掉；改了 `vite.config.ts` 或 plugin 後，舊的 dev server 不一定會重新載入。停掉自己開的背景 dev server 後，確認該埠已沒有在 listen（pnpm 底下的 vite 子程序可能殘留）；殘留時先用 PID 的命令列確認是自己開的那個，再只結束那個程序。在瀏覽器測試途中修改檔案，Vite 可能整頁重新載入，把設定畫面與對局狀態清空；改完檔要從頭重做操作再檢查，不要沿用改檔前的畫面狀態。
- 用內建瀏覽器測鍵盤輸入時用 `key` 動作；`type` 動作不會觸發 keydown，HUD 收不到。模擬較大的視窗尺寸（`resize_window`）後 Phaser 的版面不一定跟著重算，截圖不好判讀，優先用窗格原本的尺寸加 `zoom`、`get_page_text` 或 DOM 查詢檢查。需要罕見狀態（月初、到期）時，`TEMP-DEBUG` 掛勾可在 `LocalGameHost` 直接換掉狀態並廣播一次更新；之後出現的「events did not reproduce the view」警告是預期的。
- 改到客戶端的批次，reviewer 前先跑 `pnpm -F smoke shot -- --out <scratchpad 內的目錄>`（自開 Vite、本機 Edge、全電腦對局；exit 1 = 頁面錯誤），自己看過截圖，路徑列進試玩清單。
- 🎮 試玩在里程碑一次進行。交付前逐項確認清單在正常遊玩時看得到；看不到的（例：目前規則下不會發生的狀態）在試玩說明中講明原因，需要時在工作目錄加只在 dev 啟用的 `TEMP-DEBUG` 除錯掛勾（例：在 console 呼叫），不 commit，我試玩完後移除，再做回饋的修正 commit（`check:commit` 與 `/pre-push` 都會擋下程式碼中的 `TEMP-DEBUG`）。移除時用 Edit 逐段刪，不要用 regex 批次刪除（Prettier 可能把標記註解、條件式與本體拆到不同行）；刪完除了 `git grep TEMP-DEBUG`，也要搜尋掛勾本身的識別字（例：`richmanDebug`、掛勾的方法名），並跑 typecheck。
- 新增或調整的動畫時間一律放在 `render/timings.ts`。沒有原版依據的值標「非原版」，並在計畫檔或 ROADMAP「執行檔資料表匯出」記下要查的原版對應表現；不要把毫秒數寫死在 animator。
- happy-dom 的 `<select>` 預設選項可能和瀏覽器不同（例：先設 `option.selected` 再 append 時）；測試依賴下拉選單的值時，先明確設定，不要依賴預設。
