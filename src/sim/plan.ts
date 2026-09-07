import {
  advanceExecution,
  charging,
  makeAction,
  pendingSteps,
  validExecutionStep,
  type ExecutionActor,
  type ExecutionRules,
  type TargetView,
} from './execution';
import { SKILLS, WEAPONS, ROW_NAMES, DT, DEFAULT_CONFIG } from '../content/data';
import type { Ally, PlannedStep, PlanStep, State, Target, Sequence } from './types';

type Actor = Pick<
  Ally,
  'slot' | 'nextSlot' | 'queued' | 'action' | 'nextRow' | 'move' | 'shift' | 'atb'
> & {
  weapons: readonly [string, string];
  plan?: readonly PlannedStep[];
  draft?: readonly PlannedStep[];
};
export const committed = pendingSteps;
export const planned = (
  a: Parameters<typeof pendingSteps>[0] & { draft?: readonly PlannedStep[] },
) => [...pendingSteps(a), ...(a.draft ?? [])];
export const canExecuteSequence = (a: Pick<Ally, 'draft' | 'sequences' | 'hp' | 'action'>) =>
  a.hp > 0 &&
  !!a.draft?.length &&
  !a.sequences?.some((b) => !b.started) &&
  a.action?.skillId !== 'handoff';
export function projectedSlot(a: Actor) {
  let slot = a.nextSlot ?? a.slot;
  for (const step of planned(a)) if (step.kind === 'weapon') slot = step.slot;
  return slot;
}
export function projectedRow(a: Actor & Pick<Ally, 'row'>) {
  let row = a.nextRow ?? a.row;
  for (const p of planned(a)) if (p.kind === 'move') row = p.row;
  return row;
}
export const isHandoff = (p: PlanStep) => p.kind === 'skill' && p.skillId === 'handoff';
export const planCost = (p: PlanStep) =>
  p.kind === 'skill' ? (SKILLS[p.skillId]?.cost ?? Infinity) : 0;
export const plannedCost = (a: Parameters<typeof planned>[0]) =>
  planned(a).reduce((n, p) => n + planCost(p), 0);
/** Zero-ATB movement/items still occupy one entry; both bounds follow the ATB maximum. */
export function canAppend(
  a: Parameters<typeof planned>[0] & { action?: Ally['action'] },
  rules: Pick<State['config'], 'atbMax'>,
  cost = 0,
) {
  return (
    a.action?.skillId !== 'handoff' &&
    !planned(a).some(isHandoff) &&
    planned(a).length < rules.atbMax &&
    plannedCost(a) + cost <= rules.atbMax
  );
}
export function targetName(s: Pick<State, 'allies' | 'enemies'>, t: Target) {
  return t.kind === 'row'
    ? ROW_NAMES[t.row]
    : ((t.kind === 'ally' ? s.allies : s.enemies)[t.id]?.name ?? '対象なし');
}
export function stepName(a: { weapons: readonly [string, string] }, p: PlanStep) {
  return p.kind === 'skill'
    ? (SKILLS[p.skillId]?.name ?? '不明な技')
    : p.kind === 'move'
      ? `${ROW_NAMES[p.row]}へ移動`
      : `${WEAPONS[a.weapons[p.slot]].name}に変更`;
}
export function pendingPotions(
  allies: readonly {
    queued: Ally['queued'];
    plan?: readonly PlannedStep[];
    draft?: readonly PlannedStep[];
  }[],
) {
  return allies.reduce(
    (n, a) => n + planned(a).filter((p) => p.kind === 'skill' && p.skillId === 'potion').length,
    0,
  );
}
export interface PlanTiming {
  key: number;
  starts: number;
  ends: number;
  ready: number;
  linked: boolean;
  status: 'scheduled' | 'held' | 'draft' | 'invalid' | 'reset';
}
/** Conditional on visible targets and current party supply remaining unchanged.
 * Uses the runtime scheduler; future damage, interruption, and AI decisions are not predicted.
 * Times are battle seconds at normal fixed-step resolution (conservatively rounded per boundary at slow speed).
 */
export function planTiming(
  actor: Omit<ExecutionActor, 'plan' | 'draft' | 'sequences'> & {
    plan?: readonly PlannedStep[];
    draft?: readonly PlannedStep[];
    sequences?: readonly Readonly<Sequence>[];
  },
  inputRules: Pick<ExecutionRules, 'atbMax' | 'atbRate' | 'moveTime' | 'shiftTime'> &
    Partial<ExecutionRules>,
  view?: TargetView,
): PlanTiming[] {
  const rules = { ...DEFAULT_CONFIG, ...inputRules };
  const a = structuredClone(actor) as ExecutionActor;
  const queue = planned(a);
  const results = queue.map(
    (p) =>
      ({
        key: p.key,
        starts: Infinity,
        ends: Infinity,
        ready: Infinity,
        linked: false,
        status: a.draft?.some((d) => d.key === p.key)
          ? 'draft'
          : a.executionHeld
            ? 'held'
            : 'scheduled',
      }) as PlanTiming,
  );
  if (a.executionHeld || !queue.length) return results;
  const byKey = new Map(results.map((r) => [r.key, r]));
  let elapsed = 0;
  let current: PlanTiming | undefined;
  let transition: PlanTiming | undefined;
  let potions = view?.potions ?? Infinity;
  // Eight maximum-cost entries need far less than this even at minimum supply.
  for (let tick = 0; tick < 12000; tick++) {
    elapsed += DT;
    const head = committed(a)[0];
    const before = a.action;
    if (charging(a, rules)) a.atb = Math.min(rules.atbMax, a.atb + DT * rules.atbRate);
    advanceExecution(a, rules, DT, {
      valid: (p) => validExecutionStep(a, p, view ? { ...view, potions } : undefined),
      start: (p, comboIndex) => {
        if (current) current.ready = elapsed;
        current = byKey.get(p.key)!;
        current.starts = elapsed;
        current.linked = comboIndex > 1;
        a.atb = Math.max(0, a.atb - SKILLS[p.skillId].cost);
        if (p.skillId === 'potion') potions--;
        a.action = makeAction(a, p.skillId, p.target, comboIndex);
        return true;
      },
      impact: () => {
        if (current) current.ends = elapsed;
      },
      discarded: (p) => {
        byKey.get(p.key)!.status = 'invalid';
      },
      handoff: () => {
        for (const r of results)
          if (!Number.isFinite(r.starts) && r.status !== 'draft') r.status = 'reset';
      },
    });
    if (head && head.kind !== 'skill' && !planned(a).some((p) => p.key === head.key)) {
      transition = byKey.get(head.key)!;
      transition.starts = elapsed;
    }
    if (transition && a.nextRow === null && a.nextSlot === null) {
      transition.ends = transition.ready = elapsed;
      transition = undefined;
    }
    if (before && !a.action && current) {
      current.ready = elapsed;
      current = undefined;
    }
    if (!a.action && !committed(a).length && !transition) break;
  }
  return results;
}
