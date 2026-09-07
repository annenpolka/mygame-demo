import { describe, expect, it } from 'vitest';
import { DT, SKILLS } from '../src/content/data';
import { partyBonus, roleMultipliers } from '../src/sim/bonuses';
import { createState, command, step, advance, copy } from '../src/sim/engine';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import type { State } from '../src/sim/types';
function quiet() {
  const s = createState();
  command(s, { type: 'start' });
  s.allies.forEach((a) => (a.atb = 0));
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  return s;
}
function hit(s: State, target: 'single' | 'all' = 'single') {
  s.enemies[0].cast = {
    name: '検証攻撃',
    target,
    row: 'front',
    allyId: 0,
    remaining: DT,
    total: DT,
    power: 100,
    movable: false,
    push: false,
  };
  s.allies.forEach((a) => (a.row = 'front'));
  step(s);
}
describe('current party role bonuses', () => {
  it.each([1, 2, 3])('stacks each role continuously with %i contributors', (n) => {
    expect(roleMultipliers({ A: n, B: 0, D: 0, S: 0 }, 'strong').damage).toBe(1 + 0.25 * n);
    expect(roleMultipliers({ A: 0, B: n, D: 0, S: 0 }, 'strong').chain).toBe(1 + 0.3 * n);
    expect(roleMultipliers({ A: 0, B: 0, D: n, S: 0 }, 'strong').taken).toBeCloseTo(0.8 ** n);
    expect(roleMultipliers({ A: 0, B: 0, D: 0, S: n }, 'strong').atb).toBe(1 + 0.15 * n);
  });
  it('ignores reserve weapons, position and selected actor; excludes fallen contributors', () => {
    const s = quiet(),
      before = partyBonus(s.allies, 'strong');
    expect(before.counts).toEqual({ A: 1, B: 1, D: 0, S: 1 });
    s.selected = 2;
    s.allies.forEach((a) => (a.row = 'front'));
    expect(partyBonus(s.allies, 'strong')).toEqual(before);
    s.allies[2].hp = 0;
    expect(partyBonus(s.allies, 'strong').atb).toBe(1);
    expect(partyBonus(s.allies, 'none')).toMatchObject({ damage: 1, chain: 1, taken: 1, atb: 1 });
    expect(partyBonus(s.allies, 'modest').damage).toBe(1.1);
  });
  it('snapshots offense on actual start, and retains it through impact after composition changes', () => {
    const s = quiet(),
      a = s.allies[0];
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
    });
    step(s);
    expect(a.action).toBeNull();
    s.allies[1].slot = 1; // B to A while the queued attack waits for ATB.
    a.atb = 4;
    step(s);
    expect(a.action?.offense).toEqual({ damage: 1.875, chain: 1.25 });
    const control = copy(s);
    s.allies[1].slot = 0;
    advance(s, SKILLS.slash.cast);
    advance(control, SKILLS.slash.cast);
    expect(s.events.find((e) => e.type === 'damage' && e.source === 'a0')?.value).toBe(
      control.events.find((e) => e.type === 'damage' && e.source === 'a0')?.value,
    );
    expect(s.enemies[0].chain).toBe(control.enemies[0].chain);
  });
  it('changes D only on completed shifts, and protects an entire simultaneous area hit', () => {
    const s = quiet();
    command(s, { type: 'toggleWeapon', id: 0 });
    step(s);
    expect(partyBonus(s.allies, 'strong').taken).toBe(1);
    hit(s);
    expect(s.metrics.taken).toBe(100);
    advance(s, s.config.shiftTime);
    expect(partyBonus(s.allies, 'strong').taken).toBe(0.8);
    s.allies[0].hp = 1;
    const hp = s.allies[1].hp;
    hit(s, 'all');
    expect(s.allies[0].hp).toBe(0);
    expect(hp - s.allies[1].hp).toBe(80);
    expect(partyBonus(s.allies, 'strong').taken).toBe(1);
  });
  it('integrates S equally for all actors, has no refill, and does not accelerate committed actions', () => {
    const s = quiet();
    advance(s, 0.5);
    s.allies.forEach((a) => expect(a.atb).toBeCloseTo(0.5 * 0.55 * 1.15));
    const atb = s.allies[0].atb;
    command(s, { type: 'toggleWeapon', id: 2 });
    expect(s.allies[0].atb).toBe(atb);
    advance(s, s.config.shiftTime + DT);
    expect(s.allies[2].slot).toBe(1);
    const after = s.allies[0].atb;
    advance(s, 0.2);
    expect(s.allies[0].atb - after).toBeCloseTo(0.2 * 0.55);
    s.allies[0].atb = 4;
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
    step(s);
    const duration = s.allies[0].action!.remaining;
    s.allies[2].slot = 0;
    advance(s, 0.2);
    expect(s.allies[0].action!.remaining).toBeCloseTo(duration - 0.2);
    const freeze = copy(s.allies);
    command(s, { type: 'time', mode: 'stop' });
    advance(s, 0.2);
    expect(s.allies).toEqual(freeze);
  });
  it('matches the ABB / AAB example and keeps all snapshot/replay timing decisions', () => {
    const abb = roleMultipliers({ A: 1, B: 2, D: 0, S: 0 }, 'strong');
    const aab = roleMultipliers({ A: 2, B: 1, D: 0, S: 0 }, 'strong');
    expect([100 * abb.damage, 10 * abb.chain]).toEqual([125, 16]);
    expect([100 * aab.damage, 10 * aab.chain]).toEqual([150, 13]);
    const session = new Session();
    session.send(
      { type: 'start' },
      {
        type: 'enqueue',
        id: 0,
        step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
      },
    );
    session.advance(0.1);
    session.send({ type: 'optima', index: 3 });
    for (let i = 0; i < 15; i++) session.advance(0.1);
    expect(parseSnapshot(session.snapshot())).toEqual(session.state);
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(session.state);
  });
});

it('reports accepted and rejected player commands without changing their recording order', () => {
  const s = new Session();
  s.send({ type: 'start' });
  const results = s.send(
    ...Array.from({ length: 5 }, () => ({
      type: 'enqueue' as const,
      id: 0,
      step: { kind: 'skill' as const, skillId: 'guard', target: { kind: 'ally' as const, id: 0 } },
    })),
  );
  expect(results).toEqual([true, true, true, true, false]);
  expect(s.recording().inputs).toHaveLength(6);
  expect(runReplay(s.recording())).toEqual(s.state);
});
