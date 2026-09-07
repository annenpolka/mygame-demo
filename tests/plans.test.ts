import { DT, SKILLS } from '../src/content/data';
import { describe, it, expect } from 'vitest';
import { createState, command, step, advance, copy } from '../src/sim/engine';
import { planned, projectedSlot } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import { runPolicy } from '../src/ai/runner';
import { createQueuePolicy } from '../src/ai/queue-policy';
import { observe } from '../src/ai/observation';
import type { PlanStep, State } from '../src/sim/types';
const skill = (skillId: string): PlanStep => ({
  kind: 'skill',
  skillId,
  target: { kind: 'ally', id: 0 },
});
function battle() {
  const s = createState();
  command(s, { type: 'start' });
  s.enemies.forEach((e) => (e.nextAttack = 999));
  return s;
}
const add = (s: State, p: PlanStep, id = 0) => command(s, { type: 'enqueue', id, step: p });
describe('human and AI ordered plans', () => {
  it('appends during an executing attack; cancellation never interrupts or refunds it', () => {
    const s = battle(),
      a = s.allies[0];
    a.atb = 4;
    add(s, { kind: 'skill', skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    step(s);
    const before = copy(a.action),
      atb = a.atb;
    expect(add(s, skill('guard'))).toBe(true);
    expect(add(s, skill('potion'))).toBe(true);
    expect(a.action).toEqual(before);
    expect(a.atb).toBe(atb);
    const potionKey = a.plan![1].key;
    command(s, { type: 'removePlan', id: 0, key: potionKey });
    expect(planned(a).map((p) => (p.kind === 'skill' ? p.skillId : p.kind))).toEqual(['guard']);
    expect(a.action).toEqual(before);
    advance(s, SKILLS.sweep.cast + SKILLS.sweep.recovery + SKILLS.guard.cast + 0.8 + 2 * DT);
    expect(a.shield).toBeGreaterThan(0);
    expect(s.potions).toBe(3);
  });
  it('executes movement then weapon then the new weapon skill in FIFO order', () => {
    const s = battle(),
      a = s.allies[0];
    a.atb = 4;
    add(s, { kind: 'move', row: 'back' });
    add(s, { kind: 'weapon', slot: 1 });
    expect(projectedSlot(a)).toBe(1);
    expect(add(s, { kind: 'skill', skillId: 'ward', target: { kind: 'ally', id: 0 } })).toBe(true);
    expect(add(s, { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } })).toBe(
      false,
    );
    advance(s, 0.5);
    expect(a.row).toBe('front');
    expect(a.slot).toBe(0);
    advance(s, s.config.moveTime - 0.5 + 2 * DT);
    expect(a.row).toBe('back');
    expect(a.slot).toBe(0);
    advance(s, s.config.shiftTime + SKILLS.ward.cast + 4 * DT);
    expect(a.slot).toBe(1);
    expect(a.shield).toBeGreaterThan(0);
    const actions = s.events.filter((e) => e.type === 'action' && e.source === 'a0');
    expect(actions[0].text).toContain('護りの誓い');
  });
  it('removing a weapon step cancels only skills depending on it, preserving remaining order', () => {
    const s = battle(),
      a = s.allies[0];
    add(s, skill('guard'));
    add(s, { kind: 'weapon', slot: 1 });
    add(s, { kind: 'skill', skillId: 'ward', target: { kind: 'ally', id: 0 } });
    add(s, { kind: 'move', row: 'back' });
    command(s, { type: 'removePlan', id: 0, key: a.plan![1].key });
    expect(a.plan!.map((p) => p.kind)).toEqual(['skill', 'move']);
    expect(s.events.at(-1)?.text).toContain('予約を解除');
  });
  it('has a finite queue, stable cancellation IDs, and no potion overbooking across allies', () => {
    const s = battle(),
      a = s.allies[0];
    for (let i = 0; i < s.config.atbMax; i++) expect(add(s, skill('guard'))).toBe(true);
    expect(add(s, skill('guard'))).toBe(false);
    const oldKey = a.plan![0].key;
    step(s);
    expect(command(s, { type: 'removePlan', id: 0, key: oldKey })).toBe(false);
    expect(a.plan).toHaveLength(s.config.atbMax - 1);
    command(s, { type: 'cancel', id: 0 });
    expect(a.plan).toEqual([]);
    expect(a.action?.skillId).toBe('guard');
    for (let id = 0; id < 3; id++) expect(add(s, skill('potion'), id)).toBe(true);
    expect(add(s, skill('potion'))).toBe(false);
    expect(s.potions).toBe(3);
  });
  it('skips a dead target and continues; clears all plans at a battle boundary', () => {
    const s = battle(),
      a = s.allies[0];
    a.atb = 4;
    add(s, { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } });
    add(s, skill('guard'));
    s.enemies[0].hp = 0;
    step(s);
    expect(planned(a)).toHaveLength(1);
    advance(s, SKILLS.guard.cast + 0.8 + 2 * DT);
    expect(a.shield).toBeGreaterThan(0);
    add(s, skill('guard'));
    s.enemies[1].hp = 0;
    step(s);
    expect(planned(a)).toEqual([]);
    command(s, { type: 'next' });
    expect(planned(a)).toEqual([]);
  });
  it('snapshot and replay preserve planned movement, weapons, targets and cancellation keys', () => {
    const session = new Session();
    session.send({ type: 'start' });
    session.send(
      { type: 'enqueue', id: 0, step: { kind: 'move', row: 'back' } },
      { type: 'enqueue', id: 0, step: { kind: 'weapon', slot: 1 } },
      {
        type: 'enqueue',
        id: 0,
        step: { kind: 'skill', skillId: 'ward', target: { kind: 'ally', id: 1 } },
      },
    );
    session.advance(0.1);
    const saved = session.snapshot();
    expect(parseSnapshot(saved)).toEqual(session.state);
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(session.state);
    session.send({ type: 'removePlan', id: 0, key: session.state.allies[0].plan!.at(-1)!.key });
    session.restore(saved);
    expect(session.state.allies[0].plan).toHaveLength(2);
  });
  it('rejects duplicated or out-of-range keys in imported state', () => {
    const session = new Session();
    session.send(
      { type: 'start' },
      { type: 'enqueue', id: 0, step: skill('guard') },
      { type: 'enqueue', id: 0, step: skill('guard') },
    );
    const x = JSON.parse(session.snapshot());
    x.state.allies[0].plan[1].key = x.state.allies[0].plan[0].key;
    expect(() => parseSnapshot(JSON.stringify(x))).toThrow('不正');
  });
});
describe('AI planning with the same queue controls', () => {
  it('reserves guard while an attack is still executing, after cancelling offensive plans', () => {
    const s = battle();
    s.allies[0].atb = 4;
    add(s, { kind: 'skill', skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    step(s);
    s.allies[0].action!.remaining = 0.1;
    s.allies[0].action!.resolved = true;
    add(s, { kind: 'skill', skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    s.enemies.forEach(
      (e, i) =>
        (e.cast = {
          name: 'test',
          target: 'row',
          row: i === 0 ? 'front' : 'back',
          allyId: 0,
          total: 2,
          remaining: 0.65,
          power: 200,
          movable: false,
          push: false,
        }),
    );
    const d = createQueuePolicy('tactician', 0, 'none', 3).decide(observe(s));
    expect(d.commands).toContainEqual({ type: 'removePlan', id: 0, key: s.allies[0].plan![0].key });
    expect(d.commands).toContainEqual({ type: 'enqueue', id: 0, step: skill('guard') });
    for (const c of d.commands) expect(command(s, c)).toBe(true);
    expect(s.allies[0].action?.skillId).toBe('sweep');
  });
  it.each(['next', 'queue'] as const)(
    '%s planning executes actual reservations and replays exactly',
    (planning) => {
      const r = runPolicy({
        policy: 'tactician',
        planning,
        encounterSet: 'crossfire',
        encounterLevel: 6,
      });
      expect(r.summary.queuedDuringAction).toBeGreaterThan(0);
      expect(r.summary.appendedPlans).toBeGreaterThan(0);
      expect(r.summary.maxQueueDepth).toBe(planning === 'queue' ? 2 : 1);
      expect(r.summary.replayVerified).toBe(true);
      expect(r.summary.rejectedCommands).toBe(0);
      expect(runReplay(parseRecording(JSON.stringify(r.recording)))).toEqual(r.finalState);
    },
  );
});
