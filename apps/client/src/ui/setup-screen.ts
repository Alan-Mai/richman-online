// The new-game form as DOM. Validation lives in setup-form.ts.
import { DEFAULT_RULE_CONFIG, type GameSetup } from '@richman/shared';
import { t } from '../i18n';
import {
  BOARDS,
  NAME_MAX_LENGTH,
  buildSetup,
  describeSetupError,
  isBoardChoice,
  randomSeed,
  type SetupForm,
} from './setup-form';

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

function input(name: string, value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const node = document.createElement('input');
  node.name = name;
  // Attributes first: a radio's value only reflects to its attribute once its type is set.
  for (const [key, v] of Object.entries(attrs)) node.setAttribute(key, v);
  node.value = value;
  return node;
}

export interface SetupScreenOptions {
  initial: SetupForm;
  /** Receives a valid setup together with the form values (to prefill the next game). */
  onStart: (setup: GameSetup, form: SetupForm) => void;
  /** Opens the read-only preview of converted original maps. */
  onPreview?: () => void;
  /** Injectable for tests. */
  makeSeed?: () => number;
}

export function renderSetupScreen(root: HTMLElement, options: SetupScreenOptions): void {
  const { initial, onStart, onPreview, makeSeed = randomSeed } = options;
  const form = document.createElement('form');
  form.className = 'setup';
  form.noValidate = true;

  const title = document.createElement('h1');
  title.textContent = t('setup.title');

  const board = document.createElement('select');
  board.name = 'board';
  for (const [value, def] of Object.entries(BOARDS)) {
    const option = document.createElement('option');
    option.value = value;
    // Board names are map content, not UI text.
    option.textContent = def.name;
    option.selected = value === initial.board;
    board.append(option);
  }

  const count = document.createElement('select');
  count.name = 'playerCount';
  for (let n = DEFAULT_RULE_CONFIG.minPlayers; n <= DEFAULT_RULE_CONFIG.maxPlayers; n++) {
    const option = document.createElement('option');
    option.value = option.textContent = String(n);
    option.selected = n === initial.playerCount;
    count.append(option);
  }

  const nameInputs = Array.from({ length: DEFAULT_RULE_CONFIG.maxPlayers }, (_, seat) =>
    input(`name${seat}`, initial.names[seat] ?? '', { maxlength: String(NAME_MAX_LENGTH) }),
  );
  const nameLabels = nameInputs.map((node, seat) =>
    labelled(t('setup.playerName', { n: seat + 1 }), node),
  );

  const dayLimit = input('dayLimit', initial.dayLimit, { inputmode: 'numeric' });
  const netWorthTarget = input('netWorthTarget', initial.netWorthTarget, { inputmode: 'numeric' });

  const advanced = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = t('setup.advanced');
  const funds = input('startingFunds', initial.startingFunds, { inputmode: 'numeric' });
  const seed = input('seed', initial.seed, { inputmode: 'numeric' });
  advanced.append(
    summary,
    labelled(t('setup.startingFunds'), funds),
    labelled(t('setup.seed'), seed),
  );

  const errors = document.createElement('ul');
  errors.className = 'setup-errors';
  errors.setAttribute('role', 'alert');

  const start = document.createElement('button');
  start.type = 'submit';
  start.className = 'primary';
  start.textContent = t('setup.start');

  const read = (): SetupForm => ({
    board: isBoardChoice(board.value) ? board.value : 'test-loop',
    playerCount: Number(count.value),
    names: nameInputs.map((n) => n.value),
    dayLimit: dayLimit.value,
    netWorthTarget: netWorthTarget.value,
    startingFunds: funds.value,
    seed: seed.value,
  });

  const sync = () => {
    const values = read();
    nameLabels.forEach((label, seat) => (label.hidden = seat >= values.playerCount));
  };
  count.addEventListener('change', sync);
  sync();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = read();
    const result = buildSetup(values, makeSeed);
    if (!result.ok) {
      errors.replaceChildren(
        ...result.errors.map((e) => {
          const li = document.createElement('li');
          li.textContent = describeSetupError(e, values);
          return li;
        }),
      );
      return;
    }
    errors.replaceChildren();
    onStart(result.setup, values);
  });

  form.append(
    title,
    labelled(t('setup.board'), board),
    labelled(t('setup.playerCount'), count),
    ...nameLabels,
    labelled(t('setup.dayLimit'), dayLimit),
    labelled(t('setup.netWorthTarget'), netWorthTarget),
    advanced,
    errors,
    start,
  );
  if (onPreview) {
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'secondary';
    preview.textContent = t('setup.preview');
    preview.addEventListener('click', () => onPreview());
    form.append(preview);
  }
  root.replaceChildren(form);
}
