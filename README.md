# Richman Online

以《大富翁4》為藍本的開源網頁多人連線重製引擎。

> 本專案不包含任何原版遊戲素材。你必須擁有正版《大富翁4》，並在本機使用 `tools/extract` 轉出素材。

## 文件
- [CLAUDE.md](CLAUDE.md) — 專案規則（Claude Code 會自動讀取）
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 架構
- [docs/ROADMAP.md](docs/ROADMAP.md) — 路線圖與進度
- [docs/GAME_RULES.md](docs/GAME_RULES.md) — 遊戲規則規格
- [docs/ASSET_FORMATS.md](docs/ASSET_FORMATS.md) — 原版檔案格式筆記
- [docs/DECISIONS.md](docs/DECISIONS.md) — 技術決策紀錄
- [PROMPTS.md](PROMPTS.md) — Claude Code 各階段提示詞

## Claude Code 自訂指令
- `/asset-analyze <檔案>` — 分析一種原版檔案格式
- `/implement-rule <規則>` — 測試先行實作一條規則
- `/phase-check` — 驗證目前階段完成度
- `/wrap-up` — session 收尾：確認變更、更新 ROADMAP 下一步、整理規則、commit
- `/pre-push` — 推送前檢查：作者 email、逐一檢查每個 commit 的素材，通過才推送

## 授權
程式碼以 [GNU General Public License v3.0](LICENSE) 釋出。

此授權只涵蓋本倉庫的原創程式碼與文件，不包含《大富翁4》的任何素材。原版遊戲的著作權屬於其權利人。
公開伺服器只提供原創地圖；原版地圖只能用在持有正版者自架的房間。
