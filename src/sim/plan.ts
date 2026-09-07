import { SKILLS, WEAPONS, ROW_NAMES, DT } from '../content/data';
import type { Ally, PlannedStep, PlanStep, State, Target } from './types';

export const PLAN_LIMIT = 6;
type Actor = Pick<
  Ally,
  'slot' | 'nextSlot' | 'queued' | 'action' | 'nextRow' | 'move' | 'shift' | 'atb'
> & { weapons: readonly [string, string]; plan?: readonly PlannedStep[] };
export function planned(a: {
  queued: Ally['queued'];
  plan?: readonly PlannedStep[];
}): PlannedStep[] {
  return [
    ...(a.queued ? [{ key: 0, kind: 'skill' as const, ...a.queued }] : []),
    ...(a.plan ?? []),
  ];
}
export function projectedSlot(a: Actor) {
  let slot = a.nextSlot ?? a.slot;
  for (const step of planned(a)) if (step.kind === 'weapon') slot = step.slot;
  return slot;
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
  allies: readonly { queued: Ally['queued']; plan?: readonly PlannedStep[] }[],
) {
  return allies.reduce(
    (n, a) => n + planned(a).filter((p) => p.kind === 'skill' && p.skillId === 'potion').length,
    0,
  );
}
/** Earliest execution using visible state only; no enemy outcomes are predicted. */
export function planTiming(
  a: Actor,
  rules: Pick<State['config'], 'atbRate' | 'moveTime' | 'shiftTime'>,
) {
  let elapsed =
    (a.action?.remaining ?? 0) +
    Math.max(
      a.nextRow ? rules.moveTime - a.move : 0,
      a.nextSlot !== null ? rules.shiftTime - a.shift : 0,
    );
  let atb = Math.min(4, a.atb + elapsed * rules.atbRate);
  return planned(a).map((step) => {
    if (step.kind === 'skill') {
      const skill = SKILLS[step.skillId];
      const wait = Math.max(0, (skill.cost - atb) / rules.atbRate);
      elapsed += wait + DT;
      atb = Math.min(4, atb + (wait + DT) * rules.atbRate) - skill.cost;
      const starts = elapsed;
      elapsed += skill.cast + DT;
      atb = Math.min(4, atb + (skill.cast + DT) * rules.atbRate);
      return { key: step.key, starts, ends: elapsed };
    }
    const starts = elapsed + DT;
    const duration = step.kind === 'move' ? rules.moveTime : rules.shiftTime;
    elapsed = starts + duration + DT;
    atb = Math.min(4, atb + (duration + 2 * DT) * rules.atbRate);
    return { key: step.key, starts, ends: elapsed };
  });
}
