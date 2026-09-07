import { describe, expect, it } from 'vitest';
import { createState, copy, command, step } from '../src/sim/engine';
import { runReplay } from '../src/lab/session';
import { parseRecording } from '../src/lab/validation';
import { observe } from '../src/ai/observation';
import { createPolicy, POLICY_IDS, ABLATIONS } from '../src/ai/policies';
import { runPolicy } from '../src/ai/runner';
import { aggregate } from '../src/ai/report';
import type { State } from '../src/sim/types';

describe('AI observation and command contract', () => {
  it('hides future timers and random state and cannot alias live state', () => {
    const s = createState(),
      original = copy(s);
    const view = observe(s);
    expect(view).not.toHaveProperty('rng');
    expect(view.enemies[0]).not.toHaveProperty('nextAttack');
    expect(view.enemies[0]).not.toHaveProperty('attackCount');
    expect(view.enemies[0].cast).toBeNull();
    Object.assign(view.allies[0], { hp: 0 });
    expect(s).toEqual(original);
  });
  it('copies every nested observation field, so retained views remain stable and cannot change the battle', () => {
    const s = createState();
    command(s, { type: 'start' });
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
    });
    step(s);
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
    s.allies[0].queued = { skillId: 'slash', target: { kind: 'enemy', id: 0 } };
    s.enemies[0].cast = {
      name: 'visible',
      target: 'row',
      row: 'front',
      allyId: 0,
      remaining: 2,
      total: 2,
      power: 100,
      movable: true,
      push: false,
    };
    const view = observe(s),
      retained = copy(view);
    // Alter all mutable descendants, on either side of the observation boundary.
    const alter = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'number') Object.assign(value, { [key]: child + 1 });
        else if (typeof child === 'string') Object.assign(value, { [key]: child + 'changed' });
        else alter(child);
      }
    };
    const original = copy(s);
    alter(view);
    expect(s).toEqual(original);
    const next = observe(s);
    alter(s);
    expect(next).toEqual(retained);
  });
  it.each(POLICY_IDS)(
    '%s issues only legal combat commands without mutating its observation',
    (id) => {
      const s = createState(),
        policy = createPolicy(id);
      command(s, { type: 'start' });
      for (let tick = 0; tick < 1800 && s.phase === 'battle'; tick++) {
        if (tick % 15 === 0) {
          const view = observe(s),
            before = copy(view);
          const d = policy.decide(view);
          expect(view).toEqual(before);
          for (const c of d.commands) {
            expect([
              'optima',
              'move',
              'formation',
              'skill',
              'time',
              'enqueue',
              'removePlan',
            ]).toContain(c.type);
            expect(command(s, c)).toBe(true);
          }
        }
        step(s);
      }
    },
  );
  it('reserves a column technique before automatic attacks spend the second ATB segment', () => {
    const s = createState();
    s.enemies[1].row = 'front';
    s.allies[0].atb = 1.4;
    const d = createPolicy('tactician').decide(observe(s));
    expect(d.commands).toContainEqual({
      type: 'skill',
      id: 0,
      skillId: 'sweep',
      target: { kind: 'row', row: 'front' },
    });
  });
  it('a late reaction uses slow, pays focus, and still respects the actor movement time', () => {
    const s = createState();
    command(s, { type: 'start' });
    s.enemies[0].cast = {
      name: '前列薙ぎ払い',
      remaining: 1,
      total: 2,
      row: 'front',
      target: 'row',
      allyId: 0,
      power: 100,
      movable: true,
      push: false,
    };
    const p = createPolicy('focus', 0.5);
    const first = p.decide(observe(s));
    expect(first.commands).toEqual([{ type: 'time', mode: 'slow' }]);
    first.commands.forEach((c) => command(s, c));
    for (let i = 0; i < 30; i++) step(s);
    const d = p.decide(observe(s));
    expect(s.focus).toBeCloseTo(94);
    expect(s.time).toBeCloseTo(0.125);
    expect(d.commands).toContainEqual({ type: 'move', id: 0, row: 'back' });
    expect(s.allies[0].row).toBe('front');
  });
});

describe('headless comparison evidence', () => {
  it.each(ABLATIONS)(
    'ablation %s disables only the named mechanism and remains reproducible',
    (ablation) => {
      const r = runPolicy({ policy: 'tactician', ablation });
      expect(r.summary.replayVerified).toBe(true);
      if (ablation === 'no-pull') expect(r.summary.actions.pull ?? 0).toBe(0);
      if (ablation === 'no-row')
        expect(
          (r.summary.actions.sweep ?? 0) +
            (r.summary.actions.rain ?? 0) +
            (r.summary.actions.volley ?? 0),
        ).toBe(0);
      if (ablation === 'no-defense') {
        expect(r.summary.actions.guard ?? 0).toBe(0);
        expect(r.recording.inputs.some((c) => c.command.type === 'move')).toBe(false);
      }
    },
  );
  it.each(POLICY_IDS)(
    '%s replays byte-equivalent state and retains the entire event stream',
    (id) => {
      const run = runPolicy({ policy: id });
      const replay = parseRecording(JSON.stringify(run.recording));
      expect(runReplay(replay)).toEqual(run.finalState);
      expect(run.summary.replayVerified).toBe(true);
      expect(run.summary.rejectedCommands).toBe(0);
      expect(run.events.length).toBe(run.finalState.eventSeq);
      expect(run.events.map((e) => e.id)).toEqual(
        Array.from({ length: run.events.length }, (_, i) => i + 1),
      );
      expect(run.summary.encounters).toHaveLength(2);
      expect(run.summary.encounters.reduce((n, e) => n + e.seconds, 0)).toBeCloseTo(
        run.summary.seconds,
      );
      expect(run.summary.encounters.reduce((n, e) => n + e.metrics.taken, 0)).toBe(
        run.summary.metrics.taken,
      );
      expect(Object.values(run.summary.enemyOutcomes).reduce((a, b) => a + b, 0)).toBe(
        run.enemyActions.length,
      );
      const autoActions = run.events.filter((e) => e.type === 'action').length;
      expect(Object.values(run.summary.actions).reduce((a, b) => a + b, 0)).toBe(autoActions);
    },
  );
  it('independent runs start with fresh policy memory and reproduce the same outcome', () => {
    const a = runPolicy({ policy: 'tactician', seed: 13 });
    runPolicy({ policy: 'focus', seed: 14 });
    const b = runPolicy({ policy: 'tactician', seed: 13 });
    expect(a.summary).toEqual(b.summary);
    expect(a.recording).toEqual(b.recording);
  });
  it('focus and the tactical policy are identical when no reaction time is needed', () => {
    const a = runPolicy({ policy: 'tactician', reactionSeconds: 0 });
    const b = runPolicy({ policy: 'focus', reactionSeconds: 0 });
    expect(a.finalState).toEqual(b.finalState);
    expect(b.summary.metrics.focusUsed).toBe(0);
  });
  it('the tactical policy actually executes pull and row attacks, rather than merely intending them', () => {
    const r = runPolicy({ policy: 'tactician' });
    expect(r.summary.actions.pull).toBeGreaterThan(0);
    expect(
      (r.summary.actions.sweep ?? 0) +
        (r.summary.actions.rain ?? 0) +
        (r.summary.actions.volley ?? 0),
    ).toBeGreaterThan(0);
  });
  it('timeouts remain distinct and are excluded from successful clear-time statistics', () => {
    const timeout = runPolicy({ policy: 'autopilot', maxSeconds: 1 }).summary;
    const win = runPolicy({ policy: 'balanced' }).summary;
    expect(timeout.outcome).toBe('timeout');
    expect(timeout.replayVerified).toBe(true);
    const a = aggregate([timeout, win]);
    expect(a.wins).toBe(1);
    expect(a.timeouts).toBe(1);
    expect(a.winSeconds).toBe(win.seconds);
    expect(aggregate([timeout]).winSeconds).toBeNull();
  });
  it('rejects invalid run settings before starting a simulation', () => {
    for (const opts of [
      { seed: -1 },
      { atbRate: NaN },
      { enemyPower: 0 },
      { decisionInterval: 0 },
      { reactionSeconds: -1 },
      { maxSeconds: Infinity },
    ])
      expect(() => runPolicy({ policy: 'balanced', ...opts })).toThrow();
  });
});
