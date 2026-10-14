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

function createGame(setup: GameSetup):
  | { ok: true; state: GameState; events: GameEvent[] }   // events = 第一個 TurnStarted
  | { ok: false; errors: CreateGameError[] };
function applyAction(state: GameState, action: Action): Result;
function legalActions(state: GameState, playerId: PlayerId): Action[];   // 只在伺服器執行
function viewFor(state: GameState, viewer: Viewer): PlayerView;

type Viewer = { kind: 'player'; id: PlayerId } | { kind: 'spectator' };
```

觀戰者（`{ kind: 'spectator' }`）先保留在型別中，觀戰模式尚未實作。用可辨識聯合型別而不是 `PlayerId | 'spectator'`，是因為 `PlayerId` 是字串，id 剛好叫 `'spectator'` 的玩家會和觀戰者混淆。

- `applyAction` 自行驗證動作格式（日後來自網路）：格式錯誤回傳 `invalidAction`，不 throw。錯誤優先順序 `invalidAction` > `gameOver` > `unknownPlayer` > `notYourTurn` > `wrongPhase` > `insufficientFunds`。
- `PlayerView` = `GameState` 去掉 `rngState`，加上 `viewer`；欄位逐一列出複製，新增的 state 欄位預設不會外洩。
- 金錢相關邏輯在 `money.ts`：`pay()`（強制付款：現金 → 存款 → 破產）、`spend()`（購地、加蓋，依 `purchaseFunds`）、`rentFor`、`upgradeCost`、`totalAssets`。

原則：

- **純函式、決定性**：同樣的初始狀態（含 `rngState`）+ 動作序列，一定得到同樣結果。這讓存檔、重播、斷線重連、除錯都只需要「初始狀態 + 動作紀錄」。
- **回合以狀態機表示**：`phase` 欄位描述目前等待什麼（例如 `awaitRoll`、`awaitBuyDecision`、`awaitCardTarget`、`resolving`）。`legalActions` 只依 `phase` 與玩家身分回傳合法動作。
- **合法動作由伺服器計算**：`legalActions` 需要完整 `GameState`，只在伺服器執行；每次廣播時把該玩家的合法動作清單隨 `PlayerView` 一起送出。客戶端只依這份清單顯示可選項目，不自行判斷規則。
- **事件是給畫面用的**：`GameEvent`（`DiceRolled`、`PlayerMoved`、`PropertyBought`、`RentPaid`、`CardDrawn`……）描述「發生了什麼」，客戶端依序播放動畫；客戶端不從狀態差異推算動畫。
- **RNG**：使用可序列化的 PRNG（例如 mulberry32 / xoshiro）。唯一來源是 `state.rngState`：`applyAction` 從中取亂數，並把新的 RNG 狀態寫回回傳的 state，不另外接受 rng 參數。`rngState` 不進入 `PlayerView`。測試用 helper 把 `rngState` 換成預先排好的骰點序列。
- **規則參數化**：起始資金、過路費倍率、房屋上限等放在 `RuleConfig`，方便對照原版與開房自訂。

### 主要型別

完整定義見 `packages/shared/src/`（`config.ts`、`board.ts`、`state.ts`、`actions.ts`、`events.ts`、`rng.ts`）。

```ts
interface GameState {
  config: RuleConfig;        // GAME_RULES.md 標 ⚙️ 的參數
  board: Board;              // 地圖格子定義（來自轉檔資料或內建測試地圖）
  players: PlayerState[];    // 座位順序；現金、存款、位置、上一格、骰子數、是否破產
  tiles: TileState[];        // 與 board.tiles 平行：擁有者、房屋等級
  turn: { current: PlayerId; round: number; phase: Phase };
  rngState: RngState;        // 伺服器專用
}

interface Board { tiles: TileDef[]; start: TileIndex; /* id, name */ }
// TileDef 為依 kind 區分的聯合型別（目前 'property' | 'blank' | 'unsupported'），每格有無向的 links（最多 4 個，
// 兩端都要列出；可設 blocked = 不能從這一端走出去）。沒有前進方向：玩家記 prev（上一格），
// 每步走「未封鎖且不是 prev」的相鄰格，多個時用 RNG 選，沒有時掉頭（GAME_RULES.md 第 2 節）。

type Phase =
  | { kind: 'awaitRoll' }
  | { kind: 'awaitBuyDecision'; tile; price }
  | { kind: 'awaitUpgradeDecision'; tile; cost }
  | { kind: 'gameOver'; winners };
```

股票（`market`）、道具、卡片、狀態效果在 Phase 5 加入。

### 回合狀態轉移（Phase 2）

```
createGame ──▶ awaitRoll（座位 0）
                 │ rollDice
                 ▼
     擲骰 → 逐格移動：每經過一格（不含停留格）執行該格的「經過觸發」
              ├ 自動效果（例如 passStartBonus）→ 繼續
              └ 需玩家決定（日後，例如銀行）→ 暫停於新 phase，決定後走完剩下步數
     停留格處理：
       ├ 無主地產且付得起 → awaitBuyDecision ── buyProperty / decline ─┐
       ├ 自己的地產、可加蓋且付得起 → awaitUpgradeDecision ── upgradeProperty / decline ─┤
       ├ 他人的地產 → 付過路費（現金 → 存款 → 破產）───────────────┤
       └ 其他 ─────────────────────────────────────────────┤
                                                              ▼
     回合結束：未破產玩家 ≤ 1 → gameOver（lastStanding）
               下一位未破產玩家；繞回座位 0 時：
                 ├ richestAtRoundLimit 且 round === maxRounds → gameOver（總資產最高，平手並列）
                 └ 否則 round + 1
               → awaitRoll
```

回合開始的狀態效果與擲骰前使用道具（GAME_RULES 標 ❓）日後在 `awaitRoll` 前插入新的 phase。

```ts
// 伺服器送給單一玩家的訊息
interface ServerUpdate {
  events: GameEvent[];
  view: PlayerView;          // viewFor(state, { kind: 'player', id: playerId })
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

```
UI（DOM 按鈕 / 鍵盤）──intent──▶ GameConnection ──▶ LocalGameHost（hot-seat；Phase 4 換成 Colyseus）
                                                     createGame / legalActions / applyAction / viewFor
GameController ◀── ServerUpdate {events, view, legalActions} ──┘
   └▶ EventQueue ──逐一播放──▶ Animator（PhaserAnimator）
          │ 每個事件推進 DisplayModel ──▶ GameScene（棋盤、棋子）、Hud（DOM）、GameOverDialog
          └ 全部播完：與 view 比對（不一致就警告並校正）→ 釋出 legalActions 給動作列
```

- **不在客戶端判斷規則**：只有 `net/local-host.ts` 呼叫 `legalActions` / `applyAction`（它扮演伺服器）；其餘模組只讀 `ServerUpdate`。intent 不帶 `playerId`，由主機補上。
- **事件驅動畫面**：`model/display.ts` 的 `applyEventToDisplay` 逐事件推進畫面狀態；測試確認「事件依序套在前一個 view 上必定得到下一個 view」，事件缺資訊時會被抓到。
- **輸入鎖定**：`EventQueue` 播放期間 busy，按鈕全部移除；播完才以最新一筆更新的 `legalActions` 產生按鈕。動畫失敗會跳過，不卡住遊戲。
- **分層**：Phaser 只畫棋盤、棋子、骰子與飄字（`scenes/`、`render/`）；HUD、設定畫面、結算框、原版地圖選單是 DOM（`ui/`），可用 Vitest + happy-dom 測試。版面為 CSS grid，寬度 ≤ 720px 時改為上下排列。
- **動畫時間**集中在 `render/timings.ts`（暫定值，待量測原版）。
- **素材**：可玩棋局只用內建地圖與程式繪製的佔位圖，不依賴原版檔案。原版地圖目前只有唯讀預覽：dev 模式透過只回應本機的 Vite middleware 讀 `local-assets/maps/`（`vite/local-assets.ts`），任何模式都可匯入自己轉出的資料夾（`assets/`）；原版材質一律以最近鄰取樣載入（`render/original-texture.ts`）。建置產物不含任何素材。
- 玩家可見文字集中在 `i18n/zh-TW.ts`，`t()` 依佔位名稱在型別層檢查參數。

## 素材工具（tools/extract）

- `RICHMAN4_DIR` 必須是絕對路徑；啟動時若為相對路徑或路徑不存在，直接報錯結束。只讀取，不寫入。
- 讀取 `RICHMAN4_DIR`，輸出現代格式到 `local-assets/`：圖片→PNG（含調色盤處理）、音效→WAV/OGG、地圖→JSON。
- 每種格式的結構記錄於 `docs/ASSET_FORMATS.md`。
- 單元測試使用自行合成的小檔案，不使用原版檔案。

## 模擬器（tools/sim）

- 以隨機 AI（從 `legalActions` 隨機選）跑大量對局，每一步檢查不變量；失敗時輸出種子與動作序列。
- 不屬於規則引擎，可使用 `console` 與檔案 I/O。
- 模組：`args.ts`（參數）、`game.ts`（單局與逐步檢查，engine 可注入以測試失敗偵測）、`replay.ts`（紀錄檔與重播）、`stats.ts`（統計與輸出格式）、`simulate.ts`（流程，I/O 注入）、`main.ts`（接上 console 與檔案）。
- 不變量由 `packages/shared` 的 `checkInvariants(state): string[]` 提供，模擬器另外檢查：輪到的玩家有合法動作且每個都被接受、清單外的動作類型以 `wrongPhase` 拒絕、其他玩家（遊戲結束後所有人）沒有動作、`gameOver` 時有 `GameEnded` 事件。
- 每個失敗寫入 `tools/sim/out/failure-<該局種子>.json`（gitignore），內容為 config、玩家、種子、動作序列與模擬器看到的結果；`replay` 只依動作序列重播並判斷是否重現。終端機只印前 `--max-failure-details`（預設 5）筆的完整內容，最後印失敗原因分組統計。
- 輸出用英文 ASCII，避免 Windows 主控台字碼頁造成亂碼。

## 法律界線

- 本專案只散布原創程式碼（GPL-3.0）。玩家須持有正版遊戲並在本機執行轉檔。
- **公開伺服器只提供原創地圖**。原版轉檔地圖（格子、地價等結構資料）只能用在持有正版者自架的房間，避免伺服器把原版衍生資料傳給未持有正版的玩家。
