// @vitest-environment happy-dom
import {
  DEFAULT_RULE_CONFIG,
  TEST_LOOP_BOARD,
  type LegalAction,
  type AuctionPhaseView,
  type ServerUpdate,
} from '@richman/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { displayFromView, type DisplayModel } from '../model/display';
import type { Intent } from '../net/connection';
import { createHost, hotSeatSetup } from '../testing/random-game';
import { renderAuctionPanel } from './auction-panel';

/** The opening update of a 4-player game, to borrow a real view from. */
function opening(): ServerUpdate {
  const host = createHost(hotSeatSetup(3));
  let first: ServerUpdate | null = null;
  host.subscribe((m) => {
    if (m.kind === 'update') first ??= m.update;
  });
  host.start();
  if (first === null) throw new Error('no opening update');
  return first;
}

const PHASE: AuctionPhaseView = {
  kind: 'auction',
  tile: 1,
  startPrice: 1500,
  price: 2000,
  leader: 'p3',
  bidder: 'p4',
  bidders: [
    { id: 'p2', status: 'withdrawn' },
    { id: 'p3', status: 'bidding' },
    { id: 'p4', status: 'passed' },
  ],
  remaining: 2,
};

/** p1 went bankrupt; p2..p4 are in the auction with PHASE; p4 has 2600 cash. */
function auctionUpdate(legalActions: LegalAction[]): ServerUpdate {
  const base = opening();
  const players = base.view.players.map((p) =>
    p.id === 'p1' ? { ...p, bankrupt: true } : p.id === 'p4' ? { ...p, cash: 2600 } : p,
  );
  const tiles = base.view.tiles.map((t, i) => (i === 1 ? { owner: null, level: 2 } : t));
  return {
    events: [],
    view: { ...base.view, players, tiles, turn: { ...base.view.turn, phase: PHASE } },
    legalActions,
  };
}

const OFFERED: LegalAction[] = [
  { type: 'bid', playerId: 'p4', raise: 100 },
  { type: 'bid', playerId: 'p4', raise: 500 },
  { type: 'passRound', playerId: 'p4' },
  { type: 'withdraw', playerId: 'p4' },
];

let root: HTMLElement;
let acted: Intent[];

function render(model: DisplayModel, ready: ServerUpdate | null) {
  renderAuctionPanel(root, {
    model,
    board: TEST_LOOP_BOARD,
    raises: DEFAULT_RULE_CONFIG.auctionRaises,
    ready,
    onAct: (intent) => acted.push(intent),
  });
}

beforeEach(() => {
  root = document.createElement('section');
  acted = [];
});

describe('renderAuctionPanel', () => {
  it('is hidden outside auctions', () => {
    render(displayFromView(opening().view), null);
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
  });

  it('shows the property, prices, the leader and what is still to come', () => {
    const update = auctionUpdate(OFFERED);
    render(displayFromView(update.view), update);
    expect(root.hidden).toBe(false);
    expect(root.querySelector('h2')?.textContent).toBe(
      `拍賣：${TEST_LOOP_BOARD.tiles[1]!.name}（2 級）`,
    );
    const facts = [...root.querySelectorAll('dd')].map((d) => d.textContent);
    expect(facts).toEqual(['1,500', '2,000', '玩家3', '2']);
  });

  it('lists every player still in the game with their cash and standing', () => {
    const update = auctionUpdate(OFFERED);
    render(displayFromView(update.view), update);
    const rows = [...root.querySelectorAll<HTMLLIElement>('.auction-bidder')];
    expect(rows.map((r) => r.dataset.player)).toEqual(['p2', 'p3', 'p4']);
    expect(rows.map((r) => r.querySelector('.auction-status')?.textContent)).toEqual([
      '已退出',
      '最高出價 2,000',
      '本輪放棄',
    ]);
    expect(rows[2]?.querySelector('.auction-cash')?.textContent).toBe('現金 2,600');
    expect(rows[2]?.getAttribute('aria-current')).toBe('true');
    expect(rows[1]?.classList.contains('is-leader')).toBe(true);
    expect(rows[0]?.classList.contains('is-out')).toBe(true);
  });

  it('marks players who could not join', () => {
    const update = auctionUpdate([]);
    const model = displayFromView(update.view);
    const auction = model.auction!;
    render({ ...model, auction: { ...auction, bidders: auction.bidders.slice(1) } }, null);
    const status = root.querySelector('[data-player="p2"] .auction-status')?.textContent;
    expect(status).toBe('現金不足，不能出價');
  });

  it('shows every raise, enables the offered ones and sends the chosen intent', () => {
    const update = auctionUpdate(OFFERED);
    render(displayFromView(update.view), update);
    const raises = [...root.querySelectorAll<HTMLButtonElement>('button[data-raise]')];
    expect(raises.map((b) => [b.textContent, b.disabled])).toEqual([
      ['+100', false],
      ['+500', false],
      ['+1,000', true],
      ['+5,000', true],
      ['+10,000', true],
    ]);
    expect(raises[1]?.title).toBe('出價到 2,500');
    raises[1]?.click();
    raises[2]?.click();
    root.querySelector<HTMLButtonElement>('button[data-action="passRound"]')?.click();
    root.querySelector<HTMLButtonElement>('button[data-action="withdraw"]')?.click();
    expect(acted).toEqual([
      { type: 'bid', raise: 500 },
      { type: 'passRound' },
      { type: 'withdraw' },
    ]);
  });

  it('has no buttons while playing or while a computer bids', () => {
    const update = auctionUpdate(OFFERED);
    render(displayFromView(update.view), null);
    expect(root.querySelectorAll('button')).toHaveLength(0);
    render(displayFromView(update.view), auctionUpdate([]));
    expect(root.querySelectorAll('button')).toHaveLength(0);
    // The leader is shown, but nobody is marked as bidding while playing.
    render(displayFromView(update.view), null);
    expect(root.querySelector('[aria-current]')).toBeNull();
  });
});
