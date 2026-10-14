---
paths:
  - "apps/client/**"
---

# 客戶端專用規則

- 客戶端畫面檢查：內建瀏覽器窗格隱藏時，截圖是舊畫面、`requestAnimationFrame` 停止（Phaser 不會跑），先用 `tabs_context` 確認窗格顯示，否則改用 DOM 與程式狀態檢查。為檢查加的暫時程式（例如 `fps.forceSetTimeOut`、掛在 `window` 的除錯 handle）標 `TEMP-DEBUG`，commit 前移除。我自己開著的 dev server 不要動，需要時另開埠，用完關掉；改了 `vite.config.ts` 或 plugin 後，舊的 dev server 不一定會重新載入。停掉自己開的背景 dev server 後，確認該埠已沒有在 listen（pnpm 底下的 vite 子程序可能殘留）；殘留時先用 PID 的命令列確認是自己開的那個，再只結束那個程序。
- 🎮 試玩前，逐項確認清單在正常遊玩時看得到；看不到的（例：目前規則下不會發生的狀態），在試玩說明中先講明原因，需要時提供只在 dev 啟用的 `TEMP-DEBUG` 除錯掛勾（例：在 console 呼叫），使用者確認後、commit 前移除。commit 前以 `git grep TEMP-DEBUG -- . ':!*.md' ':!.claude/'` 確認程式碼中已清除；`/pre-push` 也會檢查待推送的 commit 中不得含 `TEMP-DEBUG`。
- 新增或調整的動畫時間一律放在 `render/timings.ts`。沒有原版依據的值標「非原版」，並在計畫檔或 ROADMAP「執行檔資料表匯出」記下要查的原版對應表現；不要把毫秒數寫死在 animator。
- happy-dom 的 `<select>` 預設選項可能和瀏覽器不同（例：先設 `option.selected` 再 append 時）；測試依賴下拉選單的值時，先明確設定，不要依賴預設。
