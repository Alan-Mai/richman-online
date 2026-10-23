// The new-game form as DOM. Validation lives in setup-form.ts.
import {
  DEFAULT_RULE_CONFIG,
  VEHICLES,
  type CharacterProfile,
  type Controller,
  type GameSetup,
  type PlayerId,
  type Vehicle,
} from '@richman/shared';
import { t } from '../i18n';
import {
  BOARDS,
  NAME_MAX_LENGTH,
  buildSetup,
  describeSetupError,
  isBoardChoice,
  previewCharacters,
  randomSeed,
  tierLabels,
  type SetupForm,
  type SetupOptions,
  type SetupTiers,
} from './setup-form';

type TierKey = keyof SetupTiers;
const TIER_KEYS: readonly TierKey[] = ['startingFunds', 'dayLimit', 'netWorthTarget'];

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

const CONTROLLERS: readonly Controller[] = ['human', 'computer'];

export interface SetupScreenOptions {
  initial: SetupForm;
  /**
   * Receives a valid setup together with the form values (to prefill the next game) and the
   * character numbers drawn for the computer seats (empty without tables).
   */
  onStart: (
    setup: GameSetup,
    form: SetupForm,
    characters: Readonly<Record<PlayerId, number>>,
  ) => void;
  /** Opens the read-only preview of converted original maps. */
  onPreview?: () => void;
  /** Injectable for tests. */
  makeSeed?: () => number;
  /**
   * Importing the original tables (tables.json) for the animations and the computer characters;
   * hidden when absent.
   */
  tables?: TablesImport;
}

export interface TablesImport {
  /** Name of the imported file, or null when the project values are in use. */
  importedName: string | null;
  /** Reads the picked file; resolves to the problems found, none when it was imported. */
  onPick(file: File): Promise<string[]>;
  /** Goes back to the project values. */
  onClear(): void;
  /** The character profiles of the imported file, in its order; null without one. */
  characters(): readonly CharacterProfile[] | null;
  /** The setup options of the imported file; null without one. */
  setupOptions(): SetupOptions | null;
}

/**
 * Status line, a button that opens the file picker, and a way back to the project values. The
 * native file input stays hidden: it is cleared after each pick (so the same file can be picked
 * again), which would otherwise show "no file chosen" next to a successful import.
 */
function tablesSection(tables: TablesImport, onChange: () => void): HTMLElement {
  const section = document.createElement('fieldset');
  section.className = 'setup-tables';
  const legend = document.createElement('legend');
  legend.textContent = t('setup.tables');
  const status = document.createElement('p');
  const problems = document.createElement('ul');
  problems.className = 'setup-errors';
  problems.setAttribute('role', 'alert');
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.name = 'tables';
  picker.accept = '.json,application/json';
  picker.hidden = true;
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'secondary';
  pick.textContent = t('setup.tables.pick');
  pick.addEventListener('click', () => picker.click());
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'secondary';
  clear.textContent = t('setup.tables.clear');

  let importedName = tables.importedName;
  const show = (lines: readonly string[] = []) => {
    status.textContent =
      importedName === null
        ? t('setup.tables.none')
        : t('setup.tables.imported', { name: importedName });
    clear.hidden = importedName === null;
    problems.replaceChildren(
      ...lines.map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      }),
    );
  };
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (!file) return;
    // A failed import keeps whatever was imported before; the problems say what went wrong.
    void tables.onPick(file).then(
      (lines) => {
        if (lines.length === 0) importedName = file.name;
        show(lines);
        onChange();
      },
      () => show([t('setup.tables.error.read')]),
    );
  });
  clear.addEventListener('click', () => {
    tables.onClear();
    importedName = null;
    show();
    onChange();
  });
  show();
  section.append(legend, status, picker, pick, clear, problems);
  return section;
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
  const controllerSelects = Array.from({ length: DEFAULT_RULE_CONFIG.maxPlayers }, (_, seat) => {
    const select = document.createElement('select');
    select.name = `controller${seat}`;
    for (const value of CONTROLLERS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(`setup.controller.${value}`);
      option.selected = value === (initial.controllers[seat] ?? 'human');
      select.append(option);
    }
    return select;
  });
  // The character a computer seat gets from the imported tables.json (docs/GAME_RULES.md §1).
  const characterTags = Array.from({ length: DEFAULT_RULE_CONFIG.maxPlayers }, () => {
    const tag = document.createElement('span');
    tag.className = 'setup-character';
    tag.hidden = true;
    return tag;
  });
  const nameLabels = nameInputs.map((node, seat) => {
    const label = labelled(t('setup.playerName', { n: seat + 1 }), node);
    label.classList.add('setup-seat');
    const controller = controllerSelects[seat];
    if (controller) {
      controller.setAttribute('aria-label', t('setup.controller', { n: seat + 1 }));
      label.append(controller);
    }
    const character = characterTags[seat];
    if (character) label.append(character);
    return label;
  });

  const vehicle = document.createElement('select');
  vehicle.name = 'vehicle';
  for (const value of VEHICLES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(`vehicle.${value}`);
    vehicle.append(option);
  }
  vehicle.value = initial.vehicle;

  // Starting funds, day limit and net worth target: a custom field without imported tables, the
  // original six options with them (docs/GAME_RULES.md §1 "原版設定畫面"), in the original order.
  const funds = input('startingFunds', initial.startingFunds, { inputmode: 'numeric' });
  const dayLimit = input('dayLimit', initial.dayLimit, { inputmode: 'numeric' });
  const netWorthTarget = input('netWorthTarget', initial.netWorthTarget, { inputmode: 'numeric' });
  const customFields: Record<TierKey, HTMLLabelElement> = {
    startingFunds: labelled(t('setup.startingFunds'), funds),
    dayLimit: labelled(t('setup.dayLimit'), dayLimit),
    netWorthTarget: labelled(t('setup.netWorthTarget'), netWorthTarget),
  };
  let tiers: SetupTiers = { ...initial.tiers };
  const tierSelects = Object.fromEntries(
    TIER_KEYS.map((key) => {
      const select = document.createElement('select');
      select.name = `${key}Tier`;
      select.addEventListener('change', () => {
        tiers = { ...tiers, [key]: Number(select.value) };
        sync();
      });
      return [key, select];
    }),
  ) as Record<TierKey, HTMLSelectElement>;
  const tierFields: Record<TierKey, HTMLLabelElement> = {
    startingFunds: labelled(t('setup.startingFunds'), tierSelects.startingFunds),
    dayLimit: labelled(t('setup.dayLimit.tiers'), tierSelects.dayLimit),
    netWorthTarget: labelled(t('setup.netWorthTarget.tiers'), tierSelects.netWorthTarget),
  };

  const advanced = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = t('setup.advanced');
  const seed = input('seed', initial.seed, { inputmode: 'numeric' });
  advanced.append(summary, labelled(t('setup.seed'), seed));

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
    controllers: controllerSelects.map((s): Controller =>
      s.value === 'computer' ? 'computer' : 'human',
    ),
    vehicle: VEHICLES.find((v): v is Vehicle => v === vehicle.value) ?? 'walk',
    dayLimit: dayLimit.value,
    netWorthTarget: netWorthTarget.value,
    startingFunds: funds.value,
    seed: seed.value,
    tiers: { ...tiers },
  });

  const syncTiers = () => {
    const setupOptions = options.tables?.setupOptions() ?? null;
    for (const key of TIER_KEYS) {
      customFields[key].hidden = setupOptions !== null;
      tierFields[key].hidden = setupOptions === null;
    }
    if (setupOptions === null) return;
    // Rebuilt each time: another file may have been imported, and the target amounts follow the
    // chosen starting funds.
    const texts = tierLabels(setupOptions, tiers.startingFunds);
    for (const key of TIER_KEYS) {
      const select = tierSelects[key];
      select.replaceChildren(
        ...texts[key].map((text, i) => {
          const option = document.createElement('option');
          option.value = String(i);
          option.textContent = text;
          return option;
        }),
      );
      select.value = String(tiers[key]);
    }
  };

  const sync = () => {
    const values = read();
    nameLabels.forEach((label, seat) => (label.hidden = seat >= values.playerCount));
    syncTiers();
    const characters = options.tables?.characters() ?? null;
    const preview = characters === null ? null : previewCharacters(values, characters.length);
    characterTags.forEach((tag, seat) => {
      const computer = values.controllers[seat] === 'computer';
      tag.hidden = characters === null || !computer;
      const n = preview?.[seat] ?? null;
      tag.textContent = n === null ? t('setup.character.atStart') : t('setup.character', { n });
    });
  };
  count.addEventListener('change', sync);
  seed.addEventListener('input', sync);
  for (const select of controllerSelects) select.addEventListener('change', sync);
  sync();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = read();
    const result = buildSetup(
      values,
      makeSeed,
      options.tables?.characters() ?? null,
      options.tables?.setupOptions() ?? null,
    );
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
    onStart(result.setup, values, result.characters);
  });

  form.append(
    title,
    labelled(t('setup.board'), board),
    labelled(t('setup.playerCount'), count),
    ...nameLabels,
    labelled(t('setup.vehicle'), vehicle),
    ...TIER_KEYS.flatMap((key) => [customFields[key], tierFields[key]]),
    advanced,
    ...(options.tables ? [tablesSection(options.tables, sync)] : []),
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
