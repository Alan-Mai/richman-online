# 技術決策紀錄

新決策加在最上面。格式：日期、決策、原因、考慮過的替代方案。

## 2026-10-12 規則引擎型別：有向地圖、整數百分比、勝負條件
- **決策**：
  - 地圖每格以有向的 `next`（後繼格陣列）表示前進方向，後退走其反方向；玩家帶 `direction`，掉頭效果只改這個欄位。型別允許叉路（多個 `next`），Phase 2 的地圖驗證拒絕叉路。
  - 起點不是格子種類，而是 `board.start`；「經過格子」做成通用觸發，不寫成起點專用。原版沒有經過起點獎金，`passStartBonus` 只是自訂房選項，預設 0。
  - 比例一律存整數百分比（`rentPercentByLevel`、`upgradeCostPercent`），金額無條件捨去；地圖可自帶過路費表 `rentTable` 覆蓋百分比計算。
  - 勝利條件 `'lastStanding' | 'richestAtRoundLimit'` 搭配 `maxRounds`，兩者綁定（`lastStanding` 時 `maxRounds` 必須為 null）。
  - 購地、加蓋資金來源參數化（`purchaseFunds`，預設只用現金）。
- **原因**：原版地圖的相鄰格子沒有方向，轉換器日後決定方向後填入 `next`，引擎不必改；整數百分比避免浮點誤差（例如 `0.1 * 價格`）造成不同平台或不同計算順序結果不一；沒有起點獎金時錢只會流出，`lastStanding` 可能永不結束，模擬器需要回合上限。
- **替代方案**：無向相鄰 + 玩家記住上一格（遇到死路或叉路難以表示方向）；小數比例 + 四捨五入（浮點誤差）；只做 `lastStanding`、由模擬器自行截斷（對局沒有規則上的結果）。

## 2026-10-12 地圖匯出原樣輸出，檢視器由本機 node:http 伺服器提供
- **決策**：`cli map` 把解析結果原樣輸出成 `map.json`（未知欄位照留，不轉成遊戲格式），背景輸出成調色盤 PNG；`cli view` 以 `node:http` 起只綁 127.0.0.1 的伺服器，只提供 `tools/extract/viewer/` 與 `local-assets/maps/`，並擋掉路徑穿越、檢查 Host 標頭。檢視器本身不含原版內容。
- **原因**：遊戲用的地圖型別要等 Phase 2 定案，先原樣輸出可避免過早解讀欄位；`file://` 下 `fetch` 讀不到本機檔案；素材工具不應與遊戲客戶端綁在一起，也不想為此新增依賴。
- **替代方案**：直接開 HTML 檔（`fetch` 被擋）；放進 `apps/client`（Vite，耦合素材工具與客戶端）；用 `serve`、`http-server` 等套件（新增依賴，且預設可能綁 0.0.0.0）。

## 2026-10-12 先做 Phase 2，壓縮演算法改為 Phase 3 前置
- **決策**：Phase 1 達成完成條件（原版地圖 0 可轉出並在檢視器顯示）後直接進入 Phase 2；壓縮演算法（`ASSET_FORMATS.md` H3）移到「Phase 3 前置」，在 Phase 3 開始前完成。Phase 1 其餘項目（壓縮、音效、`Data`/`Panel` 圖片）延後。
- **原因**：壓縮只擋 Phase 3 的畫面素材（`Data`、`Panel`、`jump` 的壓縮圖、`map.mkf` 子檔 16–38）；Phase 2 的規則引擎使用內建測試地圖，不依賴原版素材。先做規則引擎可避免卡在風險高、可能需要 Ghidra 的逆向工作上。
- **替代方案**：先完成壓縮演算法再進 Phase 2（順序符合原路線圖，但規則引擎會被不相關的逆向工作延後）。

## 2026-10-12 PNG 編碼器自行以 node:zlib 實作
- **決策**：`tools/extract/src/png.ts` 只用 Node 內建的 `zlib`（`deflateSync`、`crc32`）寫出 PNG，支援 8-bit RGBA 與 8-bit 調色盤（附 `tRNS`）兩種；每列濾波固定為 None。
- **原因**：不引入原生編譯套件，Windows 與 Ubuntu 的 CI 都不必處理編譯環境；轉檔只需要寫出，不需要讀取或縮放。調色盤圖直接對應 `GND`、`SPR` 的 8-bit 索引，檔案也較小。
- **替代方案**：sharp（原生編譯）；pngjs（純 JS，但要新增依賴，且功能多於需要）。

## 2026-10-12 素材解析器以 ByteSource 按需讀取
- **決策**：`tools/extract` 的解析器透過 `ByteSource`（`size` + `read(offset, length)`）讀取資料；正式執行用 `openFileByteSource`（唯讀 fd、`readSync`），測試用 `bufferByteSource` 包合成資料。解析器只讀索引與檔頭，內容按需讀取。
- **原因**：`map.mkf` 約 76 MB、`Speaking.mkf` 約 57 MB，整檔載入浪費記憶體；同一介面讓解析器可直接以記憶體中的假資料測試，不需要暫存檔。
- **替代方案**：整檔讀成 Buffer（實作最簡單，但大檔吃記憶體）；串流讀取（不適合依索引隨機存取）。

## 2026-10-08 新增依賴預設使用 ~ 版本範圍
- **決策**：`pnpm-workspace.yaml` 設定 `savePrefix: '~'`，`pnpm add` 新增的依賴只允許 patch 更新。
- **原因**：pnpm 預設寫成 `^`，曾把手動指定的 `~6.0` 改寫為 `^6.0.3`，讓 TypeScript 可能升到 typescript-eslint 不支援的 6.1。
- **範圍**：只影響之後新增的依賴；既有的 `^` 範圍維持不變，需要時再個別調整。
- **替代方案**：`.npmrc` 的 `save-prefix=~`（效果相同；pnpm 10 建議設定寫在 `pnpm-workspace.yaml`）。

## 2026-10-08 inventory.json 的輸出格式
- **決策**：
  - 只記錄相對於 `RICHMAN4_DIR` 的路徑，一律以 `/` 分隔，不寫本機絕對路徑。
  - 檔案依路徑的字元碼排序（不用 `localeCompare`）；除 `generatedAt` 外，同一份輸入每次輸出相同。
  - 熵值記錄整檔值，以及每 64 KB 區塊的最小/最大值。結尾不足 64 KB 的區塊只有在它是唯一一塊（檔案小於 64 KB）時才計入。
  - 掃描時不跟隨符號連結，記錄在 `skipped`。
- **原因**：兩個平台、任何語系下輸出一致，方便比對；封包內可能混有壓縮與未壓縮資料，只看整檔平均容易被掩蓋；結尾小區塊樣本太少，會讓最小熵值失真；不跟隨連結才不會讀到遊戲目錄以外的地方。
- **替代方案**：只算整檔熵值（看不出封包內的區段差異）；結尾區塊一律計入（最小值失真）。

## 2026-10-08 TypeScript 鎖在 ~6.0
- **決策**：`typescript` 版本範圍為 `~6.0.x`，不用目前 npm 上 latest 的 7.x。
- **原因**：typescript-eslint 8.x 的 peer 範圍是 `<6.1.0`；型別感知 lint 規則需要它。
- **之後**：typescript-eslint 支援 7.x 後再升級。

## 2026-10-08 依賴等用到時才安裝
- **決策**：Phase 0 只建立 server、client 空殼；Phaser 在 Phase 3、Colyseus 在 Phase 4 才加入。
- **原因**：避免過早鎖定版本與累積未使用的依賴。

## 2026-10-08 CI 素材防護：單檔 1 MB 上限
- **決策**：CI 執行 `pnpm check:assets`（`scripts/check-assets.js`），任何追蹤中的檔案超過 1 MB、使用被禁止的副檔名（`tools/**/fixtures/` 除外）、或位於 `local-assets/` 即失敗。
- **原因**：`.gitignore` 只擋得住未追蹤的檔案，`git add -f` 或改副檔名仍可能讓原版素材進庫。原版的圖片包、影片、音樂多半是大檔，而目前倉庫只有程式碼與文件，1 MB 足以攔下大部分誤提交且不會誤擋。
- **之後**：原創美術或音樂若有單檔超過 1 MB，改調高門檻（或對特定目錄另設門檻），或改用 Git LFS；不要直接移除這項檢查。
- **替代方案**：只靠 `.gitignore`（無法防止強制加入）；pre-commit hook（可被略過，且需每位開發者安裝）。

## 2026-10-08 CI 同時跑 Ubuntu 與 Windows
- **決策**：GitHub Actions 以 matrix 在 `ubuntu-latest` 與 `windows-latest` 執行 test、lint、typecheck。
- **原因**：主要開發環境是 Windows；`resolveGameDir()` 等路徑處理在兩個平台行為不同。單元測試另以注入 `path.win32` / `path.posix` 的方式，在任一平台都測兩種路徑語意。

## 2026-10-08 專案原創音效使用 .ogg
- **決策**：倉庫內的原創音效（含測試以外的佔位音效）一律使用 `.ogg`。
- **原因**：`.gitignore` 以 `*.wav` 做原版素材保險規則；原創音效改用 `.ogg` 就不必開例外。
- **替代方案**：`.wav` 加 `!` 例外（容易誤放行原版檔）。

## 2026-10-08 授權採用 GPL-3.0
- **決策**：程式碼以 GPL-3.0 釋出，放在公開的 GitHub。
- **原因**：確保衍生版本維持開源。
- **替代方案**：MIT（允許閉源衍生）。

## 2026-10-08 原版地圖只限自架房
- **決策**：公開伺服器只提供原創地圖；原版轉檔地圖只能用在持有正版者自架的房間。
- **原因**：地圖結構（格子、地價）屬原版衍生資料，伺服器會把它傳給所有連線玩家；公開服無法確認每位玩家都持有正版。
- **替代方案**：每位玩家在客戶端各自載入原版地圖、伺服器只收雜湊比對（伺服器仍需地圖資料才能判定，不可行）。

## 2026-10-08 模擬器放在 tools/sim
- **決策**：終端機模擬器放 `tools/sim/`，不放 `packages/shared`。
- **原因**：模擬器需要 `console`、檔案 I/O 輸出失敗紀錄，與規則引擎的純函式限制衝突。

## 2026-10-08 RNG 唯一來源為 state.rngState
- **決策**：`applyAction(state, action)` 不另外接受 rng 參數；亂數取自 `state.rngState`，新狀態寫回回傳的 state。測試以 helper 把 `rngState` 換成固定骰點序列。
- **原因**：避免「傳入的 rng」與「state 內的 rngState」兩個來源不一致；初始狀態 + 動作紀錄即可完整重播。
- **替代方案**：`applyAction(state, action, rng)` 外部注入（兩個來源，容易不同步）。

## 2026-10-08 合法動作由伺服器計算並下發
- **決策**：`legalActions` 只在伺服器以完整 `GameState` 執行；每次廣播把該玩家的合法動作清單隨 `PlayerView` 送出，客戶端只依此顯示選項。
- **原因**：`legalActions` 需要完整狀態，客戶端只拿得到過濾後的 `PlayerView`；由伺服器計算也避免前後端判斷不一致。
- **替代方案**：讓 `legalActions` 改吃 `PlayerView`（部分判斷需要隱藏資訊，無法完整實作）。

## 2026-10-08 前後端共用 TypeScript 規則引擎
- **決策**：規則引擎與型別寫在 `packages/shared`；伺服器執行規則，客戶端共用型別（Action、GameEvent、PlayerView）。
- **原因**：避免型別與規則重複定義；Action/Event 協定前後端一致。客戶端不自行執行 `legalActions`（見上方「合法動作由伺服器計算並下發」）。
- **替代方案**：Godot（前後端共用較困難）。

## 2026-10-08 伺服器權威 + 動作紀錄
- **決策**：亂數與判定只在伺服器；保存初始狀態與動作序列。
- **原因**：防作弊、支援斷線重連與重播。

## 2026-10-08 原版素材不入庫
- **決策**：玩家自備正版，以本機工具轉檔到 `local-assets/`。`RICHMAN4_DIR` 必須是倉庫外的絕對路徑；`.gitignore` 另以副檔名（`*.mkf`、`*.exe`、`*.dll`、`*.avi`、`*.mid`、`*.wav`）做保險，只有 `tools/**/fixtures/` 的合成假資料例外。
- **原因**：著作權；比照 OpenRA、OpenMW 等專案做法。
