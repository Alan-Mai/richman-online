# Richman Online（大富翁4 重製連線版）

以《大富翁4》為藍本重寫的網頁多人連線版。引擎與程式碼為原創，**原版素材由玩家自備正版匯入**，絕不進入本倉庫。

## 必守規則（違反即視為錯誤）

- **絕不提交原版素材**：任何從原版遊戲取得的圖片、音效、音樂、地圖資料、文字，或其轉檔結果，都不得寫入版本控制。原版遊戲路徑由環境變數 `RICHMAN4_DIR` 提供，**必須是倉庫外的絕對路徑**（`tools/extract` 啟動時若為相對路徑或路徑不存在，直接報錯結束）；轉檔輸出只能寫到 `local-assets/`（已 gitignore）。測試用素材一律自行產生假資料（純色圖、合成音）。
- **不得修改原版遊戲目錄**：對 `RICHMAN4_DIR` 只能讀取。
- **原版地圖只限自架房**：公開伺服器只提供原創地圖；原版轉檔地圖只能用於持有正版者自架的房間。
- **規則引擎必須是決定性的純函式**：`packages/shared` 內禁止 `Math.random()`、`Date.now()`、`new Date()`、I/O、網路、DOM。亂數一律取自 `state.rngState`，新狀態寫回回傳的 state（`applyAction` 不另收 rng 參數）。
- **伺服器說了算**：擲骰、抽卡、判定全部在伺服器執行；客戶端只送「意圖動作」，不自行改變遊戲狀態。`legalActions` 只在伺服器以完整狀態執行，結果隨廣播附給該玩家；客戶端只依此清單顯示可選項目。
- **隱藏資訊不外洩**：傳給客戶端的狀態必須經過 `viewFor(state, playerId)` 過濾（他人手牌、RNG 種子不可送出）。

## 技術堆疊

- 語言：TypeScript（`strict: true`），Node.js LTS
- 套件管理：pnpm workspaces
- 伺服器：Colyseus
- 客戶端：Phaser 3 + Vite
- 測試：Vitest；格式化/檢查：Prettier + ESLint

## 專案結構

```
packages/shared/   規則引擎、型別、RNG、viewFor（前後端共用）
apps/server/       Colyseus 房間、動作驗證、事件廣播
apps/client/       Phaser 畫面、動畫、輸入
tools/extract/     原版素材解析與轉檔 CLI（讀 RICHMAN4_DIR，寫 local-assets/）
tools/sim/         終端機模擬器（隨機 AI 大量對局、檢查不變量；可用 console 與 I/O）
docs/              架構、路線圖、遊戲規則、素材格式、決策紀錄
```

## 常用指令

```
pnpm install
pnpm test                 # 全部測試（Vitest projects）
pnpm test:coverage        # 含覆蓋率（只統計 packages/shared）
pnpm -F shared test       # 只測規則引擎
pnpm -F server dev
pnpm -F client dev
pnpm -F extract cli <cmd> # 素材工具（啟動時驗證 RICHMAN4_DIR）
pnpm -F sim sim           # 終端機模擬器
pnpm lint                 # ESLint + Prettier 檢查
pnpm format               # Prettier 自動格式化（不含 *.md）
pnpm typecheck
```

（指令有變動時，以 `package.json` 實際內容為準，並更新此段。）

## 開發流程

1. 動手前先讀相關文件：架構看 `docs/ARCHITECTURE.md`，目前進度看 `docs/ROADMAP.md`，規則細節看 `docs/GAME_RULES.md`，檔案格式看 `docs/ASSET_FORMATS.md`。
2. 非小改動先提出計畫，等我確認再寫。
3. 規則引擎採測試先行：先寫失敗的測試，再實作。
4. 完成後執行 `pnpm test && pnpm lint && pnpm typecheck`，全部通過才算完成。
5. 每次 commit 只做一件事，訊息用 Conventional Commits（`feat(shared): ...`）。
6. 重要技術決策寫進 `docs/DECISIONS.md`；完成路線圖項目時，在同一個 commit 內更新 `docs/ROADMAP.md` 的勾選。
7. `GAME_RULES.md` 標記「待確認」的規則，不要自行猜測；先問我，或做成可設定的參數。

## 程式風格

- 識別字、程式碼註解用英文；文件與 commit 說明可用繁體中文。
- 遊戲內玩家可見文字集中在 i18n 檔，預設 `zh-TW`。
- 狀態物件不可就地修改，回傳新物件。
- 優先使用可辨識聯合型別（discriminated unions）表示 Action 與 Event。
