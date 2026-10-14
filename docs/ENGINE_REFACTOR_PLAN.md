# 引擎改造：分批計畫

使用者核准的計畫（含修正版 6 點），對應 ROADMAP「引擎改造」。進度：

- [x] 批次 A（`b541cf0`、`b3906c6`、`fd8cd41`）。和計畫的差異：`noRandomPlacement` 移到 B1 才加，因為只有放置規則用到。
- [x] 批次 B0（1 輪完成）：a–i 全部查到，寫回 `GAME_RULES.md`（🔍）。使用者對結果的決定已併入下方各批：
  - g（原版沒有處理，候選 0 時除以 0）→ B1：不訂退路規則，改由 `validateBoard` 保證可放置格數足夠。
  - h（全域池是彩券獎池）→ D3：累計欄位命名 `lotteryPool`，`viewFor` 暫不送；彩券本身列入 ROADMAP Phase 5。
  - d（天數上限、淨值目標）→ C4 之後另開 C4b，改成原版勝負條件。
  - f（最高出價者在領先時不會再輪到）→ D3 不需要「最高出價者退出」的分支。
  - e（經過銀行可存提款）→ 不在本次改造，列入 ROADMAP Phase 5「特殊格子」。
  - 和計畫的差異：D4 測試案例「只剩 1 位可出價者時固定加 100」改成「開拍時只有 1 位有資格的參加者」；`auctionAiDoubleCoef` 不做（i 已確認）。
- [x] 批次 B（`7301d80`、`ace0cd4`、B2）：
  - [x] B1。和計畫的差異與補充：
    - 為了讓 client 編譯通過，B1 已先做：未放置的玩家不顯示棋子、移除起點標記（含 `BOARD_COLORS.start`）、`PlayerPlaced` 的紀錄文字（暫定「{name} 從 {tile} 出發」）、動畫先直接顯示到位；display model 的 `position` 改成 `tile: TileIndex | null`。B2 剩下：HUD「尚未出發」、出現動畫、試玩。
    - `PassBonusReceived` 事件一併移除（已沒有產生它的規則）；`resolvePass` 保留成不帶參數的空掛勾。
    - 候選只有 1 個（起點格或上一格）時不消耗 RNG，和岔路相同：使用者確認是引擎實作細節、不是規則，寫在程式註解。
    - 已破產的玩家是否佔格：B1 先寫成不佔格；依使用者要求對照逆向的放置與破產函式，原版是**仍佔著破產時所在的格**（`GAME_RULES.md` 🔍），修正於 `ace0cd4`。
    - 模擬器（1000 局 × 兩張圖 × 兩種勝負條件，種子 1）沒有失敗。
  - [x] B2（使用者試玩確認，清單全部符合）：HUD「尚未出發」、`PlayerPlaced` 出現動畫（棋子從上方落到起點格，`DURATIONS.placed` 500 ms，非原版；E0a 時查原版出場表現）、未放置者的回合開始不做脈動。和計畫的差異：設定畫面新增「地圖」選項（環狀／分岔測試圖），因為試玩需要分岔圖。
- [x] 批次 C：
  - [x] C0。`spendable` 不再收 config；`GAME_RULES.md` 第 3 節「引擎現況」刪掉兩列、第 8 節改寫；client 設定畫面沒有用到這些選項，只改 `display.test`。
  - [x] C1。價格 helper 收 `PriceView = Pick<GameState, 'board' | 'tiles'>`（C4 加 `priceIndex`），client HUD 用 display model 的 tiles 呼叫；HUD 的 `config` 欄位已不需要而移除。購地時保留既有等級（D1 之前只有測試會構造帶等級的無主地）。測試地圖的加蓋費 = 地價 ÷ 2、過路費用兩組自編百分比範本（依邊交替）；`testing.ts` 的 `loopBoard` 只給價格時用 `testProperty` 的自編數值。
  - [x] C2。無主地的 `rentFor` 只算自己那格；引擎只在有地主時收費，HUD 也只對有地主的地顯示過路費。`loopBoard` 的地產規格可指定 `name`（街名）。
  - [x] C3。`RentPaid.into` 是單一字面值 `'deposit'`；`PlayerBankrupt.paidToCreditor` 同樣進存款，只在型別註解寫明、沒有加欄位。
  - [x] C4。和計畫的差異與補充：
    - 「電腦與人類拆法相同（暫定）」的測試延到 D2（`controller` 在 D2 才加入）；開局拆法的程式註解已寫明電腦暫用人類拆法。
    - `startingFunds` 必須是正整數（coef 的除數）；暫定預設 40,000（非原版，等於原本現金 + 存款）。
    - `totalAssets`（`richestAtRoundLimit` 用，非原版）改成乘 coef 的「目前購地價」，與不乘 coef 的 `netWorth` 分開。
    - client 的編譯修正：display model 加 `day`、`priceIndex` 並處理 `DayAdvanced`（事件與 view 一致性測試因此涵蓋兩欄）；HUD 的價格 helper 帶 `priceIndex`；設定畫面的起始現金／存款合併成「起始資金」；`DayAdvanced` 的紀錄文字先放一版，C5 再調整。
    - 模擬器每步檢查 coef 不下降（新的失敗種類 `priceIndexFell`，重播同樣檢查）。
    - `engine.legal.test` 的「破產到剩一人」案例：過路費改進存款後錢不再離開場上，600 步內不會結束，改成起始資金 2000、上限 2000 步。模擬器（種子 1、1000 局）：`lastStanding` 環狀圖 93.0%、分岔圖 91.7% 結束，平均 867／968 輪；`richestAtRoundLimit`（100 輪）每局破產 0.52／0.28 次；沒有失敗。
  - [x] C4b。和計畫的差異與補充：
    - 設定欄位：`dayLimit`、`netWorthTargetMultiple`（`null` 為不限，非 `null` 時是正整數）。`GameEnded` 的 `totalAssets` 改成 `netWorth`，`reason` 改成 `lastStanding`／`dayLimit`／`netWorthTarget`；`totalAssets()` 已無人使用而移除。
    - 結束的那一日仍發出 `DayAdvanced`（`priceIndex` 不變，因為檢查在更新 coef 之前），接著 `GameEnded`。
    - 兩個條件同時成立時顯示 `netWorthTarget`（引擎細節，勝者相同，寫在程式註解與 `GAME_RULES.md` 第 1 節）。
    - client 編譯修正：設定畫面的勝負條件單選與回合上限，直接換成「天數上限」欄位（留空為不限，預設留空，同原版預設），因為移除回合上限後需要一個對應欄位；淨值目標欄位留到 C5。結算排名改用淨值、同額依座位不並列；`hotSeatSetup` 改收 `'dayLimit' | 'lastStanding'`。
    - 模擬器：`--win`／`--max-rounds` 改成 `--day-limit`、`--net-worth-target`、安全上限 `--max-days`（預設 1000，到達記為未結束）；`--max-steps` 預設改為 20 × `--max-days`，超過一律是失敗；失敗紀錄 `LOG_VERSION` 改成 3。
    - 模擬器結果寫進 `GAME_RULES.md`「模擬器觀察」。
  - [x] C5（使用者試玩確認，清單全部符合）。內容：
    - HUD：輪數下方顯示「已過 N 天　物價指數 ×K」；有設定時顯示天數上限與淨值目標（金額 = 倍數 × 起始資金）；每位玩家顯示淨值（`netWorth` 改收 `NetWorthView`，display model 也能算）。
    - 價格改用引擎 helper：格子資訊加「目前購地價」（無主地，含 coef 與既有建築），過路費含同街加總與 coef；棋盤上的價格標籤改成目前購地價、隨 coef 與建築更新（另一個圖層，每次 `show` 重畫）。
    - 事件紀錄：`DayAdvanced`「過了一天（已過 N 天），物價指數 ×K」；過路費與破產償債寫明存入收款者的存款。
    - 設定畫面加「淨值目標」（起始資金的倍數，1–999，留空為無目標）。
    - 發現：目前引擎沒有任何收入來源（銀行利息、股票、卡片等都在 Phase 5），平均淨值不會超過起始資金，所以 coef 永遠是 1（隨機 AI 2–4 人各 300 局，最大 coef 都是 1）。試玩時用暫時的除錯掛勾 `richmanDebug.setPriceIndex(n)`（暫時除錯程式，只在 dev）把 coef 調高來看價格變化，確認後已移除。
  - [x] C5 之後的修正（使用者要求依寫作慣例查證，逆向步驟 8b，筆記在 `local-assets/ghidra/notes.md`）：
    - 天數上限與淨值目標在原版是同一個判斷、同一段結束流程，不記錄是哪一個條件 → `GameEnded.reason` 合併成 `dayLimitOrNetWorthTarget`（取代 C4b 自訂的「同時成立時顯示淨值目標」）；模擬器的結束原因統計一併合併。
    - 原版沒有結算排名畫面 → 天數上限／淨值目標結束時，結算框只顯示原因、勝者與種子。
    - 使用者決定 `lastStanding` 也照原版：移除 `rankPlayers`（`ui/ranking.ts`）與結算框的名次表，三種結束都只顯示原因、勝者與種子。模擬器的破產統計本來就直接數 `PlayerBankrupt` 事件，不依賴排名，不需修改。結束後的地圖過關進度與「是否繼續」流程列入 ROADMAP「待辦/想法」。
- [x] 批次 D：
  - [x] D1。client `display.ts`：`PlayerBankrupt` 只清擁有者、`PropertyBought` 保留原等級。模擬器 `stats.test` 用到舊不變量訊息當範例字串，改成另一則訊息。
    - D6 待補：棋盤的 `drawOwnership` 只畫有地主的地，無主地的保留建築目前看不到（HUD 格子資訊有等級與含建築的購地價）。D6 時一併畫出，列入試玩清單。
  - [x] D2。`controller` 在 `PlayerSetup` 為必填（`createGame` 對未知值回傳 `invalidController`）；`actorOf` 在 `gameOver` 時回傳 `null`。補上 C4 延後的「電腦與人類拆法相同（暫定）」測試。client 設定畫面與模擬器暫時全部設成 `human`（D5、D6 再開放）；模擬器的失敗紀錄 `players` 多了 `controller`，`LOG_VERSION` 改成 4。
  - [x] D3。和計畫的差異與補充：
    - 查證（`local-assets/ghidra` 反組譯）：破產處理先判斷「只剩 1 人」並直接結束，之後才釋出地產與拍賣，所以引擎在只剩 1 人時不拍賣。結標判斷、跳過已退出者（不跳過已放棄者）、輪到時現金低於目前價自動退出，都照筆記的 p／q 流程。
    - `RuleConfig` 新增 `auctionPlotCount`（3）與 `auctionRaises`（5 檔），是 `GAME_RULES.md` 第 8 節已寫的原版常數；`auctionRaises` 必須是遞增的正整數。不在表內的加價回 `invalidAction`、現金不足回 `insufficientFunds`。
    - 事件：`AuctionStarted`（含資格名單與之後剩餘塊數；沒人有資格時名單為空，緊接 `AuctionUnsold`）、`AuctionRaised`、`AuctionPassed`、`AuctionWithdrawn`（`reason: 'chose' | 'shortOfCash'`）、`AuctionWon`、`AuctionUnsold`。`viewFor` 的拍賣 phase 以 `remaining` 取代 `queue`（`PhaseView`／`TurnView`）。
    - 系統債務破產時剩餘的錢進 `lotteryPool`（`pay` 內處理）；`PayResult` 加 `releasedTiles`。
    - 為了讓測試保持綠燈，D5／D6 的一部分提前做：模擬器改用 `actorOf`、沒提供的動作類型改用各自的範例動作（`bid` 帶參數）；client 的 intent 帶完整參數（`toIntent`）、`LocalGameHost` 改用 `actorOf`、拍賣事件的 display／紀錄文字（暫定，D6 試玩時再調）／得標動畫；HUD 目前只有一個「加價」按鈕（最小一檔），D6 換成拍賣面板。
    - 觀察：目前引擎沒有任何讓現金增加的來源（過路費進存款、付款先扣現金），破產發生時其他人的現金通常也已耗盡，所以隨機對局的拍賣幾乎都沒有人有資格出價（模擬器種子 1 各 300 局，兩張圖都沒有失敗）。`engine.legal.test` 改從「座位 0 很窮、其他人很有錢、各有 4 塊地」的狀態開始隨機對局，確保拍賣被走到。D6 試玩需要另外的設定或除錯掛勾才看得到有人出價的拍賣。
  - [x] D4。和計畫的差異與補充：
    - 查證（反組譯與 `rich4.exe` 的浮點常數）：兩個隨機係數的形式（見 `GAME_RULES.md` 第 8 節）、無主比例的分母、領先者差額的分級與「開拍時只有 1 人 → 100」的先後（先選檔、再依領先者調整、最後才套用 1 人規則；連 100 都超過時放棄不受影響）。
    - 電腦出價的常數放在 `RuleConfig.computerBid`（原版常數，`GAME_RULES.md` 已寫），因為引擎規則要求數值不寫死。
    - 拍賣 phase 加 `computerLimits`（隱藏）；不變量檢查「每位電腦參加者都有上限、人類沒有、上限是非負整數」。
    - `computerAction` 放在 `engine.ts`、出價邏輯在 `computer.ts`；購地與加蓋暫定「有提供就買、就蓋」，ROADMAP Phase 5 列為待逆向。
  - [x] D5。改用 `actorOf` 與帶參數動作的範例已在 D3 做掉，這裡做其餘部分：
    - `--controllers random|computer|mixed`（mixed：座位 2、4 是電腦，1、3 隨機）；電腦座位照 `computerAction` 行動。
    - 每步檢查新增：電腦的選擇必須在 `legalActions` 內、人類座位的 `computerAction` 必須是 `null`（`computerActionNotLegal`）；每位玩家與旁觀者的 `viewFor` 序列化後不得含 `rngState`、`queue`、`computerLimits`、`lotteryPool` 等鍵（`viewLeak`）；單一拍賣超過 5000 個動作視為失敗（`auctionTooLong`）。
    - 統計新增：局長中位數與 p90、第一次破產的輪數、終局天數、物價指數（終值平均與最大、第一次大於 1 的輪數）、拍賣（塊數、有人可出價、成交、成交價 ÷ 起標價）、彩券獎池終值、岔路與死路掉頭次數。顆數分布等批次 E 再加。
    - `rerun` 指令帶 `--controllers`；失敗紀錄格式不變（`players` 已含 `controller`）。CLAUDE.md 指令段補上 `--controllers`。
    - 之後另一個 commit 讓外洩檢查略過地圖與設定（原本每步序列化整個 view，模擬器慢了一個數量級）。模擬器結果寫進 `GAME_RULES.md`「模擬器觀察」。
  - [x] D6（使用者試玩確認，清單全部符合）。內容與查證：
    - 查證（`RunPlotAuction`、`AuctionDlgProc` 反編譯）：原版拍賣對話框列出**所有仍在場的玩家**，各列顯示現金；沒資格的人也列出（之後移出名單）；中間欄位顯示目前價；加價後該列改顯示新價格；有地塊圖片。人類有 7 個按鈕（本輪放棄、5 檔加價、退出），現金不夠的加價按了無效。成交後等 1000 ms、過戶、再等 1000 ms。面板依此設計：標題（地名與等級）、起標價、目前價、最高出價者、之後還要拍賣的塊數；每位在場玩家一列（現金與狀態：出價中／本輪放棄／已退出／現金不足不能出價／最高出價 X）；5 檔加價全部顯示、付不起的停用。
    - 非原版的時間放在 `timings.ts`：開拍 700、每次出價 600、流標 600（遊戲速度預設時，非原版；原版各角色的出價動畫在動畫檔，E0 時查）；成交前後各 1000 ms 是程式碼立即值（`FIXED_MS.auctionSale`）。
    - display model 加 `auction`（由事件推出，與 view 比對）；輪到誰出價不在事件內，HUD 從最新 view 讀。
    - hot-seat：`LocalGameHost` 自己用 `computerAction` 下電腦座位，每個動作一個 update；電腦行動時不送可選動作。設定畫面每個座位可選「人類／電腦」。Enter 只負責擲骰／購地／加蓋，拍賣用按鈕。
    - D1 待補完成：棋盤也畫無主地的保留建築（沒有顏色帶）。
    - 試玩用的 `TEMP-DEBUG` 掛勾（只在 dev）`richmanDebug.auction()`：把下一次擲骰改成落在對手的 5 級地上而破產，其他人給足現金；確認後已移除。
    - 實作中查到的原版規則（使用者決定在 D7 實作，見下）：破產處理在「只剩 1 人」之前還有兩個判斷——人類玩家只有 1 位且破產者是人類時遊戲結束（進入「是否繼續」）；破產後在場沒有人類時遊戲結束（回標題）。D2 加入電腦後這兩條才有意義；目前引擎只有「剩 1 人」與天數／淨值目標。
  - [x] D7（使用者在 D6 試玩後追加）：破產時的結束判斷照原版（`GAME_RULES.md` 第 1 節）。
    - 查證：人類座位數在開新局時算出、之後不變；破產者在檢查前就移出場上；檢查順序是「唯一的人類破產」→「場上沒有人類」→「只剩 1 人」，前兩者沒有勝者。顯示：前者原版開「遊戲結束、是否繼續」對話框（我們用結算框，沒有勝者），後者不開對話框直接回標題（我們直接回設定畫面）。
    - 設定畫面能否全部是電腦：限時查了設定對話框，「加入電腦」按鈕可以把座位都填成電腦，沒有看到人類數檢查（信心中），使用者決定照程式碼，允許 0 位人類；列入 ROADMAP 未解問題待原版確認。
    - `GameEnded.reason` 新增 `humanBankrupt`、`noHumansLeft`（`GameEndReason`）。
    - 影響：全部電腦的局在第一次破產就結束，所以模擬器的 `computer` 模式統計只到第一次破產；模擬器與引擎中需要「電腦局走到拍賣」的測試改用 `mixed` 或兩個人類座位。模擬器的結束原因統計加上這兩種。
    - 連線版：斷線代打的座位仍算人類，記在 ROADMAP Phase 4。
- [ ] E0、E、F

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

  「非原版」只剩數值類的暫定預設（起始資金等），以及 Phase 2 已有、標非原版的勝負條件與排名（C4b 改成原版的天數上限與淨值目標後移除）。
- **`auctionAiDoubleCoef`**：`DECISIONS.md` 步驟 5 列出主 session 親自核對過的項目，其中**沒有**電腦出價上限，筆記也只寫「coef 被乘兩次（未實測）」。所以列入 B0（下方 i 項）：
  - 確認是程式碼行為 → 固定照原版、不做選項。
  - 無法確認 → 標示查不到，停下問你。
  - 結果（B0-i）：程式碼確認，固定照原版、不做選項。
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
- **B1 `feat(shared)`：在每位玩家的第一個 `TurnStarted` 時放置；移除 `board.start` 與 `passStartBonus`；新增 `PlayerPlaced` 事件。** 沒有可選格子（B0-g，原版未處理）時不訂退路規則（使用者決定）：
  - `validateBoard` 新增檢查「可放置格數 ≥ 玩家人數上限」，可放置 = 有相鄰格、非 `noRandomPlacement`、非 `unsupported`；新增對應的驗證錯誤種類。放置時排除的「目前有人的格」最多是其他玩家數，所以執行期不可能出現 0 候選。
  - 萬一放置時仍出現 0 候選，視為內部錯誤（不靜默選格、不跳過放置），處理方式比照引擎既有的內部錯誤。
  - 測試案例：可放置格數 = 上限時通過、少 1 時失敗；`noRandomPlacement`、`unsupported`、沒有相鄰格的格子不計入；內部錯誤的路徑用繞過驗證的狀態觸發一次。
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
- **C4 `feat(shared)`：日與物價指數（固定開啟）。** state 加 `day`、`priceIndex`；所有價格乘 coef；新增 `DayAdvanced` 事件（含新的 coef）；新增不乘 coef 的 `netWorth()`，和 `totalAssets` 分開。推進時機與起始資金依 B0-a、b：
  - 日：每輪推進一次，在最後一位玩家的回合結束、座位 0 的回合開始前；座位 0 已破產時照樣推進。新局 `day` = 0，第 1 輪結束時第一次推進。
  - 起始資金（使用者決定）：`RuleConfig` 改成單一 `startingFunds`（原版設定畫面只有一個起始資金），移除 `startingCash`／`startingDeposit`；coef 的除數用 `startingFunds`。同一個 commit 改寫 `GAME_RULES.md` 第 1 節的引擎現況列，client 設定畫面與模擬器的編譯修正一併處理。
  - 開局拆成現金與存款（B0-b 查證）：
    - 人類（照原版）：現金 = 存款 = ⌊`startingFunds` ÷ 2⌋（程式以右移 1 位算出現金，存款直接沿用同一個值）。奇數時餘數 1 **不給任何一邊**，總和比起始資金少 1；coef 的除數仍是 `startingFunds`。
    - 電腦：原版是 現金 = 取整(角色範本的比例欄位 × 起始資金 ÷ 100)、存款 = 起始資金 − 現金；100 是程式內的單一常數，比例欄位來自執行檔內的角色範本表（資料表）。角色範本表匯出前，電腦**暫用人類的拆法**，標「暫定、非原版」；匯出後改依角色比例（ROADMAP「執行檔資料表匯出」）。
    - 起始資金的 6 檔選項也是資料表，隨 E0a 匯出；倉庫只放非原版預設值。
  - 測試案例（追加）：偶數時各半；奇數時現金 = 存款 = ⌊F ÷ 2⌋、總和 F − 1；電腦與人類拆法相同（暫定）；coef 除數用 `startingFunds`；`startingCash`／`startingDeposit` 已不存在（設定驗證拒絕或型別錯誤）。
  - 測試案例：新局 coef = 1；推進一日的時機；平均淨值 ÷ 起始資金取整；只升不降；破產者不算在平均內；購地、加蓋、過路費都乘 coef；淨值的地產部分不乘 coef；`viewFor` 送出 `day` 與 `priceIndex`。
- **C4b `feat(shared)`：原版勝負條件（B0-d，使用者決定改成原版）。** 不併入 C4。
  - `RuleConfig` 新增天數上限與淨值目標兩個設定，預設皆「不限」；淨值目標以「倍數 × 起始資金」表示。移除 `maxRounds` 與 `richestAtRoundLimit`（含 client 設定畫面與結算排名中對應的部分，在同一個 commit 修編譯；client 行為變更另開 commit）。
  - 只在每日推進時檢查（在更新 coef 之前）：已過天數 ≥ 天數上限（且最高淨值 > 0），或最高淨值 ≥ 淨值目標 → 結束，`netWorth()` 最高者勝，同額座位較前者勝（不並列）；其他玩家出局。
  - 6 檔數值（B0 查證）：天數上限與淨值目標倍數都是執行檔 `.data` 內的選項表（依設定索引讀表），**不是**程式碼立即值。所以走 `tools/extract` 匯出（併入 E0 的 `cli tables`），倉庫只放非原版預設的檔位；原版的第 1 檔「不限」是結構，可照寫。
  - 模擬器：另設僅限模擬器的安全上限（例：天數），不放進 `RuleConfig`，觸發時記為「未結束」而不是失敗；統計時明確指定天數上限（例：`--day-limit`），結果寫進「模擬器觀察」時註明。
  - 測試案例：預設不限時不會因天數結束；天數上限到達的那一日結束、前一日不結束；淨值目標達到時結束；同額時座位較前者勝；最高淨值 ≤ 0 時天數上限不結束；只在每日推進時檢查（回合中途淨值超過目標不立即結束）；破產淘汰仍照舊立即結束；`viewFor` 送出兩個設定。
- **C5 `feat(client)`：HUD 顯示日期與物價指數；價格改用引擎 helper；事件紀錄文字。** 🎮 試玩。

### 批次 D：破產拍賣
- **D1 `feat(shared)`：破產時地產全部變無主、保留建築等級**（先不拍賣）。不變量刪掉「無主地等級必為 0」；client 的 `display.ts` 在同一個 commit 修（C1 待補：`PropertyBought` 目前把等級設成 0，要改成保留原等級，引擎自 C1 起購地時保留等級）。
  - 測試案例：釋出的地保留等級；之後購買時價格含建築；`PlayerBankrupt.releasedTiles`。
- **D2 `refactor(shared)`：`controller`（加在 `PlayerSetup`／`PlayerState`）與 `actorOf`。** `applyAction`／`legalActions` 改用 `actorOf`；這個 commit 不改變行為。
  - 測試案例：非拍賣時和原本一樣；`controller` 格式錯誤時 `createGame` 失敗；`viewFor` 送出 `controller`。
- **D3 `feat(shared)`：拍賣階段與 `bid{raise}`／`passRound`／`withdraw` 動作；全域池累計欄位。**
  - 最高出價者（B0-f）：在領先時不會再輪到，不需要退出的分支；不變量加「輪到的人不是最高出價者」。
  - 拍賣所得與系統債務餘款（B0-h）：原版進彩券獎池。state 加累計欄位 `lotteryPool`（不影響玩法、不直接勾銷），`viewFor` 暫不送；開獎與號碼屬 ROADMAP Phase 5 彩券。
  - 測試案例：
    - 3 塊以下不拍賣；超過 3 塊時用 RNG 不重複抽 3 塊，依抽中順序拍。
    - 起標價 = 取整(地價 × (1 + 0.5 × 等級)) × coef。
    - 資格：現金 ≤ 起標價、已破產的人排除；沒有人有資格時直接流標。
    - 從座位最前面的參加者開始輪流；5 檔加價；現金不足時那一檔不會出現；加價後清除所有人的「本輪放棄」；輪到時現金低於目前價者自動退出。
    - 結標：只剩 1 位參加者、或只剩 1 位沒有放棄，且已有最高出價者。全部放棄或退出則流標。
    - 得標者付款（先現金後存款）、過戶、等級不變；拍完一塊接下一塊；全部拍完才 `endTurn`。
    - 所得與系統債務餘款進 `lotteryPool`。
    - 錯誤的行動者、錯誤的 phase 被拒絕；拍賣中 `turn.current` 可以是已破產的人。
    - `viewFor`：拍賣 phase 的公開欄位會送出；尚未開拍的地塊與 `lotteryPool` 不送。
- **D4 `feat(shared)`：電腦出價與 `computerAction`。** 每塊開拍時用 RNG 算各電腦的上限，存在 phase 的隱藏欄位。coef 乘兩次（B0-i 已確認，照原版固定）。
  - 測試案例：三個上限取最小值；同街自有數；一般地塊的無主比例；選最大的一檔；「領先者現金 + 500」時改用較小的檔；開拍時只有 1 位有資格的參加者時整場固定加 100（中途剩 1 人不算）；連 100 都超過時放棄；`computerAction` 的結果一定在 `legalActions` 內；`viewFor` 看不到上限。
  - 電腦購地與加蓋：暫時用固定的非原版策略（例：付得起就買、付得起就加蓋）。同一個 commit 在 ROADMAP Phase 5 列為待逆向項目。
- **D5 `feat(sim)`：模擬器支援帶參數的動作、改用 `actorOf`、`--controllers random|computer|mixed`。** 見問題 4。
- **D6 `feat(client)`：拍賣面板（目前價、最高出價者、5 檔按鈕、放棄、退出）；hot-seat 切到輪到出價的人；intent 帶參數；設定畫面可把座位設成電腦，由 `LocalGameHost` 呼叫 `computerAction`。** 🎮 試玩（拍賣需要較多回合才會出現，會提供一個容易觸發破產的種子或設定）。

### 批次 E0：執行檔資料表匯出（ROADMAP 項目）
- **E0a `feat(extract)`：`cli tables` 把動畫三表、道具表與設定選項表（起始資金、天數上限、淨值目標倍數）匯出到 `local-assets/tables.json`。** 用合成的假 exe 片段寫單元測試；交給 subagent 分析時，回報只含結構。
  - B2 待補：一併查原版玩家出場（第一回合放置）的表現與時間，取代 `timings.ts` 的 `DURATIONS.placed`（500 ms，非原版）。
  - D6 待補：查原版拍賣對話框的開場、各角色出價動畫（加價、本輪放棄、退出）與流標的表現和時間，取代 `timings.ts` 的 `DURATIONS.auctionOpen`／`auctionBid`／`auctionUnsold`（700／600／600 ms，非原版）。
- **E0b `feat(shared)`：`OriginalTables` 型別與 `parseOriginalTables`。**
  - 測試案例：合法的假資料；欄位缺少、型別錯誤、長度錯誤時回傳錯誤清單、不 throw。

### 批次 E：交通工具與選顆數
- **E1 `feat(shared)`：`vehicle: 'walk' | 'motorbike' | 'car'`、`startingVehicle`（全體共用）、`vehicleMaxDice`；開局把顆數設為上限；移除 `defaultDiceCount`。** 臨時交通工具延到 Phase 5。
  - `viewFor` 送出 `vehicle` 與 `diceCount`。
- **E2 `feat(shared)`：人類在 `awaitRoll` 可用 `setDiceCount{count}`（只限機車和汽車，範圍 1 到上限）；顆數在之後的回合沿用。**
  - 測試案例：合法範圍；步行時不提供這個動作；超出範圍時 `invalidAction`；錯誤的 phase；之後的回合沿用。
- **E3 `feat(shared)`：電腦選顆數。** 回合開始時算出（需要的 RNG 先抽好並隱藏），由 `computerAction` 送出。岔路依 B0-c：預覽遇到岔路時用 RNG 隨機選一個候選（同實際移動，含在預先抽好的值內），死路掉頭；「是否遇過岔路」不影響判斷。
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
- 拍賣：出價者有資格且未退出；有最高出價者時目前價 > 起標價、且 ≤ 最高出價者的現金；拍賣的地都是無主地；`turn.current` 只有在拍賣中才可以是破產者；只有電腦參加者才有隱藏上限；`lotteryPool` ≥ 0。
- 顆數在 1..交通工具上限之間。

**模擬器每一步的檢查**
- 改用 `actorOf`；帶參數的動作從 `legalActions` 枚舉；沒提供的動作類型各造一個範例，確認被以 `wrongPhase` 拒絕。
- coef 跨步不下降。
- `computerAction` 的結果 ∈ `legalActions`。
- 每位玩家的 `viewFor` 序列化後不含 `rngState`、電腦的隱藏欄位與 `lotteryPool`（防止外洩）。
- 單一拍賣的動作數上限（防止無窮出價）。

**統計（新增）**
- 局長：輪數的平均、中位數、p90；`lastStanding` 未結束的比例。
- 每局破產次數；第一次破產發生在第幾輪。
- 物價指數：最終 coef 的平均與最大值、coef 第一次大於 1 的輪數、終局天數。
- 拍賣：場數、每塊的成交率與流標率、成交價 ÷ 起標價；`lotteryPool` 終值。
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
| C4b | 天數上限、淨值目標（`RuleConfig`） | 送 |
| D | `controller` | 送 |
| D | 拍賣 phase：目前地塊、起標價、目前價、最高出價者、輪到誰、各參加者的狀態（參加／本輪放棄／退出）、剩餘塊數 | 送 |
| D | 尚未開拍的地塊清單（由 RNG 抽出） | 不送（只送剩餘塊數） |
| D | 電腦出價上限 | 不送 |
| D | `lotteryPool`（彩券獎池） | 暫不送（使用者決定；Phase 5 實作彩券時再定） |
| E | `vehicle`、`diceCount` | 送 |
| E | 電腦選顆數預先抽好的值 | 不送 |

## 驗證
- 每個 commit：`pnpm format && pnpm test && pnpm lint && pnpm typecheck`（用管線過濾時先 `set -o pipefail`）。
- 每批結束：`pnpm -F sim sim -- --games 1000 --seed 1`，兩種勝負條件（C4b 之後改成：不限＋模擬器安全上限、明確指定的天數上限）、兩張測試地圖都沒有失敗；`pnpm test:coverage` 的 shared 覆蓋率 ≥ 90%；停下來提醒你輸入 `/wrap-up`。
- 🎮 B2、C5、D6、E4：`pnpm -F client dev` 試玩，確認後把你的回饋併進同一個 commit。
- 全部完成：`pnpm -F client build` 的產物不含素材；推送前提醒你輸入 `/pre-push`。
