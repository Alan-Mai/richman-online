// Test helpers: hot-seat games on the built-in board, driven by random legal choices.
import {
  DEFAULT_RULE_CONFIG,
  PROVISIONAL_COMPUTER_PROFILE,
  TEST_LOOP_BOARD,
  createRng,
  nextInt,
  type Controller,
  type GameSetup,
  type PlayerSetup,
  type ServerUpdate,
} from '@richman/shared';
import { toIntent } from '../net/connection';
import { LocalGameHost } from '../net/local-host';

/** 'dayLimit' ends after 20 days; 'lastStanding' has no day limit or target. */
export function hotSeatSetup(
  seed: number,
  ending: 'dayLimit' | 'lastStanding' = 'dayLimit',
  playerCount = 4,
  controllers: readonly Controller[] = [],
): GameSetup {
  return {
    config: { ...DEFAULT_RULE_CONFIG, dayLimit: ending === 'dayLimit' ? 20 : null },
    board: TEST_LOOP_BOARD,
    players: Array.from({ length: playerCount }, (_, i): PlayerSetup => {
      const base = { id: `p${i + 1}`, name: `玩家${i + 1}` };
      return controllers[i] === 'computer'
        ? { ...base, controller: 'computer', profile: PROVISIONAL_COMPUTER_PROFILE }
        : { ...base, controller: 'human' };
    }),
    seed,
  };
}

export function createHost(setup: GameSetup): LocalGameHost {
  const result = LocalGameHost.create(setup);
  if (!result.ok) throw new Error(`createGame failed: ${JSON.stringify(result.errors)}`);
  return result.host;
}

/**
 * Plays a whole game through the host, picking among the offered actions at random, and returns
 * every update in order. Throws on a rejection or when maxSteps is exceeded.
 */
export function playRandomGame(setup: GameSetup, maxSteps = 20_000): ServerUpdate[] {
  const host = createHost(setup);
  const updates: ServerUpdate[] = [];
  host.subscribe((message) => {
    if (message.kind === 'rejected') {
      throw new Error(`rejected ${message.intent.type}: ${message.reason.code}`);
    }
    updates.push(message.update);
  });
  host.start();

  let rng = createRng((setup.seed ^ 0x5eed) >>> 0);
  for (let step = 0; step < maxSteps; step++) {
    const offered = updates.at(-1)?.legalActions ?? [];
    if (offered.length === 0) return updates;
    const [pick, nextRng] = nextInt(rng, offered.length);
    rng = nextRng;
    host.send(toIntent(offered[pick]!));
  }
  throw new Error(`game did not end within ${maxSteps} steps`);
}
