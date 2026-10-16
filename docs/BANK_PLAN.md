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
- 浮點模擬（依 3-1 查證更正）：原版啟動時把 FPU 控制字設為 0x127F（53 位元倍精度），之後沒有持續的改寫。原版存成單精度的中間值用 `Math.fround`；其餘照原版的運算順序用 JS 倍精度計算後無條件捨去（例：total × t、deposit × 1.1、loan × 1.1 ≤ 現金 + 存款）。測試要涵蓋「精確計算和倍精度結果不同」的案例。（原本的「整數 × 單精度在延伸精度下是精確值，用 BigInt 精確乘法」前提不成立。）
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
   - 換月時，在物價指數更新之後執行：沒有貸款的在場玩家，存款 = trunc(存款 × 1.1)，用倍精度（1.1 是原版的倍精度常數；對 32 位元金額與精確計算的結果相同，見 3-1）。
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

- 批次 1：完成。
  - 1-1 日曆模型完成（`calendar.ts`、`RuleConfig.startDate`、`GameState.date`、`DayAdvanced.date`、不變量）。舊的模擬器失敗紀錄沒有 `startDate`：紀錄格式版本改為 6，replay 舊檔時明確說明缺 `startDate`（不另做相容）。客戶端顯示日期併入 2-7。
  - 1-2 與 1-4 合併成一個 commit（產生器說明要引用比對指令）：農曆演算法、產生器 `pnpm -F extract lunar-gen`、`packages/shared/src/lunar-data.ts`（1997–2199，列進 `.prettierignore`，由 extract 的測試確認與產生器一致）、`pnpm -F extract cli lunar-check`。本機比對 8399 筆全部一致；香港天文台抽樣 16 年 5841 日全部一致。
  - 1-3 `lunarDate`（shared 查表）完成。
  - 1-5 節日規則完成（`holidays.ts`、`Board.holidays`、`validateBoard` 的 `tooManyHolidays`／`invalidHoliday`）；內建測試圖加了自編節日。客戶端尚未使用。
- 批次 2：進行中。
  - 2-1 查證完成（逆向步驟 10c，約 0.3 輪）：原版「加入電腦」只從尚未被任何座位使用的角色中均勻隨機選，角色不重複；已寫進 GAME_RULES 第 1 節。使用者決定：2-3、2-6、2-7 依種子為電腦**不重複**抽角色；人類座位目前沒有角色，只在電腦之間不重複。ROADMAP 另記「人類座位選角色」（Phase 4 之前）。
  - 2-2 銀行格完成：`BankTileDef`（`kind: 'bank'`，可放置）；環狀圖角落 5、15，分岔圖 23（原「測試中路尾」）改成銀行。效果尚未實作，現有測試不受影響、未調整。客戶端目前把銀行畫成空白格的顏色，畫面區分併入 2-7。
  - 2-3 完成：`profile.ts`（`CharacterProfile`、`PROVISIONAL_COMPUTER_PROFILE`、`isValidProfile`、`openingSplit`）；`PlayerSetup` 改成聯合型別，新錯誤 `invalidProfile`；`PlayerState.profile`（人類 null）與不變量。與計畫的差異：`viewFor` 原本整筆展開玩家物件，加 `profile` 時會外洩，改成 `PlayerStateView` 逐欄複製。模擬器紀錄格式版本改為 7（舊檔說明缺 profile）。客戶端與模擬器的電腦座位暫用 `PROVISIONAL_COMPUTER_PROFILE`，`--tables` 與設定畫面接上在 2-6、2-7。
  - 2-4 完成：`bank` phase（`trigger: pass{stepsLeft} | land`）、`bankTransfer`／`leaveBank`、`BankOpened`／`BankTransferred`、`LegalAction` 與 `allows`（DECISIONS 2026-10-16）。`advance` 改成 `walk`（走完直接接停留處理，經過人類的銀行時在該格暫停）。與計畫的差異：模擬器與客戶端必須跟著 `LegalAction` 改，所以提前做了最小部分：模擬器隨機 AI 會選範圍內的隨機金額、`checkStep` 檢查範圍（1、中間值、max 接受，max + 1 以 `insufficientFunds` 拒絕；中間值固定取 ⌈max ÷ 2⌉ 而非隨機）；客戶端 `LocalGameHost` 改用 `allows`，HUD 暫時只顯示「離開銀行」（存提款畫面在 2-7），事件紀錄與顯示模型處理兩個新事件。模擬器的統計與 `--tables` 仍在 2-6。待補（2-6）：模擬器 `HIDDEN_KEYS` 加 `profile`。使用者決定：轉帳金額小於 1 為 `invalidAction`，超過可動用的金額為 `insufficientFunds`（和拍賣加價一致）；未提供動作的拒絕依 ARCHITECTURE 錯誤優先順序判斷（另開的 `fix(sim)` commit）。模擬器 1000 局 × 兩張圖 × 三種座位全部通過；拍賣有出價者的比例從 0 升到 63–90%。
  - calendar 兩世紀測試逾時：量得轉換是常數時間（約 0.5–1.3 µs），慢在 16 萬次 `expect`；使用者決定改寫測試（收集不一致後一次比對，約 26 ms），另開 `test(shared)` commit。
  - 2-5 完成：`bank.ts` 的 `rebalance`（`Math.fround`、精確乘法）與 `BankRebalanced`；電腦經過與停留銀行都觸發，經過時有改變才切開 `PlayerMoved`；不消耗亂數（DECISIONS 2026-10-16）。精確乘法和倍精度只在總額超過約 2^29 時才可能不同（原版 32 位元金額達不到），測試用大金額案例涵蓋。客戶端顯示模型與事件紀錄處理新事件。模擬器紀錄格式版本改為 9。
  - 2-6 前置：`/pre-push` 的逐 commit 素材檢查加上 `tools/sim/out/` 與任何 `tables.json`（現有歷史中沒有這類檔案）。
  - 2-6 完成：`--tables <path>`（`parseOriginalTables` 讀取；每局以 `characterSeedFor(遊戲種子)` 為電腦座位不重複抽角色，紀錄檔的 `players` 含抽到的比例，replay 不需要原檔）；統計每局人類開啟銀行（經過／停留）、提款／存款次數與平均金額、離開次數、電腦重新分配次數；新檢查 `bankChangedTotal`（重新分配用事件的新金額、轉帳用動作後的狀態比對現金 + 存款，replay 同樣檢查）；`HIDDEN_KEYS` 加 `profile`。與計畫的差異：`tables.json` v1 沒有借款比例，電腦的 `loanPercent` 暫用暫定值，批次 3-2 匯出 v2 後改用原版。隨機 AI 的銀行動作已在 2-4 做完。兩張圖 × 三種座位 × 有無 `--tables` 各 1000 局全部通過。
  - 2-7 完成（使用者目視確認）：`ui/bank-panel.ts`（提款／存款模式、數字鍵最多 9 位且超過上限改成上限、C／M／退格、34 格拉桿依原版公式、確認／取消；開著時實體鍵 0–9、Backspace、Enter、Esc 也可用；切換模式歸 0；確認金額 0 等於離開）；HUD 顯示日期與星期；銀行格在棋盤上用自己的顏色、格子資訊說明用途。匯入 `tables.json` 後設定畫面的電腦座位顯示「角色 N」（有填種子時預覽，空白時顯示開局時抽選），HUD 玩家名稱後加「（角色 N）」。與計畫的差異：抽角色與「資料表 → 比例」移到 shared（`drawCharacters`、`profilesFromTables`），模擬器改用它們（結果不變），兩者只在開局前由呼叫端使用。使用者回饋「拉桿會隨輸入的數字移動」，逆向步驟 10d 查證屬實（重畫時填滿到 trunc(金額 ÷ 上限 × 34) 格），照原版實作並寫進 GAME_RULES。上限 0 時原版未定義：使用者決定停用上限 0 的模式、預設開存款模式（為避開未定義行為的調整，寫在 GAME_RULES 第 4 節）；現行實作已是如此。
- 批次 3：進行中。
  - 3-1 查證完成（逆向步驟 10e，約 0.6 輪，不 commit）：
    - 櫃檯每次停留最多成功借或還一筆，成功後關閉；取消（輸入 0、輸入框右鍵）與超過額度回到選單；還款金額超過現金 + 存款時提示「現金不足」後重新輸入。
    - 數字輸入框：鍵盤規則同存提款畫面，回傳 0..上限（0 = 取消），還款的上限是貸款餘額；拉桿 34 個位置，金額 = trunc(上限 × float32(i ÷ 33))，重畫填到 trunc(float32(金額 ÷ 上限) × 33)，H 鍵跳到第 17 個位置。
    - 每回合：換人 →（繞回座位 0 時）DailyTick → 新玩家的到期檢查 → 其他狀態倒數 → 之後畫場景時才放置；未放置的玩家沒有貸款，放置與到期檢查的先後不影響結果。
    - 0x00464b24、0x00464e88 都是倍精度 1.1。FPU 控制字啟動時設為 0x127F（53 位元倍精度），之後沒有持續的改寫：`openingSplit` 的倍精度假設正確；重新分配的「精確乘法」與原版不同。
  - 使用者決定（3-1 回報後）：
    - 重新分配改用倍精度（另開 `fix(shared)` commit），共通做法、GAME_RULES、DECISIONS 一併更正。
    - 客戶端存提款拉桿改照原版倍精度寫法（另開 `fix(client)` commit）；櫃檯輸入框的拉桿與 H 鍵在 3-9 照原版公式做。
    - 還款：合法上限 = min(貸款, 現金 + 存款)；超過現金 + 存款但不超過貸款為 `insufficientFunds`，超過貸款為 `invalidAction`；現金 + 存款為 0 時不提供還款（避開必定失敗的操作，與上限 0 的模式同類，寫進 GAME_RULES）。
    - 回合開始時強制還款造成破產之後的流程：追 0.5 輪，查不到就問，不先照既有流程實作。
  - `fix(shared)`：`rebalance` 的總額 × 目標改成倍精度（`Math.trunc(total * target)`），測試改用 32 位元範圍內精確與倍精度不同的案例（修正前斷言失敗）。
  - `fix(client)`：存提款拉桿格數改成原版的倍精度寫法 `trunc(金額 ÷ 上限 × 34)`。可證明和原先的精確計算結果完全相同（只有恰在格上時可能不同，而 (k ÷ 34) × 34 在倍精度下對每個 k 都回到 k），所以沒有修正前會失敗的測試；測試改成檢查每個恰在格上的金額。櫃檯輸入框的 float32 × 33 則確實和精確計算不同（恰在格上的 k = 17、19、…、31 會顯示成前一格），3-9 實作時要有對應測試。
  - 強制還款破產後的流程（使用者要求補查，約 0.3 輪，逆向步驟 10e C）：破產（含拍賣與結束判斷）在到期檢查中同步完成，回合開始處理看到破產者就不畫場景、不擲骰，直接換下一位。與既有「破產後結束回合」相同，3-6 照此實作。
  - 3-2 完成：`tables.json` v2（`characters[].loanPercent` = 範本 +0x18；`holidays[地圖索引][24]` 原樣匯出 12 bytes 的各欄位），`parseOriginalTables` 改 v2（v1 回 `unsupportedVersion`）；`profilesFromTables` 改用原版借款比例，客戶端設定畫面與模擬器 `--tables` 因此自動接上。新增 `originalHolidays`：略去原版永遠找不到的筆（結果相同），星期 ≥ 7 而可能成立的筆回報無法表示。與計畫的差異：節日表目前沒有呼叫端（原版地圖還不能玩），轉換函式與 ROADMAP「原版地圖轉成可玩 `Board`」的說明先備好。本機匯出：8 張圖全部可轉換，共 119 筆規則（123 筆非空 − 1 筆停用 − 3 筆農曆日大於 30）。
  - 3-3 完成：`PlayerState.loan`／`loanDue`（`viewFor` 公開、客戶端顯示模型與 `diffDisplay` 跟著加）；`netWorth` 扣貸款；`pay` 新增債務種類 `loan`（先扣存款再扣現金、減少貸款，超過貸款餘額是呼叫端錯誤；不足時破產，原因 `loan`，餘款不給任何人）；所有破產清掉貸款與到期日。不變量：貸款為非負整數、有貸款就有到期日、到期日合法、破產者沒有貸款或到期日（貸款 0 但保留到期日是允許的，電腦還款照原版不清）。與計畫的差異：`pay(loan)` 成功時不發事件，由 3-4 起的呼叫端發自己的事件（說明為何還款）。
  - 3-4 完成：`bankCounter` phase（停留時存提款之後，`CounterOpened`）；`borrow`／`repay`／`leaveCounter`，一筆後結束回合；`LoanBorrowed`（到期日 `loan.ts` 的 `loanDueDate`：90 天後跳過週日與休假日，已有到期日時沿用）、`LoanRepaid`（`by: 'counter'`，還清時清到期日）；範圍選項 `LoanOption`，`isAmountOption`／`actionFor` 讓模擬器、客戶端與測試 helper 一般化處理範圍。使用者決定的還款範圍與錯誤碼照做，GAME_RULES 註明「現金 + 存款為 0 不提供還款」的調整。與計畫的差異：
    - 「超過額度」不發事件：原版在按下借款時才顯示，引擎無從得知；客戶端可依公開的淨值與貸款判斷（3-9）。
    - 和 2-4 一樣先做最小的模擬器與客戶端部分：模擬器隨機 AI 會選櫃檯動作（隨機金額），範圍檢查一般化（還款 max + 1 依情況是 `invalidAction` 或 `insufficientFunds`），`LoanBorrowed`／`LoanRepaid` 列為改變總額的事件；客戶端顯示模型與事件紀錄處理三個新事件，HUD 暫時只顯示「離開櫃檯」（借還款畫面在 3-9）。統計在 3-8。
    - 隨機 AI 現在會借款，但到期處理還沒做（3-6），模擬器兩張圖 × 三種座位各 300 局全部通過。
  - 3-5 完成：電腦停在銀行、重新分配之後自動借還款（`engine.ts` 的 `computerLoan`，判斷在 `loan.ts`：`computerBorrowAmount`、`computerRepays`）。沒有貸款時抽一次 `nextInt(10)`（結果不論都抽，與原版相同）；借款沿用已保留的到期日；還款不清到期日；1.1 倍以倍精度比較（測試涵蓋貸款 50、總額 55 不還的案例）。經過銀行時不處理。既有兩個電腦停在銀行的測試多留一個亂數。模擬器兩張圖 × mixed／computer 與 `--tables` 各 300 局全部通過。
  - 偶發逾時（記錄，非本批造成）：整體 `pnpm test` 一次出現 4 個逾時（`engine.legal.test.ts` 的 holds through bankruptcy auctions、模擬器 `game.test.ts` 的 plays clean games on the branch board、`simulate.test.ts` 的兩個 plays clean games），單獨跑時修改前後都約 1–1.6 秒，重跑整體通過；推測是當時機器負載。
