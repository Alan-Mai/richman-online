# 技術決策紀錄

新決策加在最上面。格式：日期、決策、原因、考慮過的替代方案。

## 2026-10-13 開發時以 Vite middleware 讀 local-assets，只回應本機
- **決策**：
  - `apps/client/vite/local-assets.ts` 是 `apply: 'serve'` 的 Vite plugin，在 dev server 上以 `/local-assets/maps/` 提供 `local-assets/maps/` 的 `.json`、`.png`；不使用 `publicDir`、客戶端程式也不 `import` 任何素材，所以 `vite build` 的產物不含轉檔素材。
  - 只回應 loopback 來源（`127.0.0.0/8`、`::1` 與其 IPv4-mapped 形式），並檢查 Host 標頭為本機名稱與同一埠（防 DNS rebinding）；即使以 `vite --host` 開放區網，區網裝置一律 403。路徑規則與 `tools/extract` 的檢視器相同（擋 `..`、編碼穿越、反斜線、冒號、NUL），程式各自一份，不讓客戶端依賴素材工具。
  - 瀏覽器端以 `AssetSource` 介面讀取（`devAssetSource` 走上述路由；正式版由玩家匯入資料夾，Phase 3 後續 commit 實作）。
  - Node 端程式（`vite.config.ts`、`vite/`）有自己的 `tsconfig`（Node 型別），`typecheck` 一併檢查。
- **原因**：開發時直接看到自己轉出的原版地圖，又確保素材不會被打包或被區網其他裝置讀走（原版素材只限持有者本機使用）。
- **替代方案**：`publicDir` 指向 local-assets（會被複製進 build）；共用 `tools/extract` 的 view-server（客戶端耦合素材工具）；只檢查 Host 標頭（區網裝置可偽造 Host）。

## 2026-10-13 `board.start` 單一起點是暫時設計
- **決策**：Phase 3 不改引擎，所有玩家仍從 `board.start` 出發。原版每位玩家的起點不同（`GAME_RULES.md` 標 ❓），決定方式列入 ROADMAP「原版規則逆向」；原版地圖可玩之前，`Board` 與 `createGame` 需改為支援各玩家的起點（例如每座位一個起點，或由規則決定）。
- **原因**：內建測試地圖用單一起點就能完成 hot-seat；在不知道原版規則前先改型別，日後很可能要再改一次。
- **替代方案**：現在就加上每座位起點（規則未知，只能猜）。

## 2026-10-13 單機介面細節（非規則）
- **決策**：
  - 設定畫面：玩家名稱最多 12 字，去掉頭尾空白，留空用「玩家 n」，同一局不可重名；起始現金、起始存款、亂數種子放在「進階設定」，種子留空時以 `crypto.getRandomValues` 產生，結算框顯示本局種子以便重現；所有錯誤一次列出。「回到設定」保留上一局的值，並銷毀、重建 Phaser 遊戲。
  - 結算框：排名方式依勝負條件（規則面見 `GAME_RULES.md` 第 1 節）；破產先後以「同一筆 `ServerUpdate`（同一個動作）」為並列單位。
  - 棋盤：格子在畫面上小於 48px 時不畫名稱、小於 72px 不畫價格，點格子在 HUD 看資訊。
  - hot-seat 的畫面視角為下一位要行動的玩家（見下方 LocalGameHost 條目）。
  - 玩家顏色、佔位圖外觀、動畫時間（`render/timings.ts`）都是暫定，非原版。
- **原因**：使用者試玩確認；種子可重現有助於回報問題。
- **替代方案**：名稱允許重複（紀錄與結算會分不清）；種子不顯示（無法重現）。

## 2026-10-13 HUD 用 DOM 疊層，Phaser 只畫棋盤與動畫
- **決策**：
  - 玩家面板、回合數、動作按鈕、事件紀錄、格子資訊用 DOM（`apps/client/src/ui/`），棋盤、棋子、骰子、飄字用 Phaser。版面為 CSS grid：桌面右側 300px 側欄，寬度 ≤ 720px 改為上下排列；Phaser 只放在 `#board`，canvas 不會被 HUD 蓋住。
  - 動作按鈕只依最新且已播完的 `ServerUpdate.legalActions` 產生，播放中全部移除並顯示「播放中…」。玩家名稱一律以 `textContent` 寫入。
  - 格子太小時（< 48px）不畫名稱、< 72px 不畫價格，點格子在 HUD 看資訊。
  - DOM 測試用 `happy-dom`（以檔頭註解 `@vitest-environment happy-dom` 逐檔啟用）。選 20.14 而非剛發布兩天的 21.0。
- **原因**：DOM 可用 Vitest 自動測試、容易做 i18n、無障礙與手機排版；日後若改用原版面板圖，再評估移進 Phaser。
- **替代方案**：UI 全畫在 Phaser 內（只能目視測試）；jsdom（較重，happy-dom 已足夠）。

## 2026-10-13 hot-seat 由瀏覽器內的 LocalGameHost 扮演伺服器
- **決策**：
  - `apps/client/src/net/local-host.ts` 的 `LocalGameHost` 是客戶端唯一呼叫 `legalActions`/`applyAction` 的模組；畫面只透過 `GameConnection`（`send(intent)`、`subscribe`）收發，收到的是 `ServerUpdate`。Phase 4 換成連線版時只替換這一層。
  - intent 不帶 `playerId`，由主機補上（hot-seat 一律是目前輪到的玩家；連線版由伺服器依連線補上）。不在合法清單內的 intent 以 `rejected` 訊息回報，不丟例外。
  - hot-seat 的 `view` 以「下一個要行動的玩家」為 viewer。Phase 5 有手牌等隱藏資訊後，需加「交接裝置」畫面，避免其他玩家看到。
- **原因**：讓 UI 從第一天就只依 `ServerUpdate` 運作，維持「客戶端不自行判斷規則」的原則，連線版不必重寫畫面。
- **替代方案**：UI 直接呼叫規則引擎（Phase 4 要大改，也容易在畫面裡混入規則判斷）；hot-seat 用 spectator 視角（日後有手牌時一樣需要依玩家過濾）。

## 2026-10-13 客戶端使用 Phaser 3（鎖 ~3.90）
- **決策**：`apps/client` 安裝 `phaser@~3.90.0`；npm 的 `latest` 已是 4.x，但技術堆疊定為 Phaser 3，暫不升級。Phaser 等容器有尺寸後才建立（尺寸為 0 時 WebGL 建立 framebuffer 會失敗）。
- **原因**：Phaser 4 的渲染器與 API 有大幅變動，文件與範例仍以 3 為主；Phase 3 的需求（場景、tween、材質產生）3.90 都具備。
- **替代方案**：直接用 Phaser 4（需先評估遷移成本，日後另議）。

## 2026-10-13 MKF 壓縮：Ghidra 只產生文字描述，查表依規則產生
- **決策**：
  - 黑箱分析在約定時限內（3 輪、132 組參數）只確定字面值與長度部分，位置碼改用 Ghidra 分析 `rich4.exe`。Ghidra 專案放在倉庫外，反編譯與反組譯輸出只放在 `local-assets/ghidra/`；由 subagent 閱讀後只回報文字描述，解壓器依文字描述自行實作（`tools/extract/src/formats/mkf-compression.ts`）。
  - 位置碼的兩張 256 bytes 查表不從 exe 複製，在程式中依規則產生（各長度的碼數、標準碼配給、反相再反轉 bit 順序、高位值的配給順序）；以 scratch 腳本與 exe 內的表逐項比對 512 項全部相同。
  - 解壓器維持嚴格：必須以結束標記結束、輸出長度等於 `rawSize`、參照不可早於輸出開頭、輸入必須剛好用完；原版不做這些檢查。
  - Ghidra 12.1 在 JDK 25 下無法啟動（內建 OSGi 元件報錯），本機改用 JDK 21。
- **原因**：避免把原版程式碼或資料表帶進倉庫，又能確保實作與原版一致；嚴格檢查能在格式理解錯誤時立刻失敗，而不是轉出錯誤的圖；全部 462 個壓縮子檔都滿足這些條件，嚴格不會擋到正常資料。
- **替代方案**：繼續黑箱猜位置碼（已超過時限）；參考 SDLPAL 的 YJ2 程式碼（違反只讀說明的規則）；把查表當常數陣列寫進程式（等於複製原版資料）；照原版不檢查邊界（錯誤資料可能悄悄產生錯圖）。

## 2026-10-12 模擬器：種子推導、失敗紀錄檔、步數上限
- **決策**：
  - 第 i 局的種子為 `(seed + i) >>> 0`（超過 uint32 繞回）；選動作的 RNG 為 `createRng((gameSeed ^ 0x5eed) >>> 0)`，與規則引擎的 `rngState` 分開。同一個種子加 `--games 1` 即可重跑同一局。
  - 失敗寫成 JSON 紀錄檔（格式版本、`ENGINE_VERSION`、地圖 id、完整 config、玩家、種子、動作序列、模擬器看到的結果）；`replay` 只依動作序列重播，每一步做相同檢查並確認該動作在 `legalActions` 內，最後判斷是否重現原結果。
  - 每局有步數上限 `--max-steps`（預設 10000）：`richestAtRoundLimit` 撞到上限算失敗（理論上不可能）；`lastStanding` 撞到上限只記為「未結束」。
  - 每個失敗都寫檔，但終端機只印前 `--max-failure-details`（預設 5）筆完整內容；失敗原因把數字換成 `#` 後分組計數，各附第一個出現的種子。
  - 各座位勝率在平手時每位勝者各得 1/k 勝，加總等於已結束局數。
  - `replay` 以失敗結束（重現的不變量違規、引擎錯誤、動作不在合法清單）時 exit code 為 1；重播完成（包含重現步數上限）為 0；紀錄檔無法讀取或格式錯誤為 2。
- **原因**：重播只依賴初始設定與動作紀錄，與日後伺服器的存檔、重播模型相同，也不受隨機 AI 選法變動影響；系統性 bug 會讓上千局同時失敗，分組統計才看得出是不是同一個問題；完整 config 寫進紀錄檔，日後預設值改變也能重播舊檔。
- **替代方案**：只靠種子重跑（AI 選法一改就無法重現）；遇到第一個失敗就停（看不出失敗的範圍）；紀錄檔只記地圖 id 與預設 config（預設值改變後舊檔失效）。

## 2026-10-12 勝負判定的細節；總金額不守恆
- **決策**：
  - 回合結束時先檢查未破產人數，≤ 1 即以 `lastStanding` 結束（0 人時 winners 為空陣列），優先於回合上限；結束時不發 `TurnStarted`，round 不變。
  - `richestAtRoundLimit` 在第 `maxRounds` 輪「最後一位未破產玩家」的回合結束時判定（下一位的座位 ≤ 目前座位即繞回）；有待決定的購地或加蓋時，決定之後才結束。winners 只從未破產玩家中選，依座位順序；`GameEnded.totalAssets` 包含所有玩家。
  - 模擬器的不變量不檢查「全場金額守恆」：`bankruptcyPayout: 'full'` 由系統補錢，`passStartBonus` 也會產生錢。
- **原因**：日後卡片或事件效果可能讓多人同時破產，判定要能處理 0 人；破產者總資產為 0，若參與比較，在全員總資產為 0 時會被列為並列勝者。
- **替代方案**：在每次破產當下就結束遊戲（日後多人同時破產時順序難定）；把破產者也列入平手比較（不合理）。

## 2026-10-12 強制付款 pay()：破產只發 PlayerBankrupt，附 cause
- **決策**：`pay(state, debtor, debt)` 處理所有強制付款，`debt` 為 `{ kind: 'rent'; tile; creditor; amount }` 或 `{ kind: 'system'; amount }`。付得起時先扣現金、再扣存款（扣到存款時發 `DepositWithdrawn`），錢交給債權人；付不起時只發一個 `PlayerBankrupt`，不另發 `RentPaid`、`DepositWithdrawn`。`PlayerBankrupt.cause` 記錄破產原因與原本應付的金額（`{ kind: 'rent'; tile; amountDue }` 或 `{ kind: 'system'; amountDue }`），實際付給債權人的金額在 `paidToCreditor`。破產者的現金與存款一律歸零（系統債務時剩下的錢也不保留）。
- **原因**：避免畫面把同一筆錢播放兩次；畫面需要知道是付哪一格的過路費、原本應付多少；稅金、罰款等系統債務日後可沿用同一個欄位。
- **替代方案**：`RentPaid`（實付金額）+ `PlayerBankrupt`（畫面要自己判斷兩個事件是同一筆）；不附原因（畫面無法說明為何破產）。

## 2026-10-12 移動事件在經過觸發處切段；applyAction 自行驗證動作格式
- **決策**：
  - 移動途中某格的經過觸發有效果時，`PlayerMoved` 在該格切段：`PlayerMoved(走到觸發格)` → 效果事件（例如 `PassBonusReceived`）→ `PlayerMoved(剩下的路)`；沒有觸發時只有一個 `PlayerMoved`。`path` 不含出發格；從起點出發或剛好停在起點都不算經過。
  - `applyAction` 先把輸入重建成乾淨的 `Action`：非物件、未知 `type`、`playerId` 不是字串都回傳 `invalidAction`，不 throw；多餘欄位忽略。錯誤優先順序 `invalidAction` > `gameOver` > `unknownPlayer` > `notYourTurn` > `wrongPhase`。
  - `createGame` 成功時也回傳第一個 `TurnStarted`，每一回合都有這個事件。
- **原因**：日後銀行等「暫停等玩家決定」的經過效果需要在觸發格中斷移動，切段模型可以直接沿用；動作日後來自網路，伺服器不該因為格式錯誤的訊息崩潰；客戶端與重播不必特別處理第一回合。
- **替代方案**：單一 `PlayerMoved` 加上帶 `tile` 的效果事件（日後要暫停移動時得改事件模型）；由伺服器負責驗證格式（規則引擎的契約變得依賴呼叫端）。

## 2026-10-12 RNG 採 mulberry32，scripted 序列只供測試
- **決策**：`RngState` 為 `{ kind: 'mulberry32'; state: uint32 }` 或測試用的 `{ kind: 'scripted'; values }`。所有亂數經 `nextInt(rng, n)`，以拒絕取樣避免取模偏差。scripted 只能由 `testing.ts`（不從 `index.ts` 匯出）建立；外部輸入的 RNG 狀態一律經 `parseRngState` 驗證並拒絕 scripted，`createGame` 只收 uint32 種子。
- **原因**：狀態只有一個整數，JSON 直接序列化、存檔與重播簡單；scripted 讓測試指定骰點而不用找種子；若外部能傳入 scripted，就能事先決定骰點作弊。
- **替代方案**：xoshiro128**（品質較好但狀態 4 個整數，對擲骰用途沒有必要）；測試改用找特定種子（脆弱、難讀）。

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
