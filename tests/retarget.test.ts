import { describe, expect, it } from 'vitest';
import { DT, SKILLS, VERSION } from '../src/content/data';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { executionTarget } from '../src/sim/execution';
import { planTiming } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';

function quiet() {
  const s = createState({ bonusMode: 'none' });
  command(s, { type: 'start' });
  for (const a of s.allies) {
    a.executionHeld = a.id !== 0;
    a.atb = 4;
  }
  for (const e of s.enemies) e.nextAttack = 999;
  return s;
}
const slash = {
  kind: 'skill' as const,
  skillId: 'slash',
  target: { kind: 'enemy' as const, id: 0 },
};

describe('continue actions after losing a destination', () => {
  it('retargets a paid cast, committed follow-up and draft without restarting or paying again', () => {
    const s = quiet(),
      a = s.allies[0];
    for (let i = 0; i < 2; i++) command(s, { type: 'draft', id: 0, step: slash });
    command(s, { type: 'executeSequence', id: 0 });
    command(s, { type: 'draft', id: 0, step: slash });
    step(s);
    const action = a.action!,
      before = copy(action),
      paid = a.atb;
    s.enemies[0].hp = 0;
    expect(planTiming(a, s.config, s).every((p) => p.status !== 'invalid')).toBe(true);
    step(s);
    expect(a.action).toBe(action);
    expect(a.action).toEqual({
      ...before,
      remaining: before.remaining - DT,
      target: { kind: 'enemy', id: 1 },
    });
    expect(a.atb).toBe(paid);
    expect(a.plan).toMatchObject([{ target: { kind: 'enemy', id: 1 } }]);
    expect(a.draft).toMatchObject([{ target: { kind: 'enemy', id: 1 } }]);
    advance(s, 1.1);
    expect(a.action).toMatchObject({ comboIndex: 2, target: { kind: 'enemy', id: 1 } });
    expect(a.atb).toBe(paid - 1);
    expect(s.events.some((e) => e.type === 'damage' && e.target === 'e1')).toBe(true);
    expect(s.events.some((e) => e.text.includes('予約を解除'))).toBe(false);
  });
  it('retargets a legacy reservation and an empty row before their first impact', () => {
    const s = quiet(),
      a = s.allies[0];
    command(s, { type: 'skill', id: 0, skillId: 'slash', target: slash.target });
    s.enemies[0].hp = 0;
    step(s);
    expect(a.action?.target).toEqual({ kind: 'enemy', id: 1 });
    const area = quiet();
    command(area, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'sweep', target: { kind: 'row', row: 'back' } },
    });
    step(area);
    area.enemies[1].row = 'front';
    advance(area, SKILLS.sweep.cast);
    expect(area.allies[0].action?.target).toEqual({ kind: 'row', row: 'front' });
    expect(area.events.filter((e) => e.type === 'damage').map((e) => e.target)).toEqual([
      'e0',
      'e1',
    ]);
  });
  it.each(['heal', 'ward', 'potion'] as const)(
    'redirects paid %s even when all remaining allies are healthy or shielded',
    (skillId) => {
      const s = quiet(),
        a = s.allies[0];
      a.weapons = skillId === 'heal' ? ['bell', 'sword'] : ['shield', 'sword'];
      command(s, {
        type: 'enqueue',
        id: 0,
        step: { kind: 'skill', skillId, target: { kind: 'ally', id: 1 } },
      });
      step(s);
      const paid = a.atb,
        potions = s.potions;
      s.allies[1].hp = 0;
      s.allies[0].shield = s.allies[2].shield = 10;
      advance(s, SKILLS[skillId].cast);
      expect(a.action).toMatchObject({ skillId, target: { kind: 'ally', id: 0 }, resolved: true });
      expect(a.atb).toBe(paid);
      expect(s.potions).toBe(potions);
      expect(s.events.some((e) => e.type === 'heal' && e.target === 'a0')).toBe(true);
    },
  );
  it('keeps living destinations, rejects cross-side input, and has no fallback when the side is empty', () => {
    const s = quiet(),
      a = s.allies[0];
    const original = { kind: 'enemy' as const, id: 1 };
    expect(executionTarget(s, a, SKILLS.slash, original)).toBe(original);
    expect(executionTarget(s, a, SKILLS.slash, { kind: 'ally', id: 0 })).toBeNull();
    s.allies[1].hp = 0;
    expect(executionTarget(s, a, SKILLS.handoff, { kind: 'ally', id: 1 })).toBeNull();
    s.enemies.forEach((e) => (e.hp = 0));
    expect(executionTarget(s, a, SKILLS.slash, original)).toBeNull();
  });
  it('replays a kill and automatic follow-up retarget exactly, including a restored mid-cast snapshot', () => {
    const initial = quiet();
    initial.enemies[0].hp = 1;
    const session = new Session();
    session.restore(JSON.stringify({ kind: 'snapshot', version: VERSION, state: initial }));
    for (let i = 0; i < 2; i++) session.send({ type: 'draft', id: 0, step: slash });
    session.send({ type: 'executeSequence', id: 0 });
    for (let i = 0; i < 16; i++) session.advance(0.1);
    expect(session.state.enemies[0].hp).toBe(0);
    expect(session.state.allies[0].action?.target).toEqual({ kind: 'enemy', id: 1 });
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(session.state);
    expect(parseSnapshot(session.snapshot())).toEqual(session.state);
    const restored = new Session();
    restored.restore(session.snapshot());
    for (let i = 0; i < 10; i++) {
      session.advance(0.1);
      restored.advance(0.1);
    }
    expect(restored.state).toEqual(session.state);
    const old = JSON.parse(session.snapshot());
    old.version = old.state.version = 'orchestra-14';
    expect(() => parseSnapshot(JSON.stringify(old))).toThrow();
    const recording = session.recording();
    recording.version = recording.initial.version = 'orchestra-14';
    expect(() => parseRecording(JSON.stringify(recording))).toThrow();
  });
});
