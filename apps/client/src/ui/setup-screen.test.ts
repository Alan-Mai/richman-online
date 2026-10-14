// @vitest-environment happy-dom
import { TEST_BRANCH_BOARD, TEST_LOOP_BOARD, type GameSetup } from '@richman/shared';
import { beforeEach, describe, expect, it } from 'vitest';
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
    setValue('startingCash', '3000');
    submit();
    expect(started).toHaveLength(1);
    const [setup, form] = started[0]!;
    expect(setup.players[0]?.name).toBe('阿土伯');
    expect(setup.config.startingCash).toBe(3000);
    expect(setup.seed).toBe(99);
    expect(form.names[0]).toBe('阿土伯');
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

  it('shows the round limit only for the round-limit condition', () => {
    const limitLabel = field('maxRounds').closest('label')!;
    expect(limitLabel.hidden).toBe(false);
    const lastStanding = root.querySelector<HTMLInputElement>('[value="lastStanding"]')!;
    lastStanding.checked = true;
    lastStanding.dispatchEvent(new Event('change'));
    expect(limitLabel.hidden).toBe(true);
    submit();
    expect(started[0]?.[0].config.winCondition).toBe('lastStanding');
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
});
