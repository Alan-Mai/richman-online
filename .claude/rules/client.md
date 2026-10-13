---
paths:
  - "apps/client/**"
---

# 客戶端專用規則

- 客戶端畫面檢查：內建瀏覽器窗格隱藏時，截圖是舊畫面、`requestAnimationFrame` 停止（Phaser 不會跑），先用 `tabs_context` 確認窗格顯示，否則改用 DOM 與程式狀態檢查。為檢查加的暫時程式（例如 `fps.forceSetTimeOut`、掛在 `window` 的除錯 handle）標 `TEMP-DEBUG`，commit 前移除。我自己開著的 dev server 不要動，需要時另開埠，用完關掉；改了 `vite.config.ts` 或 plugin 後，舊的 dev server 不一定會重新載入。
