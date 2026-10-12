---
paths:
  - "packages/shared/**"
---

# 規則引擎專用規則

- 這裡的程式碼必須是決定性純函式：禁止 `Math.random`、`Date`、`setTimeout`、`console`、任何 Node/瀏覽器 API 與 import 其他 workspace 套件。`tsconfig` 設了 `types: []`，所以測試檔裡也不能用 `structuredClone` 這類宿主全域；複製物件改用展開。
- 亂數只能取自 `state.rngState`，並把 RNG 新狀態寫回回傳的 state。`applyAction(state, action)` 不接受 rng 參數。
- 每新增一種 Action：同時更新 `legalActions`、`applyAction`、對應 `GameEvent`，並寫測試涵蓋「合法」「非法（錯誤 phase/錯誤玩家）」兩種情況。
- 新增 state 欄位時檢查 `viewFor` 是否需要過濾。
- `legalActions` 只供伺服器使用；不要為客戶端設計需要完整狀態以外的變體。
- 測試用固定種子；需要特定骰點時，用 `testing.ts` 的 `withFixedDice(state, [..])`。`testing.ts` 是唯一能建立 scripted RNG 的地方，不從 `index.ts` 匯出。外部輸入的 RNG 狀態（存檔、`createGame`）一律經過 `parseRngState`，拒絕 scripted。
- 驗證外部輸入（`RuleConfig`、地圖、存檔、動作）時，回傳錯誤清單或 `Result`，不要 throw。只有呼叫端寫錯時才 throw，例如 scripted 序列用盡、`nextInt` 的範圍不合法。
- 模擬器不放這裡，放 `tools/sim/`。
- 數值不要寫死，放進 `RuleConfig`。
