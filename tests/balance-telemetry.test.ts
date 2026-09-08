import { describe, expect, it } from 'vitest';
import { summarizeTelemetry } from '../scripts/balance/telemetry';
import { stateHash, runPolicy, type RunResult } from '../src/ai/runner';
import { DT, VERSION } from '../src/content/data';
import { command, copy, createState, step } from '../src/sim/engine';
import { makeAction } from '../src/sim/execution';
import type { Command, State, Target } from '../src/sim/types';

function quietBattle(encounter: 1 | 2 = 1) {
  const s = createState({ bonusMode: 'none', encounter });
  command(s, { type: 'start' });
  for (const a of s.allies) a.executionHeld = true;
  for (const e of s.enemies) e.nextAttack = 999;
  return s;
}

function impact(s: State, actor: number, skill: string, target: Target) {
  const a = s.allies[actor];
  a.action = makeAction(a, skill, target);
  a.action.remaining = a.action.recovery + DT;
}

/** Synthetic, exactly replayable states expose event-order edge cases. */
function runFixture(initial: State, ticks: number, commands: Command[] = []): RunResult {
  const s = copy(initial);
  const decisions: RunResult['decisions'] = [];
  if (commands.length)
    decisions.push({
      tick: s.tick,
      time: s.time,
      realTime: s.realTime,
      encounter: s.encounter,
      reason: 'test fixture',
      hp: [],
      atb: [],
      rows: [],
      roles: [],
      commands: commands.map((c) => ({ command: c, accepted: command(s, c) })),
    });
  for (let i = 0; i < ticks && s.phase === 'battle'; i++) step(s);
  return {
    // These are the only summary fields consumed by the instrumentation.
    summary: {
      finalHash: stateHash(s),
      actorSeconds: { acting: 0, moving: 0, shifting: 0, waiting: 0 },
    } as RunResult['summary'],
    finalState: s,
    recording: {
      version: VERSION,
      initial: copy(initial),
      endTick: s.tick,
      inputs: commands.map((c, order) => ({ tick: initial.tick, order, command: c })),
    },
    decisions,
    events: [],
    samples: [],
    enemyActions: [],
  };
}

describe('balance experiment telemetry', () => {
  it('classifies the break-triggering hit as normal and a later same-tick hit as broken', () => {
    const s = quietBattle();
    s.enemies[0].chain = 199;
    impact(s, 0, 'spark', { kind: 'enemy', id: 0 });
    impact(s, 1, 'slash', { kind: 'enemy', id: 0 });
    const run = runFixture(s, 1);
    const damage = run.finalState.events.filter((e) => e.id > s.eventSeq && e.type === 'damage');
    const t = summarizeTelemetry(run);
    expect(damage).toHaveLength(2);
    expect(t.normalDamage).toBe(damage[0].value);
    expect(t.breakDamage).toBe(damage[1].value);
    expect(t.firstBreakSeconds).toBeCloseTo(DT);
    // The exposure interval began unbroken; a zero denominator remains unknown.
    expect(t.breakEnemySeconds).toBe(0);
    expect(t.breakDamageRate).toBeNull();
    expect(t.breakDamageShare).toBeCloseTo(damage[1].value! / run.finalState.metrics.damage);
  });

  it('uses living-enemy-person-seconds and classifies an expiring-break hit before timer expiry', () => {
    const s = quietBattle();
    s.enemies[0].broken = DT;
    s.enemies[0].chain = 250;
    s.enemies.push({ ...copy(s.enemies[1]), id: 2, hp: 0 });
    impact(s, 0, 'slash', { kind: 'enemy', id: 0 });
    const t = summarizeTelemetry(runFixture(s, 1));
    expect(t.breakEnemySeconds).toBeCloseTo(DT);
    expect(t.normalEnemySeconds).toBeCloseTo(DT);
    expect(t.enemyBrokenFraction).toBeCloseTo(0.5);
    expect(t.normalDamage).toBe(0);
    expect(t.breakDamage).toBeGreaterThan(0);
    expect(t.breakDamageRate).toBeCloseTo(t.breakDamage / DT);
  });

  it('returns null for absent damage, break, cleanup and completed recovery evidence', () => {
    const t = summarizeTelemetry(runFixture(quietBattle(), 1));
    expect(t).toMatchObject({
      breakDamageShare: null,
      firstBreakSeconds: null,
      breakDamageRate: null,
      cleanupSeconds: null,
      cleanupEncounterCount: 0,
      recoverySeconds: null,
      maxHitHpFraction: null,
      waitingFraction: null,
    });
    expect(t.normalDamageRate).toBe(0);
  });

  it('censors danger at encounter end and excludes automatic intermission healing', () => {
    const s = quietBattle();
    s.allies[0].hp = s.allies[0].maxHp * 0.2;
    for (const e of s.enemies) e.hp = e.id === 0 ? 1 : 0;
    impact(s, 1, 'slash', { kind: 'enemy', id: 0 });
    const run = runFixture(s, 1);
    expect(run.finalState.phase).toBe('loot');
    expect(run.finalState.allies[0].hp).toBe(run.finalState.allies[0].maxHp);
    const t = summarizeTelemetry(run);
    expect(t).toMatchObject({
      dangerEpisodes: 1,
      recoveredEpisodes: 0,
      censoredEpisodes: 1,
      dangerDeaths: 0,
    });
    expect(t.cleanupSeconds).toBeCloseTo(DT);
    expect(t.cleanupEncounterCount).toBe(1);
  });

  it('requires the recovered ally, rather than another party member, to return to offense', () => {
    const s = quietBattle();
    s.allies[1].hp = s.allies[1].maxHp * 0.2;
    impact(s, 0, 'greatHeal', { kind: 'ally', id: 1 });
    impact(s, 2, 'slash', { kind: 'enemy', id: 0 });
    const otherAttacks = summarizeTelemetry(runFixture(s, 1));
    expect(otherAttacks).toMatchObject({
      dangerEpisodes: 1,
      recoveredEpisodes: 0,
      censoredEpisodes: 1,
    });
    impact(s, 1, 'slash', { kind: 'enemy', id: 0 });
    const ownAttack = summarizeTelemetry(runFixture(s, 1));
    expect(ownAttack).toMatchObject({
      dangerEpisodes: 1,
      recoveredEpisodes: 1,
      censoredEpisodes: 0,
    });
    expect(ownAttack.recoverySeconds).toBeCloseTo(DT);
  });

  it('counts a first lethal hit as a danger death and measures actual HP loss', () => {
    const s = quietBattle();
    s.enemies[0].cast = {
      name: 'test hit',
      target: 'single',
      row: 'front',
      allyId: 0,
      remaining: DT,
      total: 1,
      power: 100000,
      movable: false,
      push: false,
    };
    const t = summarizeTelemetry(runFixture(s, 1));
    expect(t).toMatchObject({
      dangerEpisodes: 1,
      dangerDeaths: 1,
      censoredEpisodes: 0,
      maxHitHpFraction: 1,
    });
  });

  it('anchors recovery, death and censored replay windows to the correct actor, encounter and times', () => {
    const s = quietBattle(2);
    s.time = 10;
    for (const a of s.allies) a.hp = a.maxHp * 0.2;
    impact(s, 0, 'greatHeal', { kind: 'ally', id: 1 });
    impact(s, 1, 'slash', { kind: 'enemy', id: 0 });
    s.enemies[0].cast = {
      name: 'test hit',
      target: 'single',
      row: 'front',
      allyId: 2,
      remaining: DT,
      total: 1,
      power: 100000,
      movable: false,
      push: false,
    };
    const t = summarizeTelemetry(runFixture(s, 1));
    expect(t.dangerWindows).toEqual([
      { actorId: 1, encounter: 2, startTime: 10, endTime: 10 + DT, outcome: 'recovered' },
      { actorId: 2, encounter: 2, startTime: 10, endTime: 10 + DT, outcome: 'death' },
      { actorId: 0, encounter: 2, startTime: 10, endTime: 10 + DT, outcome: 'censored' },
    ]);
    expect(t).toMatchObject({
      dangerEpisodes: 3,
      recoveredEpisodes: 1,
      dangerDeaths: 1,
      censoredEpisodes: 1,
    });
  });

  it('counts accepted cancellation commands independently from event wording and excludes rejected moves', () => {
    const s = quietBattle();
    s.allies[2].hp = 0;
    const run = runFixture(s, 0, [
      {
        type: 'enqueue',
        id: 0,
        step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
      },
      { type: 'cancel', id: 0 },
      { type: 'move', id: 2, row: s.allies[2].row },
    ]);
    expect(run.decisions[0].commands.map((c) => c.accepted)).toEqual([true, true, false]);
    const t = summarizeTelemetry(run);
    expect(t).toMatchObject({
      commandAttempts: 3,
      acceptedCommands: 2,
      rejectedCommands: 1,
      cancellations: 1,
      acceptedMoveCommands: 0,
    });
    expect(t.commandsByType.cancel).toEqual({ attempted: 1, accepted: 1, rejected: 0 });
  });

  it('matches the runner and rejects a recording whose claimed final state was changed', () => {
    const run = runPolicy({ policy: 'tactician', seed: 1307, maxSeconds: 30, verifyReplay: false });
    const t = summarizeTelemetry(run);
    expect(t.replayVerified).toBe(true);
    expect(t.breakDamage + t.normalDamage).toBe(run.summary.metrics.damage);
    expect(t.rejectedCommands).toBe(run.summary.rejectedCommands);
    expect(t.dangerEpisodes).toBe(t.recoveredEpisodes + t.dangerDeaths + t.censoredEpisodes);
    expect(t.waitingFraction).toBeGreaterThanOrEqual(0);
    run.finalState.focus -= 1;
    expect(() => summarizeTelemetry(run)).toThrow('Telemetry replay');
  });

  it('distinguishes handoff attempts, action starts and completed handoffs', () => {
    const s = quietBattle();
    s.allies[0].atb = 4;
    const commands: Command[] = [{ type: 'select', id: 1 }];
    const started = summarizeTelemetry(runFixture(s, 1, commands));
    expect(started).toMatchObject({ handoffAttempts: 1, handoffActions: 1, handoffCompletions: 0 });
    const completed = summarizeTelemetry(runFixture(s, 80, commands));
    expect(completed).toMatchObject({
      handoffAttempts: 1,
      handoffActions: 1,
      handoffCompletions: 1,
    });
  });
});
