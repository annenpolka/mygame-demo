import { it, expect, describe } from 'vitest';
import {
  PadReader,
  defaultBindings,
  padFamily,
  buttonName,
  validBindings,
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
describe('controller polling and mappings', () => {
  it.each([
    ['Xbox Wireless', 'xbox', 0],
    ['DualSense Wireless (054c)', 'playstation', 0],
    ['Nintendo Switch Pro (057e)', 'switch', 1],
  ] as const)('%s uses its button labels and confirm mapping', (id, family, confirm) => {
    expect(padFamily(id)).toBe(family);
    const b = defaultBindings(family);
    expect(b.confirm).toBe(confirm);
    expect(buttonName(confirm, family)).toBe(family === 'playstation' ? '×' : 'A');
    const r = new PadReader();
    r.read(pad([], [], id), b, 0);
    expect(r.read(pad([confirm], [], id), b, 20)).toEqual(['confirm']);
  });
  it('fires commands once while held, but repeats navigation after a delay', () => {
    const r = new PadReader(),
      b = defaultBindings('xbox');
    r.read(pad(), b, 0);
    expect(r.read(pad([0]), b, 20)).toEqual(['confirm']);
    expect(r.read(pad([0]), b, 1000)).toEqual([]);
    r.read(pad(), b, 1010);
    expect(r.read(pad([15]), b, 1020)).toEqual(['right']);
    expect(r.read(pad([15]), b, 1200)).toEqual([]);
    expect(r.read(pad([15]), b, 1380)).toEqual(['right']);
  });
  it('uses a deadzone with hysteresis and avoids diagonal double steps', () => {
    const r = new PadReader(),
      b = defaultBindings('xbox');
    r.read(pad(), b, 0);
    expect(r.read(pad([], [0.3, 0.3]), b, 1)).toEqual([]);
    expect(r.read(pad([], [0.7, 0.7]), b, 20)).toHaveLength(1);
    expect(r.read(pad([], [0.45, 0.45]), b, 30)).toEqual([]);
    r.read(pad(), b, 40);
    expect(r.read(pad([], [-0.7, 0]), b, 50)).toEqual(['left']);
  });
  it('does not replay held input on connect, reconnect, or returning to a hidden page', () => {
    const r = new PadReader(),
      b = defaultBindings('xbox');
    expect(r.read(pad([0]), b, 0)).toEqual([]);
    r.read(pad(), b, 20);
    expect(r.read(pad([0]), b, 30)).toEqual(['confirm']);
    r.read(pad([0]), b, 40, false);
    expect(r.read(pad([0]), b, 50, true)).toEqual([]);
    r.read(null, b, 60);
    expect(r.read(pad([0]), b, 70)).toEqual([]);
  });
  it('supports custom raw-button mappings and validates persisted settings', () => {
    const b = { ...defaultBindings('xbox'), confirm: 20, axisX: 3, invertX: true };
    expect(validBindings(b)).toBe(true);
    expect(validBindings({ ...b, confirm: 100 })).toBe(false);
    const r = new PadReader();
    r.read(pad(), b, 0);
    expect(r.read(pad([20]), b, 10)).toEqual(['confirm']);
    r.read(pad(), b, 20);
    expect(r.read(pad([], [0, 0, 0, 0.8]), b, 30)).toEqual(['left']);
  });
});
