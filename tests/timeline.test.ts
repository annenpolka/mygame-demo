import { describe, expect, it } from 'vitest';
import { BattleTimeline } from '../src/lab/timeline';
import { Session, runReplay } from '../src/lab/session';
import { emptyPlayView } from '../src/lab/playtest';
import { copy, command, createState } from '../src/sim/engine';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import { SKILLS } from '../src/content/data';
import type { State } from '../src/sim/types';

function setup(initial?: State) {
  const session = new Session();
  if (initial)
    session.restore(JSON.stringify({ version: initial.version, kind: 'snapshot', state: initial }));
  const history = new BattleTimeline();
  const view = emptyPlayView();
  history.observe(session, view);
  const unsubscribe = session.subscribe(() => history.observe(session, view));
  return { session, history, view, unsubscribe };
}
function quiet() {
  const state = createState();
  command(state, { type: 'start' });
  state.allies[0].atb = 4;
  state.allies.slice(1).forEach((a) => (a.executionHeld = true));
  state.enemies.forEach((e) => (e.nextAttack = 999));
  return state;
}
const draft = {
  type: 'draft' as const,
  id: 0,
  step: { kind: 'skill' as const, skillId: 'slash', target: { kind: 'enemy' as const, id: 0 } },
};
const selected = (h: BattleTimeline, index = h.active!.points.length - 1) => ({
  branchId: h.activeId,
  index,
});
const advance = (s: Session, seconds: number) => {
  for (let i = 0; i < seconds * 60; i++) s.advance(1 / 60);
};

describe('automatic battle timeline', () => {
  it('records without altering the simulation, input sequence, RNG or snapshots', () => {
    const { session, history } = setup();
    const control = new Session();
    for (const s of [session, control]) {
      s.send({ type: 'start' }, draft);
      advance(s, 6);
    }
    expect(session.snapshot()).toBe(control.snapshot());
    expect(session.recording()).toEqual(control.recording());
    expect(history.active!.checkpoints.length).toBeGreaterThan(1);
    for (let index = 0; index < history.active!.points.length; index++) {
      const selection = selected(history, index);
      expect(history.preview(selection).state).toEqual(runReplay(history.recording(selection)));
    }
  });
  it('distinguishes several commands and view changes at the same tick', () => {
    const { session, history, view } = setup(quiet());
    session.send(draft, draft);
    expect(history.active!.points.map((p) => [p.tick, p.inputCount])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(history.preview(selected(history, 1)).state.allies[0].draft).toHaveLength(1);
    view.pending = 'potion';
    view.battle.page = 'target';
    view.battle.skillId = 'potion';
    history.observe(session, view);
    const at = selected(history);
    expect(history.preview(at).view).toEqual(view);
    session.send({ type: 'executeSequence', id: 0 });
    expect(history.preview(at).state.allies[0].draft).toHaveLength(2);
  });
  it('previews paid casts and slow-time state without mutating the live present', () => {
    const { session, history, view } = setup(quiet());
    session.send(draft, draft, { type: 'executeSequence', id: 0 }, { type: 'time', mode: 'slow' });
    advance(session, 1.5);
    history.observe(session, view, true);
    const at = selected(history),
      expected = copy(session.state);
    expect(expected.allies[0].action?.resolved).toBe(false);
    advance(session, 2);
    const present = session.snapshot(),
      inputs = copy(session.inputs);
    expect(history.preview(at).state).toEqual(expected);
    expect(session.snapshot()).toBe(present);
    expect(session.inputs).toEqual(inputs);
  });
  it('forks with a truncated input prefix, preserves original futures, and can revisit them', () => {
    const { session, history, view } = setup(quiet());
    session.send(draft);
    const at = selected(history),
      then = copy(session.state);
    session.send(draft, { type: 'executeSequence', id: 0 });
    advance(session, 3);
    history.observe(session, view, true);
    const original = copy(history.active!),
      future = copy(session.state);
    history.fork(session, at);
    expect(session.state).toEqual(then);
    expect(session.inputs).toHaveLength(1);
    expect(history.branches[0]).toEqual(original);
    session.send({ type: 'removePlan', id: 0, key: session.state.allies[0].draft![0].key });
    advance(session, 0.5);
    history.observe(session, view, true);
    expect(history.active!.parentId).toBe(original.id);
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(
      parseSnapshot(session.snapshot()),
    );
    const alternate = copy(history.active!);
    history.fork(session, { branchId: original.id, index: original.points.length - 1 });
    expect(session.state).toEqual(future);
    expect(history.branches[0]).toEqual(original);
    expect(history.branches[1]).toEqual(alternate);
  });
  it('can fork again after new checkpoints from a replay-normalized branch', () => {
    const { session, history, view } = setup();
    session.send({ type: 'start' }, draft);
    const first = selected(history);
    advance(session, 1);
    history.fork(session, first);
    advance(session, 6);
    history.observe(session, view, true);
    const next = selected(history),
      expected = copy(session.state);
    advance(session, 1);
    history.fork(session, next);
    expect(session.state).toEqual(expected);
    expect(runReplay(session.recording())).toEqual(expected);
  });
  it('crosses both encounters and preserves same-tick equipment inputs between fights', () => {
    const initial = quiet();
    initial.enemies.forEach((e) => (e.hp = 1));
    const { session, history, view } = setup(initial);
    session.send(draft, draft, { type: 'executeSequence', id: 0 });
    advance(session, 3);
    expect(session.state.phase).toBe('loot');
    const firstEnd = selected(history);
    session.send({ type: 'equip', id: 0, slot: 1, weaponId: 'hammer' });
    const equipped = selected(history),
      equippedState = copy(session.state);
    session.send({ type: 'next' });
    advance(session, 1);
    history.observe(session, view, true);
    expect(session.state.encounter).toBe(2);
    const second = selected(history),
      secondState = copy(session.state);
    expect(history.preview(firstEnd).state.encounter).toBe(1);
    expect(history.preview(equipped).state).toEqual(equippedState);
    history.fork(session, firstEnd);
    expect(session.state.phase).toBe('loot');
    history.fork(session, second);
    expect(session.state).toEqual(secondState);
  });
  it('keeps earlier histories when retrying or loading a separate snapshot', () => {
    const { session, history } = setup(quiet());
    session.send(draft);
    const original = copy(history.active!);
    const snapshot = session.snapshot();
    session.retry();
    session.restore(snapshot);
    expect(history.branches).toHaveLength(3);
    expect(history.branches[0]).toEqual(original);
    expect(history.preview(selected(history)).state).toEqual(session.state);
  });
  it('rejects changed rules, invalid positions and corrupted checkpoints before changing the live session', () => {
    const { session, history } = setup(quiet());
    session.send(draft);
    const before = session.snapshot(),
      at = selected(history);
    expect(() => history.fork(session, { branchId: 99, index: 0 })).toThrow();
    const power = SKILLS.slash.power;
    try {
      SKILLS.slash.power++;
      expect(() => history.fork(session, at)).toThrow('ルール');
    } finally {
      SKILLS.slash.power = power;
    }
    history.active!.checkpoints[0].state.rng++;
    expect(() => history.fork(session, at)).toThrow('一致');
    expect(session.snapshot()).toBe(before);
  });
});
