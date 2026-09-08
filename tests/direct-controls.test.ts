import { describe, expect, it } from 'vitest';
import { DT, SKILLS, VERSION } from '../src/content/data';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { planned } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import type { Command } from '../src/sim/types';

function quiet() {
  const s = createState();
  command(s, { type: 'start' });
  s.allies[0].atb = 4;
  s.allies.slice(1).forEach((a) => (a.executionHeld = true));
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  return s;
}
function attack(s: ReturnType<typeof quiet>) {
  command(s, {
    type: 'skill',
    id: 0,
    skillId: 'sweep',
    target: { kind: 'row', row: 'front' },
  });
  step(s);
}

describe('direct battle controls', () => {
  it('begins movement during a cast without drafting, interrupting, retargeting or refunding the action', () => {
    const s = quiet(),
      a = s.allies[0];
    attack(s);
    command(s, {
      type: 'draft',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
    const active = a.action!,
      paid = copy(active),
      draft = copy(a.draft),
      atb = a.atb;
    command(s, { type: 'move', id: 0, row: 'back' });
    expect(a.nextRow).toBe('back');
    expect(a.action).toBe(active);
    expect(a.action).toEqual(paid);
    expect(a.draft).toEqual(draft);
    expect(planned(a)).toEqual(draft);
    step(s);
    expect(a.move).toBeCloseTo(DT);
    expect(a.action!.remaining).toBeCloseTo(paid.remaining - DT);
    expect(a.atb).toBe(atb);
    advance(s, s.config.moveTime - DT);
    expect(a.row).toBe('back');
    expect(a.action).toBe(active);
    expect(a.action).toMatchObject({
      target: paid.target,
      weaponId: paid.weaponId,
      offense: paid.offense,
    });
    advance(s, SKILLS.sweep.cast + SKILLS.sweep.recovery);
    expect(s.events.filter((e) => e.type === 'action' && e.source === 'a0')).toHaveLength(1);
    expect(s.metrics.damage).toBeGreaterThan(0);
  });

  it('keeps repeated destinations idempotent and allows an opposite press to cancel an unfinished move', () => {
    const s = quiet(),
      a = s.allies[0];
    attack(s);
    command(s, { type: 'move', id: 0, row: 'back' });
    advance(s, 0.4);
    const progress = a.move;
    for (let i = 0; i < 8; i++) command(s, { type: 'move', id: 0, row: 'back' });
    expect(a.move).toBe(progress);
    advance(s, s.config.moveTime - 0.4);
    expect(a.row).toBe('back');
    command(s, { type: 'move', id: 0, row: 'front' });
    advance(s, 0.2);
    command(s, { type: 'move', id: 0, row: 'back' });
    expect(a.nextRow).toBeNull();
    expect(a.move).toBe(0);
    expect(a.row).toBe('back');
    expect(a.draft).toEqual([]);
  });

  it('moves a held actor while preserving its held skill sequence', () => {
    const s = quiet(),
      a = s.allies[0];
    command(s, { type: 'hold', id: 0, value: true });
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
    command(s, { type: 'move', id: 0, row: 'back' });
    advance(s, s.config.moveTime);
    expect(a.row).toBe('back');
    expect(a.executionHeld).toBe(true);
    expect(a.action).toBeNull();
    expect(a.plan).toHaveLength(1);
  });

  it('requests the weapon directly, preserves the current action and shifts only after recovery', () => {
    const s = quiet(),
      a = s.allies[0];
    attack(s);
    const active = a.action!,
      remaining = active.remaining;
    command(s, { type: 'toggleWeapon', id: 0 });
    expect(a.nextSlot).toBe(1);
    expect(planned(a)).toEqual([]);
    expect(a.action).toBe(active);
    advance(s, remaining - DT);
    expect(a.slot).toBe(0);
    expect(a.shift).toBe(0);
    expect(a.action).toBe(active);
    step(s);
    expect(a.action).toBeNull();
    step(s);
    expect(a.shift).toBeCloseTo(DT);
    command(s, { type: 'weapon', id: 0, slot: 1 });
    expect(a.shift).toBeCloseTo(DT);
    advance(s, s.config.shiftTime - DT);
    expect(a.slot).toBe(1);
    expect(a.nextSlot).toBeNull();
  });

  it('weapon and Optima changes retain compatible support drafts and paid shields', () => {
    const s = quiet(),
      a = s.allies[0];
    command(s, { type: 'weapon', id: 0, slot: 1 });
    advance(s, s.config.shiftTime);
    a.shield = 6;
    command(s, {
      type: 'draft',
      id: 0,
      step: { kind: 'skill', skillId: 'ward', target: { kind: 'ally', id: 2 } },
    });
    const draft = copy(a.draft);
    command(s, { type: 'optima', index: 3 });
    expect(a.draft).toEqual(draft);
    expect(a.shield).toBe(6);
    command(s, {
      type: 'draft',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
    command(s, { type: 'weapon', id: 0, slot: 0 });
    expect(a.draft).toHaveLength(1);
    expect(a.draft![0]).toMatchObject({ skillId: 'guard', target: { kind: 'ally', id: 0 } });
    expect(a.shield).toBe(6);
    expect(
      s.events.some((e) => e.text.includes('護りの誓い') && e.text.includes('予約を解除')),
    ).toBe(true);
  });

  it('can fund a handoff after a direct weapon request without deadlocking both orders', () => {
    const s = quiet(),
      a = s.allies[0];
    a.atb = 0;
    command(s, { type: 'weapon', id: 0, slot: 1 });
    command(s, { type: 'select', id: 1 });
    advance(s, 0.5);
    expect(a.atb).toBeGreaterThan(0);
    expect(a.nextSlot).toBe(1);
    expect(s.pendingSelect).toBe(1);
    advance(s, 2);
    expect(s.selected).toBe(1);
    expect(s.pendingSelect).toBeNull();
    expect(a.nextSlot).toBe(1);
    advance(s, 2);
    expect(a.nextSlot).toBeNull();
    expect(a.slot).toBe(1);
  });

  it('rejects removed stop mode in commands, snapshots and replay inputs', () => {
    const s = quiet();
    expect(command(s, { type: 'time', mode: 'stop' } as unknown as Command)).toBe(false);
    expect(s.timeMode).toBe('normal');
    expect(s.focus).toBe(100);
    expect(() =>
      parseSnapshot(
        JSON.stringify({ kind: 'snapshot', version: VERSION, state: { ...s, timeMode: 'stop' } }),
      ),
    ).toThrow();
    const session = new Session(),
      recording = session.recording();
    expect(() =>
      parseRecording(
        JSON.stringify({
          ...recording,
          inputs: [{ tick: 0, order: 0, command: { type: 'time', mode: 'stop' } }],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseSnapshot(JSON.stringify({ kind: 'snapshot', version: 'orchestra-13', state: s })),
    ).toThrow();
  });

  it('replays movement during an attack, direct weapon requests, slow and pause with identical full state', () => {
    const session = new Session();
    session.restore(JSON.stringify({ kind: 'snapshot', version: VERSION, state: quiet() }));
    session.send({ type: 'skill', id: 0, skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    session.advance(0.1);
    session.send({ type: 'move', id: 0, row: 'back' }, { type: 'weapon', id: 0, slot: 1 });
    for (let i = 0; i < 4; i++) session.advance(0.1);
    session.send({ type: 'time', mode: 'slow' });
    for (let i = 0; i < 5; i++) session.advance(0.1);
    expect(session.state.allies[0].move).toBeGreaterThan(0);
    expect(parseSnapshot(session.snapshot())).toEqual(session.state);
    session.send({ type: 'pause', value: true });
    session.advance(0.1);
    session.send({ type: 'pause', value: false }, { type: 'time', mode: 'normal' });
    for (let i = 0; i < 40; i++) session.advance(0.1);
    expect(session.state.allies[0].row).toBe('back');
    expect(session.state.allies[0].slot).toBe(1);
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(session.state);
  });
});
