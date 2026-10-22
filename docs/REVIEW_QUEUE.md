# 自主決策待審清單

Claude 自行決定、需要使用者在里程碑時審查的判斷（規則見 `.claude/rules/autonomy.md`）。

- 每筆和對應的改動放在同一個 commit，「commit」先寫 commit 標題，里程碑交付時再補上 hash。
- 「依據」寫檔案:行、`DECISIONS.md` 條目、逆向位址；不寫原版數值、名稱或反編譯內容。
- 審過後：同意的刪除（影響架構的轉寫成 `DECISIONS.md` 條目），不同意的另開修正 commit 後刪除。

格式：

```
### YYYY-MM-DD · <commit 標題>
- 類別：實作細節｜範圍外修正｜逆向查證｜測試與效能｜計畫差異｜ROADMAP 改寫
- 判斷：做了什麼決定
- 理由：為什麼這樣做、考慮過的替代做法
- 依據：檔案:行、文件條目、逆向位址
```

## 待審

### 2026-10-22 · fix(shared): 電腦選顆數的下限改由設定驗證保證，移除夾限
- 類別：範圍外修正
- 判斷：`drawComputerDiceCount` 不再用 `Math.min(crowdedMinDice, 上限)` 夾住下限；改由 `validateRuleConfig` 要求 `crowdedMinDice` 不超過機車與汽車的顆數上限，違反時回報 `computerDice` / `invalidComputerDice`（沿用既有的錯誤種類，不新增）。步行不選顆數，不檢查。某個交通工具的上限本身無效時，只回報 `vehicleMaxDice`，不重複回報 `computerDice`。
- 理由：夾限是原版沒有的自訂退路（CLAUDE.md 第 7 條：用驗證讓它不可能發生）。預設值下結果和原版相同，所以對局行為不變；設定不合法時，`createGame` 會回報設定錯誤，引擎裡不會走到這段。沿用 `invalidComputerDice`，因為 `computerDice` 的其他不合法情況也用這個種類；客戶端與模擬器都不會設定 `computerDice` 或 `vehicleMaxDice`（只用預設值），所以不需要新的錯誤種類或顯示文字。
- 依據：`packages/shared/src/config.ts` 的 `validateRuleConfig`（computerDice 段）、`packages/shared/src/computer.ts` 的 `drawComputerDiceCount`；`docs/GAME_RULES.md` 第 9 節（電腦選顆數）；reviewer 驗證 E3 批次時指出（2026-10-22，工作流程改造）。驗證：新測試先因斷言失敗（`expected [] to deeply equal [ { field: 'computerDice', … } ]`）；模擬器 200 局（`--controllers computer --vehicle car`，種子 1）exit 0。

### 2026-10-22 · test(shared): 交通工具上限無效時只回報 vehicleMaxDice
- 類別：測試與效能
- 判斷：照 reviewer 的建議（`519501e` 的審查）補一個測試：機車或汽車的上限是 0 時，`validateRuleConfig` 只回報 `vehicleMaxDice`，不另外回報 `computerDice`。
- 理由：上一筆的判斷提到這個行為。查證後發現既有測試「requires a positive integer dice limit for every vehicle」已經間接涵蓋（機車 1.5、汽車 −3、缺少汽車都只回報 `vehicleMaxDice`），reviewer 的建議實際上已經滿足；但你指示照建議補上，所以新增的測試把「不重複回報 `computerDice`」寫進測試名稱，並補上 0 這個值。兩個測試重疊，保留的理由是新測試說明的是兩個檢查之間的關係，舊測試說明的是上限本身的格式。
- 依據：`packages/shared/src/config.test.ts` 的新測試；`config.ts` 的 `validateRuleConfig`（`fitsVehicles`）。驗證：暫時把 `!isPositiveInteger(most) ||` 拿掉，新測試與既有測試都因斷言失敗（`expected [ …(2) ] to deeply equal [ { field: 'vehicleMaxDice', …(1) } ]`），改回後通過。
