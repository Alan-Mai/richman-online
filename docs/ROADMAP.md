# 路線圖

每個階段都有「完成條件」，全部勾選才進下一階段。Claude Code 完成項目時，把勾選和程式碼放在同一個 commit，不必註明 commit hash。

## Phase 0：專案骨架
- [x] pnpm workspaces：`packages/shared`、`apps/server`、`apps/client`、`tools/extract`、`tools/sim`
- [x] TypeScript strict、ESLint、Prettier、Vitest 設定完成
- [x] 根目錄 `pnpm test` / `pnpm lint` / `pnpm typecheck` 可執行
- [x] `.gitignore` 排除 `local-assets/`、`.env`，並以副檔名排除原版檔案類型
- [ ] CI（GitHub Actions）跑 test + lint + typecheck

**完成條件**：空專案所有檢查通過。

## Phase 1：素材逆向（風險最高，優先）
- [ ] `tools/extract inventory`：列出 `RICHMAN4_DIR` 全部檔案、大小、副檔名、檔頭 16 bytes，輸出 `local-assets/inventory.json`
- [ ] 依檔頭與大小分類，於 `ASSET_FORMATS.md` 建立每種格式的條目
- [ ] 調色盤格式解析
- [ ] 圖片/精靈圖格式解析 → PNG
- [ ] 地圖資料解析 → JSON（格子座標、類型、地價、連接關係）
- [ ] 音效/音樂解析或確認可直接使用
- [ ] 每個解析器都有以合成資料撰寫的單元測試

**完成條件**：能把一張原版地圖完整轉出並在簡單 HTML 檢視器中顯示。

## Phase 2：最小規則引擎
- [ ] RNG（可序列化、可重現，唯一來源 `state.rngState`）
- [ ] 內建測試地圖（不依賴原版）
- [ ] 擲骰與移動、經過起點
- [ ] 購地、加蓋、過路費
- [ ] 破產與勝負判定（現金不足自動扣存款，仍不足即破產；不賣地不拆房，地產收回為無主空地）
- [ ] `legalActions`（伺服器專用）、`viewFor`
- [ ] 終端機模擬器（`tools/sim/`）：4 個隨機 AI 跑完 1000 局不崩潰、無非法狀態

**完成條件**：模擬器穩定，測試覆蓋率 shared ≥ 90%。

## Phase 3：單機畫面
- [ ] Phaser 場景載入地圖（原版轉檔或佔位圖）
- [ ] 事件佇列與動畫：擲骰、移動、買地、付款
- [ ] 本機熱座（hot-seat）可玩完一局

**完成條件**：一台電腦上 4 人輪流可完整玩一局。

## Phase 4：連線
- [ ] Colyseus 房間、邀請碼
- [ ] 動作驗證與事件廣播
- [ ] 回合計時與逾時預設動作
- [ ] 斷線保座、AI 代打、重連
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
