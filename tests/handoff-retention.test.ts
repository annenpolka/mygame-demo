import { describe, expect, it } from 'vitest';
import { DT, SKILLS, VERSION } from '../src/content/data';
import { command, copy, createState, step, advance } from '../src/sim/engine';
import { committed, planTiming } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import { playRules } from '../src/lab/playtest';
import type { State } from '../src/sim/types';

function quiet() {
  const s = createState({ bonusMode: 'none' });
  command(s, { type: 'start' });
  s.enemies.forEach((e) => {
    e.hp = e.maxHp = 100000;
    e.nextAttack = 999;
  });
  s.allies.forEach((a) => (a.atb = 4));
  return s;
}
const slash = { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } } as const;
function until(s: State, done: () => boolean) {
  for (let n = 0; n < 3000 && !done(); n++) step(s);
  expect(done()).toBe(true);
}

describe('handoffs retain both actors’ work', () => {
  it('resolves exactly 0.3 battle seconds after starting, charging one ATB once', () => {
    const s = quiet(),
      a = s.allies[0];
    command(s, { type: 'select', id: 1 });
    step(s);
    expect(a.action).toMatchObject({ skillId: 'handoff', cast: 0.3, total: 0.3 });
    const paid = a.atb,
      started = s.time;
    expect(paid).toBe(3);
    for (let n = 0; n < 17; n++) step(s);
    expect(s.selected).toBe(0);
    expect(a.atb).toBe(paid);
    step(s);
    expect(s.selected).toBe(1);
    expect(s.time - started).toBeCloseTo(0.3, 10);
    expect(a.atb).toBe(paid);
  });

  it('retains a started sequence, its next group and the editable draft until they execute normally', () => {
    const s = quiet(),
      a = s.allies[0];
    for (let n = 0; n < 2; n++) command(s, { type: 'draft', id: 0, step: slash });
    command(s, { type: 'executeSequence', id: 0 });
    step(s);
    command(s, { type: 'draft', id: 0, step: slash });
    command(s, { type: 'executeSequence', id: 0 });
    command(s, {
      type: 'draft',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
    const reserved = copy(committed(a)),
      draft = copy(a.draft),
      groups = copy(a.sequences);
    command(s, { type: 'select', id: 1 });
    const forecast = planTiming(a, s.config, s);
    for (const p of reserved)
      expect(forecast.find((t) => t.key === p.key)).toMatchObject({ status: 'scheduled' });
    expect(
      forecast
        .filter((t) => reserved.some((p) => p.key === t.key))
        .every((t) => Number.isFinite(t.starts)),
    ).toBe(true);
    until(s, () => a.action?.skillId === 'handoff');
    expect(committed(a)).toEqual(reserved);
    expect(a.sequences).toEqual(groups);
    expect(a.draft).toEqual(draft);
    until(s, () => s.selected === 1);
    expect(committed(a)).toEqual(reserved);
    until(s, () => committed(a).length === 0 && a.action === null);
    expect(a.draft).toEqual(draft);
    expect(a.sequences).toEqual([]);
    const starts = s.events.filter((e) => e.source === 'a0' && e.type === 'action');
    expect(starts.map((e) => e.visual?.skillId)).toEqual(['slash', 'handoff', 'slash', 'slash']);
    expect(
      starts.filter((e) => e.visual?.skillId === 'slash').map((e) => e.visual?.comboIndex),
    ).toEqual([1, 1, 1]);
  });

  it('retains the incoming automatic sequence and stops creating new automatic work once it is selected', () => {
    const s = quiet(),
      incoming = s.allies[1];
    step(s);
    const pending = copy(committed(incoming));
    expect(pending.length).toBe(2);
    expect(pending.every((p) => p.auto)).toBe(true);
    const action = incoming.action;
    command(s, { type: 'select', id: 1 });
    until(s, () => s.selected === 1);
    expect(incoming.action).toBe(action);
    expect(committed(incoming)).toEqual(pending);
    until(s, () => committed(incoming).length === 0 && incoming.action === null);
    advance(s, 8);
    expect(
      s.events
        .filter((e) => e.source === 'a1' && e.type === 'action')
        .map((e) => e.visual?.skillId),
    ).toEqual(['spark', 'spark', 'spark']);
    expect(incoming.atb).toBe(4);
  });

  it('keeps both actors’ reservations in a paid handoff snapshot and reproduces the continuation', () => {
    const session = new Session();
    session.state = quiet();
    session.initial = copy(session.state);
    for (let n = 0; n < 2; n++) session.send({ type: 'draft', id: 0, step: slash });
    session.send({ type: 'executeSequence', id: 0 }, { type: 'select', id: 1 });
    session.advance(DT);
    const saved = session.snapshot();
    expect(parseSnapshot(saved)).toEqual(session.state);
    expect(committed(session.state.allies[0])).toHaveLength(2);
    const restored = new Session();
    restored.restore(saved);
    for (let n = 0; n < 900; n++) {
      session.advance(DT);
      restored.advance(DT);
    }
    expect(restored.state).toEqual(session.state);
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(session.state);
    expect(() => parseSnapshot(saved.replaceAll(VERSION, 'orchestra-15'))).toThrow();
    const incompatible = JSON.parse(saved);
    Object.assign(incompatible.state.allies[0].action, { cast: 0.6, total: 0.6, remaining: 0.6 });
    expect(() => parseSnapshot(JSON.stringify(incompatible))).toThrow();
    expect(
      JSON.parse(playRules()).skills.find((s: { id: string }) => s.id === 'handoff').cast,
    ).toBe(0.3);
  });
});
