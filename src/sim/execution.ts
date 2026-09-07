import { SKILLS, WEAPONS } from '../content/data';
import type { Action, Ally, Config, PlannedStep, Skill, Target } from './types';

export type ExecutionRules = Pick<
  Config,
  'atbMax' | 'atbRate' | 'moveTime' | 'shiftTime' | 'atbMode' | 'chainActions'
>;
export type ExecutionActor = Pick<
  Ally,
  | 'id'
  | 'hp'
  | 'atb'
  | 'row'
  | 'slot'
  | 'nextSlot'
  | 'nextRow'
  | 'move'
  | 'shift'
  | 'action'
  | 'queued'
  | 'plan'
  | 'executionHeld'
> & { weapons: readonly [string, string] };
export type TargetView = {
  allies: readonly { id: number; hp: number; maxHp: number }[];
  enemies: readonly { id: number; hp: number }[];
  potions: number;
};
export function pendingSteps(
  a: Pick<Ally, 'queued'> & { plan?: readonly PlannedStep[] },
): PlannedStep[] {
  return [
    ...(a.queued ? [{ key: 0, kind: 'skill' as const, ...a.queued }] : []),
    ...(a.plan ?? []),
  ];
}
export function validExecutionTarget(
  view: TargetView,
  a: Pick<Ally, 'id'>,
  skill: Skill,
  target: Target,
) {
  if (skill.target === 'enemy')
    return target.kind === 'enemy' && view.enemies.some((e) => e.id === target.id && e.hp > 0);
  if (skill.target === 'ally')
    return target.kind === 'ally' && view.allies.some((x) => x.id === target.id && x.hp > 0);
  if (skill.target === 'self') return target.kind === 'ally' && target.id === a.id;
  return target.kind === 'row' && (target.row === 'front' || target.row === 'back');
}
export function validExecutionStep(a: ExecutionActor, p: PlannedStep, view?: TargetView) {
  if (p.kind !== 'skill') return true;
  const sk = SKILLS[p.skillId];
  return (
    !!sk &&
    ['guard', 'potion', 'handoff', ...WEAPONS[a.weapons[a.slot]].skills].includes(p.skillId) &&
    (!view ||
      (validExecutionTarget(view, a, sk, p.target) && (sk.effect !== 'potion' || view.potions > 0)))
  );
}
export function makeAction(
  a: ExecutionActor,
  skillId: string,
  target: Target,
  comboIndex = 1,
): Action {
  const sk = SKILLS[skillId];
  return {
    skillId,
    target: { ...target },
    cast: sk.cast,
    recovery: sk.recovery,
    total: sk.cast + sk.recovery,
    remaining: sk.cast + sk.recovery,
    resolved: false,
    comboIndex,
    weaponId: a.weapons[a.slot],
    offense: { damage: 1, chain: 1 },
  };
}
export function canLink(
  a: ExecutionActor,
  next: PlannedStep | undefined,
  rules: ExecutionRules,
  valid: boolean,
) {
  const action = a.action;
  return !!(
    rules.chainActions &&
    !a.executionHeld &&
    action &&
    next?.kind === 'skill' &&
    SKILLS[action.skillId].link !== undefined &&
    next.skillId === action.skillId &&
    a.weapons[a.slot] === action.weaponId &&
    a.nextRow === null &&
    a.nextSlot === null &&
    a.atb + 1e-9 >= SKILLS[next.skillId].cost &&
    valid
  );
}
/** A pending queue alone never blocks charging. Active transition intervals do. */
export function charging(a: ExecutionActor, rules: ExecutionRules) {
  if (a.hp <= 0) return false;
  if (rules.atbMode === 'continuous') return true;
  if (a.action || a.move > 0 || a.shift > 0) return false;
  if (a.executionHeld) return true;
  const head = pendingSteps(a)[0];
  // Handoff overrides unstarted row/weapon orders, but can wait for its ATB.
  if (head?.kind === 'skill' && head.skillId === 'handoff') return true;
  return a.nextRow === null && a.nextSlot === null && (!head || head.kind === 'skill');
}
function pop(a: ExecutionActor) {
  if (a.queued) a.queued = null;
  else a.plan?.shift();
}
export interface ExecutionHooks {
  valid: (p: PlannedStep) => boolean;
  start: (p: PlannedStep & { kind: 'skill' }, comboIndex: number) => boolean;
  impact: (action: Action) => void;
  idle?: () => void;
  moved?: () => void;
  shifted?: () => void;
  discarded?: (p: PlannedStep) => void;
  handoff?: (removed: number) => void;
}
/** Shared fixed-interval scheduler for runtime, UI arrival times, and AI forecasts.
 * Charging is integrated by the caller from the beginning-of-interval party bonus.
 * Linking never clears the current action until validation, payment, and start succeed.
 */
export function advanceExecution(
  a: ExecutionActor,
  rules: ExecutionRules,
  dt: number,
  h: ExecutionHooks,
) {
  if (a.hp <= 0) return;
  if (a.action) {
    const action = a.action;
    action.remaining = Math.max(0, action.remaining - dt);
    if (!action.resolved && action.remaining <= action.recovery + 1e-9) {
      action.resolved = true;
      h.impact(action);
    }
    if (a.action !== action) return;
    const next = pendingSteps(a)[0];
    if (
      action.resolved &&
      action.remaining > 1e-9 &&
      action.recovery - action.remaining + 1e-9 >= (SKILLS[action.skillId].link ?? Infinity) &&
      canLink(a, next, rules, !!next && h.valid(next)) &&
      next.kind === 'skill' &&
      h.start(next, action.comboIndex + 1)
    ) {
      pop(a);
      return;
    }
    if (action.remaining <= 1e-9) a.action = null;
    return;
  }
  if (a.executionHeld && !a.move && !a.shift) return;
  const head = pendingSteps(a)[0];
  if (
    !a.executionHeld &&
    head?.kind === 'skill' &&
    head.skillId === 'handoff' &&
    !a.move &&
    !a.shift
  ) {
    if (!h.valid(head)) {
      pop(a);
      h.discarded?.(head);
    } else if (a.atb + 1e-9 >= SKILLS.handoff.cost && h.start(head, 1)) {
      const removed = pendingSteps(a).length - 1;
      a.plan = [];
      a.queued = null;
      a.nextRow = null;
      a.nextSlot = null;
      h.handoff?.(removed);
    }
    return;
  }
  let transitioning = false;
  if (a.nextRow !== null && (!a.executionHeld || a.move > 0)) {
    transitioning = true;
    a.move += dt;
    if (a.move + 1e-9 >= rules.moveTime) {
      a.row = a.nextRow;
      a.nextRow = null;
      a.move = 0;
      h.moved?.();
    }
  }
  if (a.nextSlot !== null && (!a.executionHeld || a.shift > 0)) {
    transitioning = true;
    a.shift += dt;
    if (a.shift + 1e-9 >= rules.shiftTime) {
      a.slot = a.nextSlot;
      a.nextSlot = null;
      a.shift = 0;
      h.shifted?.();
    }
  }
  if (transitioning || a.executionHeld) return;
  if (!head) {
    h.idle?.();
    return;
  }
  if (head.kind === 'move') {
    pop(a);
    a.nextRow = head.row === a.row ? null : head.row;
    a.move = 0;
  } else if (head.kind === 'weapon') {
    pop(a);
    a.nextSlot = head.slot === a.slot ? null : head.slot;
    a.shift = 0;
  } else if (!h.valid(head)) {
    pop(a);
    h.discarded?.(head);
  } else if (a.atb + 1e-9 >= SKILLS[head.skillId].cost && h.start(head, 1)) pop(a);
}
