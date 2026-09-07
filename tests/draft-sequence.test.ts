import { describe, it, expect } from 'vitest';
import { DT, SKILLS, VERSION } from '../src/content/data';
import { command, createState, advance, step, copy } from '../src/sim/engine';
import { committed, planned, plannedCost, planTiming } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
import { parseSnapshot } from '../src/lab/validation';
import { observe } from '../src/ai/observation';
import type { State, PlanStep } from '../src/sim/types';
function quiet(atb = 4) {
  const s = createState({ bonusMode: 'none' });
  command(s, { type: 'start' });
  s.allies[0].atb = atb;
  s.allies.slice(1).forEach((a) => (a.executionHeld = true));
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  return s;
}
const slash: PlanStep = { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } };
const guard: PlanStep = { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } };
const draft = (s: State, p: PlanStep = slash) =>
  expect(command(s, { type: 'draft', id: 0, step: p })).toBe(true);
const execute = (s: State) => expect(command(s, { type: 'executeSequence', id: 0 })).toBe(true);
const starts = (s: State) => s.events.filter((e) => e.type === 'action' && e.source === 'a0');
const snapshot = (s: State) =>
  parseSnapshot(JSON.stringify({ kind: 'snapshot', version: VERSION, state: s }));
describe('explicit, bounded action sequences', () => {
  it('keeps AI committed input on the actual weapon while the human draft previews a future one', () => {
    const s = quiet(),
      a = s.allies[0];
    draft(s, { kind: 'weapon', slot: 1 });
    expect(command(s, { type: 'enqueue', id: 0, step: slash })).toBe(true);
    expect(
      command(s, {
        type: 'enqueue',
        id: 0,
        step: { kind: 'skill', skillId: 'ward', target: { kind: 'ally', id: 0 } },
      }),
    ).toBe(false);
    expect(a.draft).toMatchObject([{ kind: 'weapon', slot: 1 }]);
    const before = copy(s);
    planTiming(a, s.config, s);
    expect(s).toEqual(before);
  });

  it('keeps edits inert even when ATB is full and does not turn execution into an enable switch', () => {
    const s = quiet(1),
      a = s.allies[0];
    draft(s);
    draft(s);
    draft(s);
    advance(s, 10);
    expect(a.atb).toBe(4);
    expect(starts(s)).toHaveLength(0);
    expect(
      planTiming(a, s.config, s).every((p) => p.status === 'draft' && Number.isFinite(p.ends)),
    ).toBe(true);
    expect(planTiming(a, s.config, s).map((p) => p.linked)).toEqual([false, true, true]);
    execute(s);
    const group = copy(a.plan);
    for (let i = 0; i < 10; i++) expect(command(s, { type: 'executeSequence', id: 0 })).toBe(false);
    expect(a.plan).toEqual(group);
    step(s);
    draft(s, guard);
    advance(s, 8);
    expect(starts(s)).toHaveLength(3);
    expect(a.action).toBeNull();
    expect(a.draft).toHaveLength(1);
    expect(snapshot(s)).toEqual(s);
  });
  it('funds all three slashes before starting and prediction matches every impact', () => {
    const s = quiet(1),
      a = s.allies[0];
    for (let i = 0; i < 3; i++) draft(s);
    execute(s);
    const prediction = planTiming(a, s.config, s);
    advance(s, 2);
    expect(a.action).toBeNull();
    while (a.action || committed(a).length) step(s);
    const events = starts(s);
    expect(events[0].time).toBeCloseTo(Math.ceil(2 / s.config.atbRate / DT) * DT);
    expect(events[1].time - events[0].time).toBeCloseTo(1.1);
    expect(events[2].time - events[1].time).toBeCloseTo(1.1);
    const hits = s.events.filter((e) => e.type === 'damage' && e.source === 'a0');
    hits.forEach((e, i) => expect(prediction[i].ends).toBeCloseTo(e.time));
  });
  it('caps running remainder plus draft, accepts only one waiting group, and pays final recovery between groups', () => {
    const s = quiet(),
      a = s.allies[0];
    for (let i = 0; i < 3; i++) draft(s);
    execute(s);
    step(s);
    draft(s);
    draft(s);
    expect(plannedCost(a)).toBe(4);
    expect(command(s, { type: 'draft', id: 0, step: guard })).toBe(false);
    execute(s);
    expect(a.sequences).toHaveLength(2);
    advance(s, 1.1);
    draft(s, guard);
    expect(command(s, { type: 'executeSequence', id: 0 })).toBe(false);
    expect(a.draft).toHaveLength(1);
    while (a.action || committed(a).length) step(s);
    expect(starts(s)).toHaveLength(5);
    expect(starts(s)[3].time - starts(s)[2].time).toBeGreaterThanOrEqual(
      SKILLS.slash.cast + SKILLS.slash.recovery,
    );
    expect(a.draft).toHaveLength(1);
    expect(snapshot(s)).toEqual(s);
  });
  it('cuts attack followups while retaining a prepared guard, the current action and unspent ATB', () => {
    const s = quiet(),
      a = s.allies[0];
    for (let i = 0; i < 3; i++) draft(s);
    execute(s);
    step(s);
    draft(s, guard);
    const current = copy(a.action),
      atb = a.atb,
      prepared = copy(a.draft);
    command(s, { type: 'cancel', id: 0 });
    expect(a.action).toEqual(current);
    expect(a.atb).toBe(atb);
    expect(a.draft).toEqual(prepared);
    expect(committed(a)).toHaveLength(0);
    execute(s);
    const prediction = planTiming(a, s.config, s)[0];
    advance(s, 1.8);
    expect(a.action?.skillId).toBe('slash');
    advance(s, 0.3);
    expect(a.action?.skillId).toBe('guard');
    expect(prediction.starts).toBeGreaterThanOrEqual(1.9);
    expect(snapshot(s)).toEqual(s);
  });
  it('waits for the full group even when the first entry is a zero-cost move', () => {
    const s = quiet(0),
      a = s.allies[0];
    draft(s, { kind: 'move', row: 'back' });
    draft(s);
    draft(s);
    execute(s);
    advance(s, 2);
    expect(a.row).toBe('front');
    expect(a.nextRow).toBeNull();
    advance(s, 1.5);
    expect(a.row).toBe('back');
    expect(a.action?.skillId).toBe('slash');
  });
  it('projects draft weapons, preserves target IDs and cancels a draft by its own stable ID', () => {
    const s = quiet(),
      a = s.allies[0];
    draft(s, { kind: 'weapon', slot: 1 });
    draft(s, { kind: 'skill', skillId: 'ward', target: { kind: 'ally', id: 2 } });
    const key = a.draft![1].key;
    command(s, { type: 'target', id: 1 });
    expect(a.draft![1]).toMatchObject({ target: { kind: 'ally', id: 2 } });
    command(s, { type: 'removePlan', id: 0, key });
    expect(a.draft).toHaveLength(1);
    execute(s);
    advance(s, 1);
    expect(a.slot).toBe(1);
    expect(a.draft).toHaveLength(0);
    expect(planned(a)).toHaveLength(0);
    expect(snapshot(s)).toEqual(s);
  });
  it('exports detached draft/batch observations and reproduces all boundaries through recorded inputs', () => {
    const x = new Session({ bonusMode: 'none' });
    x.send({ type: 'start' });
    for (let i = 0; i < 3; i++) x.send({ type: 'draft', id: 0, step: slash });
    x.send({ type: 'executeSequence', id: 0 });
    for (let i = 0; i < 30; i++) x.advance(0.1);
    x.send({ type: 'draft', id: 0, step: guard });
    const observation = observe(x.state);
    (observation.allies[0].draft![0] as any).skillId = 'potion';
    (observation.allies[0].sequences![0] as any).started = false;
    expect(x.state.allies[0].draft![0]).toMatchObject({ skillId: 'guard' });
    expect(x.state.allies[0].sequences![0].started).toBe(true);
    x.send({ type: 'cancel', id: 0 }, { type: 'executeSequence', id: 0 });
    expect(runReplay(x.recording())).toEqual(x.state);
    expect(snapshot(x.state)).toEqual(x.state);
    for (let i = 0; i < 40; i++) x.advance(0.1);
    expect(runReplay(x.recording())).toEqual(x.state);
  });
});
