// @vitest-environment happy-dom
import {
  ORIGINAL_TABLES_VERSION,
  TEST_BRANCH_BOARD,
  TEST_LOOP_BOARD,
  drawCharacters,
  type GameSetup,
} from '@richman/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { readOriginalTables } from '../assets/original-tables';
import { defaultSetupForm, type SetupForm } from './setup-form';
import { renderSetupScreen } from './setup-screen';

let root: HTMLElement;
let started: [GameSetup, SetupForm][];

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  started = [];
  renderSetupScreen(root, {
    initial: defaultSetupForm(),
    onStart: (s, f) => started.push([s, f]),
    makeSeed: () => 99,
  });
});

function field<T extends HTMLElement>(name: string): T {
  const node = root.querySelector<T>(`[name="${name}"]`);
  if (!node) throw new Error(`no field ${name}`);
  return node;
}

function setValue(name: string, value: string): void {
  const node = field<HTMLInputElement | HTMLSelectElement>(name);
  node.value = value;
  node.dispatchEvent(new Event('change'));
}

function submit(): void {
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('setup screen', () => {
  it('starts a game with the form values', () => {
    setValue('name0', '阿土伯');
    setValue('startingFunds', '3000');
    submit();
    expect(started).toHaveLength(1);
    const [setup, form] = started[0]!;
    expect(setup.players[0]?.name).toBe('阿土伯');
    expect(setup.config.startingFunds).toBe(3000);
    expect(setup.seed).toBe(99);
    expect(form.names[0]).toBe('阿土伯');
  });

  it('lets each seat be played by a human or the computer', () => {
    expect([...field<HTMLSelectElement>('controller1').options].map((o) => o.textContent)).toEqual([
      '人類',
      '電腦',
    ]);
    setValue('playerCount', '4');
    setValue('controller1', 'computer');
    submit();
    const [setup, form] = started[0]!;
    expect(setup.players.map((p) => p.controller)).toEqual(['human', 'computer', 'human', 'human']);
    expect(form.controllers[1]).toBe('computer');
  });

  it('offers the starting vehicle for everyone, on foot by default', () => {
    const options = [...field<HTMLSelectElement>('vehicle').options].map((o) => o.textContent);
    expect(options).toEqual(['步行', '機車', '汽車']);
    submit();
    expect(started[0]?.[0].config.startingVehicle).toBe('walk');
    setValue('vehicle', 'car');
    submit();
    expect(started[1]?.[0].config.startingVehicle).toBe('car');
    expect(started[1]?.[1].vehicle).toBe('car');
  });

  it('offers the built-in boards by name', () => {
    const options = [...field<HTMLSelectElement>('board').options].map((o) => o.textContent);
    expect(options).toEqual([TEST_LOOP_BOARD.name, TEST_BRANCH_BOARD.name]);
    setValue('board', 'test-branch');
    submit();
    expect(started[0]?.[0].board).toBe(TEST_BRANCH_BOARD);
    expect(started[0]?.[1].board).toBe('test-branch');
  });

  it('hides the name fields of unused seats', () => {
    setValue('playerCount', '2');
    const labels = [...root.querySelectorAll<HTMLInputElement>('[name^="name"]')].map(
      (input) => input.closest('label')!.hidden,
    );
    expect(labels).toEqual([false, false, true, true]);
    submit();
    expect(started[0]?.[0].players).toHaveLength(2);
  });

  it('takes a day limit, blank meaning none', () => {
    expect(field<HTMLInputElement>('dayLimit').value).toBe('');
    submit();
    expect(started[0]?.[0].config.dayLimit).toBeNull();
    setValue('dayLimit', '30');
    submit();
    expect(started[1]?.[0].config.dayLimit).toBe(30);
  });

  it('takes a net worth target, blank meaning none', () => {
    expect(field<HTMLInputElement>('netWorthTarget').value).toBe('');
    setValue('netWorthTarget', '4');
    submit();
    expect(started[0]?.[0].config.netWorthTargetMultiple).toBe(4);
  });

  it('lists errors instead of starting', () => {
    setValue('name1', '玩家 1');
    setValue('seed', 'abc');
    submit();
    expect(started).toEqual([]);
    const errors = [...root.querySelectorAll('.setup-errors li')].map((li) => li.textContent);
    expect(errors).toEqual(['玩家名稱不可重複：玩家 1', '種子必須是 0 到 4294967295 的整數']);
  });

  it('offers the original map preview only when asked to', () => {
    const label = '原版地圖預覽（唯讀）';
    const find = () => [...root.querySelectorAll('button')].find((b) => b.textContent === label);
    expect(find()).toBeUndefined();
    let opened = 0;
    renderSetupScreen(root, {
      initial: defaultSetupForm(),
      onStart: () => {},
      onPreview: () => opened++,
    });
    find()!.click();
    expect(opened).toBe(1);
    expect(started).toEqual([]);
  });

  it('prefills from the given form', () => {
    const form = {
      ...defaultSetupForm(),
      playerCount: 3,
      seed: '7',
      names: ['甲', '乙', '丙', '丁'],
    };
    renderSetupScreen(root, { initial: form, onStart: (s, f) => started.push([s, f]) });
    expect(field<HTMLSelectElement>('playerCount').value).toBe('3');
    expect(field<HTMLInputElement>('name2').value).toBe('丙');
    expect(field<HTMLInputElement>('seed').value).toBe('7');
  });

  it('prefills the starting vehicle', () => {
    renderSetupScreen(root, {
      initial: { ...defaultSetupForm(), vehicle: 'motorbike' },
      onStart: (s, f) => started.push([s, f]),
    });
    expect(field<HTMLSelectElement>('vehicle').value).toBe('motorbike');
  });

  describe('computer characters', () => {
    // Made-up profiles.
    const characters = Array.from({ length: 12 }, (_, i) => ({
      cashPercent: i + 1,
      loanPercent: 50,
    }));

    function render(imported: boolean) {
      const drawn: Record<string, number>[] = [];
      renderSetupScreen(root, {
        initial: { ...defaultSetupForm(), controllers: ['human', 'computer', 'human', 'human'] },
        onStart: (_s, _f, picked) => drawn.push({ ...picked }),
        tables: {
          importedName: imported ? 'tables.json' : null,
          onPick: () => Promise.resolve([]),
          onClear: () => {},
          characters: () => (imported ? characters : null),
          setupOptions: () => null,
        },
      });
      const tags = [...root.querySelectorAll<HTMLElement>('.setup-character')];
      return { tags, drawn };
    }

    it('shows nothing without imported tables', () => {
      expect(render(false).tags.every((tag) => tag.hidden)).toBe(true);
    });

    it('marks computer seats, previewing the character once a seed is typed', () => {
      const { tags, drawn } = render(true);
      expect(tags.map((tag) => tag.hidden)).toEqual([true, false, true, true]);
      expect(tags[1]?.textContent).toBe('角色：開局時依種子抽選');
      const seed = field<HTMLInputElement>('seed');
      seed.value = '1234';
      seed.dispatchEvent(new Event('input'));
      const n = drawCharacters(12, 1, 1234)[0]! + 1;
      expect(tags[1]?.textContent).toBe(`角色 ${n}`);
      root.querySelector('form')!.dispatchEvent(new Event('submit'));
      expect(drawn).toEqual([{ p2: n }]);
    });
  });

  describe('original tables', () => {
    /** Renders the section around `onPick`; returns its parts and what happened. */
    function renderTables(onPick: (file: File) => Promise<string[]>, importedName: string | null) {
      let cleared = 0;
      renderSetupScreen(root, {
        initial: defaultSetupForm(),
        onStart: (s, f) => started.push([s, f]),
        tables: {
          importedName,
          onPick,
          onClear: () => cleared++,
          characters: () => null,
          setupOptions: () => null,
        },
      });
      const section = root.querySelector<HTMLElement>('.setup-tables')!;
      const picker = field<HTMLInputElement>('tables');
      const [pick, clear] = [...section.querySelectorAll('button')];
      return { section, picker, pick: pick!, clear: clear!, cleared: () => cleared };
    }

    /** Simulates choosing a file in the native picker and waits for the import to settle. */
    async function choose(picker: HTMLInputElement, file: File): Promise<void> {
      Object.defineProperty(picker, 'files', { value: [file], configurable: true });
      picker.dispatchEvent(new Event('change'));
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    }

    it('hides the native picker behind a button that opens it', () => {
      const { picker, pick } = renderTables(() => Promise.resolve([]), null);
      expect(picker.hidden).toBe(true);
      let opened = 0;
      picker.click = () => void opened++;
      pick.click();
      expect(opened).toBe(1);
      expect(pick.textContent).toBe('選擇 tables.json…');
    });

    it('names the imported file and goes back to project values', async () => {
      const ui = renderTables(() => Promise.resolve([]), null);
      expect(ui.section.textContent).toContain('未匯入');
      expect(ui.clear.hidden).toBe(true);
      await choose(ui.picker, new File(['{}'], 'tables.json'));
      expect(ui.section.textContent).toContain('已匯入：tables.json');
      expect(ui.clear.hidden).toBe(false);
      ui.clear.click();
      expect(ui.cleared()).toBe(1);
      expect(ui.section.textContent).toContain('未匯入');
    });

    it('keeps showing the imported file when the screen comes back', () => {
      const { section } = renderTables(() => Promise.resolve([]), 'my-tables.json');
      expect(section.textContent).toContain('已匯入：my-tables.json');
    });

    it('lists the kind and path of each problem, without values, and imports nothing', async () => {
      const ui = renderTables(async (file) => {
        const read = readOriginalTables(await file.text());
        return read.ok ? [] : read.problems;
      }, null);
      const broken = {
        version: ORIGINAL_TABLES_VERSION,
        animation: { frameTicks: [1, 2], stepPixels: { walk: 98765 } },
      };
      await choose(ui.picker, new File([JSON.stringify(broken)], 'broken.json'));
      const problems = [...ui.section.querySelectorAll('.setup-errors li')].map(
        (li) => li.textContent,
      );
      expect(problems).toContain('欄位 animation.frameTicks 不正確（應有 3 筆）');
      expect(problems).toContain('欄位 animation.stepPixels.walk 不正確（超出範圍）');
      expect(problems).toContain('欄位 items 不正確（缺少）');
      expect(ui.section.textContent).not.toContain('98765');
      expect(ui.section.textContent).toContain('未匯入');

      await choose(ui.picker, new File(['{'], 'not-json.json'));
      expect(ui.section.textContent).toContain('不是有效的 JSON 檔');
    });

    it('keeps the earlier import when a later one fails, and reports unreadable files', async () => {
      let answer: Promise<string[]> = Promise.resolve(['欄位 x 不正確（缺少）']);
      const ui = renderTables(() => answer, 'good.json');
      await choose(ui.picker, new File(['x'], 'bad.json'));
      expect(ui.section.textContent).toContain('已匯入：good.json');
      expect(ui.section.textContent).toContain('欄位 x 不正確（缺少）');
      answer = Promise.reject(new Error('unreadable'));
      await choose(ui.picker, new File(['x'], 'bad.json'));
      expect(ui.section.textContent).toContain('無法讀取這個檔案');
    });
  });

  describe('original setup options', () => {
    // Invented option tables, not the original values.
    const OPTIONS = {
      startingFunds: [1137, 2213, 3391, 4409, 5521, 6673],
      dayLimit: [0, 13, 27, 41, 59, 73],
      netWorthTargetMultiple: [0, 17, 19, 0, 23, 29],
      dayLimitLabels: ['la', 'lb', 'lc', 'ld', 'le', 'lf'],
    };

    /** Renders with tables that can be imported (`imported`) and cleared through the section. */
    function render(initial: SetupForm = defaultSetupForm(), imported = true) {
      let current = imported;
      renderSetupScreen(root, {
        initial,
        onStart: (s, f) => started.push([s, f]),
        tables: {
          importedName: imported ? 'tables.json' : null,
          onPick: () => {
            current = true;
            return Promise.resolve([]);
          },
          onClear: () => (current = false),
          characters: () => null,
          setupOptions: () => (current ? OPTIONS : null),
        },
      });
      const clear = [...root.querySelectorAll<HTMLButtonElement>('.setup-tables button')][1]!;
      return { clear };
    }

    const visible = (name: string) => !field(name).closest('label')!.hidden;
    const optionTexts = (name: string) =>
      [...field<HTMLSelectElement>(name).options].map((o) => o.textContent);

    it('offers the six original options instead of the custom fields once imported', () => {
      render();
      for (const name of ['startingFundsTier', 'dayLimitTier', 'netWorthTargetTier']) {
        expect(visible(name)).toBe(true);
      }
      for (const name of ['startingFunds', 'dayLimit', 'netWorthTarget']) {
        expect(visible(name)).toBe(false);
      }
      expect(optionTexts('startingFundsTier')).toEqual(OPTIONS.startingFunds.map(String));
      expect(optionTexts('dayLimitTier')).toEqual(OPTIONS.dayLimitLabels);
      // The default second starting-funds option, 2213, times each multiple.
      expect(optionTexts('netWorthTargetTier')).toEqual([
        '無',
        '37621',
        '42047',
        '無',
        '50899',
        '64177',
      ]);
      expect(field<HTMLSelectElement>('startingFundsTier').value).toBe('1');
      expect(field<HTMLSelectElement>('dayLimitTier').value).toBe('0');
    });

    it('starts the game with the chosen options and remembers them', () => {
      render();
      setValue('startingFundsTier', '4');
      setValue('dayLimitTier', '2');
      setValue('netWorthTargetTier', '5');
      submit();
      const [setup, form] = started[0]!;
      expect(setup.config).toMatchObject({
        startingFunds: 5521,
        dayLimit: 27,
        netWorthTargetMultiple: 29,
      });
      expect(form.tiers).toEqual({ startingFunds: 4, dayLimit: 2, netWorthTarget: 5 });
    });

    it('recomputes the target amounts when the starting funds change, keeping the choice', () => {
      render();
      setValue('netWorthTargetTier', '2');
      setValue('startingFundsTier', '5');
      expect(optionTexts('netWorthTargetTier')).toEqual([
        '無',
        '113441',
        '126787',
        '無',
        '153479',
        '193517',
      ]);
      expect(field<HTMLSelectElement>('netWorthTargetTier').value).toBe('2');
    });

    it('prefills the options from the given form', () => {
      render({
        ...defaultSetupForm(),
        tiers: { startingFunds: 3, dayLimit: 4, netWorthTarget: 1 },
      });
      expect(field<HTMLSelectElement>('startingFundsTier').value).toBe('3');
      expect(field<HTMLSelectElement>('dayLimitTier').value).toBe('4');
      expect(field<HTMLSelectElement>('netWorthTargetTier').value).toBe('1');
    });

    it('goes back to the custom fields, as typed, when the tables are cleared', () => {
      const { clear } = render({ ...defaultSetupForm(), dayLimit: '45' });
      setValue('dayLimitTier', '3');
      clear.click();
      expect(visible('dayLimit')).toBe(true);
      expect(visible('dayLimitTier')).toBe(false);
      expect(field<HTMLInputElement>('dayLimit').value).toBe('45');
      submit();
      const [setup, form] = started[0]!;
      expect(setup.config.dayLimit).toBe(45);
      expect(form.tiers.dayLimit).toBe(3);
    });

    it('shows the starting funds with the day limit and target, outside the advanced settings', () => {
      for (const imported of [false, true]) {
        render(defaultSetupForm(), imported);
        const suffix = imported ? 'Tier' : '';
        const names = ['startingFunds', 'dayLimit', 'netWorthTarget'].map((n) => n + suffix);
        const labels = names.map((n) => field(n).closest('label')!);
        expect(labels.map((l) => l.closest('details'))).toEqual([null, null, null]);
        const all = [...root.querySelectorAll('form > label')];
        const at = labels.map((l) => all.indexOf(l));
        // Each setting has its custom field and its option menu side by side, one of them hidden.
        expect(at[1]).toBe(at[0]! + 2);
        expect(at[2]).toBe(at[1]! + 2);
      }
    });
  });

  it('has no tables section unless asked to', () => {
    expect(root.querySelector('.setup-tables')).toBeNull();
  });
});
