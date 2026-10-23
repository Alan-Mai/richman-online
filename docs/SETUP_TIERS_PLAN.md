# 設定畫面改用原版檔位：計畫

> **已完成，僅供歷史參考**（2026-10-23，批次 0–3 全部完成，等使用者在里程碑試玩與確認）。規則見 `GAME_RULES.md` 第 1 節；回饋的修正用新 commit。

對應 ROADMAP Phase 3 之後「匯入資料表後，設定畫面改用原版檔位（天數上限、淨值目標、起始資金）」。新工作流程（`.claude/rules/autonomy.md`）的試行項目。

檔位編號：本檔寫「索引 i（第 i+1 檔）」；`GAME_RULES.md` 與 notes.md 用從 1 起算的「第 n 檔」。

## 接續狀態

- 目前批次：全部完成（批次 3 為本 commit）。批次 0、0b、1、2 已通過 batch 審查。
- 下一個動作：`reviewer batch 0c96873..<head>`，通過後交付里程碑、提醒使用者輸入 `/wrap-up`
- 未 commit 的工作：無
- 待審筆數（REVIEW_QUEUE）：10

## 現況

- `packages/shared/src/tables.ts`：`OriginalTables.setupOptions` 有 `startingFunds`、`dayLimit`、`netWorthTargetMultiple` 三個長度 6 的原始值陣列。`parseOriginalTables` 驗證起始資金各檔為 1..I32 上限、另兩者為 0..I32 上限；**沒有**檢查「第 1 檔為 0」（那是 `tools/extract` 匯出時檢查的，見 `ASSET_FORMATS.md`），所以手改過的檔案裡 0 可能出現在任何一檔。
- `apps/client/src/ui/setup-form.ts`：`SetupForm` 的 `dayLimit`、`netWorthTarget`、`startingFunds` 是字串，`buildSetup` 以非原版的輸入範圍驗證（1–9999 日、1–999 倍、1–10 億，留空為不限）。
- `apps/client/src/ui/setup-screen.ts`：天數上限、淨值目標是一般輸入框；起始資金在「進階設定」。`TablesImport` 目前只提供 `characters()`；匯入或清除後只呼叫 `sync()`，不重繪畫面。
- `apps/client/src/app.ts`：匯入的資料表存在 `tables`，到重新整理頁面為止；`lastForm` 保留上一局的表單值。
- 引擎（`config.ts` 的 `validateRuleConfig`）：`dayLimit`、`netWorthTargetMultiple` 為 `null` 或正整數，`startingFunds` 為正整數；原始值 0 換成 `null` 後都可直接使用，引擎不需改動。

## 設計

1. **表單值分兩組保存**：`SetupForm` 新增 `tiers: { startingFunds: number; dayLimit: number; netWorthTarget: number }`（檔位索引 0–5），原本的三個字串欄位保留給未匯入時的自訂輸入。是否用檔位只由「有沒有匯入資料表」決定，畫面上沒有另外的切換開關；匯入、清除資料表時兩組各自保留，不互相覆蓋；`lastForm` 照舊帶到下一局。
2. **檔位換成設定值**（`setup-form.ts`，純函式，可單元測試）：
   - `buildSetup` 的第三個參數由 `characters` 改成 `tables: { characters; setupOptions } | null`（或新增一個參數，實作時選較少改動者，記 REVIEW_QUEUE）。有 `setupOptions` 時三個設定只讀檔位、忽略自訂字串（字串不合法也不報錯）；沒有時照現在的自訂輸入驗證。
   - 原始值 0 → `null`（不限）；其他值原樣使用。不看檔位索引、只看值是否為 0：原版的結束判斷就是以「值 ≠ 0」決定是否檢查（`local-assets/ghidra/notes.md` 的 CheckDayLimitOrTargetEnd，0x0041d89e），所以 0 出現在哪一檔都等於不限；第 1 檔為 0 是原版結構（`GAME_RULES.md` 第 1 節）。起始資金的原始值由 `parseOriginalTables` 保證為正。
   - 檔位索引：`read()` 從 `<select>` 讀值，只會是 0–5；`buildSetup` 收到超出範圍或非整數的索引時視為呼叫端寫錯而 throw，不另設退路。
3. **選項文字**（`setup-form.ts` 匯出 `tierLabels(setupOptions, startingFundsTier)`，固定字串在 `zh-TW.ts`）：照批次 0 查到的原版呈現（`GAME_RULES.md` 第 1 節「原版設定畫面的…」）：
   - 起始資金：十進位整數，無千分位。
   - 淨值目標：金額＝目前選的起始資金值 × 倍數，十進位整數；倍數 0 顯示本專案自己措辭的固定字串「無」。換起始資金檔位時 `sync()` 重算淨值目標的選項文字。
   - 天數上限：顯示 `tables.json` v3 的 `setupOptions.dayLimitLabels[檔位]`（批次 0b 由 `tools/extract` 從執行檔匯出的每檔文字，只在本機）。
   - 數值與文字只來自匯入的檔案，倉庫與測試不放原版數值或字串（測試用自編的假值）。
4. **畫面**（`setup-screen.ts`）：三個設定各建一個輸入框與一個 `<select>`（6 個選項，value 為檔位索引），由 `sync()` 依 `options.tables?.setupOptions()` 是否為 null 切換哪一個顯示（`hidden` 加在 label 上）。`TablesImport` 新增 `setupOptions()`，回傳 `setupOptions`（含批次 0b 時的預設索引）或 null。匯入時選項文字要換成新檔的值，所以 `sync()` 也重建三個 `<select>` 的選項、保留目前選的索引。起始資金移出「進階設定」，和天數上限、淨值目標並列，有無匯入都一樣（使用者決定，見下方「使用者的決定」；批次 2 記 REVIEW_QUEUE）。
5. **預設檔位**：
   - 天數上限、淨值目標：`defaultSetupForm()` 為索引 0（第 1 檔，不限）；原版預設不限（`GAME_RULES.md` 第 1 節；notes.md 步驟 8 d），照結構寫。
   - 起始資金：原版從標題開新局時是索引 1（第 2 檔），是程式中的立即值（批次 0）。依 asset-analyze SKILL.md「規則中的單一常數只限程式碼裡的立即值」，可以寫進文件與程式：shared `tables.ts` 新增常數 `ORIGINAL_SETUP_DEFAULT_TIERS = { startingFunds: 1, dayLimit: 0, netWorthTarget: 0 }`，不經 `tables.json`（計畫差異，見「進度」）。`defaultSetupForm().tiers` 直接用這個常數；原本為了「預設來自匯入檔」而設計的 `null` 不再需要，`tiers` 三項都是數字。
   - 沿用上一局：原版在遊戲中接續開新局時沿用上一局的設定；客戶端的 `lastForm` 已經在同一頁面內沿用上一局的表單，與原版一致。重新整理頁面後回到預設，也與原版「不存設定檔」一致。
6. **資料表區塊的說明文字**：`setup.tables.none`／`setup.tables.imported` 加上「起始資金、天數上限、淨值目標使用原版檔位／自訂輸入」。
7. **app.ts**：`setupOptions: () => tables?.data.setupOptions ?? null`。

不做：伺服器端（Phase 4 連線版的設定流程另議）、模擬器（已有 `--day-limit` 等自訂參數，`--tables` 不改設定值）、`parseOriginalTables` 加「第 1 檔為 0」的檢查（依結構處理就不需要；若要加屬 shared 改動，另提）。

## 批次

### 批次 0：設定畫面三個選項的逆向查證（時限：主 session 1 輪、約 45 分鐘）
- 先讀 `.claude/skills/asset-analyze/SKILL.md` 的 Ghidra 段落。
- 查兩件事，共用時限：
  - **起始資金的預設檔位**：新局 0x0040717e 讀取的檔位索引變數的靜態初始值、設定畫面開啟時是否重設（「依目前值找檔位」的迴圈 0x406f5c 前後）、是否從設定檔讀寫。順便核對天數上限、淨值目標的索引變數初始值為索引 0（步驟 8 d 已記）。
  - **選項文字**：設定畫面畫三個選項的程式（從 0x406f5c、0x406f8f、0x406fbd 附近往外找）：值 0 的寫法、天數的單位、淨值目標顯示倍數還是金額、起始資金的格式。字串內容是原版文字，不抄進倉庫，只記結構（例：「顯示金額＝倍數 × 起始資金」「值 0 時改用另一個固定字串」）；固定字串用本專案自己的措辭。順便記下設定畫面上三個選項的相對位置（只記結構），作為「待使用者決定」第 2 點的依據。
- 關鍵指令由主 session 親自對照反組譯，位址記進 `local-assets/ghidra/notes.md`；結論寫進 `GAME_RULES.md` 第 1 節（🔍，只寫結構，不寫數值或原版字串），需要原版佐證的列 ROADMAP 未解問題。
- 結果的用法：
  - 預設檔位查到且是固定索引 → 檔位索引屬執行檔內的資料值，**不寫死在倉庫**：由 `tools/extract` 匯出為 `setupOptions.startingFundsDefault`，`tables.json` 升為 v3，shared 的 `parseOriginalTables` 驗證 0–5。多一個批次 0b（extract + shared，測試先行，含 v2 → v3 的重新匯出提示；同一個 commit 更新 `ASSET_FORMATS.md` 的 `tables.json` 版本號與欄位清單（:442）和匯出時的檢查條件（:419）），完成後依實際介面調整批次 1、2 的細節，記成計畫差異。
  - 查到是「沿用上次的值」（含設定檔）→ 同一頁面內 `lastForm` 已經沿用上次的值，這部分與原版一致；第一次開啟時用查到的靜態初始值（照上一項的 0b 方式匯出），查不到初始值才用索引 0 並記 REVIEW_QUEUE；跨頁面保存不做，列 ROADMAP。
  - 任一項時限內查不到 → 停下問你（autonomy.md「逆向超出時限」）；選項文字查不到時，列出暫定提案（設計第 3 點）請你決定。
- 只改文件（`local-assets/` 不進版本控制）；commit：`docs(rules): 設定畫面的預設檔位與選項文字（逆向）`。

### 批次 0b：`tables.json` v3 匯出天數上限的選項文字（`tools/extract` + `packages/shared`，測試先行）
- 批次 0 的結論：天數上限的選項文字是執行檔內的字串指標表（6 筆，與數值表一一對應），屬執行檔資料表，比照其他表由 `tools/extract` 匯出。
- `tools/extract/src/exe-tables.ts`：`RICH4_LAYOUT` 新增 `dayLimitLabels`（指標表 6 × u32）；檢查指標表有程式碼參照、每個指標落在有檔案內容的區段、字串在合理長度內以 NUL 結尾，以 Big5 嚴格解碼（`TextDecoder('big5', { fatal: true })`）成 UTF-8；失敗時錯誤訊息不印內容。`TABLES_JSON_VERSION` 升為 3。測試用合成的假 PE 與自編字串（`exe-tables.test.ts`）。
- `packages/shared/src/tables.ts`：`ORIGINAL_TABLES_VERSION` 升為 3；`setupOptions.dayLimitLabels` 為 6 個非空字串（長度上限 32 字，超出回 `outOfRange`，非字串回 `wrongType`）；v2 檔回 `unsupportedVersion`（客戶端既有訊息提示重新匯出）。新增常數 `ORIGINAL_SETUP_DEFAULT_TIERS`（設計第 5 點）。測試先行（`tables.test.ts`）。
- 同步：用到 `tables.json` 假資料的測試（`apps/client/src/assets/original-tables.test.ts`、`setup-screen.test.ts`、`tools/sim/src/simulate.test.ts`、`tools/extract/src/exe-tables.test.ts`）補欄位；`ASSET_FORMATS.md` 的 `tables.json` 版本號、欄位清單（:442）、各表一覽與匯出時的檢查（:419、:428 附近）；`pnpm -F extract cli tables` 的輸出摘要只印筆數。
- 完成後在本機重新匯出 `local-assets/tables.json`（只看筆數），確認客戶端能讀。
- commit：`feat(extract): tables.json v3 匯出天數上限的選項文字`（extract 與 shared 一起，因為版本號必須同步）。

### 批次 1：表單邏輯（`setup-form.ts` + 測試 + i18n）
- 測試先行（`setup-form.test.ts`，自編假值的 `setupOptions`）：
  - 有檔位時：索引 0（原始值 0）→ `dayLimit`/`netWorthTargetMultiple` 為 `null`；選其他檔 → 該檔的原始值；起始資金取所選檔的值。
  - 有檔位時，自訂字串不合法也不產生 `dayLimit`／`netWorthTarget`／`startingFunds` 錯誤。
  - 索引 0 以外的檔原始值為 0 時也換成 `null`。
  - 沒有檔位時，行為與現在相同（既有測試不改）。
  - `tierLabels`：起始資金是無千分位的整數；淨值目標是「所選起始資金 × 倍數」的整數，倍數 0 時是固定字串，換起始資金檔位後跟著變；天數上限是 `dayLimitLabels` 的對應字串。
  - `defaultSetupForm().tiers` 等於 `ORIGINAL_SETUP_DEFAULT_TIERS`（起始資金索引 1，其餘 0；期望值寫成常數）。
- commit：`feat(client): 設定表單可依原版檔位產生天數上限、淨值目標與起始資金`

### 批次 2：設定畫面與接線（`setup-screen.ts`、`app.ts` + 測試）
- 測試先行（`setup-screen.test.ts`）：
  - 未匯入：顯示輸入框、不顯示檔位選單（既有測試照舊）。
  - 匯入後（`setupOptions()` 回傳假值、觸發 onChange）：三個設定顯示 6 檔的 `<select>`、輸入框隱藏；選索引 2 開局，`onStart` 收到的 setup 用該檔的值，`form.tiers` 記下索引。
  - 清除資料表後：選單隱藏、輸入框回來，原本輸入的字串仍在。
  - 用含 `tiers` 的 `initial` 預填時，選單選中對應的檔位；預設表單時起始資金選中索引 1。
  - 起始資金在未匯入與匯入時都不在「進階設定」內，和天數上限、淨值目標並列（順序照原版：起始資金、天數上限、淨值目標）。
  - 換起始資金檔位後，淨值目標選單的文字跟著變、選中的索引不變。
  - 依 `client.md`：測試前明確設定 `<select>` 的值，不依賴 happy-dom 預設選項。
- 煙霧測試 `pnpm -F smoke shot -- --out <scratchpad>`（它不匯入資料表，只確認沒有破壞未匯入的畫面）；另在內建瀏覽器用 scratchpad 內自編的假 `tables.json` 匯入，截圖確認選單（假值，不是原版）。
- commit：`feat(client): 匯入資料表後設定畫面改用原版檔位`

### 批次 3：文件收尾
- `GAME_RULES.md` 第 1 節：「單機設定畫面的勝負條件」（:54）、「起始資金」與「勝利條件」兩列的「引擎：」段落（:23、:25）都改成：有匯入時用原版 6 檔、未匯入時為自訂輸入（非原版）、預設檔位的來源。
- `ROADMAP.md`：本項的 `[ ]` 在這個 commit 改成 `[x]`（CLAUDE.md 第 6 條），里程碑時列為「待你確認的勾選」；「下一步」整段改寫：移除本項；hook 實測已在計畫 commit 時移除；改指向「原版地圖轉成可玩 `Board`」；ROADMAP 中指向本計畫檔的文字移除。
- 計畫檔末尾寫試行回顧，檔頭標「已完成，僅供歷史參考」（或刪除；先 `git grep SETUP_TIERS_PLAN`）。
- commit：`docs: 設定畫面原版檔位完成，更新 GAME_RULES 與 ROADMAP`

每批 commit 後跑 `reviewer batch <base>..<head> docs/SETUP_TIERS_PLAN.md`。

## 使用者的決定（2026-10-23 核准時）

1. **起始資金的預設檔位**：照提案，批次 0 查到固定索引就由 `tools/extract` 匯出（`tables.json` v3）。使用者不記得原版預設檔位，完全依批次 0 的查證結果。（批次 0 查到的是程式中的立即值，改為寫成常數，見「進度」的計畫差異；`tables.json` v3 仍然要做，用於天數上限的選項文字。）
2. **起始資金的位置**：移出「進階設定」，和天數上限、淨值目標並列，有無匯入都一樣；記 REVIEW_QUEUE。

## 🎮 試玩（里程碑時）

- 先重新匯出：`pnpm -F extract cli tables`（v2 的 `tables.json` 會被拒絕，提示重新匯出）。
- 未匯入：三個欄位可自訂；起始資金已不在「進階設定」，排在天數上限之前。
- 匯入 `tables.json`：三個設定變成 6 檔選單，預設起始資金第 2 檔、天數上限與淨值目標第 1 檔；起始資金為無千分位的整數、淨值目標顯示金額（換起始資金時跟著變）、天數上限顯示原版的每檔文字。**匯入後的畫面我只用 DOM 檢查過（內建瀏覽器窗格隱藏），沒有截圖，請順便看選單外觀。**
- 選天數上限第 2 檔開局，到期時結束（`dayLimitOrNetWorthTarget`）。
- 結束一局回到設定畫面時，選單維持上一局的檔位（同原版「遊戲中接續開新局」；從標題開新局的情況本專案沒有，見 REVIEW_QUEUE）。
- 清除資料表後輸入框回來，之前輸入的值仍在；再匯入時選單維持之前選的檔位。
- 煙霧測試截圖（未匯入）：scratchpad `smoke/01-setup.png`、`02-start.png`、`03-later.png`。

## 進度

- 2026-10-23 前置：hook 實測。`.claude/rules/_probe.md` 的 Write 成功；手動以相同輸入執行 `ask-rule-edits.mjs`，輸出 `permissionDecision: "ask"`，對 `docs/` 的路徑不輸出。使用者確認畫面上有跳出確認框（bypass permissions 模式下 ask 仍有效）。SessionStart 接續訊息在 session 開頭有出現。探測檔已刪、未 commit。曾依使用者要求寫了「bypass 模式下改為擋下」的修正，使用者看過 diff 後決定不採用、維持 ask，已用 `git restore` 還原（未 commit）。
- 批次 0（2026-10-23，主 session 約 0.3 輪，未超出時限）：結果寫進 `GAME_RULES.md` 第 1 節「原版設定畫面的起始資金、天數上限、淨值目標」與 `notes.md` 步驟 11（關鍵位址：0x00406f06–0x00406f20 預設索引、0x00406f5c／0x00406f8f／0x00406fbd 沿用上一局、0x00401c8c–0x00401ca6 與 0x00401def 參數來源、0x00404651–0x004046c3 起始資金與淨值目標文字、0x00404778 天數上限字串表）。需要原版佐證的列入 ROADMAP 未解問題。和計畫的差異（記 REVIEW_QUEUE）：
  - 預設檔位是立即值 → 寫成常數，不經 `tables.json`。
  - 天數上限的選項文字是執行檔內的字串表 → 新增批次 0b，`tables.json` v3 匯出這張表。
  - 設計第 1、5 點的 `tiers.startingFunds: number | null` 改成 `number`。
  - 選項位置：原版三者都在主要區域、順序是起始資金、天數上限、淨值目標，與使用者決定的「移出進階設定、並列」一致。
  - batch 審查建議，留給後面的批次：ROADMAP 本項內文的「第 1 檔『不限』照結構寫」在批次 3 改寫（起始資金沒有不限、天數上限的第 1 檔顯示匯出的文字）；客戶端 `lastForm` 的沿用範圍和原版「接續開新局」的觸發條件是否相同，在批次 2 的 REVIEW_QUEUE 或試玩清單帶到。
- 批次 0b（`42ef6a4`，batch 審查通過）：大致照計畫，兩處不同：字串長度上限 64（extract 以 bytes、shared 以字數），計畫原寫 32，改成兩邊一致的 64，記在 REVIEW_QUEUE 第 2 筆的補充；`setup-screen.test.ts` 不用 `tables.json` 假資料，不需要補欄位。審查建議的修正另開 commit：測試的假字串換成沒有意義的組合（不用時間單位），ROADMAP 一處過時的「v2」。本機重新匯出 `local-assets/tables.json` 後 shared 驗證通過（6 段文字）。
- 批次 1（`46372cc`）：照計畫。`buildSetup` 加第 4 個參數 `setupOptions`；`tierLabels(options, startingFundsTier)`；淨值目標的 0 文字是 i18n 的 `setup.tier.noTarget`。為了讓 commit 能編譯，`setup-screen.ts` 的 `read()` 暫時原樣帶回 `initial.tiers`，批次 2 換成選單的值。REVIEW_QUEUE 兩筆（參數形式、淨值目標乘積不模擬 32 位元溢位）。這行進度在批次 1 的 commit 漏掉，補在下一個 commit。batch 審查第 1 次不通過：`3c51d45` 處理審查建議卻沒記 REVIEW_QUEUE；補上該筆與 `read()` 過渡寫法的計畫差異。審查建議：淨值目標乘積的 32 位元溢位差異在里程碑列給使用者決定；測試假值改得較不規則（另開 test commit）。重審通過，建議：里程碑補 hash 時註明 `db155fe` 補記的兩筆。
- 批次 2：照計畫。設定畫面三個設定各有自訂輸入框與檔位選單（`startingFundsTier` 等），`sync()` 依 `tables.setupOptions()` 切換並重建選項文字；`app.ts` 接上 `setupOptions`；說明文字更新。煙霧測試（未匯入）截圖：scratchpad `smoke/01-setup.png`、`03-later.png`，無頁面錯誤，起始資金已在交通工具之後、天數上限之前。另在內建瀏覽器（自開 5193 埠，用完已關）以自編的假 `tables.json` 匯入，窗格隱藏所以用 DOM 檢查：三個選單出現、文字照原版呈現、換起始資金後淨值目標金額跟著變；選第 6 檔起始資金（奇數）開局，人類現金與存款各為一半、餘 1 捨去。REVIEW_QUEUE 兩筆（位置與標籤、`lastForm` 與原版沿用條件的差異）。batch 審查（`8332385..0c96873`）通過。
- 批次 3：`GAME_RULES.md` 第 1 節的「起始資金」「勝利條件」「單機設定畫面的勝負條件」三列照程式碼改寫；ROADMAP 勾選本項並改寫內文（REVIEW_QUEUE 一筆，勾選待里程碑確認）、「下一步」改指向「原版地圖轉成可玩 `Board`」、移除指向本檔的文字；本檔檔頭標「已完成」。`git grep SETUP_TIERS_PLAN` 只剩 REVIEW_QUEUE 的依據欄（本檔保留，引用仍有效）。

## 試行回顧

新工作流程（`.claude/rules/autonomy.md`）第一次完整試行，2026-10-23 一個 session 內完成。

- **停下的次數**：開頭 1 次（計畫核准，另加 hook 實測與 hook 修正的來回，屬前置）；中間 0 次；結尾 1 次（里程碑）。批次 0 的逆向在時限內查到，不需要停。
- **reviewer**：plan 3 次（通過、不通過、通過）；batch 5 次（批次 0 通過、0b 通過、1 不通過後重審通過、2 通過、3 待審）。兩次不通過都是真問題：plan 第 2 次抓到「選項文字屬規則、不能自訂」，batch 抓到「處理審查建議沒記 REVIEW_QUEUE」。建議也有實質內容（假資料碰巧和原版值相同、過時的 v2 字樣、計畫內文與實作不符）。
- **好用的**：計畫檔的「接續狀態」讓每個 commit 後的狀態一目了然；reviewer 只看輸入、不看過程，抓到我自己忽略的規則（GAME_RULES 寫作慣例第 17 行、autonomy 的「記進 REVIEW_QUEUE、重審」）；`check:commit` + hook 讓每個 commit 都經過完整檢查，沒有出現漏格式或漏測試。
- **礙事或可改進的**：
  - 「審查建議的修正要記 REVIEW_QUEUE」和「程式碼與文件分開 commit」互相拉扯：REVIEW_QUEUE 條目必須和改動同一個 commit，修測試的 commit 就一定會帶文件。可以在規則裡明說 REVIEW_QUEUE／計畫檔的更新不算「另一件事」。
  - 小修正（假資料、措辭）每筆都進 REVIEW_QUEUE，里程碑待審筆數膨脹到 10 筆，其中幾筆你大概不需要審。可以考慮讓「依審查建議改測試資料」這類只記在計畫檔進度。
  - 計畫寫「截圖確認」但內建瀏覽器窗格隱藏時只能做 DOM 檢查；計畫範本可以預先寫成「截圖或 DOM 檢查」。
  - 批次 1 為了編譯要先碰批次 2 的檔案：拆批次時，型別上的必填欄位會跨批次，計畫可以預先寫明過渡寫法。
  - 每批 reviewer 約 1–2 分鐘、token 用量不小；範圍這麼小的項目，批次 0b／1／2 合併審查也許就夠。
