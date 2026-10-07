---
paths:
  - "packages/shared/**"
---

# 規則引擎專用規則

- 這裡的程式碼必須是決定性純函式：禁止 `Math.random`、`Date`、`setTimeout`、`console`、任何 Node/瀏覽器 API 與 import 其他 workspace 套件。
- 亂數只能取自 `state.rngState`，並把 RNG 新狀態寫回回傳的 state。`applyAction(state, action)` 不接受 rng 參數。
- 每新增一種 Action：同時更新 `legalActions`、`applyAction`、對應 `GameEvent`，並寫測試涵蓋「合法」「非法（錯誤 phase/錯誤玩家）」兩種情況。
- 新增 state 欄位時檢查 `viewFor` 是否需要過濾。
- `legalActions` 只供伺服器使用；不要為客戶端設計需要完整狀態以外的變體。
- 測試用固定種子；需要特定骰點時用測試 helper（例如 `withFixedDice(state, [..])`）把 `state.rngState` 換成預先排好的序列。
- 模擬器不放這裡，放 `tools/sim/`。
- 數值不要寫死，放進 `RuleConfig`。
