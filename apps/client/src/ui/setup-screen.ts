// The new-game form as DOM. Validation lives in setup-form.ts.
import { DEFAULT_RULE_CONFIG, type GameSetup, type WinCondition } from '@richman/shared';
import { t, type MessageKey } from '../i18n';
import {
  NAME_MAX_LENGTH,
  buildSetup,
  describeSetupError,
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

const WIN_LABELS = {
  lastStanding: 'setup.win.lastStanding',
  richestAtRoundLimit: 'setup.win.richestAtRoundLimit',
} as const satisfies Record<WinCondition, MessageKey>;

/**
 * Renders the form into `root`. `onStart` receives a valid setup together with the form values
 * (to prefill the next game). `makeSeed` is injectable for tests.
 */
export function renderSetupScreen(
  root: HTMLElement,
  initial: SetupForm,
  onStart: (setup: GameSetup, form: SetupForm) => void,
  makeSeed: () => number = randomSeed,
): void {
  const form = document.createElement('form');
  form.className = 'setup';
  form.noValidate = true;

  const title = document.createElement('h1');
  title.textContent = t('setup.title');

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

  const win = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = t('setup.winCondition');
  win.append(legend);
  const winInputs = (Object.keys(WIN_LABELS) as WinCondition[]).map((value) => {
    const radio = input('winCondition', value, { type: 'radio' });
    radio.checked = value === initial.winCondition;
    const label = document.createElement('label');
    label.className = 'setup-radio';
    label.append(radio, t(WIN_LABELS[value]));
    win.append(label);
    return radio;
  });
  const maxRounds = input('maxRounds', initial.maxRounds, { inputmode: 'numeric' });
  const maxRoundsLabel = labelled(t('setup.maxRounds'), maxRounds);
  win.append(maxRoundsLabel);

  const advanced = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = t('setup.advanced');
  const cash = input('startingCash', initial.startingCash, { inputmode: 'numeric' });
  const deposit = input('startingDeposit', initial.startingDeposit, { inputmode: 'numeric' });
  const seed = input('seed', initial.seed, { inputmode: 'numeric' });
  advanced.append(
    summary,
    labelled(t('setup.startingCash'), cash),
    labelled(t('setup.startingDeposit'), deposit),
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
    playerCount: Number(count.value),
    names: nameInputs.map((n) => n.value),
    winCondition:
      winInputs.find((r) => r.checked)?.value === 'lastStanding'
        ? 'lastStanding'
        : 'richestAtRoundLimit',
    maxRounds: maxRounds.value,
    startingCash: cash.value,
    startingDeposit: deposit.value,
    seed: seed.value,
  });

  const sync = () => {
    const values = read();
    nameLabels.forEach((label, seat) => (label.hidden = seat >= values.playerCount));
    maxRoundsLabel.hidden = values.winCondition !== 'richestAtRoundLimit';
  };
  count.addEventListener('change', sync);
  winInputs.forEach((r) => r.addEventListener('change', sync));
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
    labelled(t('setup.playerCount'), count),
    ...nameLabels,
    win,
    advanced,
    errors,
    start,
  );
  root.replaceChildren(form);
}
