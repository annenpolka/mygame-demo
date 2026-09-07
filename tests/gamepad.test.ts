import { it, expect, describe } from 'vitest';
import {
  PadReader,
  defaultBindings,
  navigationPreset,
  padFamily,
  buttonName,
  validBindings,
  migrateBindings,
  type PadSnapshot,
} from '../src/input/gamepad';
const pad = (buttons: number[] = [], axes: number[] = [0, 0], id = 'Xbox'): PadSnapshot => ({
  id,
  index: 0,
  connected: true,
  mapping: 'standard',
  buttons: Array.from({ length: 24 }, (_, i) => ({
    pressed: buttons.includes(i),
    value: buttons.includes(i) ? 1 : 0,
  })),
  axes,
});
const legacy = () => ({
  confirm: 20,
  cancel: 1,
  skill: 3,
  item: 2,
  previous: 4,
  next: 5,
  slow: 6,
  stop: 7,
  pause: 9,
  log: 8,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  queue: 11,
  mark: 10,
  axisX: 2,
  axisY: 3,
  invertX: true,
  invertY: false,
});
describe('separate analog navigation and physical control edges', () => {
  it.each([
    ['Xbox Wireless', 'xbox', 0],
    ['DualSense Wireless (054c)', 'playstation', 0],
    ['Nintendo Switch Pro (057e)', 'switch', 1],
  ] as const)(
    '%s has distinct execute/cutoff/back and three action buttons',
    (id, family, confirm) => {
      const b = defaultBindings(family),
        r = new PadReader();
      expect(padFamily(id)).toBe(family);
      expect(b.confirm).toBe(confirm);
      expect(buttonName(confirm, family)).toBe(family === 'playstation' ? '×' : 'A');
      expect([b.execute, b.cutQueue, b.back]).toEqual([7, 6, family === 'switch' ? 0 : 1]);
      expect([b.skill, b.guard]).toEqual([2, 3]);
      expect(validBindings(b)).toBe(true);
      r.read(pad([], [], id), b, 0);
      expect(r.read(pad([confirm], [], id), b, 20)).toEqual(['confirm']);
    },
  );
  it('separates a held D-pad time button from repeating analog navigation, including while both are held', () => {
    const b = defaultBindings('xbox'),
      r = new PadReader();
    r.read(pad(), b, 0);
    expect(r.read(pad([14], [1, 0]), b, 20)).toEqual(['slow', 'right']);
    expect(r.read(pad([14], [1, 0]), b, 400)).toEqual(['right']);
    expect(r.read(pad([14], [1, 0]), b, 1000)).toEqual(['right']);
    r.read(pad(), b, 1020);
    expect(r.read(pad([15]), b, 1040)).toEqual(['stop']);
    expect(r.read(pad([15]), b, 2040)).toEqual([]);
  });
  it('never repeats execute, cutoff, back, action or menu controls', () => {
    const b = defaultBindings('playstation'),
      r = new PadReader();
    for (const key of [
      'execute',
      'cutQueue',
      'back',
      'guard',
      'skill',
      'confirm',
      'tactics',
      'aux',
      'menu',
    ] as const) {
      r.reset();
      r.read(pad(), b, 0);
      expect(r.read(pad([b[key]]), b, 20)).toEqual([key]);
      expect(r.read(pad([b[key]]), b, 2000)).toEqual([]);
    }
  });
  it('offers digital navigation without losing execute, cutoff, back or access to time controls through the menu', () => {
    const original = defaultBindings('xbox'),
      b = navigationPreset(original, 'dpad'),
      r = new PadReader();
    expect(validBindings(b)).toBe(true);
    expect([b.execute, b.cutQueue, b.back, b.menu]).toEqual([7, 6, 1, 8]);
    expect([b.slow, b.stop, b.tactics, b.aux]).toEqual([-1, -1, -1, -1]);
    r.read(pad(), b, 0);
    expect(r.read(pad([14]), b, 20)).toEqual(['left']);
    expect(r.read(pad([14]), b, 400)).toEqual(['left']);
    expect(navigationPreset(b, 'stick')).toEqual(original);
  });
  it('uses deadzone hysteresis and a single diagonal choice', () => {
    const b = defaultBindings('xbox'),
      r = new PadReader();
    r.read(pad(), b, 0);
    expect(r.read(pad([], [0.3, 0.3]), b, 1)).toEqual([]);
    expect(r.read(pad([], [0.7, 0.7]), b, 20)).toHaveLength(1);
    expect(r.read(pad([], [0.45, 0.45]), b, 30)).toEqual([]);
    r.read(pad(), b, 40);
    expect(r.read(pad([], [-0.7, 0]), b, 50)).toEqual(['left']);
  });
  it('does not replay held input on connect, reconnect or returning to a hidden page', () => {
    const b = defaultBindings('xbox'),
      r = new PadReader();
    expect(r.read(pad([7]), b, 0)).toEqual([]);
    r.read(pad(), b, 20);
    expect(r.read(pad([7]), b, 30)).toEqual(['execute']);
    r.read(pad([7]), b, 40, false);
    expect(r.read(pad([7]), b, 50, true)).toEqual([]);
    r.read(null, b, 60);
    expect(r.read(pad([7]), b, 70)).toEqual([]);
  });
  it('validates independent physical controls and supports raw mappings with custom axes', () => {
    const b = { ...defaultBindings('xbox'), confirm: 20, axisX: 3, invertX: true },
      r = new PadReader();
    expect(validBindings(b)).toBe(true);
    expect(validBindings({ ...b, execute: b.back })).toBe(false);
    expect(validBindings({ ...b, back: -1 })).toBe(false);
    expect(validBindings({ ...b, confirm: 100 })).toBe(false);
    r.read(pad(), b, 0);
    expect(r.read(pad([20]), b, 10)).toEqual(['confirm']);
    r.read(pad(), b, 20);
    expect(r.read(pad([], [0, 0, 0, 0.8]), b, 30)).toEqual(['left']);
  });
  it.each(['v1', 'v2', 'v3', 'v4'] as const)(
    'migrates %s physical slots and custom axes to the new roles',
    (version) => {
      const old: any = legacy();
      if (version === 'v1') {
        delete old.skill;
        delete old.item;
        old.slow = 2;
        old.stop = 3;
      }
      if (version === 'v1' || version === 'v2') {
        delete old.queue;
        delete old.mark;
      }
      if (version === 'v4') {
        old.back = old.cancel;
        old.cutQueue = old.item;
        delete old.cancel;
        delete old.item;
      }
      const b = migrateBindings(old)!;
      expect(b).toMatchObject({
        confirm: 20,
        back: 1,
        skill: 2,
        guard: 3,
        cutQueue: 6,
        execute: 7,
        slow: 14,
        stop: 15,
        tactics: 12,
        aux: 13,
        menu: 8,
        axisX: 2,
        axisY: 3,
        invertX: true,
      });
      expect(validBindings(b)).toBe(true);
      expect(migrateBindings(b)).toEqual(b);
    },
  );
  it('finds unused queue and mark buttons in older custom layouts', () => {
    const old: any = { ...legacy(), confirm: 11, previous: 10 };
    delete old.queue;
    delete old.mark;
    const b = migrateBindings(old)!;
    expect(b.confirm).toBe(11);
    expect(b.previous).toBe(10);
    expect(b.queue).not.toBe(11);
    expect(b.mark).not.toBe(10);
    expect(validBindings(b)).toBe(true);
  });
});
