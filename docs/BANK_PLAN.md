# 銀行格與存提款：階段 2 分批實作計畫

（2026-10-15 使用者核准。進度、與計畫的差異、實作中發現的待補項寫在文末「進度」。）

## Context
引擎目前的現金只減不增：過路費進存款、付款先扣現金，而購地、加蓋與拍賣資格都只看現金。所以後期每個人都卡住，模擬器 1.8 萬塊上拍的地沒有一塊有人能出價。原版的解法是銀行格：經過或停留時可存提款，電腦依角色比例重新分配；停留時另有貸款；每月初存款計息。這些規則已由逆向步驟 10、10b 查完（`GAME_RULES.md` 第 2 節「日」「日曆」、第 4 節銀行、第 8 節「貸款與破產」）。

本計畫把它們分批實作，最後用模擬器和 F1 比較表對照。ROADMAP「銀行格與存提款」指向本檔。

使用者已決定：
- 開局日期放 `RuleConfig`，預設 2010/1/1，範圍 1998/1/1–2010/12/31。
- 農曆用自己實作的演算法**預先產生精簡表**（1998–2199），在本機和原版表逐筆比對；超過 2199 年視為內部錯誤。
- 電腦的角色由呼叫端用開局種子隨機選，記在 GameSetup。
- 沒有匯入 tables.json 時，電腦用暫定比例：現金 50%、借款 50%（非原版）。

**建議拆成「存提款」（批次 2）與「貸款與利息」（批次 3）兩批**，理由：
- 存提款單獨就能解決「現金只減不增」。
- 貸款會改淨值，連帶影響物價指數、勝負判定與破產。拆開後，模擬器的變化才分得清是哪一批造成的。

## 共通做法
- 測試先行（CLAUDE.md 第 3 條）。每個 commit 前跑 format → test → lint → typecheck。
- 單精度模擬：中間值用 `Math.fround`。「整數 × 單精度」這類原版在 x87 延伸精度下是精確值的乘積，用 BigInt 精確乘法再無條件捨去（例：total × t、deposit × 1.1）。測試要涵蓋「精確計算和 double 結果不同」的案例。
- 電腦的銀行處理（重新分配、借還款）是引擎內的自動效果，不經過 phase 或動作，和 `pay` 一樣是決定性的，重播結果相同。需要的亂數（借款判定的 `rand % 10`）在處理當下從 `rngState` 抽。這點寫進 DECISIONS。
- 金額型動作的 `legalActions`：金額無法逐一列舉。新增 `LegalAction` 型別，在 `Action` 之外多一種範圍選項（`{ type: 'bankTransfer'; direction; max }` 等）；`ServerUpdate.legalActions` 改用它，`LocalGameHost` 改用 `allows(option, intent)` 比對。模擬器對每個範圍選項檢查 1、max、隨機中間值都會被接受，max + 1 會被拒絕。
- 新的 state 欄位預設不進 `viewFor`。要送的明確加入：`date`、玩家的 `loan`／`loanDue`（和現金一樣公開）、銀行 phase。電腦的 `profile` 不送。

## 核准時的補充（使用者，2026-10-15）
1. 農曆除了和原版表逐筆比對，2021 年以後另外和公開的官方農曆資料（例：香港天文台年曆）抽樣比對一次，結果記在產生器說明中（批次 1-2）。
2. `computerAction` 的 switch 要處理 `bank`、`bankCounter` phase，暫時回傳 `leaveBank`／`leaveCounter`（Phase 4 的斷線代打與模擬器 mixed 都會遇到人類座位在這些 phase）。ROADMAP Phase 4 記一筆「代打座位在銀行的行為待定」（批次 2-4、3-4）。
3. GameSetup 會含匯入的角色比例，所以模擬器的失敗紀錄與 replay 檔只能寫進 gitignored 的 `tools/sim/out/`（目前已是如此）。另開 `chore` commit 補強 `/pre-push`：檢查每個 commit 都沒有 `tools/sim/out/` 底下的檔案與 `tables.json`（批次 2-6 之前完成）。
4. 批次 2 的前置查證（加入電腦的角色選法）限 0.5 輪。

## 批次 1：日曆與農曆
1. **feat(shared): 日曆模型**
   - 新增 `calendar.ts`：`CalendarDate {year, month, day}`、日序（1998/1/1 = 0）與日期互換、`addDays`、`daysBetween`、`weekday`（(日序 + 4) mod 7）、`daysInMonth`（閏年只看 % 4）、`nextDay → {date, monthChanged}`、`isValidDate`。
   - `RuleConfig.startDate`，預設 2010/1/1，驗證範圍與日期合法（新錯誤 `invalidStartDate`）。
   - `GameState.date`；`advanceDay` 推進日期；`DayAdvanced` 加 `date`；`viewFor` 送出日期。
   - 不變量：日序(date) − 日序(startDate) == day。
   - 呼叫端與模擬器 replay 檔的 config 一起更新。
2. **feat(extract): 農曆演算法與產生器**
   - 依公開文獻（Meeus《Astronomical Algorithms》的朔望與太陽黃經公式）自己實作，不用第三方程式碼或資料，參考文獻記在 DECISIONS。
   - 規則：月首為朔日（UTC+8 日期）、冬至所在月為十一月、13 個月的歲中第一個無中氣月為閏月。
   - 產生器輸出 `packages/shared/src/lunar-data.ts`（每農曆年一個整數：月大小位元與閏月），附產生指令，並寫進 CLAUDE.md 常用指令。
   - 測試：已知朔望時刻、公開的農曆新年日期（公開事實，非原版資料）。
3. **feat(shared): 農曆查表** `lunarDate(serial)`；超出表的範圍就 throw（內部錯誤）。
4. **本機比對**（`pnpm -F extract cli lunar-check`，讀 `RICHMAN4_DIR`，只印筆數與是否完全一致）：
   - 完全一致：GAME_RULES 註明「與原版表在其範圍內逐筆一致」。
   - 有不一致：**停下回報**。依使用者決定改由 extract 匯出原版表，超出範圍怎麼處理再問。
5. **feat(shared): 節日規則**
   - `HolidayRule`：`restDay`、`disabled`、`date` 三種之一（`solar` / `lunar` / `nthWeekday`）、`event`（原始值，暫不用）。
   - `Board.holidays?`（最多 24 筆）；`validateBoard` 檢查欄位。
   - `isSundayOrHoliday(date, holidays)`：只用第一筆符合且未停用的；第 n 個星期 w 的「改成 7」照原版。
   - 內建測試圖各加一兩筆自編節日。

## 批次 2：存提款
1. **前置查證**（不 commit，記在 notes）：原版「加入電腦」選角色的範圍（12 個全選，還是只選未用的）。查不出來就問使用者。
2. **feat(shared): 銀行格**
   - `TileDef` 加 `kind: 'bank'`（可放置，同原版）。
   - 測試環狀圖 4 個角落中的 2 個、分岔圖 1 個空白格改成銀行，調整受影響的測試。
   - ROADMAP「原版地圖轉成可玩 Board」註明種類碼 14 → bank。
3. **feat(shared): 電腦角色比例與開局拆法**
   - `PlayerSetup` 改成可辨識聯合型別：電腦座位必填 `profile: {cashPercent, loanPercent}`（0–100）。
   - 匯出 `PROVISIONAL_COMPUTER_PROFILE = {50, 50}`（非原版）。
   - 開局時電腦現金 = trunc(cashPercent × (funds / 100))（倍精度），存款 = 起始資金 − 現金。
   - 更新 GAME_RULES 第 1 節的「引擎：」段落。
4. **feat(shared): 經過與停留觸發、人類存提款**
   - `advance` 改成可暫停、可接續：人類經過銀行時，在該格切開 `PlayerMoved`，進入 phase `bank {tile, trigger: {kind:'pass', stepsLeft} | {kind:'land'}}`。
   - 動作：`bankTransfer {direction, amount}`（1..上限）與 `leaveBank`（取消，或確認金額 0）。一次只做一筆。
   - 經過時處理完，走完剩下的步數（可能再遇到銀行）；停留時結束回合，批次 3 會在這裡接櫃檯。
   - 事件：`BankOpened`、`BankTransferred`。
5. **feat(shared): 電腦重新分配**
   - 純函式 `rebalance(cash, deposit, cashPercent, dayOfMonth)`：用 fround，夾限只有 t ≥ 1 → 0.9、t = 0 → 0.1；日 ≤ 7 時 ×1.5、日 ≥ 26 時 ×0.5；差距 ≥ 0.25 或現金為 0 才重分；total 0 時不變。
   - 經過與停留都觸發；有改變時發 `BankRebalanced`。
6. **feat(sim): 模擬器**
   - 隨機 AI 會用銀行動作。
   - `--tables <path>`：用 `parseOriginalTables` 讀取；每個電腦座位的角色由模擬器種子隨機選。
   - 統計：經過／停留銀行次數、存提款、重新分配。
   - 不變量：搬錢前後總額不變。
7. **feat(client): 存提款畫面與日期顯示（🎮，停下等目視確認後才 commit）**
   - 提款／存款兩種模式；數字鍵最多 9 位，超過上限改成上限；C、M、退格；34 格拉桿依原版公式；確認／取消。
   - HUD 顯示日期與星期。
   - 匯入 tables.json 後，設定畫面依種子為電腦選角色，只顯示「角色 N」。文字放 i18n，自編。

## 批次 3：貸款與利息
1. **前置查證**（主 session 親自讀反組譯，記在 notes；查不到就問）：
   - 櫃檯一次能做幾筆、數字輸入框（0x00453544）的規則。
   - 每回合的到期檢查和 DailyTick、放置的先後順序（0x00418ebd）。
   - 常數 0x00464b24、0x00464e88 是單精度還是倍精度，乘法在哪個精度下做。
2. **feat(extract)+feat(shared): tables.json v2**
   - `characters.loanPercent`（範本 +0x18）。
   - 每張地圖的節日表，轉成 `HolidayRule` 的原始形式。
   - `parseOriginalTables` 改成 v2（v1 回 `unsupportedVersion`）。
   - 客戶端與模擬器的 `--tables` 接上；更新 ASSET_FORMATS。
3. **feat(shared): 貸款狀態與破產**
   - `PlayerState.loan`、`loanDue: CalendarDate | null`；`netWorth` 扣掉貸款。
   - 新的債務種類 `loan`：先扣存款、再扣現金，不足的部分勾銷，不進彩券獎池。`BankruptcyCause` 加 `loan`。
   - 破產時貸款與到期日一起清零。
4. **feat(shared): 人類櫃檯**
   - 停留時存提款結束後進入 phase `bankCounter`。
   - 動作：`borrow`（1..淨值 − 貸款；貸款 ≥ 淨值時不提供，並發「超過額度」事件）、`repay`（1..min(貸款, 現金 + 存款)）、`leaveCounter`。
   - 到期日：第一次借款時設為 90 天後，遇到週日或節日往後順延；還清時清除。
5. **feat(shared): 電腦自動借還款**
   - 停留、重新分配之後執行。
   - 沒有貸款時抽 `rand % 10`；條件成立就借 trunc(loanPercent × 淨值 / 100)。
   - 有貸款時，符合原版條件就全額還款，到期日不清除。
6. **feat(shared): 到期處理**
   - 每次輪到該玩家時檢查：剩 3 天時人類收到提醒事件；剩 2、1 天時發提醒事件；當天強制還清（可能在回合開始時就破產，走既有的破產流程）；過了到期日不處理。
7. **feat(shared): 月初利息**
   - 換月時，在物價指數更新之後執行：沒有貸款的在場玩家，存款 = trunc(存款 × 1.1)，用精確乘法。
   - 事件 `MonthStarted`：每位玩家的利息金額，或「貸款中」。
8. **feat(sim)**：隨機 AI 會用櫃檯動作；統計借款與還款；不變量 `loan ≥ 0`。
9. **feat(client): 櫃檯、到期提醒、月初報表（🎮，停下等確認）**；訊息停留時間 1500 ms 放進 `timings.ts`。

## 批次 4：比較與收尾
1. **docs: 模擬器比較**
   - 條件同 F1 表（隨機 AI、步行、種子 1、各 1000 局、兩張圖 × 100 日／不限天數），另加 `--controllers mixed` 有無 `--tables` 兩組。
   - 新增一張表，和 F1 表並列：局長、破產次數、拍賣有資格出價與成交的塊數、物價指數最大值。
   - 寫進 GAME_RULES「模擬器觀察」，只記數字，原因沒分析就寫「原因未分析」。
2. **docs: 收尾**
   - ROADMAP 勾選前先把內文改成實際完成的內容，沒做的移到對應項目，**先問使用者再勾**。
   - DECISIONS 寫完成紀錄；ARCHITECTURE 更新狀態轉移圖、`LegalAction` 與銀行 phase。
   - 刪除 `BANK_PLAN.md` 並移除 ROADMAP 的指向。

## 主要修改檔案
- `packages/shared/src/`：`calendar.ts`（新）、`lunar-data.ts`（產生）、`config.ts`、`state.ts`、`board.ts`、`engine.ts`（advance、resolvePass/Landing、advanceDay、startTurn）、`money.ts`（netWorth、新債務種類）、`actions.ts`、`events.ts`、`view.ts`、`protocol.ts`、`tables.ts`、`invariants.ts`、`computer.ts`、`maps/*`、`testing.ts`（helper 擴充）。
- `tools/extract/src/`：`exe-tables.ts`（v2）、農曆演算法、產生與比對指令。
- `tools/sim/src/`：`args.ts`、`game.ts`、`simulate.ts`、`stats.ts`。
- `apps/client/src/`：`net/local-host.ts`、`ui/`（新的 bank-panel、counter-panel）、`ui/hud.ts`、`ui/setup-screen.ts`、`assets/original-tables.ts`、`i18n/zh-TW.ts`、`render/timings.ts`。
- 文件：GAME_RULES、DECISIONS、ROADMAP、ARCHITECTURE、ASSET_FORMATS、CLAUDE.md（指令）。

## 驗證
- 每個 commit：`pnpm test && pnpm lint && pnpm typecheck`。shared 的覆蓋率維持 ≥ 90%（`pnpm test:coverage`）。
- 每批結束：`pnpm -F sim sim -- --games 1000 --seed 1` 搭配兩張圖、三種座位，以及有無 `--tables`，全部不能失敗；失敗時用 replay 重現。
- 農曆：`pnpm -F extract cli lunar-check` 必須完全一致，否則停下。
- 🎮 commit：`pnpm -F client dev` 實際操作，經過與停留銀行、存提款、櫃檯、到期提醒、月初報表都試一次，再請使用者目視確認。

## 進度

- 批次 1：進行中。
  - 1-1 日曆模型完成（`calendar.ts`、`RuleConfig.startDate`、`GameState.date`、`DayAdvanced.date`、不變量）。舊的模擬器失敗紀錄沒有 `startDate`，replay 時會被設定驗證拒絕（只在本機，不另做相容）。客戶端顯示日期併入 2-7。
