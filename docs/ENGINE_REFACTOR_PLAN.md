# 引擎改造：分批計畫

使用者核准的計畫（含修正版 6 點），對應 ROADMAP「引擎改造」。進度：

- [x] 批次 A（`b541cf0`、`b3906c6`、`fd8cd41`）。和計畫的差異：`noRandomPlacement` 移到 B1 才加，因為只有放置規則用到。
- [ ] B0、B、C、D、E0、E、F

實作中發現的待補項目，直接寫進對應批次的條目。

## Context
原版規則逆向步驟 1–7 已寫回 `GAME_RULES.md`（🔍），但引擎仍是 Phase 2 的模型：有向的 `next`、`direction`、單一 `board.start`、用百分比算加蓋費和過路費、破產時清屋、沒有交通工具。這次依 ROADMAP「引擎改造」把引擎改成原版模型，讓「原版地圖轉成可玩 Board」可以接上。每批都先寫測試，改完用模擬器確認不崩潰，並比較節奏。

已確認的決定：
- **只留原版做法，不保留非原版選項**：移除百分比加蓋費／過路費、`passStartBonus` 與 `board.start`、破產清屋、過路費進現金，以及 `streetBonus: 'none'`、`priceIndex` 開關、`purchaseFunds: 'cashAndDeposit'`、`bankruptcyPayout` 的 `full`／`none`、`upgradeOnOwnTile`。
- **電腦玩家**：`controller: human | computer`。需要亂數的決策由引擎在決策開始時從 `rngState` 抽出，存成隱藏狀態。shared 提供純函式 `computerAction(state, id)`，只在伺服器／模擬器呼叫，結果照樣走 `applyAction`。
- **逆向步驟 8（B0）排在批次 B 之前**。查不到的項目明確標示，不自行補規則。
- **大型建築**：不放在這次。`TileDef` 加明確的暫時種類 `'unsupported'`，轉檔時發出警告，不靜默轉成空白格。ROADMAP「原版地圖接入」下新增大型建築項目。
- **每批結束**：停下來提醒你輸入 `/wrap-up`；是否推送、是否 `/clear` 由你決定。

---

## 問題 1：會打破什麼、怎麼遷移

| 改動 | 打破的型別／測試 | 遷移 |
|---|---|---|
| `TileDef.next` → `links: {to, blocked}[]`（≤4，對稱）；加 `noRandomPlacement?` | `board.ts` 的驗證與錯誤種類全換；`board.test`、`engine.move.test`（後退的部分）、`loopBoard`、`TEST_LOOP_BOARD`、`prevOf` 匯出 | 驗證錯誤改成：`linkOutOfRange`／`selfLink`／`duplicateLink`／`tooManyLinks`／`asymmetricLink`／`noExit`（沒有未封鎖的槽位）／`disconnected`。刪掉 `prevOf` |
| `PlayerState.position + direction` → `location: {kind:'offBoard'} \| {kind:'onBoard'; tile; prev}` | 所有讀 `position` 的地方（引擎、不變量、client `display.ts`、HUD、棋子繪製），`Direction` 匯出 | 用可辨識聯合型別，符合 CLAUDE.md 的風格規則 |
| 移除 `board.start`、`passStartBonus`，改成第一回合放置 | `createGame`、`resolvePass` 的測試、client `board-view.ts` 的起點標記 | `resolvePass` 保留成空的掛勾（日後給銀行、路障用）；路徑切段的測試先移除，Phase 5 有經過效果時再補 |
| 移除百分比設定與 C0 列出的非原版選項 | `config.ts`／`config.test`、`engine.upgrade/rent/buy.test`、`money.pay.test` 的 `full`／`none`／`cashAndDeposit` 案例、`money.ts` 的 `rentFor`／`upgradeCost` 簽名、client HUD | `rentFor`／`upgradeCost`／`buyPrice` 改收 `(state, tile)`，因為需要同街加總和 coef |
| 拍賣：一回合內有其他玩家行動 | `applyAction` 的 `notYourTurn`、`legalActions` 的「只有 `turn.current`」、不變量「current 不可破產」、模擬器的 `offeredOutOfTurn`、client `local-host.ts` 用 `turn.current` | 新增 `actorOf(state)`：拍賣中是輪到出價的人，其他時候是 `turn.current`。出價依座位順序一次一人，所以「同一時間只有一個行動者」的模型不變，只是把判斷改成看 `actorOf` |
| 動作帶參數（`bid{raise}`、`setDiceCount{count}`） | `parseAction` 只認 `type/playerId`、模擬器用 `{type, playerId}` 測試沒提供的動作、client 的 intent 只用 `type` | `parseAction` 依 type 逐一驗證參數；intent 改帶完整參數 |
| `PlayerBankrupt` 地產保留等級、`RentPaid` 錢進存款 | client `display.ts` 依事件推畫面的測試（view 一致性） | 事件本身寫清楚去向（例：`RentPaid` 加 `into: 'deposit'`），client 依事件更新畫面，在同一個 commit 修，讓測試保持綠燈 |

**遷移原則**
- TS strict 會讓改型別的 commit 一次牽動所有呼叫者：型別、引擎、模擬器和 client 的**編譯修正**放在同一個 commit；client 的**行為／畫面變更**另開 commit。
- `testing.ts` 先改：`loopBoard` 產生對稱的 links；`newTestGame` 預設把所有玩家放在 0 號格、`prev` 設成最後一格（等同舊的「往前走」），讓大多數購地、過路費測試只需改測試資料；另外新增 `placePlayer(state, id, tile, prev)`。專測放置的測試用 `newTestGame({ placement: 'engine' })`。
- 只適用舊模型或已移除選項的測試直接刪除，不保留相容層。
- 模擬器的失敗紀錄（`out/failure-*.json`）加格式版本號，舊檔讀入時拒絕並說明原因；全部改完時 `ENGINE_VERSION` 改成 `0.1.0`。
- 測試先行（CLAUDE.md 第 3 條）：新功能先用空殼回傳預設值，讓測試因**斷言**而失敗，再寫實作。

## 問題 2：原版規則與非原版預設怎麼並存；資料表匯出排在哪

- **不並存規則模式**：引擎只實作原版規則。`RuleConfig` 只放兩類東西：
  - 原版的設定畫面選項：起始資金、勝負條件、起始交通工具。
  - 已寫進 `GAME_RULES.md` 的單一常數：`vehicleMaxDice`、拍賣加價檔位、拍賣塊數上限 3、`maxLevel`。

  「非原版」只剩數值類的暫定預設（起始資金等），以及 Phase 2 已有、標非原版的勝負條件與排名。
- **`auctionAiDoubleCoef`**：`DECISIONS.md` 步驟 5 列出主 session 親自核對過的項目，其中**沒有**電腦出價上限，筆記也只寫「coef 被乘兩次（未實測）」。所以列入 B0（下方 i 項）：
  - 確認是程式碼行為 → 固定照原版、不做選項。
  - 無法確認 → 標示查不到，停下問你。
- **三層資料**：
  1. 規則常數放 `RuleConfig`。
  2. 逐格數值放 `Board`（地價、`upgradeCost`、`rents`、街名＝`name`、封鎖、`noRandomPlacement`）。原版地圖由本機轉檔產生，倉庫只有自編的測試地圖。
  3. 執行檔資料表由 `tools/extract` 匯出 JSON 到 `local-assets/`。
- **資料表的讀入介面**：shared 定義 `OriginalTables` 型別與純函式 `parseOriginalTables(json: unknown)`，回傳錯誤清單、不 throw。檔案 I/O 只在呼叫端：模擬器 `--tables <path>`、client 匯入資料夾（沿用 `AssetSource`）、自架伺服器。表的內容由呼叫端合併進 `RuleConfig` 或 `GameSetup`，引擎不讀檔；公開伺服器從不載入。
- **匯出排在哪**：排在批次 E 之前（E0）。
  - 批次 A–D 的引擎改動不需要執行檔資料表：地產的逐格數值來自 `map.mkf`，`extract map` 已經會轉出。
  - 批次 E 的 client 需要動畫三表。
  - 開局「每人扣 1 台全場庫存」需要道具表與庫存模型，延到 Phase 5。

## 問題 3：分批與 commit（🎮 = 需要你試玩，做到該處先停、不 commit）

每個 commit 前都跑 `pnpm format && pnpm test && pnpm lint && pnpm typecheck`。`GAME_RULES.md`「引擎現況（改造前）」的條目在對應的 commit 內改寫。**每批都有一個 `viewFor` 測試**：新增的欄位各自送或不送（見問題 5）。每批結束時停下，提醒你輸入 `/wrap-up`。

### 批次 A：無向地圖與移動
- **A1 `refactor(shared)`：Board 改成無向 links＋單向封鎖；玩家改記上一格；死路掉頭；岔路用 RNG。** 這批包含型別改動，以及模擬器和 client 的編譯修正。暫時保留 `board.start`；開局的 `prev` 先從起點的相鄰格中用 RNG 選。
  - 測試案例：
    - 驗證：7 種錯誤各一例；一個合法地圖同時有岔路、死路、單向封鎖。
    - 移動：直線上一步；被封鎖的槽位不能走出去，但對面那格可以走進來；死路掉頭；岔路有 2 個、3 個候選時依 scripted RNG 選到各候選；非岔路不消耗 RNG；`PlayerMoved.path` 正確。
    - 決定性：同樣的種子與動作得到同樣的路徑。
    - `viewFor` 送出 `prev`。
- **A2 `feat(shared)`：新增原創測試地圖 `TEST_BRANCH_BOARD`**（有岔路、死路支線、單向封鎖；名稱與價格自編），模擬器加 `--board`。
  - 測試案例：通過 `validateBoard`；每一格都能到達；模擬器在這張圖跑 1000 局沒有失敗。
- **A3 `feat(shared)`：`TileDef` 加 `kind: 'unsupported'`**（暫時標記大型建築等尚未支援的格子）：可以經過、停留沒有效果、不會被選為隨機起點。同一個 commit 在 ROADMAP「原版地圖接入」下新增大型建築項目（待逆向：收費倍數的來源、第 3 類依交通工具收費），並註明轉檔時遇到這類格子要發出警告。
  - 測試案例：停在上面沒有效果；放置時不會選到；`checkInvariants` 不允許它有擁有者。

### 批次 B0：逆向步驟 8（只改文件，時限 3 輪）
用和步驟 1–7 相同的方式進行：subagent 只回報結構與文字描述，關鍵指令由主 session 核對。範圍：
- a. 「日」何時推進；DailyTick 還推動哪些系統（臨時交通工具、狀態持續時間等）。
- b. 淨值公式中的「起始資金」是否等於現金＋存款。
- c. 電腦預覽前方 5 步時遇到岔路怎麼走。
- d. 步驟 3 未解的「疑似遊戲天數」「疑似勝利目標」選項：是否以日計算、如何決定勝負，與 `maxRounds`／`richestAtRoundLimit` 怎麼對應。
- e. 經過銀行格的行為。
- f. 拍賣中最高出價者能否退出。
- g. 隨機放置時沒有可選格子的處理。
- h. 拍賣所得與系統債務餘款所進全域池的用途。
- i. 電腦出價上限中 coef 乘兩次是否為程式碼確認的行為。

寫回 `GAME_RULES.md`（🔍）；3 輪內查不到的項目標「查不到」，不自行補規則。完成後停下回報。

### 批次 B：起點（第一回合隨機放置）
- **B1 `feat(shared)`：在每位玩家的第一個 `TurnStarted` 時放置；移除 `board.start` 與 `passStartBonus`；新增 `PlayerPlaced` 事件。** 沒有可選格子時依 B0-g 實作；若 B0 查不到，停下問你。
  - 測試案例：
    - 座位 0 在 `createGame` 時放置，其他人在輪到時才放置；放置前是 `offBoard`。
    - 不會選到 `noRandomPlacement`、`unsupported`、沒有相鄰格、目前有人的格；可以選到已離開者的原起點。
    - `prev` 從所有相鄰格中選（不看封鎖）；起點是死路端時第一步走回唯一的相鄰格。
    - 放置後同一回合接著擲骰。
    - `viewFor` 送出 `location`。
    - `noRandomPlacement` 在這裡加進 `TileDef`（A1 沒有加）。
    - A3 待補：「停留在 `unsupported` 格」的測試改用更強的斷言：
      - 除了回合結束，沒有其他事件。
      - 所有玩家的金錢與所有地產都不變。

      A3 依規則暫時把實作改壞時，原本的測試仍然通過，所以要補強。
- **B2 `feat(client)`：未放置的玩家不畫棋子、HUD 顯示「尚未出發」；`PlayerPlaced` 的出現動畫與紀錄文字；移除起點標記。** 🎮 試玩 A＋B：在環狀圖上方向是隨機的，可能逆時針走；也可以選分岔測試圖。

### 批次 C：地產與物價指數
- **C0 `refactor(shared)`：移除非原版選項 `purchaseFunds`、`bankruptcyPayout`、`upgradeOnOwnTile`**（固定為只用現金、`remaining`、停在自己的地可選擇加蓋）。`GAME_RULES.md` 對應的列一併改寫。
  - 測試案例：刪除選項相關的案例；保留原版行為的案例。
- **C1 `feat(shared)`：每塊地自帶 `upgradeCost`、`rents`；移除百分比設定；購地價 = 地價 + 等級 × 加蓋費。** 測試地圖改用自編數值；`totalAssets` 用每塊地的加蓋費。
  - 測試案例：等級 0 與等級 > 0 的無主地購地價；加蓋費；各等級過路費查表；`rents` 長度錯誤、數值非法時驗證失敗；`totalAssets`。
- **C2 `feat(shared)`：同街名過路費加總（固定）。** 移除 `streetBonus`；測試地圖改成每邊同一個街名。
  - 測試案例：同名的地不相鄰也加總；他人擁有的同名地不算；各塊用各自的等級。
- **C3 `feat(shared)`：過路費收進地主存款。** `RentPaid` 加 `into`；client 的 `display.ts` 在同一個 commit 修。
  - 測試案例：地主存款增加、現金不變；破產時剩餘的錢進存款；client 的事件與 view 一致性測試通過。
- **C4 `feat(shared)`：日與物價指數（固定開啟）。** state 加 `day`、`priceIndex`；所有價格乘 coef；新增 `DayAdvanced` 事件（含新的 coef）；新增不乘 coef 的 `netWorth()`，和 `totalAssets` 分開。推進時機與起始資金依 B0-a、b。
  - 測試案例：新局 coef = 1；推進一日的時機；平均淨值 ÷ 起始資金取整；只升不降；破產者不算在平均內；購地、加蓋、過路費都乘 coef；淨值的地產部分不乘 coef；`viewFor` 送出 `day` 與 `priceIndex`。
  - 若 B0-d 查到原版的天數上限或勝利目標，另開一個 commit 處理，處理方式先問你，不併入 C4。
- **C5 `feat(client)`：HUD 顯示日期與物價指數；價格改用引擎 helper；事件紀錄文字。** 🎮 試玩。

### 批次 D：破產拍賣
- **D1 `feat(shared)`：破產時地產全部變無主、保留建築等級**（先不拍賣）。不變量刪掉「無主地等級必為 0」；client 的 `display.ts` 在同一個 commit 修。
  - 測試案例：釋出的地保留等級；之後購買時價格含建築；`PlayerBankrupt.releasedTiles`。
- **D2 `refactor(shared)`：`controller`（加在 `PlayerSetup`／`PlayerState`）與 `actorOf`。** `applyAction`／`legalActions` 改用 `actorOf`；這個 commit 不改變行為。
  - 測試案例：非拍賣時和原本一樣；`controller` 格式錯誤時 `createGame` 失敗；`viewFor` 送出 `controller`。
- **D3 `feat(shared)`：拍賣階段與 `bid{raise}`／`passRound`／`withdraw` 動作；全域池累計欄位。**
  - 最高出價者能否退出，依 B0-f 實作；查不到時停下問你。
  - 拍賣所得與系統債務餘款：B0-h 查到用途就照原版處理；查不到時，state 加一個不影響玩法的累計欄位 `systemPool`，不直接勾銷。
  - 測試案例：
    - 3 塊以下不拍賣；超過 3 塊時用 RNG 不重複抽 3 塊，依抽中順序拍。
    - 起標價 = 取整(地價 × (1 + 0.5 × 等級)) × coef。
    - 資格：現金 ≤ 起標價、已破產的人排除；沒有人有資格時直接流標。
    - 從座位最前面的參加者開始輪流；5 檔加價；現金不足時那一檔不會出現；加價後清除所有人的「本輪放棄」；輪到時現金低於目前價者自動退出。
    - 結標：只剩 1 位參加者、或只剩 1 位沒有放棄，且已有最高出價者。全部放棄或退出則流標。
    - 得標者付款（先現金後存款）、過戶、等級不變；拍完一塊接下一塊；全部拍完才 `endTurn`。
    - 所得與系統債務餘款進 `systemPool`（或原版的去處）。
    - 錯誤的行動者、錯誤的 phase 被拒絕；拍賣中 `turn.current` 可以是已破產的人。
    - `viewFor`：拍賣 phase 的公開欄位會送出；尚未開拍的地塊與 `systemPool` 不送。
- **D4 `feat(shared)`：電腦出價與 `computerAction`。** 每塊開拍時用 RNG 算各電腦的上限，存在 phase 的隱藏欄位。coef 乘幾次依 B0-i。
  - 測試案例：三個上限取最小值；同街自有數；一般地塊的無主比例；選最大的一檔；「領先者現金 + 500」時改用較小的檔；只剩 1 位可出價者時固定加 100；連 100 都超過時放棄；`computerAction` 的結果一定在 `legalActions` 內；`viewFor` 看不到上限。
  - 電腦購地與加蓋：暫時用固定的非原版策略（例：付得起就買、付得起就加蓋）。同一個 commit 在 ROADMAP Phase 5 列為待逆向項目。
- **D5 `feat(sim)`：模擬器支援帶參數的動作、改用 `actorOf`、`--controllers random|computer|mixed`。** 見問題 4。
- **D6 `feat(client)`：拍賣面板（目前價、最高出價者、5 檔按鈕、放棄、退出）；hot-seat 切到輪到出價的人；intent 帶參數；設定畫面可把座位設成電腦，由 `LocalGameHost` 呼叫 `computerAction`。** 🎮 試玩（拍賣需要較多回合才會出現，會提供一個容易觸發破產的種子或設定）。

### 批次 E0：執行檔資料表匯出（ROADMAP 項目）
- **E0a `feat(extract)`：`cli tables` 把動畫三表與道具表匯出到 `local-assets/tables.json`。** 用合成的假 exe 片段寫單元測試；交給 subagent 分析時，回報只含結構。
- **E0b `feat(shared)`：`OriginalTables` 型別與 `parseOriginalTables`。**
  - 測試案例：合法的假資料；欄位缺少、型別錯誤、長度錯誤時回傳錯誤清單、不 throw。

### 批次 E：交通工具與選顆數
- **E1 `feat(shared)`：`vehicle: 'walk' | 'motorbike' | 'car'`、`startingVehicle`（全體共用）、`vehicleMaxDice`；開局把顆數設為上限；移除 `defaultDiceCount`。** 臨時交通工具延到 Phase 5。
  - `viewFor` 送出 `vehicle` 與 `diceCount`。
- **E2 `feat(shared)`：人類在 `awaitRoll` 可用 `setDiceCount{count}`（只限機車和汽車，範圍 1 到上限）；顆數在之後的回合沿用。**
  - 測試案例：合法範圍；步行時不提供這個動作；超出範圍時 `invalidAction`；錯誤的 phase；之後的回合沿用。
- **E3 `feat(shared)`：電腦選顆數。** 回合開始時算出（需要的 RNG 先抽好並隱藏），由 `computerAction` 送出。岔路依 B0-c；查不到時停下問你。
  - 測試案例：預覽 5 步經過的格子；好 0 格且壞 ≥ 3 格；好 ≥ 2 格且壞 ≤ 1 格；其他情況維持上限；機車和汽車的差別；`viewFor` 看不到電腦預先抽好的值。
- **E4 `feat(client)`：顆數選擇（按鈕＋快捷鍵）、顯示交通工具、移動動畫使用該交通工具的每幀位移（有匯入的資料表時用原版數值）；設定畫面加起始交通工具。** 🎮 試玩。

### 批次 F：收尾
- **F1 `docs`**：
  - 改寫或刪除 `GAME_RULES.md` 所有「引擎現況（改造前）」；把模擬器結果寫進「模擬器觀察」。
  - 更新 `ARCHITECTURE.md` 的型別、狀態轉移圖與行動者。
  - `DECISIONS.md` 新增一則：controller 模型、只留原版做法、資料表介面、`unsupported` 格。
  - ROADMAP 勾選「引擎改造」與「資料表匯出」。
  - CLAUDE.md 指令段補上模擬器的新參數。

## 問題 4：模擬器的不變量與統計

**`checkInvariants`（shared）新增／修改**
- `location`：在地圖上時 `prev` 是 `tile` 的相鄰格；`offBoard` 只會出現在第 1 輪、座位在目前玩家之後的人；目前行動者一定已放置。
- 無主地可以有等級；等級在 0..`maxLevel` 之間；`unsupported` 格沒有擁有者。
- `priceIndex` 是 ≥ 1 的整數、`day` 是 ≥ 0 的整數；`awaitBuy`／`awaitUpgrade` 的價格等於依 coef 重算的結果。
- 拍賣：出價者有資格且未退出；有最高出價者時目前價 > 起標價、且 ≤ 最高出價者的現金；拍賣的地都是無主地；`turn.current` 只有在拍賣中才可以是破產者；只有電腦參加者才有隱藏上限；`systemPool` ≥ 0。
- 顆數在 1..交通工具上限之間。

**模擬器每一步的檢查**
- 改用 `actorOf`；帶參數的動作從 `legalActions` 枚舉；沒提供的動作類型各造一個範例，確認被以 `wrongPhase` 拒絕。
- coef 跨步不下降。
- `computerAction` 的結果 ∈ `legalActions`。
- 每位玩家的 `viewFor` 序列化後不含 `rngState`、電腦的隱藏欄位與 `systemPool`（防止外洩）。
- 單一拍賣的動作數上限（防止無窮出價）。

**統計（新增）**
- 局長：輪數的平均、中位數、p90；`lastStanding` 未結束的比例。
- 每局破產次數；第一次破產發生在第幾輪。
- 物價指數：最終 coef 的平均與最大值、coef 第一次大於 1 的輪數、終局天數。
- 拍賣：場數、每塊的成交率與流標率、成交價 ÷ 起標價；`systemPool` 終值。
- 移動：岔路次數、死路掉頭次數；各顆數的使用分布（批次 E 之後）。
- 各座位勝率（第一回合隨機放置後，先手優勢是否改變）。

**比較方式**：和 Phase 2 的既有基準（每局破產 0.63 次、`lastStanding` 平均 198 輪、各座位勝率）對照。參數只有 `--board test-loop|test-branch`、`--vehicle walk|motorbike|car`、`--controllers random|computer|mixed`，各跑 1000 局，結果寫進 `GAME_RULES.md`「模擬器觀察」（非原版、不作為規則依據）。

## 問題 5：`viewFor` 各欄位送或不送（每項各一個測試）

| 批次 | 欄位 | 送出 |
|---|---|---|
| A | `location.prev`（初版仍在 `position` 旁） | 送 |
| A3 | `unsupported` 格（在 `board` 內） | 送 |
| B | `location`（`offBoard`／`onBoard`） | 送 |
| C | `day`、`priceIndex` | 送 |
| D | `controller` | 送 |
| D | 拍賣 phase：目前地塊、起標價、目前價、最高出價者、輪到誰、各參加者的狀態（參加／本輪放棄／退出）、剩餘塊數 | 送 |
| D | 尚未開拍的地塊清單（由 RNG 抽出） | 不送（只送剩餘塊數） |
| D | 電腦出價上限 | 不送 |
| D | `systemPool` | 不送（用途未知；B0-h 查到原版會顯示時再改） |
| E | `vehicle`、`diceCount` | 送 |
| E | 電腦選顆數預先抽好的值 | 不送 |

## 驗證
- 每個 commit：`pnpm format && pnpm test && pnpm lint && pnpm typecheck`（用管線過濾時先 `set -o pipefail`）。
- 每批結束：`pnpm -F sim sim -- --games 1000 --seed 1`，兩種勝負條件、兩張測試地圖都沒有失敗；`pnpm test:coverage` 的 shared 覆蓋率 ≥ 90%；停下來提醒你輸入 `/wrap-up`。
- 🎮 B2、C5、D6、E4：`pnpm -F client dev` 試玩，確認後把你的回饋併進同一個 commit。
- 全部完成：`pnpm -F client build` 的產物不含素材；推送前提醒你輸入 `/pre-push`。
