import { prepareLoadout, LOADOUT_MODES, type LoadoutMode } from './composition';
import { BONUS_MODES } from '../sim/bonuses';
import { createQueuePolicy, QUEUE_POLICY_VERSION } from './queue-policy';
import { planned } from '../sim/plan';
import { ENCOUNTER_SET_IDS, type EncounterSetId } from '../content/encounters';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_CONFIG, DT, SKILLS, VERSION, WEAPONS } from '../content/data';
import { command, copy, createState, step } from '../sim/engine';
import { runReplay } from '../lab/session';
import type { BattleEvent, BonusMode, Command, Metrics, Recording, State } from '../sim/types';
import { observe } from './observation';
import { createPolicy, POLICY_VERSION, type PolicyId, type Ablation } from './policies';

export type PlanningMode = 'legacy' | 'next' | 'queue';
export interface RunOptions {
  loadout?: LoadoutMode;
  fullInventory?: boolean;
  bonusMode?: BonusMode;
  enemyHpScale?: number;
  planning?: PlanningMode;
  encounterSet?: EncounterSetId;
  encounterLevel?: number;
  policy: PolicyId;
  ablation?: Ablation;
  seed?: number;
  enemyPower?: number;
  atbRate?: number;
  atbMax?: number;
  decisionInterval?: number;
  reactionSeconds?: number;
  maxSeconds?: number;
  verifyReplay?: boolean;
}
export interface DecisionEntry {
  tick: number;
  time: number;
  realTime: number;
  encounter: number;
  reason: string;
  commands: { command: Command; accepted: boolean }[];
  hp: number[];
  atb: number[];
  rows: string[];
  roles: string[];
}
export interface Sample {
  time: number;
  realTime: number;
  encounter: number;
  hp: number[];
  enemies: { id: number; hp: number; chain: number; row: string }[];
  focus: number;
  preset: number;
  roles: string[];
  rows: string[];
}
export interface EncounterSummary {
  encounter: number;
  outcome: string;
  seconds: number;
  realSeconds: number;
  metrics: Metrics;
}
export interface EnemyOutcome {
  time: number;
  encounter: number;
  enemy: string;
  action: string;
  outcome: 'hit' | 'empty-row' | 'break' | 'displacement' | 'killed';
  targetsHit: number;
}
export interface RunSummary {
  loadout: LoadoutMode;
  fullInventory: boolean;
  loadoutWeapons: string[][];
  bonusMode: BonusMode;
  enemyHpScale: number;
  planning: PlanningMode;
  queuedDuringAction: number;
  appendedPlans: number;
  maxQueueDepth: number;
  encounterSet: EncounterSetId;
  encounterLevel: number;
  policy: PolicyId;
  ablation: Ablation;
  seed: number;
  enemyPower: number;
  atbRate: number;
  atbMax: number;
  decisionInterval: number;
  reactionSeconds: number;
  maxSeconds: number;
  outcome: 'victory' | 'defeat' | 'timeout';
  seconds: number;
  realSeconds: number;
  metrics: Metrics;
  encounters: EncounterSummary[];
  rejectedCommands: number;
  decisions: number;
  shifts: number;
  moves: number;
  cancellations: number;
  deaths: number;
  potionsUsed: number;
  actions: Record<string, number>;
  enemyOutcomes: Record<EnemyOutcome['outcome'], number>;
  roleSeconds: Record<string, number>;
  activeRoleSeconds: Record<string, number>;
  rowPersonSeconds: { front: number; back: number };
  actorSeconds: { acting: number; moving: number; shifting: number; waiting: number };
  minHpFraction: number;
  finalHp: number[];
  replayVerified: boolean;
  finalHash: string;
}
export interface RunResult {
  summary: RunSummary;
  recording: Recording;
  events: (BattleEvent & { encounter: number })[];
  decisions: DecisionEntry[];
  samples: Sample[];
  enemyActions: EnemyOutcome[];
  finalState: State;
}
export const ROLES = (s: State) => s.allies.map((a) => WEAPONS[a.weapons[a.slot]].role);
export function stateHash(s: State) {
  const canonical = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(canonical)
      : x && typeof x === 'object'
        ? Object.fromEntries(
            Object.entries(x)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : x;
  return createHash('sha256')
    .update(JSON.stringify(canonical(s)))
    .digest('hex');
}
function difference(now: Metrics, before: Metrics): Metrics {
  return Object.fromEntries(
    Object.keys(now).map((k) => [k, now[k as keyof Metrics] - before[k as keyof Metrics]]),
  ) as unknown as Metrics;
}
export function runPolicy(options: RunOptions): RunResult {
  const opts = {
    loadout:
      options.policy === 'adaptive' || options.policy === 'assault'
        ? options.policy
        : ('legacy' as LoadoutMode),
    fullInventory: false,
    bonusMode: DEFAULT_CONFIG.bonusMode,
    enemyHpScale: 1,
    seed: 1307,
    enemyPower: 1,
    atbRate: DEFAULT_CONFIG.atbRate,
    atbMax: DEFAULT_CONFIG.atbMax,
    decisionInterval: 0.25,
    reactionSeconds: 0.35,
    maxSeconds: 180,
    verifyReplay: true,
    ...options,
  };
  if (
    !LOADOUT_MODES.includes(opts.loadout) ||
    !BONUS_MODES.includes(opts.bonusMode) ||
    !Number.isFinite(opts.enemyHpScale) ||
    opts.enemyHpScale < 0.5 ||
    opts.enemyHpScale > 4 ||
    !Number.isInteger(opts.seed) ||
    opts.seed < 0 ||
    opts.seed > 4294967295 ||
    !Number.isFinite(opts.enemyPower) ||
    opts.enemyPower < 0.2 ||
    opts.enemyPower > 3 ||
    !Number.isInteger(opts.atbMax) ||
    opts.atbMax < 2 ||
    opts.atbMax > 8 ||
    !Number.isFinite(opts.atbRate) ||
    opts.atbRate < 0.2 ||
    opts.atbRate > 3 ||
    !Number.isFinite(opts.decisionInterval) ||
    opts.decisionInterval < DT ||
    opts.decisionInterval > 5 ||
    !Number.isFinite(opts.reactionSeconds) ||
    opts.reactionSeconds < 0 ||
    opts.reactionSeconds > 5 ||
    !Number.isFinite(opts.maxSeconds) ||
    opts.maxSeconds < 1 ||
    opts.maxSeconds > 3600
  )
    throw new Error('AI実行条件が範囲外です。');
  if (
    (opts.encounterSet !== undefined && !ENCOUNTER_SET_IDS.includes(opts.encounterSet)) ||
    (opts.encounterLevel !== undefined &&
      (!Number.isInteger(opts.encounterLevel) ||
        opts.encounterLevel < 1 ||
        opts.encounterLevel > 10))
  )
    throw new Error('戦闘セットまたは強度が範囲外です。');
  const s = createState({
    seed: opts.seed,
    enemyPower: opts.enemyPower,
    atbRate: opts.atbRate,
    atbMax: opts.atbMax,
    bonusMode: opts.bonusMode,
    enemyHpScale: opts.enemyHpScale,
    ...(opts.encounterSet ? { encounterSet: opts.encounterSet } : {}),
    ...(opts.encounterLevel ? { encounterLevel: opts.encounterLevel } : {}),
  });
  const initial = copy(s);
  s.controlMode = initial.controlMode = 'ai';
  const planning = opts.planning ?? 'legacy';
  if (!['legacy', 'next', 'queue'].includes(planning)) throw new Error('不明な予約方式');
  const policy =
    planning === 'legacy'
      ? createPolicy(opts.policy, opts.reactionSeconds, opts.ablation)
      : createQueuePolicy(
          opts.policy,
          opts.reactionSeconds,
          opts.ablation,
          planning === 'next' ? 1 : 3,
        );
  const recording: Recording = { version: VERSION, initial, inputs: [], endTick: 0 };
  const events: RunResult['events'] = [],
    decisions: DecisionEntry[] = [],
    samples: Sample[] = [],
    enemyActions: EnemyOutcome[] = [];
  const encounters: EncounterSummary[] = [];
  let queuedDuringAction = 0,
    appendedPlans = 0,
    maxQueueDepth = 0;
  let lastEvent = 0,
    nextDecision = 0,
    nextSample = 0,
    rejectedCommands = 0,
    minHpFraction = 1;
  let startTime = 0,
    startRealTime = 0,
    initialMetrics = copy(s.metrics);
  const actions: Record<string, number> = {},
    roleSeconds: Record<string, number> = {};
  const activeRoleSeconds: Record<string, number> = {};
  const rowPersonSeconds = { front: 0, back: 0 },
    actorSeconds = { acting: 0, moving: 0, shifting: 0, waiting: 0 };
  const drain = (encounter = s.encounter) => {
    const additions = s.events.filter((e) => e.id > lastEvent);
    for (const e of additions) {
      events.push({ ...copy(e), encounter });
      lastEvent = e.id;
      if (e.type === 'action') {
        const name = e.text.split(' → ')[1];
        const skill = Object.values(SKILLS).find((sk) => sk.name === name);
        if (skill) actions[skill.id] = (actions[skill.id] ?? 0) + 1;
      }
    }
    return additions;
  };
  const send = (commands: Command[], reason: string) => {
    if (!commands.length) return;
    const entry: DecisionEntry = {
      tick: s.tick,
      time: s.time,
      realTime: s.realTime,
      encounter: s.encounter,
      reason,
      commands: [],
      hp: s.allies.map((a) => a.hp),
      atb: s.allies.map((a) => a.atb),
      rows: s.allies.map((a) => a.row),
      roles: ROLES(s),
    };
    for (const c of commands) {
      recording.inputs.push({ tick: s.tick, order: recording.inputs.length, command: copy(c) });
      const actingBefore = c.type === 'enqueue' && !!s.allies[c.id]?.action;
      const accepted = command(s, c);
      if (accepted && c.type === 'enqueue') {
        appendedPlans++;
        if (actingBefore) queuedDuringAction++;
      }
      maxQueueDepth = Math.max(maxQueueDepth, ...s.allies.map((a) => planned(a).length));
      if (!accepted) rejectedCommands++;
      entry.commands.push({ command: copy(c), accepted });
      drain();
    }
    decisions.push(entry);
  };
  const sample = () =>
    samples.push({
      time: s.time,
      realTime: s.realTime,
      encounter: s.encounter,
      hp: s.allies.map((a) => a.hp),
      enemies: s.enemies.map((e) => ({ id: e.id, hp: e.hp, chain: e.chain, row: e.row })),
      focus: s.focus,
      preset: s.activePreset,
      roles: ROLES(s),
      rows: s.allies.map((a) => a.row),
    });
  const endEncounter = () =>
    encounters.push({
      encounter: s.encounter,
      outcome: s.phase === 'battle' ? 'timeout' : s.phase,
      seconds: s.time - startTime,
      realSeconds: s.realTime - startRealTime,
      metrics: difference(s.metrics, initialMetrics),
    });

  if (opts.fullInventory) send([{ type: 'labWeapons' }], '比較用の全武器を共通に追加');
  send(prepareLoadout(s, opts.loadout), '持ち込みとオプティマを準備');
  send([{ type: 'start' }], '第一戦を開始');
  sample();
  for (let ticks = 0; ticks < Math.round(opts.maxSeconds / DT); ticks++) {
    if (s.phase === 'loot') {
      endEncounter();
      send(
        [...prepareLoadout(s, opts.loadout), { type: 'next' }],
        '装備方針に従って戦利品とオプティマを更新し、第二戦へ',
      );
      startTime = s.time;
      startRealTime = s.realTime;
      initialMetrics = copy(s.metrics);
      nextDecision = s.tick;
      sample();
    }
    if (s.phase !== 'battle') break;
    if (s.tick >= nextDecision) {
      const decision = policy.decide(observe(s));
      send(decision.commands, decision.reason);
      nextDecision = s.tick + Math.max(1, Math.round(opts.decisionInterval / DT));
    }
    const beforeTime = s.time,
      encounter = s.encounter;
    const beforeActors = s.allies.map(
      (a) =>
        ({
          alive: a.hp > 0,
          row: a.row,
          category: a.action
            ? 'acting'
            : a.nextRow !== null
              ? 'moving'
              : a.nextSlot !== null
                ? 'shifting'
                : 'waiting',
        }) as const,
    );
    const roles = ROLES(s).join('');
    const activeRoles = s.allies
      .map((a) => (a.hp > 0 ? WEAPONS[a.weapons[a.slot]].role : '-'))
      .join('');
    const casts = s.enemies
      .filter((e) => e.hp > 0 && e.cast)
      .map((e) => ({ id: e.id, name: e.name, row: e.row, cast: copy(e.cast!) }));
    step(s);
    const dt = s.time - beforeTime;
    roleSeconds[roles] = (roleSeconds[roles] ?? 0) + dt;
    activeRoleSeconds[activeRoles] = (activeRoleSeconds[activeRoles] ?? 0) + dt;
    for (const a of beforeActors)
      if (a.alive) {
        rowPersonSeconds[a.row] += dt;
        actorSeconds[a.category] += dt;
      }
    for (const a of s.allies) minHpFraction = Math.min(minHpFraction, a.hp / a.maxHp);
    const newEvents = drain(encounter);
    for (const c of casts) {
      const after = s.enemies[c.id];
      if (after.cast) continue;
      const hitCount = newEvents.filter(
        (e) => e.type === 'damage' && e.source === `e${c.id}`,
      ).length;
      const outcome: EnemyOutcome['outcome'] =
        after.hp <= 0
          ? 'killed'
          : newEvents.some((e) => e.type === 'break' && e.target === `e${c.id}`)
            ? 'break'
            : after.row !== c.row && c.cast.movable
              ? 'displacement'
              : hitCount
                ? 'hit'
                : 'empty-row';
      enemyActions.push({
        time: s.time,
        encounter,
        enemy: c.name,
        action: c.cast.name,
        outcome,
        targetsHit: hitCount,
      });
    }
    if (s.realTime >= nextSample || s.phase !== 'battle') {
      sample();
      nextSample = s.realTime + 0.5;
    }
  }
  endEncounter();
  recording.endTick = s.tick;
  const replayVerified = opts.verifyReplay && isDeepStrictEqual(runReplay(recording), s);
  if (opts.verifyReplay && !replayVerified)
    throw new Error(`AI ${opts.policy} seed=${opts.seed} のリプレイが一致しません。`);
  const summary: RunSummary = {
    loadout: opts.loadout,
    fullInventory: opts.fullInventory,
    loadoutWeapons: s.allies.map((a) => [...a.weapons]),
    planning,
    queuedDuringAction,
    appendedPlans,
    maxQueueDepth,
    encounterSet: opts.encounterSet ?? 'belfry',
    encounterLevel: opts.encounterLevel ?? 1,
    policy: opts.policy,
    ablation: opts.ablation ?? 'none',
    seed: opts.seed,
    enemyPower: opts.enemyPower,
    atbRate: opts.atbRate,
    atbMax: opts.atbMax,
    bonusMode: opts.bonusMode,
    enemyHpScale: opts.enemyHpScale,
    decisionInterval: opts.decisionInterval,
    reactionSeconds: opts.reactionSeconds,
    maxSeconds: opts.maxSeconds,
    outcome: s.phase === 'victory' ? 'victory' : s.phase === 'defeat' ? 'defeat' : 'timeout',
    seconds: s.time,
    realSeconds: s.realTime,
    metrics: copy(s.metrics),
    encounters,
    rejectedCommands,
    decisions: decisions.length - 1 - (s.encounter === 2 ? 1 : 0),
    shifts: events.filter((e) => e.type === 'shift' && e.target?.startsWith('a')).length,
    moves: events.filter((e) => e.type === 'move' && e.target?.startsWith('a')).length,
    cancellations: events.filter((e) => e.text.includes('予約を解除')).length,
    deaths: events.filter((e) => e.text.includes('戦闘不能')).length,
    potionsUsed: 3 - s.potions,
    actions,
    enemyOutcomes: Object.fromEntries(
      ['hit', 'empty-row', 'break', 'displacement', 'killed'].map((k) => [
        k,
        enemyActions.filter((e) => e.outcome === k).length,
      ]),
    ) as RunSummary['enemyOutcomes'],
    roleSeconds,
    activeRoleSeconds,
    rowPersonSeconds,
    actorSeconds,
    minHpFraction,
    finalHp: s.allies.map((a) => a.hp),
    replayVerified,
    finalHash: stateHash(s),
  };
  return { summary, recording, events, decisions, samples, enemyActions, finalState: s };
}
export const EXPERIMENT_VERSION = `${VERSION}/${POLICY_VERSION}/${QUEUE_POLICY_VERSION}/runner-4`;
