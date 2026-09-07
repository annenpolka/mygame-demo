export const PAD_ACTIONS = [
  'confirm',
  'cancel',
  'previous',
  'next',
  'slow',
  'stop',
  'pause',
  'log',
  'up',
  'down',
  'left',
  'right',
] as const;
export type PadAction = (typeof PAD_ACTIONS)[number];
export type PadFamily = 'xbox' | 'playstation' | 'switch';
export type PadBindings = Record<PadAction, number> & {
  axisX: number;
  axisY: number;
  invertX: boolean;
  invertY: boolean;
};
export interface PadSnapshot {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}
export function padFamily(id: string): PadFamily {
  return /playstation|dualsense|dualshock|054c|sony/i.test(id)
    ? 'playstation'
    : /nintendo|switch|057e|pro controller/i.test(id)
      ? 'switch'
      : 'xbox';
}
export function defaultBindings(family: PadFamily): PadBindings {
  return {
    confirm: family === 'switch' ? 1 : 0,
    cancel: family === 'switch' ? 0 : 1,
    previous: 4,
    next: 5,
    slow: 2,
    stop: 3,
    pause: 9,
    log: 8,
    up: 12,
    down: 13,
    left: 14,
    right: 15,
    axisX: 0,
    axisY: 1,
    invertX: false,
    invertY: false,
  };
}
export function buttonName(index: number, family: PadFamily) {
  return (
    {
      xbox: [
        'A',
        'B',
        'X',
        'Y',
        'LB',
        'RB',
        'LT',
        'RT',
        'View',
        'Menu',
        'L3',
        'R3',
        '↑',
        '↓',
        '←',
        '→',
      ],
      playstation: [
        '×',
        '○',
        '□',
        '△',
        'L1',
        'R1',
        'L2',
        'R2',
        'Share',
        'Options',
        'L3',
        'R3',
        '↑',
        '↓',
        '←',
        '→',
      ],
      switch: [
        'B',
        'A',
        'Y',
        'X',
        'L',
        'R',
        'ZL',
        'ZR',
        '−',
        '+',
        'L押込',
        'R押込',
        '↑',
        '↓',
        '←',
        '→',
      ],
    }[family][index] ?? `ボタン ${index}`
  );
}
const directions = new Set<PadAction>(['up', 'down', 'left', 'right']);
/** Poller is independent of the DOM. Commands are edges, only navigation repeats. */
export class PadReader {
  private identity = '';
  private held = new Set<PadAction>();
  private repeats = new Map<PadAction, number>();
  private axisHeld = { x: 0, y: 0 };
  reset() {
    this.identity = '';
    this.held.clear();
    this.repeats.clear();
    this.axisHeld = { x: 0, y: 0 };
  }
  read(pad: PadSnapshot | null, bindings: PadBindings, now: number, enabled = true): PadAction[] {
    if (!pad?.connected) {
      this.reset();
      return [];
    }
    const identity = `${pad.index}:${pad.id}`;
    const rawX = (pad.axes[bindings.axisX] ?? 0) * (bindings.invertX ? -1 : 1),
      rawY = (pad.axes[bindings.axisY] ?? 0) * (bindings.invertY ? -1 : 1);
    const axis = (value: number, previous: number) =>
      Math.abs(value) < 0.35 ? 0 : Math.abs(value) >= 0.55 ? Math.sign(value) : previous;
    this.axisHeld = { x: axis(rawX, this.axisHeld.x), y: axis(rawY, this.axisHeld.y) };
    const down = new Set(
      PAD_ACTIONS.filter(
        (a) => pad.buttons[bindings[a]]?.pressed || (pad.buttons[bindings[a]]?.value ?? 0) > 0.55,
      ),
    );
    if (this.axisHeld.x < 0) down.add('left');
    if (this.axisHeld.x > 0) down.add('right');
    if (this.axisHeld.y < 0) down.add('up');
    if (this.axisHeld.y > 0) down.add('down');
    if (!enabled || identity !== this.identity) {
      this.identity = identity;
      this.held = down;
      this.repeats.clear();
      return [];
    }
    const output: PadAction[] = [];
    for (const a of down) {
      if (!this.held.has(a)) {
        output.push(a);
        this.repeats.set(a, now + 350);
      } else if (directions.has(a) && now >= (this.repeats.get(a) ?? Infinity)) {
        output.push(a);
        this.repeats.set(a, now + 110);
      }
    }
    for (const a of this.held) if (!down.has(a)) this.repeats.delete(a);
    this.held = down;
    // A diagonal is a single navigation choice; avoid jumping twice per frame.
    const nav = output.find((a) => directions.has(a));
    return output.filter((a) => !directions.has(a) || a === nav);
  }
}
export function validBindings(input: unknown): input is PadBindings {
  if (!input || typeof input !== 'object') return false;
  const b = input as PadBindings;
  return (
    PAD_ACTIONS.every((k) => Number.isInteger(b[k]) && b[k] >= 0 && b[k] <= 63) &&
    ['axisX', 'axisY'].every(
      (k) => Number.isInteger(b[k as 'axisX']) && b[k as 'axisX'] >= -1 && b[k as 'axisX'] <= 15,
    ) &&
    typeof b.invertX === 'boolean' &&
    typeof b.invertY === 'boolean'
  );
}
