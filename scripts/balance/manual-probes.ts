import { isDeepStrictEqual } from 'node:util';
import { DT, SKILLS, VERSION } from '../../src/content/data';
import { stateHash } from '../../src/ai/runner';
import { runReplay } from '../../src/lab/session';
import { parseRecording } from '../../src/lab/validation';
import { command, copy, createState, step } from '../../src/sim/engine';
import { makeAction } from '../../src/sim/execution';
import type { Command, Recording, State } from '../../src/sim/types';

export type ManualProbeMode = 'no-intervention' | 'immediate-handoff' | 'delayed-handoff';
export interface ManualProbeCondition {
  id: string;
  outgoingAtb: number;
  outgoingAction: 'idle' | 'sweep';
  healerAtb: number;
}
export interface ProbeTime {
  battleSeconds: number;
  realSeconds: number;
}
export interface ManualProbeRun {
  condition: ManualProbeCondition;
  mode: ManualProbeMode;
  initialStateHash: string;
  recording: Recording;
  finalStateHash: string;
  replayVerified: boolean;
  metrics: {
    request: ProbeTime | null;
    selected: ProbeTime | null;
    skillInput: ProbeTime | null;
    effectiveHeal: ProbeTime | null;
    recoveredTo60Percent: ProbeTime | null;
    requestToSelected: ProbeTime | null;
    requestToEffectiveHeal: ProbeTime | null;
    selectedToEffectiveHeal: ProbeTime | null;
    timeTo60Percent: ProbeTime | null;
    requestOutgoingAtb: number | null;
    selectedOutgoingAtb: number | null;
    selectedHealerAtb: number | null;
    handoffCount: number;
    handoffAtbSpent: number;
    greatHealCount: number;
    greatHealAtbSpent: number;
    effectiveGreatHeal: number;
    healed: number;
    damage: number;
    initialHp: number;
    finalHp: number;
    finalHpFraction: number;
    finalAtb: number[];
    commandCount: number;
    rejectedCommands: number;
    elapsed: ProbeTime;
  };
  caveat: string;
}

const HORIZON_REAL_SECONDS = 15;
const DELAYED_REQUEST_REAL_SECONDS = 2;
const POST_SELECTION_INPUT_REAL_SECONDS = 0.35;
const RECOVERY_THRESHOLD = 0.6;
const clock = (s: State): ProbeTime => ({ battleSeconds: s.time, realSeconds: s.realTime });
const elapsed = (end: ProbeTime | null, start: ProbeTime | null): ProbeTime | null =>
  end && start
    ? {
        battleSeconds: end.battleSeconds - start.battleSeconds,
        realSeconds: end.realSeconds - start.realSeconds,
      }
    : null;

/** A common, serialized synthetic start, not a naturally reached encounter. */
function fixture(condition: ManualProbeCondition): State {
  const s = createState({ bonusMode: 'none', seed: 1307 }, 'manual');
  s.phase = 'battle';
  s.allies[0].hp = Math.round(s.allies[0].maxHp * 0.3);
  s.allies[0].atb = condition.outgoingAtb;
  s.allies[1].hp = 0;
  s.allies[2].atb = condition.healerAtb;
  s.enemies = [s.enemies[0]];
  s.enemies[0].hp = s.enemies[0].maxHp = 100000;
  s.enemies[0].nextAttack = 9999;
  if (condition.outgoingAction === 'sweep') {
    // The attack has already been paid for before the snapshot. Its remaining
    // commitment is real; the listed outgoing ATB is its post-payment balance.
    s.allies[0].action = makeAction(s.allies[0], 'sweep', { kind: 'row', row: 'front' });
    s.allies[0].action.offense.damage = 1.25;
    s.allies[0].action.offense.chain = 1.25;
  }
  // Normalize through the same parser used by imported UI recordings before any
  // branch starts, including fixtures containing a paid action.
  return parseRecording(
    JSON.stringify({ version: VERSION, initial: s, inputs: [], endTick: s.tick }),
  ).initial;
}

function runProbe(condition: ManualProbeCondition, mode: ManualProbeMode): ManualProbeRun {
  const s = fixture(condition),
    initial = copy(s),
    start = clock(s);
  const recording: Recording = { version: VERSION, initial, inputs: [], endTick: s.tick };
  let request: ProbeTime | null = null,
    selected: ProbeTime | null = null,
    skillInput: ProbeTime | null = null,
    effectiveHeal: ProbeTime | null = null,
    recoveredTo60Percent: ProbeTime | null = null,
    requestOutgoingAtb: number | null = null,
    selectedOutgoingAtb: number | null = null,
    selectedHealerAtb: number | null = null,
    handoffCount = 0,
    greatHealCount = 0,
    effectiveGreatHeal = 0,
    rejectedCommands = 0,
    lastEvent = s.eventSeq;
  const requestAfter = mode === 'delayed-handoff' ? DELAYED_REQUEST_REAL_SECONDS : 0;
  const send = (c: Command) => {
    recording.inputs.push({ tick: s.tick, order: recording.inputs.length, command: copy(c) });
    const accepted = command(s, c);
    if (!accepted) rejectedCommands++;
    return accepted;
  };
  for (let tick = 0; tick < Math.round(HORIZON_REAL_SECONDS / DT); tick++) {
    if (mode !== 'no-intervention' && !request && s.realTime + 1e-9 >= requestAfter) {
      request = clock(s);
      requestOutgoingAtb = s.allies[0].atb;
      if (!send({ type: 'select', id: 2 })) throw new Error('Manual probe handoff was rejected');
    }
    if (
      selected &&
      !skillInput &&
      s.realTime + 1e-9 >= selected.realSeconds + POST_SELECTION_INPUT_REAL_SECONDS
    ) {
      skillInput = clock(s);
      if (
        !send({
          type: 'enqueue',
          id: 2,
          step: { kind: 'skill', skillId: 'greatHeal', target: { kind: 'ally', id: 0 } },
        })
      )
        throw new Error('Manual probe great heal was rejected');
    }
    step(s);
    if (request && !selected && s.selected === 2) {
      selected = clock(s);
      selectedOutgoingAtb = s.allies[0].atb;
      selectedHealerAtb = s.allies[2].atb;
    }
    if (!recoveredTo60Percent && s.allies[0].hp / s.allies[0].maxHp >= RECOVERY_THRESHOLD)
      recoveredTo60Percent = clock(s);
    for (const event of s.events.filter((e) => e.id > lastEvent)) {
      lastEvent = event.id;
      if (event.type === 'action' && event.visual?.skillId === 'handoff') handoffCount++;
      if (event.type === 'action' && event.visual?.skillId === 'greatHeal') greatHealCount++;
      if (
        event.type === 'heal' &&
        event.source === 'a2' &&
        event.target === 'a0' &&
        event.visual?.skillId === 'greatHeal' &&
        (event.value ?? 0) > 0
      ) {
        effectiveHeal ??= clock(s);
        effectiveGreatHeal += event.value!;
      }
    }
  }
  recording.endTick = s.tick;
  const parsed = parseRecording(JSON.stringify(recording));
  const replayVerified = isDeepStrictEqual(runReplay(parsed), s);
  if (!replayVerified) throw new Error(`Manual probe replay mismatch: ${condition.id}/${mode}`);
  return {
    condition,
    mode,
    initialStateHash: stateHash(initial),
    recording: parsed,
    finalStateHash: stateHash(s),
    replayVerified,
    metrics: {
      request,
      selected,
      skillInput,
      effectiveHeal,
      recoveredTo60Percent,
      requestToSelected: elapsed(selected, request),
      requestToEffectiveHeal: elapsed(effectiveHeal, request),
      selectedToEffectiveHeal: elapsed(effectiveHeal, selected),
      timeTo60Percent: elapsed(recoveredTo60Percent, start),
      requestOutgoingAtb,
      selectedOutgoingAtb,
      selectedHealerAtb,
      handoffCount,
      handoffAtbSpent: handoffCount * SKILLS.handoff.cost,
      greatHealCount,
      greatHealAtbSpent: greatHealCount * SKILLS.greatHeal.cost,
      effectiveGreatHeal,
      healed: s.metrics.healed - initial.metrics.healed,
      damage: s.metrics.damage - initial.metrics.damage,
      initialHp: initial.allies[0].hp,
      finalHp: s.allies[0].hp,
      finalHpFraction: s.allies[0].hp / s.allies[0].maxHp,
      finalAtb: s.allies.map((a) => a.atb),
      commandCount: recording.inputs.length,
      rejectedCommands,
      elapsed: elapsed(clock(s), start)!,
    },
    caveat:
      'Synthetic recovery probe: no incoming attacks, one ally absent, no focus spending. The unselected healer uses ordinary automatic small heals. One deliberate greatHeal replaces continued healer automation after handoff; this is not sustained optimal manual play. Delay assumptions are not measured human input times. Damage includes the outgoing actor becoming automatic. These outcomes do not establish human usability, fun, or natural encounter win rates.',
  };
}

export function runManualProbes() {
  const conditions: ManualProbeCondition[] = [0, 4].flatMap((outgoingAtb) =>
    (['idle', 'sweep'] as const).flatMap((outgoingAction) =>
      [2, 4].map((healerAtb) => ({
        id: `outgoing-${outgoingAtb}-${outgoingAction}-healer-${healerAtb}`,
        outgoingAtb,
        outgoingAction,
        healerAtb,
      })),
    ),
  );
  return {
    version: `${VERSION}/manual-probes-1`,
    conditions: {
      fixtures: conditions,
      horizonRealSeconds: HORIZON_REAL_SECONDS,
      delayedRequestRealSeconds: DELAYED_REQUEST_REAL_SECONDS,
      postSelectionInputRealSeconds: POST_SELECTION_INPUT_REAL_SECONDS,
      initialHpFraction: 0.3,
      recoveryThreshold: RECOVERY_THRESHOLD,
      targetAllyId: 0,
      healerAllyId: 2,
      fixture:
        'Manual control of ally 0; ally 1 absent; ally 2 uses bell; no incoming attacks; one 100000 HP target. Existing sweep, where present, is fully paid before the common initial snapshot. Fixed seed 1307, ordinary engine defaults except bonusMode none.',
    },
    caveats: [
      'Every three-mode comparison shares the exact same initial snapshot, including both ATB balances and any paid outgoing action.',
      'Recovery is the first HP >= 60% event, regardless of whether an automatic or deliberate heal caused it. A deliberate effective heal is separately identified by the greatHeal outcome event.',
      'Request and post-selection input delays are explicit synthetic assumptions, with tick-resolution scheduling. Handoff slow makes battle time differ from real time.',
      'One use of greatHeal is followed by no additional user inputs. Compare first recovery latency; final HP is not a fair comparison of sustained healing policies.',
      'These probes isolate mechanical intervention costs and conditional payoff. Human attention, UI input burden, readability, and perceived value remain unmeasured.',
    ],
    runs: conditions.flatMap((condition) =>
      (['no-intervention', 'immediate-handoff', 'delayed-handoff'] as const).map((mode) =>
        runProbe(condition, mode),
      ),
    ),
  };
}
