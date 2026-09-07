import { describe, it, expect } from 'vitest';
import { command, createState, step } from '../src/sim/engine';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import { DT, SKILLS } from '../src/content/data';

const ticks = (s: ReturnType<typeof createState>, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) step(s);
};
describe('presentation facts in battle records', () => {
  it('records exact skill, combo and mitigation on the resolved hit and retains them on import', () => {
    const s = createState();
    command(s, { type: 'start' });
    s.allies[0].atb = 4;
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 1 } },
    });
    ticks(s, SKILLS.slash.cast + 2 * DT);
    const damage = s.events.find((e) => e.type === 'damage' && e.source === 'a0')!;
    expect(damage).toMatchObject({
      target: 'e1',
      visual: { skillId: 'slash', comboIndex: 1, shielded: true },
    });
    expect(
      parseSnapshot(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
    ).toEqual(s);
  });
  it('distinguishes a shielded hit, defeat, and actual displacement', () => {
    const s = createState();
    command(s, { type: 'start' });
    const a = s.allies[0];
    a.shield = 3;
    s.enemies[0].cast = {
      name: 'test',
      target: 'single',
      row: 'front',
      allyId: 0,
      remaining: DT,
      total: 1,
      power: 100,
      movable: false,
      push: true,
    };
    step(s);
    expect(s.events.find((e) => e.type === 'damage')?.visual).toEqual({
      actionName: 'test',
      shielded: true,
    });
    expect(s.events.find((e) => e.type === 'move')?.visual).toEqual({
      fromRow: 'front',
      toRow: 'back',
    });
    a.hp = 1;
    s.enemies[0].cast = {
      name: 'test',
      target: 'single',
      row: 'front',
      allyId: 0,
      remaining: DT,
      total: 1,
      power: 100,
      movable: false,
      push: true,
    };
    step(s);
    expect(s.events.at(-1)).toMatchObject({ target: 'a0', visual: { outcome: 'defeat' } });
  });
  it('marks an empty column as a miss without emitting damage', () => {
    const s = createState();
    command(s, { type: 'start' });
    s.allies.forEach((a) => (a.row = 'back'));
    s.enemies[0].cast = {
      name: 'test',
      target: 'row',
      row: 'front',
      allyId: 0,
      remaining: DT,
      total: 1,
      power: 100,
      movable: true,
      push: false,
    };
    step(s);
    expect(s.events.some((e) => e.type === 'damage')).toBe(false);
    expect(s.events.at(-1)).toMatchObject({ target: 'e0', visual: { outcome: 'miss' } });
  });
  it('replays complete State including presentation facts from recorded inputs', () => {
    const session = new Session({}, 'ai');
    session.send({ type: 'start' });
    for (let i = 0; i < 800; i++) session.advance(DT);
    const recording = parseRecording(JSON.stringify(session.recording()));
    expect(session.state.events.some((e) => e.visual?.skillId)).toBe(true);
    expect(runReplay(recording)).toEqual(session.state);
  });
});
