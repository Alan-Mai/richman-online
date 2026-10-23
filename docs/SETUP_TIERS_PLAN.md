# 設定畫面改用原版檔位：計畫

對應 ROADMAP Phase 3 之後「匯入資料表後，設定畫面改用原版檔位（天數上限、淨值目標、起始資金）」。新工作流程（`.claude/rules/autonomy.md`）的試行項目。

檔位編號：本檔寫「索引 i（第 i+1 檔）」；`GAME_RULES.md` 與 notes.md 用從 1 起算的「第 n 檔」。

## 接續狀態

- 目前批次：批次 0（逆向查證）。計畫已核准（2026-10-23）；plan 審查第 1、3 次通過，第 2 次不通過後已修正。
- 下一個動作：讀 `.claude/skills/asset-analyze/SKILL.md` 的 Ghidra 段落，開始批次 0
- 未 commit 的工作：本計畫檔
- 待審筆數（REVIEW_QUEUE）：0

## 現況

- `packages/shared/src/tables.ts`：`OriginalTables.setupOptions` 有 `startingFunds`、`dayLimit`、`netWorthTargetMultiple` 三個長度 6 的原始值陣列。`parseOriginalTables` 驗證起始資金各檔為 1..I32 上限、另兩者為 0..I32 上限；**沒有**檢查「第 1 檔為 0」（那是 `tools/extract` 匯出時檢查的，見 `ASSET_FORMATS.md`），所以手改過的檔案裡 0 可能出現在任何一檔。
- `apps/client/src/ui/setup-form.ts`：`SetupForm` 的 `dayLimit`、`netWorthTarget`、`startingFunds` 是字串，`buildSetup` 以非原版的輸入範圍驗證（1–9999 日、1–999 倍、1–10 億，留空為不限）。
- `apps/client/src/ui/setup-screen.ts`：天數上限、淨值目標是一般輸入框；起始資金在「進階設定」。`TablesImport` 目前只提供 `characters()`；匯入或清除後只呼叫 `sync()`，不重繪畫面。
- `apps/client/src/app.ts`：匯入的資料表存在 `tables`，到重新整理頁面為止；`lastForm` 保留上一局的表單值。
- 引擎（`config.ts` 的 `validateRuleConfig`）：`dayLimit`、`netWorthTargetMultiple` 為 `null` 或正整數，`startingFunds` 為正整數；原始值 0 換成 `null` 後都可直接使用，引擎不需改動。

## 設計

1. **表單值分兩組保存**：`SetupForm` 新增 `tiers: { startingFunds: number | null; dayLimit: number; netWorthTarget: number }`（檔位索引 0–5），原本的三個字串欄位保留給未匯入時的自訂輸入。是否用檔位只由「有沒有匯入資料表」決定，畫面上沒有另外的切換開關；匯入、清除資料表時兩組各自保留，不互相覆蓋；`lastForm` 照舊帶到下一局。`tiers.startingFunds` 為 `null` 表示「還沒選過，用預設檔位」（見第 5 點）。
2. **檔位換成設定值**（`setup-form.ts`，純函式，可單元測試）：
   - `buildSetup` 的第三個參數由 `characters` 改成 `tables: { characters; setupOptions } | null`（或新增一個參數，實作時選較少改動者，記 REVIEW_QUEUE）。有 `setupOptions` 時三個設定只讀檔位、忽略自訂字串（字串不合法也不報錯）；沒有時照現在的自訂輸入驗證。
   - 原始值 0 → `null`（不限）；其他值原樣使用。不看檔位索引、只看值是否為 0：原版的結束判斷就是以「值 ≠ 0」決定是否檢查（`local-assets/ghidra/notes.md` 的 CheckDayLimitOrTargetEnd，0x0041d89e），所以 0 出現在哪一檔都等於不限；第 1 檔為 0 是原版結構（`GAME_RULES.md` 第 1 節）。起始資金的原始值由 `parseOriginalTables` 保證為正。
   - 檔位索引：`read()` 從 `<select>` 讀值，只會是 0–5；`buildSetup` 收到超出範圍或非整數的索引時視為呼叫端寫錯而 throw，不另設退路。
3. **選項文字**（`setup-form.ts` 匯出 `tierLabel(kind, raw, …)`，i18n 在 `zh-TW.ts`）：玩家看得到的呈現屬規則（`GAME_RULES.md` 開頭），由批次 0 查原版怎麼顯示（「不限」的寫法、天數的單位、淨值目標顯示倍數還是乘上起始資金後的金額、起始資金的格式），照原版做。若淨值目標顯示金額，換起始資金檔位時要重算淨值目標的選項文字（`sync()` 處理）。批次 0 時限內查不到就停下，列給你決定；在你決定前不做批次 1 的文字部分，暫定提案是：索引值 0 →「不限」、天數「{n} 日」、淨值目標「起始資金的 {n} 倍」、起始資金千分位。數值只來自匯入的檔案，倉庫與測試不放原版數值（測試用自編的假值）。
4. **畫面**（`setup-screen.ts`）：三個設定各建一個輸入框與一個 `<select>`（6 個選項，value 為檔位索引），由 `sync()` 依 `options.tables?.setupOptions()` 是否為 null 切換哪一個顯示（`hidden` 加在 label 上）。`TablesImport` 新增 `setupOptions()`，回傳 `setupOptions`（含批次 0b 時的預設索引）或 null。匯入時選項文字要換成新檔的值，所以 `sync()` 也重建三個 `<select>` 的選項、保留目前選的索引。起始資金移出「進階設定」，和天數上限、淨值目標並列，有無匯入都一樣（使用者決定，見下方「使用者的決定」；批次 2 記 REVIEW_QUEUE）。
5. **預設檔位**：
   - 天數上限、淨值目標：`defaultSetupForm()` 為索引 0（第 1 檔，不限）；原版預設不限（`GAME_RULES.md` 第 1 節；notes.md 步驟 8 d），照結構寫。
   - 起始資金：原版預設檔位目前未知。新局以一個檔位索引變數查選項表（notes.md 步驟 8 b，0x0040717e），由批次 0 查它的初始值。表單：`defaultSetupForm()` 的 `tiers.startingFunds` 為 `null`；`buildSetup` 與畫面把 `null` 解析成預設索引（批次 0b 匯出的值，或批次 0 結論下的索引 0）。玩家在選單選過後才變成數字，所以匯入（或換一個檔案匯入）不會蓋掉玩家已選的檔位，只有還沒選過時跟著預設走。
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

### 批次 1：表單邏輯（`setup-form.ts` + 測試 + i18n）
- 測試先行（`setup-form.test.ts`，自編假值的 `setupOptions`）：
  - 有檔位時：索引 0（原始值 0）→ `dayLimit`/`netWorthTargetMultiple` 為 `null`；選其他檔 → 該檔的原始值；起始資金取所選檔的值。
  - 有檔位時，自訂字串不合法也不產生 `dayLimit`／`netWorthTarget`／`startingFunds` 錯誤。
  - 索引 0 以外的檔原始值為 0 時也換成 `null`。
  - `tiers.startingFunds` 為 `null` 時用預設索引。
  - 沒有檔位時，行為與現在相同（既有測試不改）。
  - `tierLabel`：依批次 0 的結論（值 0、單位、淨值目標的顯示方式、起始資金格式）。
  - `defaultSetupForm().tiers`：天數上限、淨值目標為 0，起始資金為 `null`。
- commit：`feat(client): 設定表單可依原版檔位產生天數上限、淨值目標與起始資金`

### 批次 2：設定畫面與接線（`setup-screen.ts`、`app.ts` + 測試）
- 測試先行（`setup-screen.test.ts`）：
  - 未匯入：顯示輸入框、不顯示檔位選單（既有測試照舊）。
  - 匯入後（`setupOptions()` 回傳假值、觸發 onChange）：三個設定顯示 6 檔的 `<select>`、輸入框隱藏；選索引 2 開局，`onStart` 收到的 setup 用該檔的值，`form.tiers` 記下索引。
  - 清除資料表後：選單隱藏、輸入框回來，原本輸入的字串仍在。
  - 用含 `tiers` 的 `initial` 預填時，選單選中對應的檔位；起始資金為 `null` 時選中預設檔位。
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

1. **起始資金的預設檔位**：照提案，批次 0 查到固定索引就由 `tools/extract` 匯出（`tables.json` v3）。使用者不記得原版預設檔位，完全依批次 0 的查證結果。
2. **起始資金的位置**：移出「進階設定」，和天數上限、淨值目標並列，有無匯入都一樣；記 REVIEW_QUEUE。

## 🎮 試玩（里程碑時）

- 未匯入：設定畫面與現在相同，三個欄位可自訂。
- 匯入真正的 `tables.json`：三個設定變成 6 檔選單，文字依批次 0 的結論；選天數上限某一檔開局，到期時結束。
- 清除資料表後輸入框回來，之前輸入的值仍在；再匯入時選單維持之前選的檔位。

## 進度

- 2026-10-23 前置：hook 實測。`.claude/rules/_probe.md` 的 Write 成功；手動以相同輸入執行 `ask-rule-edits.mjs`，輸出 `permissionDecision: "ask"`，對 `docs/` 的路徑不輸出。使用者確認畫面上有跳出確認框（bypass permissions 模式下 ask 仍有效）。SessionStart 接續訊息在 session 開頭有出現。探測檔已刪、未 commit。曾依使用者要求寫了「bypass 模式下改為擋下」的修正，使用者看過 diff 後決定不採用、維持 ask，已用 `git restore` 還原（未 commit）。

## 試行回顧

（完成時填寫：新流程中停下的次數、reviewer 的結果、哪些規則好用或礙事）
