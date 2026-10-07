# Claude Code 提示詞手冊

依階段使用。每段 prompt 可直接貼進 Claude Code。
建議：每個階段開新 session；大任務先按 `Shift+Tab` 切到 Plan 模式讓它先規劃。

---

## 開始之前（一次性）

1. 把這個資料夾 `git init`，第一個 commit 只放這些文件。
2. 複製 `.env.example` 為 `.env`，填入你的原版遊戲資料夾路徑（從光碟或安裝目錄複製出來的那份）。
3. 在專案資料夾執行 `claude`。

### 第一個 prompt：確認它讀懂專案

```
請閱讀 CLAUDE.md 和 docs/ 下所有文件，用你自己的話摘要：
1) 專案目標與法律界線 2) 架構重點 3) 目前階段與下一步。
有任何不清楚或矛盾的地方列出來問我，先不要寫程式。
```

---

## Phase 0：專案骨架

```
執行 ROADMAP 的 Phase 0。先提出計畫（各 package 的 package.json、tsconfig 結構、
ESLint/Prettier/Vitest 設定、CI workflow），等我確認後再建立。
每個 package 先放一個最簡單的測試讓 pnpm test 有東西跑。
完成後更新 CLAUDE.md 的「常用指令」段落與 ROADMAP 勾選。
```

---

## Phase 1：素材逆向

### 1-1 建立檔案清單工具
```
在 tools/extract 實作 `inventory` 指令：遞迴掃描 RICHMAN4_DIR，
輸出每個檔案的相對路徑、大小、副檔名、前 16 bytes（hex）、粗略熵值，
寫到 local-assets/inventory.json，並在終端機印出依副檔名分組的統計表。
只讀不寫原版目錄。寫完後執行它，把統計表給我看。
```

### 1-2 分類與排定優先順序
```
根據 local-assets/inventory.json，把檔案分組並推測用途（圖片、調色盤、地圖、
音效、音樂、文字、執行檔/DLL）。填入 docs/ASSET_FORMATS.md 的「檔案清單摘要」表格，
並建議分析順序（先解調色盤與一種圖片格式，地圖其次）。說明你的判斷依據。
```

### 1-3 逐一分析格式（重複使用）
```
/asset-analyze <檔名或萬用字元>
```

### 1-4 卡住時
```
<檔案>看起來是壓縮或加密的。請說明你目前觀察到的證據，
並告訴我在 Ghidra 裡應該怎麼找讀取這個檔案的函式（搜尋哪些字串、API 呼叫），
我會把反組譯結果貼給你。
```

### 1-5 階段驗收
```
寫一個簡單的地圖檢視器（tools/extract/viewer，純 HTML + Vite 即可），
讀 local-assets/ 的轉檔結果，畫出一張原版地圖與格子編號。然後執行 /phase-check。
```

---

## Phase 2：最小規則引擎

### 2-1 型別與狀態機設計
```
進入 Plan 模式。依 docs/ARCHITECTURE.md 設計 packages/shared 的型別：
GameState、Phase、Action、GameEvent、RuleConfig、Rng。
只涵蓋 Phase 2 範圍（移動、買地、加蓋、過路費、破產）。
畫出 Phase 狀態轉移圖（Mermaid），列出每個 Phase 的合法 Action。先不寫實作。
```

### 2-2 實作（測試先行）
```
依剛確認的設計實作 RNG、內建 12 格測試地圖、applyAction、legalActions、viewFor。
測試先行。內建地圖不可使用任何原版資料。
```

### 2-3 模擬器
```
在 tools/sim/ 寫模擬器（可用 console 與檔案 I/O，規則一律呼叫 packages/shared）：N 個隨機 AI（從 legalActions 隨機選）
以指定種子跑 M 局，每一步檢查不變量（現金不為負除非進入破產流程、
地產擁有者存在、位置在地圖範圍內、回合玩家存活……）。
失敗時輸出種子與動作序列以便重現。跑 1000 局給我結果。
```

### 2-4 填寫規則（你自己做）
實際玩原版，把數值與行為填進 `docs/GAME_RULES.md`，標成 ✅。
可以請 Claude 幫忙整理：
```
以下是我玩原版的觀察筆記，請整理進 docs/GAME_RULES.md 對應的段落，
不確定的部分標 ❓ 並列出我下次該驗證什麼：
<貼上筆記>
```

---

## Phase 3：單機畫面

```
進入 Plan 模式。設計 apps/client 的 Phaser 場景結構、素材載入（local-assets 優先，
找不到時使用程式產生的佔位圖）、事件佇列播放機制。
目標是本機 hot-seat 4 人能玩完一局。給我計畫與檔案清單。
```

```
實作事件動畫：DiceRolled、PlayerMoved（逐格移動）、PropertyBought、RentPaid。
完成後用 Vite dev server 啟動，描述我應該怎麼測試。
```

---

## Phase 4：連線

```
進入 Plan 模式。設計 apps/server：Colyseus Room 生命週期、訊息協定（型別放 shared）、
動作驗證流程、viewFor 廣播、回合計時、斷線保座與 AI 代打、重連流程、動作紀錄存檔。
列出可能的作弊與競態問題以及對策。
```

```
寫整合測試：啟動伺服器，用 4 個 Colyseus 測試客戶端跑完一局，
中途讓一個客戶端斷線 10 秒再重連，驗證狀態一致且無隱藏資訊外洩。
```

---

## Phase 5：內容補完（重複使用）

```
/implement-rule <卡片或規則名稱>
```

批次處理時：
```
列出 GAME_RULES.md 中所有 ✅ 但尚未實作的卡片，依實作難度與相依性排序，
從最簡單的開始，一次做一張，每張完成都 commit。遇到 ❓ 就跳過並在最後列給我。
```

---

## 日常好用

- 檢查進度：`/phase-check`
- 程式碼審查：`請審查最近 5 個 commit，重點：規則引擎是否仍是純函式、viewFor 是否漏過濾、測試是否涵蓋非法動作。`
- 除錯：`模擬器在種子 <n> 第 <k> 步失敗，錯誤如下：<貼上>。先重現，找出根因，寫回歸測試，再修正。`
- 長 session 變慢：使用 `/compact` 或開新 session；重要結論先寫進 docs/。
