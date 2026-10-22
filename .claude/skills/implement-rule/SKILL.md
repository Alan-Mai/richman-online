---
name: implement-rule
description: 依 docs/GAME_RULES.md 的一條規則或一張卡片，以測試先行方式實作到規則引擎。
argument-hint: "[規則或卡片名稱]"
disable-model-invocation: true
---

實作規則：$ARGUMENTS

1. 在 `docs/GAME_RULES.md` 找到這條規則。若找不到、或狀態是 `❓ 待確認`，列出你需要我確認的問題後停下，不要猜。
2. 列出影響範圍：新增/修改的 Action、Phase、GameEvent、state 欄位、RuleConfig 參數、`viewFor` 是否需過濾。寫進計畫檔，經 `reviewer` 審查後隨計畫給我核准（`.claude/rules/autonomy.md`）；已核准計畫內的規則直接進行。
3. 先寫測試（`packages/shared`），至少涵蓋：正常效果、非法時機、非法目標、與既有效果的互動、邊界數值（錢剛好不夠等）。執行確認測試失敗。
4. 實作到測試通過。
5. 跑 `tools/sim/` 的終端機模擬器 200 局確認沒有崩潰或非法狀態。
6. `pnpm format` 並 add，執行 `pnpm check:commit`。
7. 更新 `GAME_RULES.md` 該規則狀態與 `ROADMAP.md` 勾選，與程式碼一起放進同一個 commit（`feat(shared): <規則>`），訊息附 `Test-first:` 段落（`.claude/rules/test-first.md`）。
