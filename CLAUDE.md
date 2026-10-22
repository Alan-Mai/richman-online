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
pnpm -F extract cli tables       # 匯出 rich4.exe 的資料表到 local-assets/tables.json（只印筆數）
pnpm -F extract cli lunar-check  # 本機比對農曆演算法與 rich4.exe 的農曆表（只印筆數）
pnpm -F extract lunar-gen        # 重新產生 packages/shared/src/lunar-data.ts（不需要原版檔案）
pnpm -F extract cli find-dword <hex> ...  # 逆向用：rich4.exe 中存放某個 32 位元值的位址（找指標表）
pnpm -F extract cli imports [IAT 位址 ...] # 逆向用：rich4.exe 匯入的 Windows API 與其 IAT 位址
pnpm -F sim sim -- --games 1000 [--seed 1] [--board test-branch] [--controllers random|computer|mixed] [--vehicle walk|motorbike|car] [--day-limit N] [--net-worth-target M] [--max-days 1000] [--max-steps N] [--max-failure-details 5] [--tables local-assets/tables.json]  # 終端機模擬器（--tables：電腦依種子不重複抽原版角色比例）
pnpm -F sim sim -- replay out/failure-<seed>.json                 # 重播失敗紀錄
pnpm lint                 # ESLint + Prettier 檢查
pnpm format               # Prettier 自動格式化（不含 *.md）
pnpm typecheck
pnpm check:commit         # commit 前檢查（素材、TEMP-DEBUG、格式、lint、typecheck、test）
pnpm check:commits <range>  # 逐 commit 的素材檢查（/pre-push）
pnpm -F smoke shot -- --out <倉庫外絕對路徑>  # 客戶端截圖煙霧測試
```

（指令有變動時，以 `package.json` 實際內容為準，並更新此段。）

## 開發流程

1. 動手前先讀相關文件：架構看 `docs/ARCHITECTURE.md`，目前進度看 `docs/ROADMAP.md`，規則細節看 `docs/GAME_RULES.md`，檔案格式看 `docs/ASSET_FORMATS.md`。
2. 何時停下、何時自行決定、審查與接續見 `.claude/rules/autonomy.md`。每個 ROADMAP 勾選項先提出計畫，經 `reviewer` 審查後等我核准；核准後存成 `docs/` 內的計畫檔（開頭維持「接續狀態」），在 ROADMAP 對應項目註明位置；進度、與計畫的差異、實作中發現的待補項寫回該檔對應批次。計畫全部完成後，在收尾 commit 刪除該計畫檔，或在檔頭標「已完成，僅供歷史參考」，並移除 ROADMAP 的指向；刪除前先 `git grep` 計畫檔名，程式註解與文件中的引用改指向永久文件（DECISIONS、GAME_RULES、ROADMAP），另開 commit 放在收尾之前（DECISIONS 舊條目的出處保留為歷史紀錄）。需要我目視確認的項目照常 commit，留到里程碑一次確認，回饋用修正 commit。要修正未推送、但不在最上面的 commit 時，優先新增一個修正 commit；只有我要求改寫歷史時，才用暫時分支 amend 再 cherry-pick 的方式（不用 `git rebase -i`），完成後確認新舊頂端的 diff 只有預期改動。
3. 規則引擎採測試先行，確認斷言失敗後才實作；細節見 `.claude/rules/test-first.md`。
4. **每個 commit 前** `pnpm format` 並 add，再跑 `pnpm check:commit`，通過才 commit（hook 會擋下暫存內容沒通過檢查的 commit）；細節（stash 與 patch 備份、偶發失敗、測試逾時）見 `.claude/rules/commit-workflow.md`。
5. 每次 commit 只做一件事，訊息用 Conventional Commits（`feat(shared): ...`）。工作中發現不屬於目前範圍的問題（過時的程式註解、不穩定的測試等）另開 commit，不併入目前的 commit，並記在 `docs/REVIEW_QUEUE.md`；只改文件的批次也照這條處理。
6. 重要技術決策寫進 `docs/DECISIONS.md`；完成路線圖項目時，在同一個 commit 內更新 `docs/ROADMAP.md` 的勾選。項目內文有沒做到的部分時，不要原樣勾選：把內文改成實際完成的內容，刪掉和現有決策矛盾的句子，沒做的部分移到對應的項目（沒有就新增），改寫記在 REVIEW_QUEUE，勾選留到里程碑由我確認。
7. `GAME_RULES.md` 標「待確認」的規則不要自行猜測，其他大富翁類遊戲的慣例也不能當成原版規則；先問我，不要自行補成非原版選項（引擎只實作原版規則，見 `DECISIONS.md`）。原版程式會當機或結果未定義的邊界情況（例：0 個候選仍取亂數），不照抄也不自訂退路，先問我；預設做法是用驗證讓它不可能發生，萬一發生就視為內部錯誤。其餘看似缺陷但結果確定的原版行為，照原版實作。寫作慣例見 `GAME_RULES.md` 開頭。
8. 輸出很長的工作（掃描 git 歷史、等 CI、分析二進位檔、大範圍搜尋）優先交給 subagent，只回報結論；分析原版素材時，要求 subagent 的回報只含結構與統計，不含原版內容數值。不論是否透過 `/asset-analyze`：逆向分析前先讀 `.claude/skills/asset-analyze/SKILL.md` 的 Ghidra 段落；subagent 的逆向結論寫成 🔍 前，主 session 必須親自對照反組譯核對關鍵指令，並在 `notes.md` 記下核對的位址。
9. 推送前執行 `/pre-push`。
10. 新增有 peer 依賴限制的套件時，確認版本範圍相容（例：typescript-eslint 對 TypeScript）；也避免選用發布未滿兩週的版本（尤其是新的主版本），`~`／`^` 範圍要以 lockfile 實際解析到的版本確認。
11. 不要在本倉庫用 `git add -f` 測試防護機制，改用暫存目錄的另一個倉庫。
12. 描述原版素材時，從 `RICHMAN4_DIR` 觀察到的現象一律寫成「本機副本中…」；需要原版佐證的列入 ROADMAP 未解問題。
13. `/pre-push`、`/wrap-up`、`/asset-analyze` 等專案 skill 只能由使用者輸入；流程走到這些步驟時，停下來提醒我輸入（里程碑時提醒 `/wrap-up`；我試玩完成前不提醒 `/pre-push`）。

## 程式風格

- 識別字、程式碼註解用英文；文件與 commit 說明可用繁體中文。
- 與使用者對話一律使用繁體中文。
- 遊戲內玩家可見文字集中在 i18n 檔，預設 `zh-TW`。
- 狀態物件不可就地修改，回傳新物件。
- 優先使用可辨識聯合型別（discriminated unions）表示 Action、Event，以及任何「id 或特殊值」的參數（例：`Viewer = { kind: 'player'; id } | { kind: 'spectator' }`）。不要把特殊值和字串 id 混在同一個型別（`PlayerId | 'spectator'`），也不要用 `eslint-disable` 掩蓋型別問題。
- 含反斜線、單引號、反引號或 `${…}` 的文字（Windows 路徑、正則、跳脫字元、JS 樣板字串、含單引號的字串常值）一律用 Write/Edit 工具寫，不要用 bash heredoc（含 `<<'EOF'`）、sed、perl 或 `node -e '…'`（本機 Git Bash 會吞掉 `\\`、單引號會提前結束 bash 字串、雙引號內的反引號與 `${…}` 會被 shell 展開）。需要一次改多個檔案時，先用 Write 把腳本寫到 gitignored 的位置（`tools/extract/scratch/` 或系統暫存目錄，不得 commit），再用 `node <檔案>` 執行；腳本內容同樣適用這條。
