import { describe, expect, it } from 'vitest';
import { DT, SKILLS } from '../src/content/data';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { planTiming } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording } from '../src/lab/validation';
import type { State } from '../src/sim/types';

function isolated() {
  const s = createState();
  command(s, { type: 'start' });
  s.allies[0].atb = 4;
  s.allies.slice(1).forEach((a) => (a.hp = 0));
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  return s;
}
function add(s: State, skillId: string) {
  expect(
    command(s, {
      type: 'enqueue',
      id: 0,
      step: {
        kind: 'skill',
        skillId,
        target: { kind: skillId === 'slash' ? 'enemy' : 'ally', id: 0 },
      },
    }),
  ).toBe(true);
}
const starts = (s: State) => s.events.filter((e) => e.type === 'action' && e.source === 'a0');
describe('human-scale action commitment', () => {
  it.each([
    ['slash', 3],
    ['guard', 3],
    ['potion', 2],
  ] as const)(
    '%s cannot empty its full available queue in three seconds, even with full ATB',
    (id, maximum) => {
      const s = isolated();
      for (let i = 0; i < (id === 'potion' ? 3 : s.config.atbMax); i++) add(s, id);
      advance(s, 3);
      expect(starts(s).length).toBeLessThanOrEqual(maximum);
      expect(s.allies[0].plan!.length).toBeGreaterThan(0);
    },
  );
  it('hits once before recovery ends, accepts cancellation, and delays movement and weapon change until free', () => {
    const s = isolated(),
      a = s.allies[0];
    add(s, 'slash');
    step(s);
    advance(s, SKILLS.slash.cast - DT);
    expect(s.metrics.damage).toBe(0);
    step(s);
    expect(s.metrics.damage).toBeGreaterThan(0);
    expect(a.action?.resolved).toBe(true);
    const damage = s.metrics.damage,
      atb = a.atb;
    add(s, 'guard');
    command(s, { type: 'cancel', id: 0 });
    command(s, { type: 'move', id: 0, row: 'back' });
    command(s, { type: 'optima', index: 3 });
    expect(a.atb).toBe(atb);
    advance(s, SKILLS.slash.recovery - DT);
    expect(a.row).toBe('front');
    expect(a.slot).toBe(0);
    expect(starts(s)).toHaveLength(1);
    expect(s.metrics.damage).toBe(damage);
    advance(s, DT + s.config.moveTime);
    expect(a.row).toBe('back');
    expect(a.slot).toBe(1);
    expect(s.metrics.damage).toBe(damage);
  });
  it('guard protects during recovery, without waiting for the entire action to finish', () => {
    const s = isolated();
    add(s, 'guard');
    step(s);
    s.enemies[0].cast = {
      name: '追尾',
      target: 'single',
      row: 'front',
      allyId: 0,
      remaining: 0.6,
      total: 0.6,
      power: 100,
      movable: false,
      push: false,
    };
    advance(s, 0.6);
    expect(s.allies[0].action?.resolved).toBe(true);
    expect(s.metrics.taken).toBe(50);
  });
  it('queue estimates distinguish impact from readiness and include recovery before the next skill', () => {
    const s = isolated();
    add(s, 'slash');
    add(s, 'guard');
    const prediction = planTiming(s.allies[0], s.config);
    expect(prediction[1].starts).toBeGreaterThan(prediction[0].ends + 0.9);
    advance(s, prediction[1].ends + 2 * DT);
    expect(Math.abs(starts(s)[1].time - prediction[1].starts)).toBeLessThanOrEqual(2 * DT);
    const impact = s.events.find((e) => e.text.includes('防護'))!;
    expect(Math.abs(impact.time - prediction[1].ends)).toBeLessThanOrEqual(2 * DT + 1e-9);
  });
  it('stop freezes recovery; snapshot and replay restoration cannot apply a resolved hit twice', () => {
    const session = new Session();
    // Use an isolated already-resolved state as the recording's explicit initial state.
    const s = isolated();
    add(s, 'slash');
    advance(s, SKILLS.slash.cast + 2 * DT);
    session.restore(JSON.stringify({ kind: 'snapshot', version: s.version, state: s }));
    const damage = session.state.metrics.damage;
    session.send({ type: 'time', mode: 'stop' });
    const before = copy(session.state.allies[0].action);
    session.advance(0.1);
    expect(session.state.allies[0].action).toEqual(before);
    session.send({ type: 'time', mode: 'normal' });
    for (let i = 0; i < 20; i++) session.advance(0.1);
    expect(session.state.metrics.damage).toBe(damage);
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(session.state);
  });
  it('self evacuation keeps its recovery, while interrupting another ally without refunding ATB', () => {
    const s = isolated(),
      caster = s.allies[0],
      other = s.allies[1];
    s.inventory.push('banner');
    caster.weapons[0] = 'banner';
    other.hp = other.maxHp;
    other.atb = 4;
    other.row = 'front';
    command(s, {
      type: 'enqueue',
      id: 1,
      step: { kind: 'skill', skillId: 'rain', target: { kind: 'row', row: 'front' } },
    });
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'evacuate', target: { kind: 'row', row: 'front' } },
    });
    advance(s, SKILLS.evacuate.cast + 2 * DT);
    expect(caster.row).toBe('back');
    expect(other.row).toBe('back');
    expect(caster.action).toMatchObject({ skillId: 'evacuate', resolved: true });
    expect(other.action?.skillId).not.toBe('rain');
    expect(other.atb).toBeLessThan(2.5);
  });
  it('homing enemies provide at least three seconds of warning and seven seconds between hits', () => {
    const s = createState({ encounterSet: 'pursuit' });
    command(s, { type: 'start' });
    s.allies[0].hp = s.allies[0].maxHp = 100000;
    s.allies.slice(1).forEach((a) => (a.hp = 0));
    s.enemies.slice(1).forEach((e) => (e.hp = 0));
    advance(s, 25);
    const warnings = s.events.filter(
      (e) => e.type === 'warning' && e.text.includes('連続追尾斬り'),
    );
    const hits = s.events.filter((e) => e.type === 'damage' && e.source === 'e0');
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits[0].time - warnings[0].time).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < hits.length; i++)
      expect(hits[i].time - hits[i - 1].time).toBeGreaterThanOrEqual(7);
  });
});
