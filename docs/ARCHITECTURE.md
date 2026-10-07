# 架構說明

## 總覽

```
┌──────────────┐   意圖動作 (Action)   ┌──────────────────────┐
│  Client      │ ───────────────────▶ │  Server (Colyseus)    │
│  Phaser 3    │                      │  驗證 → applyAction   │
│  播放事件動畫 │ ◀─────────────────── │  → 廣播 Events + View │
└──────────────┘  事件 + 過濾後狀態    └──────────────────────┘
        ▲                                       │
        └──────── packages/shared（規則引擎）────┘
```

## 規則引擎（packages/shared）

核心函式：

```ts
type Result =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: RuleError };

function applyAction(state: GameState, action: Action): Result;
function legalActions(state: GameState, playerId: PlayerId): Action[];   // 只在伺服器執行
function viewFor(state: GameState, playerId: PlayerId | 'spectator'): PlayerView;
```

`'spectator'` 先保留在型別中，觀戰模式尚未實作。

原則：

- **純函式、決定性**：同樣的初始狀態（含 `rngState`）+ 動作序列，一定得到同樣結果。這讓存檔、重播、斷線重連、除錯都只需要「初始狀態 + 動作紀錄」。
- **回合以狀態機表示**：`phase` 欄位描述目前等待什麼（例如 `awaitRoll`、`awaitBuyDecision`、`awaitCardTarget`、`resolving`）。`legalActions` 只依 `phase` 與玩家身分回傳合法動作。
- **合法動作由伺服器計算**：`legalActions` 需要完整 `GameState`，只在伺服器執行；每次廣播時把該玩家的合法動作清單隨 `PlayerView` 一起送出。客戶端只依這份清單顯示可選項目，不自行判斷規則。
- **事件是給畫面用的**：`GameEvent`（`DiceRolled`、`PlayerMoved`、`PropertyBought`、`RentPaid`、`CardDrawn`……）描述「發生了什麼」，客戶端依序播放動畫；客戶端不從狀態差異推算動畫。
- **RNG**：使用可序列化的 PRNG（例如 mulberry32 / xoshiro）。唯一來源是 `state.rngState`：`applyAction` 從中取亂數，並把新的 RNG 狀態寫回回傳的 state，不另外接受 rng 參數。`rngState` 不進入 `PlayerView`。測試用 helper 把 `rngState` 換成預先排好的骰點序列。
- **規則參數化**：起始資金、過路費倍率、房屋上限等放在 `RuleConfig`，方便對照原版與開房自訂。

### 主要型別（草稿）

```ts
interface GameState {
  config: RuleConfig;
  board: Board;              // 地圖格子定義（來自轉檔資料或內建測試地圖）
  players: PlayerState[];    // 現金、存款、位置、道具、卡片、狀態效果
  tiles: TileState[];        // 擁有者、房屋等級
  market: StockMarket;
  turn: { current: PlayerId; round: number; phase: Phase };
  rngState: RngState;        // 伺服器專用
}

// 伺服器送給單一玩家的訊息
interface ServerUpdate {
  events: GameEvent[];
  view: PlayerView;          // viewFor(state, playerId)
  legalActions: Action[];    // legalActions(state, playerId)，非輪到該玩家時為空陣列
}
```

## 伺服器（apps/server）

- 一局遊戲 = 一個 Colyseus Room。
- 收到訊息 → 檢查是否為當前玩家、動作是否在 `legalActions` 內 → `applyAction` → 寫入動作紀錄 → 對每位玩家送出 `ServerUpdate`（`events`、`viewFor` 結果、該玩家的 `legalActions`）。
- 回合計時器逾時：由伺服器代為執行預設動作（或交給電腦 AI）。
- 斷線：保留座位 N 秒，期間由 AI 代打；重連時送完整 `viewFor`。
- 房間以 6 碼邀請碼加入。

## 客戶端（apps/client）

- 啟動時從 `local-assets/`（或使用者以瀏覽器選取的轉檔包）載入素材；找不到素材時使用內建佔位圖，確保開發與測試不依賴原版檔案。
- 場景分層：地圖、角色、UI、對話框。
- 事件佇列：依序播放伺服器事件，播放期間鎖住輸入。
- 可操作的按鈕/選項只依伺服器送來的 `legalActions` 顯示。

## 素材工具（tools/extract）

- `RICHMAN4_DIR` 必須是絕對路徑；啟動時若為相對路徑或路徑不存在，直接報錯結束。只讀取，不寫入。
- 讀取 `RICHMAN4_DIR`，輸出現代格式到 `local-assets/`：圖片→PNG（含調色盤處理）、音效→WAV/OGG、地圖→JSON。
- 每種格式的結構記錄於 `docs/ASSET_FORMATS.md`。
- 單元測試使用自行合成的小檔案，不使用原版檔案。

## 模擬器（tools/sim）

- 以隨機 AI（從 `legalActions` 隨機選）跑大量對局，每一步檢查不變量；失敗時輸出種子與動作序列。
- 不屬於規則引擎，可使用 `console` 與檔案 I/O。

## 法律界線

- 本專案只散布原創程式碼（GPL-3.0）。玩家須持有正版遊戲並在本機執行轉檔。
- **公開伺服器只提供原創地圖**。原版轉檔地圖（格子、地價等結構資料）只能用在持有正版者自架的房間，避免伺服器把原版衍生資料傳給未持有正版的玩家。
