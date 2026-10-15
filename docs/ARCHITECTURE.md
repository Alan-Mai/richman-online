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
  | { ok: true; state: GameState; events: GameEvent[] }   // events = 第一個 TurnStarted、座位 0 的 PlayerPlaced
  | { ok: false; errors: CreateGameError[] };
function applyAction(state: GameState, action: Action): Result;
function actorOf(state: GameState): PlayerId | null;                     // 目前在等誰；遊戲結束為 null
function legalActions(state: GameState, playerId: PlayerId): Action[];   // 只在伺服器執行
function computerAction(state: GameState, playerId: PlayerId): Action | null;  // 只在伺服器／模擬器執行
function viewFor(state: GameState, viewer: Viewer): PlayerView;
function checkInvariants(state: GameState): string[];                    // 模擬器與測試用

type Viewer = { kind: 'player'; id: PlayerId } | { kind: 'spectator' };
```

觀戰者（`{ kind: 'spectator' }`）先保留在型別中，觀戰模式尚未實作。用可辨識聯合型別而不是 `PlayerId | 'spectator'`，是因為 `PlayerId` 是字串，id 剛好叫 `'spectator'` 的玩家會和觀戰者混淆。

- `applyAction` 自行驗證動作格式（日後來自網路），依動作種類逐一檢查參數（`bid.raise`、`setDiceCount.count` 必須是整數）：格式錯誤回傳 `invalidAction`，不 throw。錯誤優先順序 `invalidAction` > `gameOver` > `unknownPlayer` > `notYourTurn`（送出者不是 `actorOf`）> `wrongPhase` > 動作本身的檢查（參數不在允許範圍的 `invalidAction`，例：不在加價檔位內、步行時選顆數；`insufficientFunds`）。
- `PlayerView` 的欄位逐一列出複製，新增的 state 欄位預設不會外洩。不送：`rngState`、`lotteryPool`（彩券獎池，Phase 5 再定）、拍賣尚未開拍的地塊清單（只送剩餘塊數 `remaining`）、電腦的隱藏欄位（拍賣 `computerLimits`、`awaitRoll` 的 `computerDiceCount`）。
- 金錢相關邏輯在 `money.ts`：`pay()`（強制付款：現金 → 存款 → 破產；收款進債權人存款，系統債務破產時餘款進 `lotteryPool`）、`spend()`（購地、加蓋、得標，只用現金）、價格 helper `buyPrice`／`upgradeCost`／`rentFor`／`auctionStartPrice`（收 `PriceView`）與 `netWorth`（收 `NetWorthView`）。`GameState`、`PlayerView` 與客戶端的 display model 都符合，前後端算出同樣的數字。
- 其他模組：`movement.ts`（`stepFrom` 走一步、`previewPath` 預覽，實際移動與電腦預覽共用）、`auction.ts`（破產拍賣）、`computer.ts`（電腦出價上限與選顆數的抽取、出價選擇）、`tables.ts`（`parseOriginalTables`，見下方「原版資料表」）、`invariants.ts`。

原則：

- **純函式、決定性**：同樣的初始狀態（含 `rngState`）+ 動作序列，一定得到同樣結果。這讓存檔、重播、斷線重連、除錯都只需要「初始狀態 + 動作紀錄」。
- **回合以狀態機表示**：`phase` 欄位描述目前等待什麼（例如 `awaitRoll`、`awaitBuyDecision`、`awaitCardTarget`、`resolving`）。`legalActions` 只依 `phase` 與玩家身分回傳合法動作。
- **合法動作由伺服器計算**：`legalActions` 需要完整 `GameState`，只在伺服器執行；每次廣播時把該玩家的合法動作清單隨 `PlayerView` 一起送出。客戶端只依這份清單顯示可選項目，不自行判斷規則。
- **事件是給畫面用的**：`GameEvent`（`DiceRolled`、`PlayerMoved`、`PropertyBought`、`RentPaid`、`CardDrawn`……）描述「發生了什麼」，客戶端依序播放動畫；客戶端不從狀態差異推算動畫。
- **RNG**：使用可序列化的 PRNG（例如 mulberry32 / xoshiro）。唯一來源是 `state.rngState`：`applyAction` 從中取亂數，並把新的 RNG 狀態寫回回傳的 state，不另外接受 rng 參數。`rngState` 不進入 `PlayerView`。測試用 helper 把 `rngState` 換成預先排好的骰點序列。
- **只實作原版規則**：沒有非原版的規則模式（`DECISIONS.md` 2026-10-14）。`RuleConfig` 只放原版設定畫面的選項（起始資金、天數上限、淨值目標、起始交通工具）與 `GAME_RULES.md` 已寫的單一常數（顆數上限、拍賣塊數與加價檔位、電腦出價與選顆數的常數、`maxLevel` 等）；數值不寫死在引擎內。逐格數值（地價、加蓋費、過路費、街名、封鎖）放在 `Board`。

### 行動者與電腦玩家

- 同一時間只有一位行動者：`actorOf(state)` 平常是 `turn.current`，拍賣中是輪到出價的人（`phase.bidder`），遊戲結束時是 `null`。`applyAction` 與 `legalActions` 都以它判斷是否輪到。
- 每位玩家有 `controller: 'human' | 'computer'`（`PlayerSetup` 必填）。電腦的動作由 `computerAction(state, id)` 產生，結果一定在 `legalActions` 內，照樣送進 `applyAction`，所以動作紀錄與重播與人類相同。
- 電腦決策需要的亂數，由引擎在決策開始時從 `rngState` 抽好、存成 phase 的隱藏欄位（拍賣開拍時的 `computerLimits`、電腦回合開始時的 `computerDiceCount`），`computerAction` 本身只是讀狀態的純函式，不消耗亂數。
- 呼叫者：伺服器（Phase 4）、模擬器、客戶端的 `LocalGameHost`（hot-seat，扮演伺服器）。電腦購地與加蓋目前是非原版的暫定策略（有提供就買、就蓋），見 ROADMAP Phase 5。

### 原版資料表

- 執行檔資料表（動畫表、道具表、設定選項表、角色範本）由 `tools/extract` 的 `cli tables` 匯出成本機的 `local-assets/tables.json`，倉庫不放數值（`DECISIONS.md` 2026-10-14、2026-10-15）。
- shared 只提供型別 `OriginalTables` 與純函式 `parseOriginalTables(json: unknown)`：一次回傳全部錯誤的清單（可辨識聯合型別，含欄位路徑），不 throw。引擎不讀檔、`RuleConfig` 不直接引用這些表；讀檔與換算在呼叫端（目前只有客戶端設定畫面匯入，用於動畫表），公開伺服器不載入。

### 主要型別

完整定義見 `packages/shared/src/`（`config.ts`、`board.ts`、`state.ts`、`actions.ts`、`events.ts`、`rng.ts`）。

```ts
interface GameState {
  config: RuleConfig;        // 原版設定選項與單一常數
  board: Board;              // 地圖格子定義（來自轉檔資料或內建測試地圖）
  players: PlayerState[];    // 座位順序
  tiles: TileState[];        // 與 board.tiles 平行：擁有者、建築等級（無主地也可能有等級）
  turn: { current: PlayerId; round: number; phase: Phase };
  day: number;               // 已過天數，新局 0，每輪 +1
  priceIndex: number;        // 物價指數 coef，新局 1，只升不降
  lotteryPool: number;       // 彩券獎池，viewFor 不送
  rngState: RngState;        // 伺服器專用
}

interface PlayerState {
  id; name; controller: 'human' | 'computer';
  cash; deposit; points;
  location: { kind: 'offBoard' } | { kind: 'onBoard'; tile: TileIndex; prev: TileIndex };
  vehicle: 'walk' | 'motorbike' | 'car';
  diceCount: number;         // 1..該交通工具的顆數上限
  bankrupt: boolean;
}

interface Board { id; name; tiles: TileDef[] }   // 沒有起點：每位玩家第一回合隨機放置
// TileDef 為依 kind 區分的聯合型別：'property'（price、upgradeCost、rents）| 'blank' | 'unsupported'
// （尚未支援的地圖內容，例如大型建築；可經過、停留沒有效果、不會被選為起點）。每格有無向的 links
// （最多 4 個，兩端都要列出；可設 blocked = 不能從這一端走出去），可設 noRandomPlacement。
// 沒有前進方向：玩家記 prev（上一格），每步走「未封鎖且不是 prev」的相鄰格，多個時用 RNG 選，
// 沒有時掉頭（GAME_RULES.md 第 2 節）。

type Phase =
  | { kind: 'awaitRoll'; computerDiceCount?: number }        // 隱藏欄位只在電腦騎機車或汽車時有
  | { kind: 'awaitBuyDecision'; tile; price }
  | { kind: 'awaitUpgradeDecision'; tile; cost }
  | { kind: 'auction'; tile; queue; startPrice; price; leader; bidder; bidders; computerLimits }
  | { kind: 'gameOver'; winners };
```

動作：`rollDice`、`setDiceCount{count}`、`buyProperty`、`upgradeProperty`、`decline`、`bid{raise}`、`passRound`、`withdraw`。股票、道具、卡片、狀態效果、銀行在之後的階段加入。

### 回合狀態轉移

```
createGame ──▶ startTurn（座位 0）
startTurn(玩家)：TurnStarted → 尚未放置則隨機放置（PlayerPlaced）
                 → 電腦騎機車或汽車：預抽本回合顆數（隱藏）→ awaitRoll
awaitRoll ── setDiceCount{count}（機車、汽車；停在 awaitRoll）
          └─ rollDice
                 ▼
     擲骰（diceCount 顆）→ 逐格移動：每經過一格（不含停留格）執行該格的「經過觸發」
              ├ 自動效果（目前沒有格子有經過效果）→ 繼續
              └ 需玩家決定（日後，例如銀行）→ 暫停於新 phase，決定後走完剩下步數
     停留格處理：
       ├ 無主地產且現金付得起 → awaitBuyDecision ── buyProperty / decline ─────────┐
       ├ 自己的地產、可加蓋且現金付得起 → awaitUpgradeDecision ── upgradeProperty / decline ─┤
       ├ 他人的地產 → 付過路費（現金 → 存款，進地主存款）──────────────────────┤
       │    └ 付不起 → 破產（地產全部無主、建築保留）：                           │
       │         ├ 開局唯一的人類座位破產 → gameOver（humanBankrupt，沒有勝者）      │
       │         ├ 場上沒有人類 → gameOver（noHumansLeft，沒有勝者）                │
       │         ├ 只剩 1 人 → 回合結束 → gameOver（lastStanding）                  │
       │         ├ 地產 3 塊以下 → 不拍賣 ─────────────────────────────┤
       │         └ 地產超過 3 塊 → 抽 3 塊逐塊拍賣（auction，行動者 = 出價者）：     │
       │              bid / passRound / withdraw，直到成交或流標；全部拍完 ───────┤
       └ 其他 ──────────────────────────────────────────────────────┤
                                                                         ▼
     回合結束：未破產玩家 ≤ 1 → gameOver（lastStanding）
               下一位未破產玩家；繞回座位 0 時：
                 日 + 1（DayAdvanced）：
                 ├ 達到天數上限（最高淨值 > 0）或淨值目標
                 │    → gameOver（dayLimitOrNetWorthTarget；淨值最高者，同額座位較前者）
                 └ 否則更新物價指數，round + 1
               → startTurn（下一位）
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
- 收到訊息 → 檢查送出者是否為 `actorOf`、動作是否在 `legalActions` 內 → `applyAction` → 寫入動作紀錄 → 對每位玩家送出 `ServerUpdate`（`events`、`viewFor` 結果、該玩家的 `legalActions`）。
- 行動者是電腦座位時，伺服器呼叫 `computerAction` 取得動作，照同樣流程送進 `applyAction`。
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

- **不在客戶端判斷規則**：只有 `net/local-host.ts` 呼叫 `actorOf` / `legalActions` / `applyAction` / `computerAction`（它扮演伺服器；電腦座位每個動作送一次更新，電腦行動時不送可選動作）；其餘模組只讀 `ServerUpdate`。intent 帶完整參數（例：加價檔位、顆數），不帶 `playerId`，由主機補上（拍賣中是輪到出價的人）。
- **事件驅動畫面**：`model/display.ts` 的 `applyEventToDisplay` 逐事件推進畫面狀態；測試確認「事件依序套在前一個 view 上必定得到下一個 view」，事件缺資訊時會被抓到。
- **輸入鎖定**：`EventQueue` 播放期間 busy，按鈕全部移除；播完才以最新一筆更新的 `legalActions` 產生按鈕。動畫失敗會跳過，不卡住遊戲。
- **分層**：Phaser 只畫棋盤、棋子、骰子與飄字（`scenes/`、`render/`）；HUD、設定畫面、結算框、原版地圖選單是 DOM（`ui/`），可用 Vitest + happy-dom 測試。版面為 CSS grid，寬度 ≤ 720px 時改為上下排列。
- **動畫時間**集中在 `render/timings.ts`：結構照原版（`GAME_RULES.md` 第 10 節），幀長與每幀位移用 `Pacing`（專案自訂值，或設定畫面匯入 `tables.json` 後由 `pacingFromTables` 換算的原版值）；拍賣照原版的固定時間。
- **素材**：可玩棋局只用內建地圖與程式繪製的佔位圖，不依賴原版檔案。原版地圖目前只有唯讀預覽：dev 模式透過只回應本機的 Vite middleware 讀 `local-assets/maps/`（`vite/local-assets.ts`），任何模式都可匯入自己轉出的資料夾（`assets/`）；原版材質一律以最近鄰取樣載入（`render/original-texture.ts`）。建置產物不含任何素材。
- 玩家可見文字集中在 `i18n/zh-TW.ts`，`t()` 依佔位名稱在型別層檢查參數。

## 素材工具（tools/extract）

- `RICHMAN4_DIR` 必須是絕對路徑；啟動時若為相對路徑或路徑不存在，直接報錯結束。只讀取，不寫入。
- 讀取 `RICHMAN4_DIR`，輸出現代格式到 `local-assets/`：圖片→PNG（含調色盤處理）、音效→WAV/OGG、地圖→JSON、`rich4.exe` 的資料表→`tables.json`（`cli tables`，以寫死的虛擬位址定位並檢查結構，終端機只印筆數）。
- 每種格式的結構記錄於 `docs/ASSET_FORMATS.md`。
- 單元測試使用自行合成的小檔案，不使用原版檔案。

## 模擬器（tools/sim）

- 跑大量對局，每一步檢查不變量；失敗時輸出種子與動作序列。座位由 `--controllers` 決定：`random`（全部隨機，從 `legalActions` 均勻選）、`computer`（座位 0 隨機、其餘電腦）、`mixed`（座位 1、3 電腦，0、2 隨機）；隨機座位的 `controller` 是 `human`，電腦座位照 `computerAction` 行動。
- 不屬於規則引擎，可使用 `console` 與檔案 I/O。
- 模組：`args.ts`（參數）、`game.ts`（單局與逐步檢查，engine 可注入以測試失敗偵測）、`replay.ts`（紀錄檔與重播）、`stats.ts`（統計與輸出格式）、`simulate.ts`（流程，I/O 注入）、`main.ts`（接上 console 與檔案）。
- 不變量由 `packages/shared` 的 `checkInvariants(state): string[]` 提供，模擬器另外檢查：輪到的玩家（`actorOf`）有合法動作且每個都被接受、清單外的動作類型各造一個範例並確認被拒絕（通常是 `wrongPhase`）、其他玩家（遊戲結束後所有人）沒有動作、電腦的選擇在 `legalActions` 內且人類座位的 `computerAction` 是 `null`、物價指數不下降、每位玩家與旁觀者的 `viewFor` 不含隱藏欄位、單一拍賣的動作數上限、`gameOver` 時有 `GameEnded` 事件。
- 天數上限與淨值目標不限時，模擬器有不屬於規則的安全上限 `--max-days`（預設 1000），到達時記為「未結束」而不是失敗；`--max-steps` 超過則是失敗。
- 每個失敗寫入 `tools/sim/out/failure-<該局種子>.json`（gitignore），內容為 config、玩家、種子、動作序列與模擬器看到的結果；`replay` 只依動作序列重播並判斷是否重現。終端機只印前 `--max-failure-details`（預設 5）筆的完整內容，最後印失敗原因分組統計。
- 輸出用英文 ASCII，避免 Windows 主控台字碼頁造成亂碼。

## 法律界線

- 本專案只散布原創程式碼（GPL-3.0）。玩家須持有正版遊戲並在本機執行轉檔。
- **公開伺服器只提供原創地圖**。原版轉檔地圖（格子、地價等結構資料）只能用在持有正版者自架的房間，避免伺服器把原版衍生資料傳給未持有正版的玩家。
