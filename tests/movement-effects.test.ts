import { describe, expect, it } from 'vitest';
import { DT, SKILLS } from '../src/content/data';
import { MOVEMENT_LANDING_DURATION, movementCues } from '../src/client/effects/movement';
import { emptyPlayView } from '../src/lab/playtest';
import { Session, runReplay } from '../src/lab/session';
import { BattleTimeline } from '../src/lab/timeline';
import { parseSnapshot } from '../src/lab/validation';
import { command, copy, createState, emit, step } from '../src/sim/engine';
import { makeAction } from '../src/sim/execution';
import type { BattleEvent, Row, State } from '../src/sim/types';

function quiet() {
  const state = createState();
  command(state, { type: 'start' });
  state.allies.forEach((ally) => (ally.executionHeld = true));
  state.enemies.forEach((enemy) => (enemy.nextAttack = 999));
  return state;
}
function ticks(state: State, count: number) {
  for (let i = 0; i < count; i++) step(state);
}
function moveEvent(
  state: State,
  target: string,
  fromRow: Row,
  toRow: Row,
  extra: Partial<BattleEvent> = {},
) {
  emit(state, 'move', '位置変更', { target, visual: { fromRow, toRow }, ...extra });
}
function enemyPush(state: State, power = 1) {
  state.enemies[0].cast = {
    name: '押し出し',
    target: 'single',
    row: 'front',
    allyId: 0,
    remaining: DT,
    total: 1,
    power,
    movable: false,
    push: true,
  };
}
function resolveNextTick(state: State, skill: string, target: Parameters<typeof makeAction>[2]) {
  const ally = state.allies[0];
  ally.action = makeAction(ally, skill, target);
  ally.action.remaining = SKILLS[skill].recovery + DT;
  step(state);
}

describe('movement presentation reconstructed from battle state', () => {
  it('tracks direct movement while preserving the paid action and stable cue identity', () => {
    const state = quiet(),
      ally = state.allies[0];
    ally.action = makeAction(ally, 'sweep', { kind: 'row', row: 'front' });
    const paid = ally.action;
    command(state, { type: 'move', id: 0, row: 'back' });
    const initial = movementCues(state);
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      target: 'a0',
      phase: 'moving',
      kind: 'move',
      fromRow: 'front',
      toRow: 'back',
      progress: 0,
    });
    ticks(state, 20);
    const moving = movementCues(state)[0];
    expect(ally.row).toBe('front');
    expect(ally.action).toBe(paid);
    expect(moving.key).toBe(initial[0].key);
    expect(moving.progress).toBeCloseTo((20 * DT) / state.config.moveTime);
    expect(moving.age + moving.remaining).toBeCloseTo(state.config.moveTime);
    command(state, { type: 'move', id: 0, row: 'back' });
    expect(movementCues(state)[0]).toEqual(moving);
    command(state, { type: 'move', id: 0, row: 'front' });
    expect(ally.nextRow).toBeNull();
    expect(movementCues(state)).toEqual([]);
  });

  it('does not animate an unstarted move in either the live plan or the draft', () => {
    const state = quiet();
    state.allies[0].plan = [{ key: 1, kind: 'move', row: 'back' }];
    state.allies[1].draft = [{ key: 2, kind: 'move', row: 'front' }];
    expect(movementCues(state)).toEqual([]);
  });

  it('turns an actual arrival into a short landing, with battle-clock pause and expiry', () => {
    const state = quiet();
    command(state, { type: 'move', id: 0, row: 'back' });
    ticks(state, Math.round(state.config.moveTime / DT));
    expect(state.allies[0].row).toBe('back');
    expect(state.allies[0].nextRow).toBeNull();
    const arrival = movementCues(state);
    expect(arrival).toHaveLength(1);
    expect(arrival[0]).toMatchObject({
      phase: 'landing',
      kind: 'move',
      target: 'a0',
      fromRow: 'front',
      toRow: 'back',
      age: 0,
      progress: 0,
      duration: MOVEMENT_LANDING_DURATION,
    });
    command(state, { type: 'pause', value: true });
    ticks(state, 120);
    expect(movementCues(state)).toEqual(arrival);
    command(state, { type: 'pause', value: false });
    ticks(state, 6);
    expect(movementCues(state)[0].progress).toBeCloseTo(0.25);
    ticks(state, 19);
    expect(movementCues(state)).toEqual([]);
  });

  it('gives a newly requested reverse move priority over the prior arrival', () => {
    const state = quiet();
    command(state, { type: 'move', id: 0, row: 'back' });
    ticks(state, 51);
    expect(movementCues(state)[0].phase).toBe('landing');
    command(state, { type: 'move', id: 0, row: 'front' });
    expect(movementCues(state)).toHaveLength(1);
    expect(movementCues(state)[0]).toMatchObject({
      phase: 'moving',
      fromRow: 'back',
      toRow: 'front',
      progress: 0,
    });
  });

  it('replaces an interrupted voluntary move with the actual enemy push destination', () => {
    const state = quiet();
    command(state, { type: 'move', id: 0, row: 'back' });
    ticks(state, 12);
    enemyPush(state);
    step(state);
    expect(state.allies[0]).toMatchObject({ row: 'back', nextRow: null, move: 0 });
    expect(movementCues(state)).toHaveLength(1);
    expect(movementCues(state)[0]).toMatchObject({
      phase: 'landing',
      kind: 'forced',
      source: 'e0',
      target: 'a0',
      fromRow: 'front',
      toRow: 'back',
      progress: 0,
    });
  });

  it('shows a real forced enemy move, but never a resisted move', () => {
    const state = quiet();
    state.allies[0].weapons[0] = 'hammer';
    resolveNextTick(state, 'push', { kind: 'enemy', id: 0 });
    expect(state.enemies[0].row).toBe('front');
    expect(state.events.some((event) => event.visual?.outcome === 'resist')).toBe(true);
    expect(movementCues(state)).toEqual([]);
    state.enemies[0].broken = 8;
    resolveNextTick(state, 'push', { kind: 'enemy', id: 0 });
    expect(state.enemies[0].row).toBe('back');
    expect(movementCues(state)[0]).toMatchObject({
      side: 'enemy',
      target: 'e0',
      phase: 'landing',
      kind: 'forced',
      source: 'a0',
      fromRow: 'front',
      toRow: 'back',
    });
  });

  it('reconstructs simultaneous evacuation arrivals after every pending move is interrupted', () => {
    const state = quiet();
    state.allies[0].weapons[0] = 'banner';
    for (const ally of state.allies) {
      ally.row = 'front';
      command(state, { type: 'move', id: ally.id, row: 'back' });
    }
    ticks(state, 10);
    expect(movementCues(state).map((cue) => cue.target)).toEqual(['a0', 'a1', 'a2']);
    resolveNextTick(state, 'evacuate', { kind: 'row', row: 'front' });
    expect(state.allies.every((ally) => ally.row === 'back' && ally.nextRow === null)).toBe(true);
    const cues = movementCues(state);
    expect(cues).toHaveLength(3);
    expect(new Set(cues.map((cue) => cue.key)).size).toBe(3);
    for (const cue of cues)
      expect(cue).toMatchObject({
        phase: 'landing',
        kind: 'evacuate',
        source: 'a0',
        fromRow: 'front',
        toRow: 'back',
        age: 0,
      });
  });

  it('keeps simultaneous independent progress and enemy arrivals in stable unit order', () => {
    const state = quiet();
    command(state, { type: 'move', id: 0, row: 'back' });
    ticks(state, 12);
    command(state, { type: 'move', id: 1, row: 'front' });
    state.enemies[0].row = 'back';
    moveEvent(state, 'e0', 'front', 'back', { source: 'a2' });
    const cues = movementCues(state);
    expect(cues.map((cue) => [cue.target, cue.phase])).toEqual([
      ['a0', 'moving'],
      ['a1', 'moving'],
      ['e0', 'landing'],
    ]);
    expect(cues[0].progress).toBeGreaterThan(cues[1].progress);
  });

  it('deduplicates events and uses the latest direction without resurrecting older metadata', () => {
    const state = quiet();
    state.time = 2;
    moveEvent(state, 'a0', 'back', 'front', { time: 1.8 });
    moveEvent(state, 'a0', 'front', 'back', { time: 1.9 });
    expect(movementCues(state)).toEqual([]);
    state.allies[0].row = 'back';
    const expected = movementCues(state);
    expect(expected).toHaveLength(1);
    const duplicate = copy(state.events.at(-1)!);
    state.events.unshift(duplicate);
    state.events.reverse();
    expect(movementCues(state)).toEqual(expected);
    moveEvent(state, 'a0', 'front', 'back', { time: 2, visual: undefined });
    expect(movementCues(state)).toEqual([]);
  });

  it('rejects future, expired, same-row and unknown-target landings', () => {
    const state = quiet();
    state.time = 2;
    moveEvent(state, 'a0', 'back', 'front', { time: 3 });
    moveEvent(state, 'a1', 'front', 'back', { time: 1 });
    moveEvent(state, 'a2', 'back', 'back');
    moveEvent(state, 'a99', 'front', 'back');
    expect(movementCues(state)).toEqual([]);
  });

  it('does not show dead actors or frozen end-of-battle cues', () => {
    const state = quiet();
    command(state, { type: 'move', id: 0, row: 'back' });
    state.allies[0].hp = 1;
    enemyPush(state, 100);
    step(state);
    expect(state.allies[0].hp).toBe(0);
    state.allies[0].nextRow = 'back'; // A legacy snapshot must also suppress stale movement.
    moveEvent(state, 'a0', 'back', 'front');
    state.enemies[0].hp = 0;
    moveEvent(state, 'e0', 'back', 'front');
    expect(movementCues(state)).toEqual([]);
    state.allies[1].nextRow = 'front';
    expect(movementCues(state)).toHaveLength(1);
    for (const phase of ['ready', 'loot', 'victory', 'defeat'] as const) {
      state.phase = phase;
      expect(movementCues(state)).toEqual([]);
    }
  });

  it('bounds legacy progress and suppresses invalid timing instead of falling back to a landing', () => {
    const state = quiet();
    const ally = state.allies[0];
    ally.nextRow = 'back';
    ally.move = -1;
    expect(movementCues(state)[0].progress).toBe(0);
    ally.move = 100;
    expect(movementCues(state)[0]).toMatchObject({ progress: 1, remaining: 0 });
    moveEvent(state, 'a0', 'back', 'front');
    for (const duration of [0, -1, Infinity, NaN]) {
      state.config.moveTime = duration;
      expect(movementCues(state)).toEqual([]);
    }
    state.config.moveTime = 0.85;
    ally.move = NaN;
    expect(movementCues(state)).toEqual([]);
  });

  it.each(['manual', 'ai'] as const)(
    'recognizes the real %s battle-start boundary',
    (controlMode) => {
      const state = createState({}, controlMode);
      moveEvent(state, 'a0', 'back', 'front');
      expect(command(state, { type: 'start' })).toBe(true);
      expect(movementCues(state)).toEqual([]);
      command(state, { type: 'move', id: 0, row: 'back' });
      expect(movementCues(state)[0].phase).toBe('moving');
    },
  );

  it('uses the actual next command boundary to discard old arrivals on reused enemy IDs', () => {
    const state = quiet();
    state.time = 3;
    moveEvent(state, 'e0', 'back', 'front');
    expect(movementCues(state)).toHaveLength(1);
    state.phase = 'loot';
    expect(command(state, { type: 'next' })).toBe(true);
    expect(state.enemies[0].row).toBe('front');
    expect(movementCues(state)).toEqual([]);
    moveEvent(state, 'e0', 'back', 'front');
    expect(movementCues(state)).toHaveLength(1);
  });

  it('reconstructs identical cues from snapshots, replay and timeline branches without mutation', () => {
    const session = new Session();
    const initial = quiet();
    session.restore(JSON.stringify({ version: initial.version, kind: 'snapshot', state: initial }));
    const timeline = new BattleTimeline(),
      view = emptyPlayView();
    timeline.observe(session, view);
    const stop = session.subscribe(() => timeline.observe(session, view));
    session.send({ type: 'move', id: 0, row: 'back' }, { type: 'move', id: 1, row: 'front' });
    const check = () => {
      timeline.observe(session, view, true);
      const selection = { branchId: timeline.activeId, index: timeline.active!.points.length - 1 };
      const before = session.snapshot();
      const expected = movementCues(session.state);
      expect(movementCues(parseSnapshot(before))).toEqual(expected);
      expect(movementCues(runReplay(session.recording()))).toEqual(expected);
      expect(movementCues(timeline.preview(selection).state)).toEqual(expected);
      expect(session.snapshot()).toBe(before);
      return { selection, expected };
    };
    for (let i = 0; i < 18; i++) session.advance(DT);
    const moving = check();
    expect(moving.expected.every((cue) => cue.phase === 'moving')).toBe(true);
    for (let i = 18; i < 51; i++) session.advance(DT);
    const landing = check();
    expect(landing.expected.every((cue) => cue.phase === 'landing')).toBe(true);
    timeline.fork(session, moving.selection);
    session.send({ type: 'move', id: 0, row: 'front' });
    expect(movementCues(session.state).map((cue) => cue.target)).toEqual(['a1']);
    expect(movementCues(timeline.preview(landing.selection).state)).toEqual(landing.expected);
    stop();
  });
});
