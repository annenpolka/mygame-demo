import { describe, expect, it } from 'vitest';
import { BATTLE_TIMING, DT, SKILLS } from '../src/content/data';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { canAppend, planned, plannedCost, projectedRow } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import { runPolicy } from '../src/ai/runner';
import type { State } from '../src/sim/types';

function battle(atbMax = 4) {
  const s = createState({ atbMax, bonusMode: 'none' });
  command(s, { type: 'start' });
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  s.allies.forEach((a) => {
    a.atb = atbMax;
  });
  return s;
}
const add = (s: State, skillId = 'guard', id = 0) =>
  command(s, {
    type: 'enqueue',
    id,
    step: {
      kind: 'skill',
      skillId,
      target: skillId === 'sweep' ? { kind: 'row', row: 'front' } : { kind: 'ally', id },
    },
  });
const untilHandoff = (s: State) => {
  for (let i = 0; i < 600 && s.pendingSelect !== null; i++) step(s);
  expect(s.pendingSelect).toBeNull();
};

describe('capacity, direct stacking and head cancellation', () => {
  it.each([2, 4, 6, 8])(
    'bounds charged ATB and queued cost at %i independently of currently held ATB',
    (cap) => {
      const s = battle(cap),
        a = s.allies[0];
      a.atb = 0;
      for (let i = 0; i < cap / 2; i++) expect(add(s, 'sweep')).toBe(true);
      expect(plannedCost(a)).toBe(cap);
      expect(add(s)).toBe(false);
      expect(a.atb).toBe(0);
      command(s, { type: 'cancelFirst', id: 0 });
      expect(plannedCost(a)).toBe(cap - 2);
      expect(add(s)).toBe(true);
      command(s, { type: 'cancel', id: 0 });
      advance(s, 20);
      expect(a.atb).toBe(cap);
    },
  );
  it('bounds zero-cost steps, toggles the projected row and keeps the surviving absolute destinations', () => {
    const s = battle(),
      a = s.allies[0];
    for (let i = 0; i < 4; i++) expect(command(s, { type: 'toggleRow', id: 0 })).toBe(true);
    expect(planned(a).map((p) => p.kind === 'move' && p.row)).toEqual([
      'back',
      'front',
      'back',
      'front',
    ]);
    expect(plannedCost(a)).toBe(0);
    expect(canAppend(a, s.config)).toBe(false);
    expect(command(s, { type: 'toggleRow', id: 0 })).toBe(false);
    expect(command(s, { type: 'cancelFirst', id: 0 })).toBe(true);
    expect(planned(a).map((p) => p.key)).toEqual([2, 3, 4]);
    expect(projectedRow(a)).toBe('front');
    step(s); // The now-redundant first front move completes without reversing the later moves.
    step(s);
    expect(a.nextRow).toBe('back');
    command(s, { type: 'cancel', id: 0 });
    expect(projectedRow(a)).toBe('back');
    command(s, { type: 'toggleRow', id: 0 });
    expect(planned(a)[0]).toMatchObject({ kind: 'move', row: 'front' });
  });
  it('cancels the current head after execution advances, leaving committed recovery and paid ATB intact', () => {
    const s = battle(),
      a = s.allies[0];
    add(s);
    add(s, 'potion');
    add(s);
    step(s);
    const action = copy(a.action),
      atb = a.atb;
    command(s, { type: 'cancelFirst', id: 0 });
    expect(planned(a).map((p) => p.key)).toEqual([3]);
    expect(a.action).toEqual(action);
    expect(a.atb).toBe(atb);
    command(s, { type: 'cancelFirst', id: 0 });
    expect(command(s, { type: 'cancelFirst', id: 0 })).toBe(false);
    expect(s.potions).toBe(3);
    advance(s, SKILLS.guard.cast + DT);
    expect(a.shield).toBeGreaterThan(0);
  });
  it('supports the legacy pending slot and prunes skills made impossible by cancelling a weapon change', () => {
    const s = battle(),
      a = s.allies[0];
    a.atb = 0;
    command(s, { type: 'skill', id: 0, skillId: 'guard', target: { kind: 'ally', id: 0 } });
    expect(planned(a)).toHaveLength(1);
    command(s, { type: 'cancelFirst', id: 0 });
    expect(planned(a)).toHaveLength(0);
    command(s, { type: 'enqueue', id: 0, step: { kind: 'weapon', slot: 1 } });
    add(s, 'ward');
    add(s);
    command(s, { type: 'cancelFirst', id: 0 });
    expect(planned(a)).toMatchObject([{ kind: 'skill', skillId: 'guard' }]);
  });
  it('rejects over-budget snapshots, even when their number of entries is valid', () => {
    const s = battle();
    add(s, 'sweep');
    add(s, 'sweep');
    s.allies[0].plan!.push({
      key: ++s.planSeq!,
      kind: 'skill',
      skillId: 'guard',
      target: { kind: 'ally', id: 0 },
    });
    expect(() =>
      parseSnapshot(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
    ).toThrow();
  });
});

describe('one-ATB handoff at the head of the stack', () => {
  it('does not let legacy replacement input orphan the pending handoff', () => {
    const s = battle();
    command(s, { type: 'select', id: 1 });
    expect(
      command(s, { type: 'skill', id: 0, skillId: 'guard', target: { kind: 'ally', id: 0 } }),
    ).toBe(false);
    expect(planned(s.allies[0])[0]).toMatchObject({ kind: 'skill', skillId: 'handoff' });
    expect(
      parseSnapshot(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
    ).toEqual(s);
  });
  it.each([1, 2] as const)(
    'clears an interrupted handoff when battle %i ends, preserving valid snapshots',
    (encounter) => {
      const s = battle();
      s.encounter = encounter;
      command(s, { type: 'select', id: 1 });
      s.enemies.forEach((e) => (e.hp = 0));
      step(s);
      expect(s.pendingSelect).toBeNull();
      expect(planned(s.allies[0]).some((p) => p.kind === 'skill' && p.skillId === 'handoff')).toBe(
        false,
      );
      expect(
        parseSnapshot(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
      ).toEqual(s);
    },
  );
  it('can exceed both limits, waits for the committed attack, then pays and clears the following plans', () => {
    const s = battle(),
      a = s.allies[0];
    add(s);
    step(s);
    for (let i = 0; i < 4; i++) add(s);
    const atb = a.atb,
      action = copy(a.action);
    expect(command(s, { type: 'select', id: 1 })).toBe(true);
    expect(planned(a)).toHaveLength(5);
    expect(plannedCost(a)).toBe(5);
    expect(a.action).toEqual(action);
    expect(a.atb).toBe(atb);
    expect(
      parseSnapshot(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
    ).toEqual(s);
    advance(s, 1.4);
    expect(a.action).toBeNull();
    step(s);
    expect(a.action?.skillId).toBe('handoff');
    expect(planned(a)).toHaveLength(0);
    expect(a.atb).toBeCloseTo(
      Math.min(4, atb + 1.4 * s.config.atbRate) + DT * s.config.atbRate - 1,
    );
    untilHandoff(s);
    expect(s.selected).toBe(1);
    expect(s.handoffSlow).toBe(0.8);
    expect(
      s.events.filter((e) => e.source === 'a0' && e.type === 'action').map((e) => e.text),
    ).toHaveLength(2);
  });
  it('waits for 1 ATB even when idle and has a committed 0.6-second action', () => {
    const s = battle(),
      a = s.allies[0];
    a.atb = 0;
    command(s, { type: 'select', id: 1 });
    advance(s, 1);
    expect(s.selected).toBe(0);
    expect(a.action).toBeNull();
    advance(s, 0.85);
    expect(a.action?.skillId).toBe('handoff');
    expect(s.selected).toBe(0);
    expect(command(s, { type: 'cancelFirst', id: 0 })).toBe(false);
    untilHandoff(s);
    expect(s.selected).toBe(1);
  });
  it('cancels or replaces the head reservation without removing the original following actions', () => {
    const s = battle(),
      a = s.allies[0];
    add(s);
    add(s);
    const keys = planned(a).map((p) => p.key);
    command(s, { type: 'select', id: 1 });
    command(s, { type: 'select', id: 2 });
    expect(planned(a)).toHaveLength(3);
    expect(s.pendingSelect).toBe(2);
    command(s, { type: 'cancelFirst', id: 0 });
    expect(s.pendingSelect).toBeNull();
    expect(planned(a).map((p) => p.key)).toEqual(keys);
  });
  it.each(['move', 'weapon'] as const)('waits for a %s already in progress', (kind) => {
    const s = battle();
    command(s, {
      type: 'enqueue',
      id: 0,
      step: kind === 'move' ? { kind, row: 'back' } : { kind, slot: 1 },
    });
    step(s);
    step(s);
    command(s, { type: 'select', id: 1 });
    step(s);
    expect(s.allies[0].action).toBeNull();
    untilHandoff(s);
    expect(s.selected).toBe(1);
    expect(kind === 'move' ? s.allies[0].row : s.allies[0].slot).toBe(kind === 'move' ? 'back' : 1);
  });
  it('allows free slowdown on every paid handoff and consumes no focus even from manual slow', () => {
    const s = battle();
    command(s, { type: 'time', mode: 'slow' });
    command(s, { type: 'select', id: 1 });
    untilHandoff(s);
    expect(s.handoffSlow).toBe(0.8);
    const focus = s.focus,
      time = s.time;
    advance(s, 0.4);
    expect(s.focus).toBe(focus);
    expect(s.time - time).toBeCloseTo(0.1);
    command(s, { type: 'time', mode: 'normal' });
    command(s, { type: 'select', id: 0 });
    untilHandoff(s);
    expect(s.handoffSlow).toBe(0.8);
  });
  it('preserves later plans if the destination dies before execution, freezes on pause and clears on AI mode', () => {
    const s = battle();
    add(s);
    command(s, { type: 'select', id: 1 });
    s.allies[1].hp = 0;
    step(s);
    expect(s.pendingSelect).toBeNull();
    expect(planned(s.allies[0])).toHaveLength(1);
    command(s, { type: 'select', id: 2 });
    command(s, { type: 'pause', value: true });
    const before = copy(s);
    advance(s, 2);
    expect(s).toEqual(before);
    command(s, { type: 'pause', value: false });
    command(s, { type: 'control', mode: 'ai' });
    expect(s.pendingSelect).toBeNull();
    expect(planned(s.allies[0])).toHaveLength(1);
    expect(s.handoffSlow).toBe(0);
  });
  it('round-trips over-capacity reservations and paid handoffs through replay and snapshots', () => {
    const x = new Session();
    x.send(
      { type: 'start' },
      { type: 'toggleRow', id: 0 },
      { type: 'toggleRow', id: 0 },
      { type: 'select', id: 1 },
    );
    expect(parseSnapshot(x.snapshot()).pendingSelect).toBe(1);
    x.send({ type: 'cancelFirst', id: 0 });
    expect(x.state.pendingSelect).toBeNull();
    x.send({ type: 'select', id: 2 });
    for (let i = 0; i < 40; i++) x.advance(DT);
    expect(x.state.selected).toBe(2);
    expect(x.state.handoffSlow).toBeGreaterThan(0);
    expect(runReplay(parseRecording(JSON.stringify(x.recording())))).toEqual(x.state);
  });
});

it.each([2, 4, 8])('queued AI respects ATB capacity %i and still reproduces exactly', (atbMax) => {
  const r = runPolicy({
    policy: 'tactician',
    planning: 'queue',
    encounterSet: 'crossfire',
    encounterLevel: 6,
    atbMax,
  });
  expect(r.summary.rejectedCommands).toBe(0);
  expect(r.summary.replayVerified).toBe(true);
  expect(r.summary.atbMax).toBe(atbMax);
  expect(r.summary.maxQueueDepth).toBeLessThanOrEqual(atbMax);
});
