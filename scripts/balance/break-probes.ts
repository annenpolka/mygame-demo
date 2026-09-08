import { isDeepStrictEqual } from 'node:util';
import { stateHash } from '../../src/ai/runner';
import { BATTLE_TIMING, DT, VERSION } from '../../src/content/data';
import { COMBAT_RULES } from '../../src/content/rules';
import { playRules } from '../../src/lab/playtest';
import { runReplay } from '../../src/lab/session';
import { parseRecording } from '../../src/lab/validation';
import { command, copy, createState, step } from '../../src/sim/engine';
import type { Recording, State } from '../../src/sim/types';

export const BREAK_PROBE_VERSION = 'balance-break-probes-1';
const policies = [
  { id: 'keep-abb', switchSeconds: null },
  { id: 'aab-now', switchSeconds: 0 },
  { id: 'aab-after-4s', switchSeconds: 4 },
  { id: 'aab-after-8s', switchSeconds: 8 },
] as const;

/** A synthetic post-break snapshot, not a naturally reached combat state. */
function fixture(enemyHp: number, initialChain: number): State {
  const state = createState({ seed: 1307, bonusMode: 'strong' }, 'ai');
  command(state, { type: 'start' });
  state.activePreset = 1;
  for (const ally of state.allies) {
    ally.slot = state.presets[1].slots[ally.id];
    ally.row = 'front';
  }
  state.enemies = [state.enemies[0]];
  Object.assign(state.enemies[0], {
    hp: enemyHp,
    maxHp: enemyHp,
    row: 'front',
    chain: initialChain,
    hold: 0,
    broken: BATTLE_TIMING.breakDuration,
    nextAttack: 999,
    cast: null,
    steadfast: 0,
    attackCount: 0,
  });
  state.events = [];
  state.eventSeq = 0;
  return state;
}

function runProbe(initial: State, policy: (typeof policies)[number]) {
  const state = copy(initial);
  const recording: Recording = { version: VERSION, initial: copy(initial), inputs: [], endTick: 0 };
  const initialHp = initial.enemies[0].hp;
  let chainPeak = initial.enemies[0].chain;
  let killSeconds: number | null = null;
  let lastEvent = initial.eventSeq;
  let switchIssuedSeconds: number | null = null;
  let switchCompletedSeconds: number | null = null;
  let offensiveHits = 0;
  const ticks = Math.round(BATTLE_TIMING.breakDuration / DT);
  const switchTick = policy.switchSeconds === null ? null : Math.round(policy.switchSeconds / DT);
  for (let elapsedTicks = 0; elapsedTicks < ticks && state.phase === 'battle'; elapsedTicks++) {
    if (elapsedTicks === switchTick) {
      const input = { type: 'optima', index: 2 } as const;
      recording.inputs.push({ tick: state.tick, order: recording.inputs.length, command: input });
      if (!command(state, input)) throw new Error('Break probe optima command was rejected.');
      switchIssuedSeconds = state.time - initial.time;
    }
    step(state);
    chainPeak = Math.max(chainPeak, state.enemies[0].chain);
    for (const event of state.events) {
      if (event.id <= lastEvent) continue;
      if (event.type === 'shift' && event.target === 'a1')
        switchCompletedSeconds = event.time - initial.time;
      if (event.type === 'damage' && event.target === 'e0') offensiveHits++;
    }
    lastEvent = state.eventSeq;
    if (state.enemies[0].hp === 0) killSeconds = state.time - initial.time;
  }
  recording.endTick = state.tick;
  const parsed = parseRecording(JSON.stringify(recording));
  const replayed = runReplay(parsed);
  const finalStateHash = stateHash(state);
  const replayVerified =
    isDeepStrictEqual(replayed, state) && stateHash(replayed) === finalStateHash;
  if (!replayVerified)
    throw new Error('Break probe public replay does not reproduce the full State.');
  const damage = initialHp - state.enemies[0].hp;
  if (damage !== state.metrics.damage - initial.metrics.damage || state.metrics.taken !== 0)
    throw new Error('Break probe damage accounting or zero-enemy-pressure guard failed.');
  return {
    fixture: `hp${initialHp}-chain${initial.enemies[0].chain}`,
    enemyHp: initialHp,
    initialChain: initial.enemies[0].chain,
    initialStateHash: stateHash(initial),
    policy: policy.id,
    damage,
    chainPeak,
    killSeconds,
    observedSeconds: state.time - initial.time,
    switchIssuedSeconds,
    switchCompletedSeconds,
    offensiveHits,
    recording: parsed,
    finalStateHash,
    replayVerified,
  };
}

/** Twenty-four small mechanistic probes; this does not optimize global balance. */
export function runBreakProbes() {
  if (VERSION !== 'orchestra-15' || BATTLE_TIMING.breakDuration !== 12)
    throw new Error('Review the frozen break probe conditions for this combat version.');
  const frozenRules = playRules();
  const runs = [2000, 5000, 10000].flatMap((hp) =>
    [200, 300].flatMap((chain) => {
      const initial = fixture(hp, chain);
      return policies.map((policy) => runProbe(initial, policy));
    }),
  );
  if (playRules() !== frozenRules || runs.some((run) => run.chainPeak > COMBAT_RULES.chainMax))
    throw new Error('Break probe frozen-rules guard failed.');
  return {
    conditions: {
      experimentVersion: BREAK_PROBE_VERSION,
      combatVersion: VERSION,
      synthetic: true,
      runCount: runs.length,
      seed: 1307,
      enemyHp: [2000, 5000, 10000],
      initialChain: [200, 300],
      breakWindowSeconds: 12,
      initialRoles: 'ABB',
      targetRoles: 'AAB',
      initialAtb: 1,
      allyRows: ['front', 'front', 'front'],
      enemyCount: 1,
      enemyRow: 'front',
      enemyNextAttack: 999,
      equipment: [
        ['sword', 'shield'],
        ['staff', 'bow'],
        ['bell', 'hook'],
      ],
      config: copy(runs[0].recording.initial.config),
      policies,
      actions: 'Unmodified engine autopilot basic skills and follow-up queues for every policy.',
      switch:
        'Actual optima index 2 command; action completion, queue pruning and shift time are retained.',
      damageDefinition: 'Actual enemy HP lost, capped at remaining HP; stop on kill or 12 seconds.',
      rules: JSON.parse(frozenRules),
    },
    caveats: [
      'These 24 runs are synthetic local break-window probes, not global balance optimization or independent human playtests.',
      'Initial ABB, empty action queues and ATB 1 are constructed at break onset; reaching this snapshot is not evaluated.',
      'Enemy pressure is disabled. All-front exposure, recovery, survival and UI or handoff effort cannot be evaluated.',
      'Higher post-break chain is only one effect: changing B to A also changes skill power, party bonuses, ATB supply and shift delay.',
      'Equal damage after an early kill means the HP cap was reached; compare killSeconds and do not infer equal damage potential.',
      'A null killSeconds means not killed within the observed 12-second window; it does not mean a zero-second kill.',
      'A scheduled switch may never be issued or completed if the enemy dies first.',
      'The single shared seed improves reproducibility; action changes can alter random-number consumption and this is not a seed-robust estimate.',
      'No comparison freezes chain growth artificially. These probes compare real timing policies under current rules, not the isolated causal effect of chain alone.',
    ],
    runs,
  };
}
