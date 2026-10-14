// @vitest-environment happy-dom
import { TEST_LOOP_BOARD, type ActionType, type ServerUpdate } from '@richman/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyEventToDisplay, displayFromView, type DisplayModel } from '../model/display';
import { hotSeatSetup, playRandomGame } from '../testing/random-game';
import { describeEvent } from './event-text';
import { Hud, actionLabel } from './hud';

const updates = playRandomGame(hotSeatSetup(51));

function find(predicate: (u: ServerUpdate) => boolean): ServerUpdate {
  const found = updates.find(predicate);
  if (!found) throw new Error('no such update in the sample game');
  return found;
}

let root: HTMLElement;
let acted: ActionType[];
let hud: Hud;

beforeEach(() => {
  root = document.createElement('div');
  acted = [];
  hud = new Hud(root, { board: TEST_LOOP_BOARD, onAct: (type) => acted.push(type) });
});

function buttons(): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('.hud-actions button')];
}

describe('Hud actions', () => {
  it('shows exactly the legal actions of the ready update', () => {
    const offer = find((u) => u.view.turn.phase.kind === 'awaitBuyDecision');
    hud.showModel(displayFromView(offer.view));
    hud.setReady(offer);
    expect(buttons().map((b) => b.dataset.action)).toEqual(offer.legalActions.map((a) => a.type));
  });

  it('labels a buy offer with its price', () => {
    const offer = find((u) => u.view.turn.phase.kind === 'awaitBuyDecision');
    const phase = offer.view.turn.phase;
    if (phase.kind !== 'awaitBuyDecision') throw new Error('unreachable');
    expect(actionLabel('buyProperty', offer)).toContain(phase.price.toLocaleString('en-US'));
  });

  it('labels an upgrade offer with its cost', () => {
    const offer = find((u) => u.view.turn.phase.kind === 'awaitUpgradeDecision');
    const phase = offer.view.turn.phase;
    if (phase.kind !== 'awaitUpgradeDecision') throw new Error('unreachable');
    expect(actionLabel('upgradeProperty', offer)).toContain(phase.cost.toLocaleString('en-US'));
  });

  it('removes the buttons while playing', () => {
    hud.setReady(updates[0]!);
    expect(buttons()).toHaveLength(1);
    hud.setReady(null);
    expect(buttons()).toHaveLength(0);
    expect(root.querySelector('.hud-prompt')?.textContent).toBe('播放中…');
  });

  it('sends the clicked action', () => {
    hud.setReady(updates[0]!);
    buttons()[0]!.click();
    expect(acted).toEqual(['rollDice']);
  });

  it('offers nothing after the game ends', () => {
    const last = updates.at(-1)!;
    hud.showModel(displayFromView(last.view));
    hud.setReady(last);
    expect(buttons()).toHaveLength(0);
  });
});

describe('Hud players', () => {
  it('shows money, the current player and bankruptcy', () => {
    const model: DisplayModel = {
      ...displayFromView(updates[0]!.view),
      current: 'p2',
    };
    const players = model.players.map((p, i) =>
      i === 2 ? { ...p, bankrupt: true, cash: 0 } : { ...p, cash: 12345 },
    );
    hud.showModel({ ...model, players, round: 7 });

    const items = [...root.querySelectorAll('.hud-player')];
    expect(items).toHaveLength(4);
    expect(items[0]?.querySelector('.hud-cash')?.textContent).toBe('12,345');
    expect(items[1]?.getAttribute('aria-current')).toBe('true');
    expect(items[0]?.hasAttribute('aria-current')).toBe(false);
    expect(items[2]?.classList.contains('is-bankrupt')).toBe(true);
    expect(root.querySelector('.hud-round')?.textContent).toBe('第 7 輪');
  });

  it('marks players who are not on the board yet', () => {
    const opening = displayFromView(updates[0]!.view);
    hud.showModel(opening);
    const tags = [...root.querySelectorAll('.hud-player')].map(
      (item) => item.querySelector('.hud-tag')?.textContent ?? null,
    );
    // Seat 0 is placed when the game starts; the others wait for their first turn.
    expect(tags).toEqual([null, '尚未出發', '尚未出發', '尚未出發']);
  });

  it('shows names as text, not markup', () => {
    const model = displayFromView(updates[0]!.view);
    const players = model.players.map((p, i) => (i === 0 ? { ...p, name: '<b>x</b>' } : p));
    hud.showModel({ ...model, players });
    expect(root.querySelector('.hud-name')?.textContent).toBe('<b>x</b>');
    expect(root.querySelector('.hud-name b')).toBeNull();
  });
});

describe('Hud log', () => {
  it('lists played events newest first, up to a limit', () => {
    let model = displayFromView(updates[0]!.view);
    const played: string[] = [];
    for (const update of updates.slice(1)) {
      for (const event of update.events) {
        model = applyEventToDisplay(model, event);
        hud.eventPlayed(event, model);
        played.push(describeEvent(event, model, TEST_LOOP_BOARD));
      }
    }
    const lines = [...root.querySelectorAll('.hud-log li')].map((li) => li.textContent);
    expect(lines).toEqual(played.reverse().slice(0, 50));
  });
});

describe('Hud tile info', () => {
  it('shows the hint until a tile is selected', () => {
    expect(root.querySelector('.hud-tile')?.textContent).toBe('點選格子查看資訊');
  });

  it('shows price, owner, level, rent and upgrade cost of a property', () => {
    const owned = find((u) => u.view.tiles.some((t) => t.owner !== null && t.level > 0));
    const index = owned.view.tiles.findIndex((t) => t.owner !== null && t.level > 0);
    hud.showModel(displayFromView(owned.view));
    hud.setReady(owned);
    hud.showTile(index);
    const text = root.querySelector('.hud-tile')?.textContent ?? '';
    const tile = TEST_LOOP_BOARD.tiles[index]!;
    expect(text).toContain(tile.name);
    expect(text).toContain('目前過路費');
    expect(text).toContain('加蓋費用');
  });

  it('says a blank tile cannot be bought', () => {
    hud.showTile(0);
    expect(root.querySelector('.hud-tile')?.textContent).toContain('這一格不能購買');
  });
});

describe('describeEvent bankruptcy', () => {
  const model = displayFromView(updates[0]!.view);

  it('names the unpaid rent and what the creditor received', () => {
    const text = describeEvent(
      {
        type: 'PlayerBankrupt',
        playerId: 'p1',
        creditor: 'p2',
        paidToCreditor: 800,
        releasedTiles: [],
        cause: { kind: 'rent', tile: 1, amountDue: 1200 },
      },
      model,
      TEST_LOOP_BOARD,
    );
    expect(text).toBe(
      `玩家1 付不起 ${TEST_LOOP_BOARD.tiles[1]!.name} 的過路費 1,200，破產了；玩家2 收到 800`,
    );
  });

  it('falls back to a short line for system debts', () => {
    const text = describeEvent(
      {
        type: 'PlayerBankrupt',
        playerId: 'p1',
        creditor: null,
        paidToCreditor: 0,
        releasedTiles: [],
        cause: { kind: 'system', amountDue: 1200 },
      },
      model,
      TEST_LOOP_BOARD,
    );
    expect(text).toBe('玩家1 破產了');
  });
});

describe('describeEvent', () => {
  it('describes every event type in the sample game', () => {
    let model = displayFromView(updates[0]!.view);
    for (const update of updates.slice(1)) {
      for (const event of update.events) {
        model = applyEventToDisplay(model, event);
        const text = describeEvent(event, model, TEST_LOOP_BOARD);
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe('Hud game speed', () => {
  it('is hidden unless requested', () => {
    expect(root.querySelector('select[name="gameSpeed"]')).toBeNull();
  });

  it('shows the current speed and reports changes', () => {
    const changes: number[] = [];
    const speedRoot = document.createElement('div');
    new Hud(speedRoot, {
      board: TEST_LOOP_BOARD,
      onAct: () => {},
      gameSpeed: { initial: 1, onChange: (speed) => changes.push(speed) },
    });
    const select = speedRoot.querySelector<HTMLSelectElement>('select[name="gameSpeed"]');
    if (!select) throw new Error('no speed control');
    expect([...select.options].map((o) => o.value)).toEqual(['0', '1', '2', '3']);
    expect(select.value).toBe('1');
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    expect(changes).toEqual([3]);
  });
});
