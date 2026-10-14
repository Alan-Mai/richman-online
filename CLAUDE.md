# Richman Online（大富翁4 重製連線版）

以《大富翁4》為藍本重寫的網頁多人連線版。引擎與程式碼為原創，**原版素材由玩家自備正版匯入**，絕不進入本倉庫。

## 必守規則（違反即視為錯誤）

- **絕不提交原版素材**：任何從原版遊戲取得的圖片、音效、音樂、地圖資料、文字、執行檔內的資料表與程式碼（含反編譯與反組譯輸出），或其轉檔結果，都不得寫入版本控制；文件、測試、commit 訊息也只記錄結構，不寫原版內容數值（地價、價格表、名稱等），`GAME_RULES.md` 只寫歸納出的規則、不放原版數值表；執行檔的演算法只用自己的文字描述。原版遊戲路徑由環境變數 `RICHMAN4_DIR` 提供，**必須是倉庫外的絕對路徑**（`tools/extract` 啟動時若為相對路徑或路徑不存在，直接報錯結束）；轉檔輸出只能寫到 `local-assets/`（已 gitignore）。測試用素材一律自行產生假資料（純色圖、合成音、自編的名稱與數值）。原版規則需要執行檔內資料表的數值（例：道具價格與庫存）時，由 `tools/extract` 匯出成 JSON 到 `local-assets/`，倉庫只放非原版預設值。
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
pnpm -F client dev        # dev 模式；只對本機提供 local-assets/maps（原版地圖預覽）
pnpm -F client build      # 建置產物不含任何素材
pnpm -F client exec vite preview --host 127.0.0.1  # 檢查正式版（素材只能用匯入資料夾）
pnpm -F extract cli <cmd> # 素材工具（啟動時驗證 RICHMAN4_DIR）
pnpm -F extract cli map [n ...]  # 匯出地圖背景 PNG + JSON 到 local-assets/maps/
pnpm -F extract cli view [port]  # 地圖檢視器，只綁 127.0.0.1（預設 5180）
pnpm -F sim sim -- --games 1000 [--seed 1] [--board test-branch] [--day-limit N] [--net-worth-target M] [--max-days 1000]  # 終端機模擬器
pnpm -F sim sim -- replay out/failure-<seed>.json                 # 重播失敗紀錄
pnpm lint                 # ESLint + Prettier 檢查
pnpm format               # Prettier 自動格式化（不含 *.md）
pnpm typecheck
```

（指令有變動時，以 `package.json` 實際內容為準，並更新此段。）

## 開發流程

1. 動手前先讀相關文件：架構看 `docs/ARCHITECTURE.md`，目前進度看 `docs/ROADMAP.md`，規則細節看 `docs/GAME_RULES.md`，檔案格式看 `docs/ASSET_FORMATS.md`。
2. 非小改動先提出計畫，等我確認再寫。跨多個 session 的分批計畫核准後存成 `docs/` 內的檔案，在 ROADMAP 對應項目註明位置；進度、與計畫的差異、實作中發現的待補項寫回該檔對應批次。分批計畫全部完成後，在收尾 commit 刪除該計畫檔，或在檔頭標「已完成，僅供歷史參考」，並移除 ROADMAP 的指向。計畫中標明需要我目視確認的 commit，做到該處先停下、不要 commit，確認後把我的回饋併進同一個 commit。要修正未推送、但不在最上面的 commit 時，優先新增一個修正 commit；只有我要求改寫歷史時，才用暫時分支 amend 再 cherry-pick 的方式（不用 `git rebase -i`），完成後確認新舊頂端的 diff 只有預期改動。
3. 規則引擎採測試先行：先寫測試並實際跑一次，確認它因為功能未實作而**斷言失敗**（空殼回傳空值或預設值，不要 throw；import 錯誤或測試檔載入失敗不算；空殼若會讓流程走到既有的內部錯誤 throw，就在測試中先加前置斷言，讓失敗出現在斷言上；測試 helper 檢查前提時也先用 `expect`，不要直接 throw），再寫實作。若實作已先寫好，就暫時把實作改壞，確認測試會失敗後再改回；改壞後仍通過的測試代表斷言太弱，要補強或記成待補項。
4. **每個 commit 前**執行 `pnpm test && pnpm lint && pnpm typecheck`（先跑 `pnpm format`），全部通過才 commit；任務完成時再整體跑一次。用管線過濾輸出（`| grep`、`| tail`）時先 `set -o pipefail`，否則失敗的 exit code 會被吃掉。
5. 每次 commit 只做一件事，訊息用 Conventional Commits（`feat(shared): ...`）。
6. 重要技術決策寫進 `docs/DECISIONS.md`；完成路線圖項目時，在同一個 commit 內更新 `docs/ROADMAP.md` 的勾選。
7. `GAME_RULES.md` 標「待確認」的規則不要自行猜測，其他大富翁類遊戲的慣例也不能當成原版規則；先問我，不要自行補成非原版選項（引擎只實作原版規則，見 `DECISIONS.md`）。原版程式會當機或結果未定義的邊界情況（例：0 個候選仍取亂數），不照抄也不自訂退路，先問我；預設做法是用驗證讓它不可能發生，萬一發生就視為內部錯誤。其餘看似缺陷但結果確定的原版行為，照原版實作。寫作慣例見 `GAME_RULES.md` 開頭。
8. 輸出很長的工作（掃描 git 歷史、等 CI、分析二進位檔、大範圍搜尋）優先交給 subagent，只回報結論；分析原版素材時，要求 subagent 的回報只含結構與統計，不含原版內容數值。
9. 推送前執行 `/pre-push`。
10. 新增有 peer 依賴限制的套件時，確認版本範圍相容（例：typescript-eslint 對 TypeScript）；也避免選用發布未滿兩週的版本（尤其是新的主版本）。
11. 不要在本倉庫用 `git add -f` 測試防護機制，改用暫存目錄的另一個倉庫。
12. 描述原版素材時，從 `RICHMAN4_DIR` 觀察到的現象一律寫成「本機副本中…」；需要原版佐證的列入 ROADMAP 未解問題。
13. `/pre-push`、`/wrap-up`、`/asset-analyze` 等專案 skill 只能由使用者輸入；流程走到這些步驟時，停下來提醒我輸入。

## 程式風格

- 識別字、程式碼註解用英文；文件與 commit 說明可用繁體中文。
- 與使用者對話一律使用繁體中文。
- 遊戲內玩家可見文字集中在 i18n 檔，預設 `zh-TW`。
- 狀態物件不可就地修改，回傳新物件。
- 優先使用可辨識聯合型別（discriminated unions）表示 Action、Event，以及任何「id 或特殊值」的參數（例：`Viewer = { kind: 'player'; id } | { kind: 'spectator' }`）。不要把特殊值和字串 id 混在同一個型別（`PlayerId | 'spectator'`），也不要用 `eslint-disable` 掩蓋型別問題。
- 含反斜線、單引號、反引號或 `${…}` 的文字（Windows 路徑、正則、跳脫字元、JS 樣板字串、含單引號的字串常值）一律用 Write/Edit 工具寫，不要用 bash heredoc、sed、perl 或 `node -e '…'`（本機 Git Bash 會吞掉 `\\`、單引號會提前結束 bash 字串、雙引號內的反引號與 `${…}` 會被 shell 展開）。
