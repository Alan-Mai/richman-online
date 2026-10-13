# 路線圖

每個階段都有「完成條件」，全部勾選才進下一階段。Claude Code 完成項目時，把勾選和程式碼放在同一個 commit，不必註明 commit hash。

## Phase 0：專案骨架
- [x] pnpm workspaces：`packages/shared`、`apps/server`、`apps/client`、`tools/extract`、`tools/sim`
- [x] TypeScript strict、ESLint、Prettier、Vitest 設定完成
- [x] 根目錄 `pnpm test` / `pnpm lint` / `pnpm typecheck` 可執行
- [x] `.gitignore` 排除 `local-assets/`、`.env`，並以副檔名排除原版檔案類型
- [x] CI（GitHub Actions）跑 test + lint + typecheck（ubuntu-latest + windows-latest）

**完成條件**：空專案所有檢查通過。

## Phase 1：素材逆向（風險最高，優先）
- [x] `tools/extract inventory`：列出 `RICHMAN4_DIR` 全部檔案、大小、副檔名、檔頭 16 bytes，輸出 `local-assets/inventory.json`（另含整檔與 64 KB 區塊熵值）
- [ ] 依檔頭與大小分類，於 `ASSET_FORMATS.md` 建立每種格式的條目
- [x] 像素格式解析（RGB555/RGB565，以及是否另有調色盤）
- [ ] 圖片/精靈圖格式解析 → PNG
- [x] 地圖資料解析 → JSON（格子座標、類型、地價、連接關係）
- [ ] 音效/音樂解析或確認可直接使用
- [ ] 每個解析器都有以合成資料撰寫的單元測試

- [x] **完成條件**：能把一張原版地圖完整轉出並在簡單 HTML 檢視器中顯示。（已達成：`pnpm -F extract cli map` 後 `pnpm -F extract cli view`，使用者目視確認地圖 0 的背景、格子、連線、名稱、區段都正確。）

Phase 1 其餘項目（壓縮、音效、Data/Panel 圖片）延後；壓縮演算法移到「Phase 3 前置」（見 `DECISIONS.md`）。

RGB555、`SMP`、`SPR`（未壓縮）、FLC、`GND`、地圖資料已確認，分析順序見 `ASSET_FORMATS.md`。

**未解問題**（Phase 1，延後處理）：
- 確認原版光碟的 AVI 是否為真實影片（本機副本的 21 個 `*.avi` 是相同的佔位檔，可能是精簡版）；不影響 Phase 1 完成條件。
- 地圖資料：玩家前進方向的來源（相鄰格子無方向）、區段 1–4 與 `unknownAt*` 欄位的意義、某張地圖 20 個沒有連結的格子、`GND` 子檔 8 背景沒有道路；需對照原版遊戲畫面確認。
- MKF 子檔頭的 `unknown3`、`unknown4` 在全螢幕圖、(0, 0) 類的意義未知（`SMP`、`SPR`、`GND` 已確認）。壓縮演算法已在 Phase 3 前置完成。
- `SMP`/`SPR` 的透明色與錨點：
  - `SMP` 四角統計沒有一致的透明色（`0x0000` 為候選）。
  - `SPR` 以調色盤索引 0 為透明（已目視確認）；但 `Data.mkf` 有 10 個調色盤的第 0 色不是 `0x0000`（見 `ASSET_FORMATS.md`）。
  - 兩者張數表的 `unknown3`/`unknown4` 都疑似錨點；`SPR` 以 int16 讀，可落在圖外。
  - 最後需對照原版遊戲截圖確認（由使用者提供）。
- FLC 轉檔方式：`jump.mkf` 的 25 個 FLC 動畫瀏覽器無法直接播放，需決定轉成影片（ffmpeg 可解 FLC）或精靈圖序列，以及轉檔放在 `tools/extract` 還是依賴外部 ffmpeg。
- MIDI 播放方式：瀏覽器內以 soundfont 合成，或離線轉檔；若選 soundfont，需確認其授權與 GPL 相容。

## Phase 2：最小規則引擎
- [x] RNG（可序列化、可重現，唯一來源 `state.rngState`）
- [x] 內建測試地圖（不依賴原版）與 `validateBoard(board, config)`
- [x] 型別與 `RuleConfig` 定案（`GameState`、`Phase`、`Action`、`GameEvent`、地圖型別）
- [x] 擲骰與移動、經過觸發（通用機制；`passStartBonus` 預設 0）
- [x] 購地、加蓋、過路費
- [x] 破產與勝負判定（現金不足自動扣存款，仍不足即破產；不賣地不拆房，地產收回為無主空地；`lastStanding` 與 `richestAtRoundLimit`）
- [x] `legalActions`（伺服器專用）、`viewFor`
- [x] 終端機模擬器（`tools/sim/`）：4 個隨機 AI 以 `richestAtRoundLimit` 跑完 1000 局不崩潰、無非法狀態

- [x] **完成條件**：模擬器穩定，測試覆蓋率 shared ≥ 90%。（已達成：`pnpm -F sim sim -- --games 1000` 以 `richestAtRoundLimit` 與 `lastStanding` 各跑 1000 局，全部結束、無失敗；`shared` 覆蓋率約 98.7%。）

## Phase 3：單機畫面

**Phase 3 前置**（Phase 3 開始前完成）：
- [x] 壓縮演算法（`ASSET_FORMATS.md` H3），以 `SPR` 的完整結構當已知明文，從 `jump.mkf` 子檔 9–44 下手。先對照 SDLPAL 文件描述的 YJ1 與常見 LZSS 變體（只看說明，不複製程式碼）；**設時限：這些候選都不符合就改用 Ghidra 分析 `rich4.exe` 的解壓函式，不繼續猜。**（已完成：LZ + 動態 Huffman，見 `ASSET_FORMATS.md`「MKF 壓縮」；462 個壓縮子檔全部通過驗證，`jump.mkf` 子檔 9–44 縮圖經使用者目視確認。）

**下一步**：Phase 3 第一項「Phaser 場景載入地圖」。先讀 `ARCHITECTURE.md` 與 `apps/client` 現況，提出計畫（原版轉檔與佔位圖的載入方式、`tools/extract` 匯出哪些素材給客戶端），確認後再寫。

**未解問題**：
- 壓縮子檔中沒有已知 magic 的 308 個（`Data.mkf` 302、`Panel.mkf` 6）格式未知，需另外分析（可用 `decompressMkf` 解壓後再看）。
- 讀檔函式解壓後的兩個處理尚未分析：對 `[unknown3, unknown3 + unknown4)` 的後處理，以及開頭 3 bytes 與兩個常數比對後的分派（見 `ASSET_FORMATS.md`「MKF 壓縮」待解問題）；目前轉出的色彩已正確，不影響 Phase 3。
- 待使用者確認的規則（`GAME_RULES.md` 標 ❓）：銀行經過時能不能存提款、叉路怎麼選、掉頭效果、原版地圖 7 階價格表的意義。
- 前進方向：原版地圖資料的相鄰格子沒有方向，日後要讓規則引擎吃原版地圖時需先解決（見 Phase 1 未解問題）；不影響內建測試地圖。
- GitHub 的 `ubuntu-latest` 自 2026-10-19 起改為 Ubuntu 26，留意 CI 結果。
- 遊戲節奏：暫定數值下破產很少（`richestAtRoundLimit` 每局 0.63 次、`lastStanding` 平均 198 輪），待 `GAME_RULES.md` 填入原版數值後用模擬器重新比較。

- [ ] Phaser 場景載入地圖（原版轉檔或佔位圖）
- [ ] 事件佇列與動畫：擲骰、移動、買地、付款
- [ ] 本機熱座（hot-seat）可玩完一局

**完成條件**：一台電腦上 4 人輪流可完整玩一局。

## Phase 4：連線
- [ ] Colyseus 房間、邀請碼
- [ ] 動作驗證與事件廣播
- [ ] 回合計時與逾時預設動作
- [ ] 斷線保座、AI 代打、重連
- [ ] 開局隨機決定座位順序（模擬器觀察到先手優勢，見 `GAME_RULES.md` 觀察紀錄）
- [ ] 動作紀錄存檔與重播

**完成條件**：4 台裝置（含手機瀏覽器）連線完成一局，中途斷線重連成功。

## Phase 5：內容補完
- [ ] 機會/命運卡
- [ ] 道具卡（逐張實作，見 GAME_RULES.md）
- [ ] 股票市場
- [ ] 神明（財神、福神、窮神、衰神等）
- [ ] 特殊格子（銀行、醫院、監獄、商店、新聞……）
- [ ] 電腦 AI 角色與難度
- [ ] 音效、音樂

## 待辦/想法
- 觀戰模式
- 自訂規則房
