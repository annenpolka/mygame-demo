import { stateHash, type RunResult } from '../../src/ai/runner';
import { runReplay } from '../../src/lab/session';
import type { Command, State } from '../../src/sim/types';

export const TELEMETRY_VERSION = 'balance-telemetry-2';

export interface DangerWindow {
  actorId: number;
  encounter: number;
  startTime: number;
  endTime: number;
  outcome: 'recovered' | 'death' | 'censored';
}

export interface BalanceTelemetry {
  /** From the run's first battle start to its first break, including encounter 2. */
  firstBreakSeconds: number | null;
  breakDamageShare: number | null;
  breakDamage: number;
  normalDamage: number;
  breakEnemySeconds: number;
  normalEnemySeconds: number;
  breakDamageRate: number | null;
  normalDamageRate: number | null;
  /** Maximum at fixed-tick/input observation boundaries. */
  maxChain: number;
  enemyBrokenFraction: number | null;
  waitingFraction: number | null;
  cleanupSeconds: number | null;
  cleanupEncounterCount: number;
  dangerEpisodes: number;
  recoveredEpisodes: number;
  dangerDeaths: number;
  censoredEpisodes: number;
  /** First 12 completed/censored windows; aggregate counts include every episode. */
  dangerWindows: DangerWindow[];
  recoverySeconds: number | null;
  maxHitHpFraction: number | null;
  handoffAttempts: number;
  handoffActions: number;
  handoffCompletions: number;
  commandAttempts: number;
  acceptedCommands: number;
  rejectedCommands: number;
  cancellations: number;
  acceptedMoveCommands: number;
  totalMoveEvents: number;
  commandsByType: Partial<
    Record<
      Command['type'],
      {
        attempted: number;
        accepted: number;
        rejected: number;
      }
    >
  >;
  replayVerified: boolean;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

/**
 * Observe one exact replay, without keeping a second sequence of State snapshots.
 * Damage rates are conditional observations per living-enemy-person-second, not
 * a causal estimate of the break multiplier: target selection, chain, protection,
 * action mix and enemy survival differ between the two exposure groups.
 * Exposure uses the beginning of each fixed battle-time interval (same convention
 * as the runner). Event order distinguishes the break-triggering hit from later
 * hits in that tick. Max chain is observed at tick/input boundaries.
 *
 * Input counts include preparation commands and are uncalibrated bot-activity
 * proxies; they do not estimate human workload or the value of intervention.
 */
export function summarizeTelemetry(run: RunResult): BalanceTelemetry {
  const result: BalanceTelemetry = {
    firstBreakSeconds: null,
    breakDamageShare: null,
    breakDamage: 0,
    normalDamage: 0,
    breakEnemySeconds: 0,
    normalEnemySeconds: 0,
    breakDamageRate: null,
    normalDamageRate: null,
    maxChain: 100,
    enemyBrokenFraction: null,
    waitingFraction: null,
    cleanupSeconds: null,
    cleanupEncounterCount: 0,
    dangerEpisodes: 0,
    recoveredEpisodes: 0,
    dangerDeaths: 0,
    censoredEpisodes: 0,
    dangerWindows: [],
    recoverySeconds: null,
    maxHitHpFraction: null,
    handoffAttempts: 0,
    handoffActions: 0,
    handoffCompletions: 0,
    commandAttempts: 0,
    acceptedCommands: 0,
    rejectedCommands: 0,
    cancellations: 0,
    acceptedMoveCommands: 0,
    totalMoveEvents: 0,
    commandsByType: {},
    replayVerified: false,
  };
  for (const input of run.decisions.flatMap((d) => d.commands)) {
    const type = input.command.type;
    const count = (result.commandsByType[type] ??= { attempted: 0, accepted: 0, rejected: 0 });
    count.attempted++;
    result.commandAttempts++;
    if (input.accepted) {
      count.accepted++;
      result.acceptedCommands++;
      if (['cancel', 'cancelFirst', 'removePlan'].includes(type)) result.cancellations++;
      if (['move', 'toggleRow', 'formation'].includes(type)) result.acceptedMoveCommands++;
    } else {
      count.rejected++;
      result.rejectedCommands++;
    }
  }
  // Recordings retain attempts even when a custom run does not have DecisionEntry.
  result.handoffAttempts = run.recording.inputs.filter((i) => i.command.type === 'select').length;

  type Actor = { hp: number; maxHp: number };
  type Episode = { started: number; encounter: number };
  let previous:
    | {
        phase: State['phase'];
        time: number;
        encounter: number;
        enemies: { id: number; hp: number; broken: number }[];
      }
    | undefined;
  let lastEvent = run.recording.initial.eventSeq;
  let firstStart: number | null = null;
  let cleanupStart: number | null = null;
  let cleanupTotal = 0;
  let recoveryTotal = 0;
  const actors = new Map<number, Actor>();
  const episodes = new Map<number, Episode>();

  const recordWindow = (actorId: number, endTime: number, outcome: DangerWindow['outcome']) => {
    const episode = episodes.get(actorId);
    if (episode && result.dangerWindows.length < 12)
      result.dangerWindows.push({
        actorId,
        encounter: episode.encounter,
        startTime: episode.started,
        endTime,
        outcome,
      });
  };
  const trackHealth = (id: number, time: number, encounter: number) => {
    const actor = actors.get(id);
    if (!actor) return;
    // A lethal hit also enters the danger region. This preserves first-hit deaths.
    if (!episodes.has(id) && actor.hp / actor.maxHp < 0.3) {
      episodes.set(id, { started: time, encounter });
      result.dangerEpisodes++;
    }
    if (actor.hp <= 0 && episodes.has(id)) {
      recordWindow(id, time, 'death');
      episodes.delete(id);
      result.dangerDeaths++;
    }
  };
  const endBattle = (time: number) => {
    result.censoredEpisodes += episodes.size;
    for (const id of episodes.keys()) recordWindow(id, time, 'censored');
    episodes.clear();
  };
  const beginBattle = (s: State) => {
    firstStart ??= s.time;
    actors.clear();
    for (const a of s.allies) {
      actors.set(a.id, { hp: a.hp, maxHp: a.maxHp });
      // Characters already dead when a recording begins are not incident deaths.
      if (a.hp > 0) trackHealth(a.id, s.time, s.encounter);
    }
    cleanupStart = s.enemies.filter((e) => e.hp > 0).length === 1 ? s.time : null;
  };

  const finalState = runReplay(run.recording, undefined, (s) => {
    const wasBattle = previous?.phase === 'battle';
    const sameEncounter = previous?.encounter === s.encounter;
    if (previous && wasBattle && !sameEncounter) endBattle(previous.time);
    if (s.phase === 'battle' && (!wasBattle || !sameEncounter)) beginBattle(s);

    if (previous && wasBattle && sameEncounter) {
      const dt = Math.max(0, s.time - previous.time);
      const broken = new Map(previous.enemies.map((e) => [e.id, e.broken > 0]));
      for (const e of previous.enemies) {
        if (e.hp <= 0) continue;
        if (e.broken > 0) result.breakEnemySeconds += dt;
        else result.normalEnemySeconds += dt;
      }

      for (const event of s.events) {
        if (event.id <= lastEvent) continue;
        if (event.type === 'break' && event.target?.startsWith('e')) {
          broken.set(Number(event.target.slice(1)), true);
          result.firstBreakSeconds ??= event.time - (firstStart ?? event.time);
        }
        if (event.type === 'action' && event.visual?.skillId === 'handoff') result.handoffActions++;
        // The current completion event has no structured skill/outcome metadata.
        if (event.type === 'system' && event.text.endsWith('へ交代：引継ぎスロー'))
          result.handoffCompletions++;
        if (event.type === 'move') result.totalMoveEvents++;
        if (
          event.type === 'damage' &&
          event.source?.startsWith('a') &&
          event.target?.startsWith('e')
        ) {
          const damage = event.value ?? 0;
          if (broken.get(Number(event.target.slice(1)))) result.breakDamage += damage;
          else result.normalDamage += damage;
          const actorId = Number(event.source.slice(1));
          const actor = actors.get(actorId);
          const episode = episodes.get(actorId);
          // Recovery means this same ally returns to offense while at >=60% HP.
          if (damage > 0 && actor && episode && actor.hp / actor.maxHp >= 0.6) {
            result.recoveredEpisodes++;
            recoveryTotal += event.time - episode.started;
            recordWindow(actorId, event.time, 'recovered');
            episodes.delete(actorId);
          }
        }
        if (
          event.type === 'damage' &&
          event.source?.startsWith('e') &&
          event.target?.startsWith('a')
        ) {
          const actorId = Number(event.target.slice(1));
          const actor = actors.get(actorId);
          if (actor && event.value !== undefined) {
            result.maxHitHpFraction = Math.max(
              result.maxHitHpFraction ?? 0,
              event.value / actor.maxHp,
            );
            actor.hp = Math.max(0, actor.hp - event.value);
            trackHealth(actorId, event.time, s.encounter);
          }
        }
        if (event.type === 'heal' && event.target?.startsWith('a') && event.value !== undefined) {
          const actor = actors.get(Number(event.target.slice(1)));
          if (actor) actor.hp = Math.min(actor.maxHp, actor.hp + event.value);
        }
      }
      if (s.phase === 'loot' || s.phase === 'victory') {
        cleanupTotal += cleanupStart === null ? 0 : s.time - cleanupStart;
        result.cleanupEncounterCount++;
      }
      if (s.phase !== 'battle') endBattle(s.time);
      else {
        if (cleanupStart === null && s.enemies.filter((e) => e.hp > 0).length === 1)
          cleanupStart = s.time;
        for (const a of s.allies) actors.set(a.id, { hp: a.hp, maxHp: a.maxHp });
      }
    }
    lastEvent = s.eventSeq;
    for (const enemy of s.enemies) result.maxChain = Math.max(result.maxChain, enemy.chain);
    previous = {
      phase: s.phase,
      time: s.time,
      encounter: s.encounter,
      enemies: s.enemies.map((e) => ({ id: e.id, hp: e.hp, broken: e.broken })),
    };
  });
  endBattle(finalState.time); // Episodes still open at the run's time limit are right-censored.
  const replayHash = stateHash(finalState);
  result.replayVerified =
    replayHash === run.summary.finalHash && replayHash === stateHash(run.finalState);
  if (!result.replayVerified)
    throw new Error('Telemetry replay does not match the recorded final state.');

  result.breakDamageShare = ratio(result.breakDamage, result.breakDamage + result.normalDamage);
  result.breakDamageRate = ratio(result.breakDamage, result.breakEnemySeconds);
  result.normalDamageRate = ratio(result.normalDamage, result.normalEnemySeconds);
  result.enemyBrokenFraction = ratio(
    result.breakEnemySeconds,
    result.breakEnemySeconds + result.normalEnemySeconds,
  );
  const actorSeconds = run.summary.actorSeconds;
  result.waitingFraction = ratio(
    actorSeconds.waiting,
    Object.values(actorSeconds).reduce((a, b) => a + b, 0),
  );
  result.cleanupSeconds = ratio(cleanupTotal, result.cleanupEncounterCount);
  result.recoverySeconds = ratio(recoveryTotal, result.recoveredEpisodes);
  return result;
}
