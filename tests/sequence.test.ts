import { describe, expect, it } from 'vitest';
import { DT, SKILLS, VERSION } from '../src/content/data';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { planTiming, planned } from '../src/sim/plan';
import { charging } from '../src/sim/execution';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import type { State, Target } from '../src/sim/types';
function quiet(atb = 4) {
  const s = createState({ bonusMode: 'none' });
  command(s, { type: 'start' });
  s.allies[0].atb = atb;
  s.allies.slice(1).forEach((a) => {
    a.executionHeld = true;
  });
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  return s;
}
function add(s: State, skillId = 'slash', target: Target = { kind: 'enemy', id: 0 }, id = 0) {
  expect(command(s, { type: 'enqueue', id, step: { kind: 'skill', skillId, target } })).toBe(true);
}
const starts = (s: State, id = 0) =>
  s.events.filter((e) => e.type === 'action' && e.source === `a${id}`);
function tickUntil(s: State, predicate: () => boolean, limit = 3000) {
  for (let i = 0; i < limit && !predicate(); i++) step(s);
  expect(predicate()).toBe(true);
}
describe('bank ATB, link identical skills, and keep the final recovery', () => {
  it('links four funded slashes at 1.1s intervals; impacts once at 0.9s; finishes in 5.2s', () => {
    const s = quiet();
    for (let i = 0; i < 4; i++) add(s);
    step(s);
    const first = s.time;
    while (s.allies[0].action || planned(s.allies[0]).length) {
      const before = s.allies[0].atb;
      step(s);
      expect(s.allies[0].atb).toBeLessThanOrEqual(before);
    }
    expect(starts(s).map((e) => Number((e.time - first).toFixed(2)))).toEqual([0, 1.1, 2.2, 3.3]);
    expect(
      s.events
        .filter((e) => e.type === 'damage' && e.source === 'a0')
        .map((e) => Number((e.time - first).toFixed(2))),
    ).toEqual([0.9, 2, 3.1, 4.2]);
    expect(s.time - first).toBeCloseTo(5.2);
    expect(s.allies[0].atb).toBe(0);
    step(s);
    expect(s.allies[0].atb).toBeCloseTo(s.config.atbRate * DT);
  });
  it('charges with an unfunded queue, and hold lets a one-ATB start bank a full sequence', () => {
    const s = quiet(1),
      a = s.allies[0];
    command(s, { type: 'hold', id: 0, value: true });
    for (let i = 0; i < 4; i++) add(s);
    advance(s, 4);
    expect(a.atb).toBe(4);
    expect(starts(s)).toHaveLength(0);
    expect(
      planTiming(a, s.config, s).every((p) => p.status === 'held' && p.ends === Infinity),
    ).toBe(true);
    command(s, { type: 'hold', id: 0, value: false });
    advance(s, 3.5);
    expect(starts(s)).toHaveLength(4);
    const low = quiet(1);
    for (let i = 0; i < 4; i++) add(low);
    advance(low, 2.5);
    expect(starts(low)).toHaveLength(1);
    expect(low.allies[0].atb).toBeGreaterThan(0);
    advance(low, 2);
    expect(starts(low)).toHaveLength(2);
    expect(low.allies[0].action?.comboIndex).toBe(1);
  });
  it.each(['cancel', 'cancelFirst', 'hold', 'death', 'weapon', 'move'] as const)(
    '%s at the connection boundary cannot erase final recovery or refund payment',
    (interruption) => {
      const s = quiet(),
        a = s.allies[0];
      add(s);
      add(s);
      step(s);
      advance(s, 1.1 - DT);
      const paid = a.atb;
      if (interruption === 'hold') command(s, { type: 'hold', id: 0, value: true });
      else if (interruption === 'death') s.enemies[0].hp = 0;
      else if (interruption === 'weapon') command(s, { type: 'optima', index: 3 });
      else if (interruption === 'move') command(s, { type: 'move', id: 0, row: 'back' });
      else command(s, { type: interruption, id: 0 });
      step(s);
      expect(starts(s)).toHaveLength(1);
      expect(a.atb).toBe(paid);
      expect(a.action?.remaining).toBeCloseTo(0.8);
      advance(s, 0.8 - DT);
      expect(a.action).not.toBeNull();
      step(s);
      expect(a.action).toBeNull();
      expect(a.atb).toBe(paid);
    },
  );
  it('cancelling after a committed link preserves the second hit and its own full final recovery', () => {
    const s = quiet(),
      a = s.allies[0];
    for (let i = 0; i < 4; i++) add(s);
    tickUntil(s, () => a.action?.comboIndex === 2);
    const action = copy(a.action),
      atb = a.atb;
    command(s, { type: 'cancel', id: 0 });
    expect(a.action).toEqual(action);
    expect(a.atb).toBe(atb);
    advance(s, 1.9);
    expect(a.action).toBeNull();
    expect(starts(s)).toHaveLength(2);
    expect(a.atb).toBe(atb);
  });
  it('allows different valid targets for the same skill, including distributed healing', () => {
    const s = quiet();
    add(s);
    add(s, 'slash', { kind: 'enemy', id: 1 });
    advance(s, 1.2);
    expect(s.allies[0].action).toMatchObject({ comboIndex: 2, target: { kind: 'enemy', id: 1 } });
    const heal = quiet(),
      a = heal.allies[2];
    heal.selected = 2;
    a.executionHeld = false;
    a.atb = 4;
    heal.allies[0].hp = heal.allies[1].hp = 100;
    add(heal, 'heal', { kind: 'ally', id: 0 }, 2);
    add(heal, 'heal', { kind: 'ally', id: 1 }, 2);
    advance(heal, 1.5);
    expect(a.action).toMatchObject({ comboIndex: 2, target: { kind: 'ally', id: 1 } });
  });
  it.each(['guard', 'potion', 'sweep'] as const)('%s always pays full recovery', (id) => {
    const s = quiet();
    const target: Target = id === 'sweep' ? { kind: 'row', row: 'front' } : { kind: 'ally', id: 0 };
    add(s, id, target);
    add(s, id, target);
    tickUntil(s, () => starts(s).length === 2);
    expect(starts(s)[1].time - starts(s)[0].time).toBeCloseTo(
      SKILLS[id].cast + SKILLS[id].recovery + DT,
    );
    expect(s.allies[0].action?.comboIndex).toBe(1);
  });
  it('stops supply for movement, weapon changes, potion and handoff independently per actor', () => {
    for (const mode of ['move', 'weapon', 'potion', 'handoff']) {
      const s = quiet(2),
        a = s.allies[0];
      if (mode === 'move') command(s, { type: 'move', id: 0, row: 'back' });
      if (mode === 'weapon') command(s, { type: 'toggleWeapon', id: 0 });
      if (mode === 'potion') add(s, 'potion', { kind: 'ally', id: 0 });
      if (mode === 'handoff') command(s, { type: 'select', id: 1 });
      step(s);
      const atb = a.atb,
        other = s.allies[2].atb;
      expect(charging(a, s.config)).toBe(false);
      advance(s, 0.25);
      expect(a.atb).toBe(atb);
      expect(s.allies[2].atb).toBeGreaterThan(other);
    }
  });
  it.each([1, 4])(
    'runtime starts and impacts match forecasts from %s ATB across links, waiting, movement, and guard',
    (initial) => {
      const s = quiet(initial),
        a = s.allies[0];
      add(s);
      add(s);
      command(s, { type: 'enqueue', id: 0, step: { kind: 'move', row: 'back' } });
      add(s, 'guard', { kind: 'ally', id: 0 });
      step(s);
      advance(s, 0.5);
      const now = s.time,
        forecast = planTiming(a, s.config, s);
      tickUntil(s, () => !planned(a).length && !a.action && !a.nextRow);
      const future = starts(s).filter((e) => e.time > now);
      for (const [i, prediction] of forecast.filter((_, i) => i !== 1).entries())
        expect(future[i].time - now).toBeCloseTo(prediction.starts, 8);
      const guardImpact = s.events.find((e) => e.text.includes('防護'))!;
      expect(guardImpact.time - now).toBeCloseTo(forecast.at(-1)!.ends, 8);
    },
  );
  it('companions form funded bursts and stop automatic heals once the target recovers', () => {
    const s = quiet(),
      a = s.allies[1];
    a.executionHeld = false;
    a.atb = 3;
    step(s);
    expect(planned(a)).toHaveLength(2);
    advance(s, 1.2);
    expect(a.action?.comboIndex).toBe(2);
    const h = quiet(),
      healer = h.allies[2];
    healer.executionHeld = false;
    healer.atb = 3;
    h.allies[0].hp = h.allies[0].maxHp * 0.8;
    step(h);
    expect(planned(healer)).toHaveLength(2);
    advance(h, 2.5);
    expect(starts(h, 2)).toHaveLength(1);
    expect(planned(healer)).toHaveLength(0);
  });
  it('a queued handoff cannot release an active action for free, even after spending the last ATB', () => {
    const s = quiet(1),
      a = s.allies[0];
    add(s);
    step(s);
    command(s, { type: 'select', id: 1 });
    advance(s, 1.9);
    expect(s.selected).toBe(0);
    expect(a.atb).toBeLessThan(0.02);
    expect(a.action).toBeNull();
    tickUntil(s, () => a.action?.skillId === 'handoff');
    expect(s.selected).toBe(0);
    expect(s.time).toBeGreaterThan(3);
  });
  it('restores and replays holds, links, cancellations, and frozen recovery exactly; rejects old and changed timing', () => {
    const session = new Session();
    const s = quiet();
    session.restore(JSON.stringify({ version: VERSION, kind: 'snapshot', state: s }));
    session.send({ type: 'hold', id: 0, value: true });
    for (let i = 0; i < 3; i++)
      session.send({
        type: 'enqueue',
        id: 0,
        step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
      });
    session.send({ type: 'hold', id: 0, value: false });
    for (let i = 0; i < 13; i++) session.advance(0.1);
    expect(session.state.allies[0].action?.comboIndex).toBe(2);
    session.send({ type: 'cancel', id: 0 }, { type: 'time', mode: 'stop' });
    const atb = session.state.allies[0].atb;
    session.advance(0.2);
    expect(session.state.allies[0].atb).toBe(atb);
    expect(parseSnapshot(session.snapshot())).toEqual(session.state);
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(session.state);
    expect(() => parseSnapshot(session.snapshot().replaceAll(VERSION, 'orchestra-7'))).toThrow();
    const invalid = JSON.parse(session.snapshot());
    invalid.state.allies[0].action.recovery = 0;
    expect(() => parseSnapshot(JSON.stringify(invalid))).toThrow();
  });
});
