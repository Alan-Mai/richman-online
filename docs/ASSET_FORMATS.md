# 原版素材格式筆記

逆向分析的成果記錄在這裡。**只記錄格式結構，不貼原始資料內容**（不要貼大段十六進位或圖片）。

## 工具
- ImHex（十六進位檢視 + pattern language）
- Ghidra（必要時分析執行檔讀檔邏輯）
- `tools/extract inventory`（檔案清單與檔頭）

## 參考來源
只參考公開的格式說明，**不複製其程式碼**；解析器一律自行撰寫。

| 來源 | 內容 | 用途 | 備註 |
|---|---|---|---|
| SDLPAL（https://github.com/sdlpal/sdlpal） | 《仙劍奇俠傳》MKF 封包、YJ1 壓縮等格式的說明與實作 | 驗證大富翁4 的 `*.mkf` 是否為同一套格式 | 只讀說明，不複製程式碼 |

## 待驗證假設

### H1：`*.mkf` 與仙劍的 MKF 封包相同，內部資料可能以 YJ1 壓縮
- 依據：同為大宇（Softstar）作品；原版目錄有 `Data.mkf`、`map.mkf`、`Panel.mkf`、`Effect.mkf` 等檔案。
- 狀態：**偏移表部分有檔頭反證；YJ1 部分未驗證**。
- 可驗證的預測（例）：檔頭是一串 uint32 偏移表，第一個值 ÷ 4 = 子檔數 + 1，最後一個值 = 檔案大小。
- 反證（依 inventory 的 16 bytes 檔頭）：
  - 7 個 `*.mkf` 的第一個 uint32 都接近檔案大小（差 284–5496 bytes），不是小的偏移表長度；其中 5 個甚至不能被 4 整除。
- YJ1 壓縮：
  - 支持：`Data.mkf`、`Panel.mkf` 的第一個子檔看似「原始大小 > 儲存大小」，表示有某種壓縮。
  - 反對（弱）：仙劍的 YJ1 把大小欄位放在 `YJ_1` magic 之後，這裡大小欄位在容器層（見「MKF 容器」）。`help.mkf` 全檔沒有 `YJ_1`，但它也沒有壓縮子檔；壓縮演算法需在 `Data.mkf`、`Panel.mkf` 等檢查。

### H2：`*.mkf` 的索引表在檔尾，每個子檔前有 12 bytes 子檔頭
- 依據（inventory）：
  - offset 0 的 uint32（下稱 `tailOff`）接近檔案大小；7 個檔案的 `size − tailOff` 全部可被 4 整除，像 uint32 表。換算項數：Data 602、Effect 115、Panel 113、Speaking 1374、help 100、jump 71、map 298。
  - offset 4、8 的兩個 uint32 看似第一個子檔的「原始大小」與「儲存大小」：5 個檔案兩者相等（未壓縮），`Data.mkf`、`Panel.mkf` 不等（壓縮）。
  - offset 12 的 uint32 意義不明（觀察值 0、4、16、84、156、528）。
- 狀態：**以 16 bytes 子檔頭修正後成立**，結果整理為「已知格式」的「MKF 容器」條目。
- 可驗證的預測與結果（`help.mkf`，`jump.mkf` 交叉確認）：
  1. 檔尾表（`tailOff` 到檔尾）的值單調遞增。→ 通過。
  2. 檔尾表的值都落在 `[4, tailOff]`；第一個值為 4，最後一個值為 `tailOff`。→ 部分通過：表中存的是各子檔**起點**，最後一個值是最後一個子檔的起點，該子檔結束於 `tailOff`。
  3. 相鄰兩個偏移之差 = 12 + 該子檔的儲存大小。→ 不通過，每項固定多 4；改為 16 + 儲存大小後全部吻合。
  4. offset 4–15 屬於第一個子檔、而非全域檔頭。→ 通過。

## 檔案清單摘要
依 `local-assets/inventory.json`（81 個檔案）分組：

| 副檔名/群組 | 檔案數 | 推測用途 | 格式條目 | 狀態 |
|---|---|---|---|---|
| `*.mkf`（共同容器） | 7 | 主要素材封包 | MKF 容器 | 容器已解析；子檔內容未分析 |
| `help.mkf` | 1 | 說明：子檔 1–99 為 Big5 文字；子檔 0 為另一種結構（開頭 ASCII `SMP`） | MKF 容器 | 子檔內容延後 |
| `jump.mkf` | 1 | 全螢幕過場／載入畫面（第一子檔 614400 = 640×480×2） | MKF 容器 | 下一個分析（像素格式） |
| `map.mkf` | 1 | 地圖背景與資料（76.6 MB） | MKF 容器 | 未分析 |
| `Data.mkf` | 1 | 綜合素材（角色、卡片、精靈圖？；有壓縮） | MKF 容器 | 未分析 |
| `Panel.mkf` | 1 | UI 面板（有壓縮） | MKF 容器 | 未分析 |
| `Effect.mkf` | 1 | 特效動畫 | MKF 容器 | 未分析 |
| `Speaking.mkf` | 1 | 角色語音（熵 3.2–7.2，像未壓縮 PCM） | MKF 容器 | 未分析 |
| `*.mid` + `Midi.txt` | 25 + 1 | 背景音樂，標準 SMF（format 1、解析度 120）；`Midi.txt` 為曲目清單 | 不需解析 | 播放方式待定 |
| `*.avi` | 21 | 片頭片尾影片 | — | 本機副本中為 21 個相同的佔位檔，排除 |
| cnc-ddraw 相容層 | 18 | `ddraw.dll`、`ddraw.ini`、`cnc-ddraw config.exe`、`Shaders/`（15） | — | 排除（非原版內容） |
| 安裝／移除程式 | 5 | `Uninst.exe`、`Uninst.isu`、`Uninstall.exe`、`InstOK.wav`、`InstSel.wav` | — | 排除 |
| `rich4.exe` | 1 | 遊戲主程式 | — | 不當素材；必要時以 Ghidra 分析讀檔邏輯 |
| `RICH4.CFG` | 1 | 設定檔（72 bytes） | — | 延後 |
| `*.ico` | 2 | 圖示 | — | 排除 |

### 建議分析順序
1. MKF 容器：以 `help.mkf`（最小）、`jump.mkf`（第一子檔未壓縮）驗證 H2。
2. 像素格式：把 `jump.mkf` 第一子檔當 640×480 16-bit 轉 PNG 目視，確認 RGB555／RGB565 及是否另有調色盤。
3. `map.mkf`（完成條件所需）。
4. 壓縮演算法：`Data.mkf`、`Panel.mkf`；先找 `YJ_1` magic，否則以 Ghidra 找 `rich4.exe` 的解壓函式。
5. 精靈圖：`Data`、`Panel`、`Effect`。
6. `Speaking.mkf`、MIDI 播放方式。
7. 延後：`help.mkf` 內容、`RICH4.CFG`。

## 格式條目範本

```
### <格式名稱>（例：*.XXX 精靈圖包）
- 相關檔案：
- 推測用途：
- 位元組序：little-endian
- 檔頭：
  | offset | 長度 | 型別 | 說明 |
  |---|---|---|---|
- 主體結構：
- 壓縮/加密：無 / RLE / LZ / 未知
- 調色盤來源：
- 證據：（怎麼確認的，例如 Ghidra 中的函式位址、比對截圖）
- 解析器：tools/extract/src/formats/<name>.ts
- 待解問題：
```

## 已知格式

### MKF 容器（`*.mkf`）
- 相關檔案：`Data.mkf`、`Effect.mkf`、`Panel.mkf`、`Speaking.mkf`、`help.mkf`、`jump.mkf`、`map.mkf`
- 推測用途：素材封包，每個子檔是一筆素材。
- 位元組序：little-endian
- 檔頭：
  | offset | 長度 | 型別 | 說明 |
  |---|---|---|---|
  | 0 | 4 | uint32 | `tableOffset`：索引表位置 |
- 主體結構：
  - 子檔從 offset 4 開始連續排列，每個子檔 = 16 bytes 子檔頭 + `storedSize` bytes 內容。
  - 子檔頭：
    | offset | 長度 | 型別 | 說明 |
    |---|---|---|---|
    | 0 | 4 | uint32 | `rawSize`：推測為解壓後大小 |
    | 4 | 4 | uint32 | `storedSize`：檔內實際儲存的內容長度 |
    | 8 | 4 | uint32 | `unknown3`：意義未知 |
    | 12 | 4 | uint32 | `unknown4`：意義未知 |
  - `[tableOffset, EOF)` 是 N 個 uint32 的子檔起點，N = (檔案大小 − `tableOffset`) / 4；起點嚴格遞增，第一個為 4。
  - 每個子檔結束於下一個子檔的起點，最後一個結束於 `tableOffset`。允許 `storedSize` = 0 的空子檔。
- 壓縮/加密：容器本身無。`rawSize` > `storedSize` 的子檔推測為壓縮，演算法未知。
- 調色盤來源：不適用。
- 證據：
  - `help.mkf` 驗證 H2 的四個預測，並由此修正子檔頭為 16 bytes。
  - 嚴格解析器與逐項檢查（不在第一個錯誤停下）跑完 7 個檔案，都沒有例外：
    | 檔案 | 子檔數 | raw = stored | raw > stored | 空子檔 |
    |---|---|---|---|---|
    | `Data.mkf` | 602 | 291 | 311 | 0 |
    | `Effect.mkf` | 115 | 115 | 0 | 16 |
    | `Panel.mkf` | 113 | 21 | 92 | 0 |
    | `Speaking.mkf` | 1374 | 1374 | 0 | 0 |
    | `help.mkf` | 100 | 100 | 0 | 0 |
    | `jump.mkf` | 71 | 35 | 36 | 0 |
    | `map.mkf` | 298 | 275 | 23 | 0 |
  - 沒有任何子檔 `rawSize` < `storedSize`。
- 解析器：`tools/extract/src/formats/mkf.ts`（只讀索引表與子檔頭，內容以 offset 按需讀取）
- 待解問題：
  - `unknown3`、`unknown4` 的意義。觀察：
    - `help.mkf`：99 項為 (0, 0)；子檔 0 的 `unknown3 + unknown4 = rawSize`。
    - `jump.mkf`：10 項 `unknown3 + unknown4 = rawSize`；25 項為 (0, 0)；36 項 `unknown4 = 512`、`unknown3` 為 12 的倍數。36 項 `rawSize > storedSize` 的子檔是否就是這 36 項，尚未確認。
  - 壓縮演算法（`help.mkf` 無 `YJ_1`，但也沒有壓縮子檔）。
  - `rawSize` 是否確為解壓後大小，需等壓縮演算法確認。
