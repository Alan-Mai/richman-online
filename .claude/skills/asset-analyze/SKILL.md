---
name: asset-analyze
description: 分析原版大富翁4的一個素材檔或一組同類檔案的二進位格式，記錄到 docs/ASSET_FORMATS.md 並撰寫解析器。
argument-hint: "[RICHMAN4_DIR 內的檔名或萬用字元]"
disable-model-invocation: true
---

分析原版素材：$ARGUMENTS

限制：
- 只讀取 `$RICHMAN4_DIR`，絕不修改或複製原檔到倉庫內。
- 輸出只寫到 `local-assets/`。文件中只記錄結構，不貼原始內容。

步驟：
1. 讀 `docs/ASSET_FORMATS.md`，確認此格式是否已有條目；有則延續其「待解問題」。
2. 收集基本資訊：檔案大小、前 64 bytes、同類檔案之間大小與檔頭的差異、明顯字串、熵（判斷是否壓縮）。
3. 提出 2–3 個格式假設，各自說明可驗證的預測（例如「offset 4 的 uint16 × offset 6 的 uint16 應等於主體長度」）。
4. 寫小型驗證腳本逐一檢驗假設，把腳本放 `tools/extract/scratch/`（可刪）。
5. 若為圖片：嘗試以推測的寬高與調色盤轉成 PNG 寫到 `local-assets/preview/`，並請我目視確認是否正確。
6. 確認後：在 `ASSET_FORMATS.md` 用範本新增/更新條目；在 `tools/extract/src/formats/` 寫正式解析器；用**合成資料**寫單元測試。
7. 回報：結論、信心程度、還未解的問題、建議下一個分析的檔案。

卡住時（例如疑似壓縮或加密），提出是否需要用 Ghidra 分析執行檔的讀檔函式，並說明要找什麼。
