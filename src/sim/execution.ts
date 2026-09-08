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
  | 'draft'
  | 'sequences'
  | 'executionHeld'
> & { weapons: readonly [string, string] };
export type TargetView = {
  allies: readonly { id: number; hp: number; maxHp: number; row: 'front' | 'back' }[];
  enemies: readonly { id: number; hp: number; row: 'front' | 'back' }[];
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
/** Drop empty groups, retaining the group whose final action/transition is still running. */
export function refreshSequences(a: ExecutionActor) {
  if (!a.sequences) return;
  a.sequences = a.sequences.filter(
    (sequence) =>
      pendingSteps(a).some((p) => p.sequenceId === sequence.key) ||
      (sequence.started &&
        (a.action?.sequenceId === sequence.key || a.nextRow !== null || a.nextSlot !== null)),
  );
}
export function sequenceCost(a: ExecutionActor, key: number) {
  return pendingSteps(a)
    .filter((p) => p.sequenceId === key)
    .reduce((sum, p) => sum + (p.kind === 'skill' ? SKILLS[p.skillId].cost : 0), 0);
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
      (!!executionTarget(view, a, sk, p.target) && (sk.effect !== 'potion' || view.potions > 0)))
  );
}
/** Keep a living destination; replace an absent one on the same side in stable ID order.
 * Explicit character handoffs and self actions do not select another actor.
 */
export function executionTarget(
  view: TargetView,
  a: Pick<Ally, 'id'>,
  skill: Skill,
  target: Target,
): Target | null {
  if (skill.target === 'self' || skill.effect === 'handoff')
    return validExecutionTarget(view, a, skill, target) ? target : null;
  const side = skill.target.startsWith('enemy') ? 'enemy' : 'ally';
  const row = skill.target.endsWith('Row');
  if (row ? target.kind !== 'row' : target.kind !== side) return null;
  const units = (side === 'enemy' ? view.enemies : view.allies).filter((u) => u.hp > 0);
  if (units.some((u) => (target.kind === 'row' ? u.row === target.row : u.id === target.id)))
    return target;
  const next = [...units].sort((a, b) => a.id - b.id)[0];
  return next ? (row ? { kind: 'row', row: next.row } : { kind: side, id: next.id }) : null;
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
    next.sequenceId === action.sequenceId &&
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
  if (a.action || a.nextRow !== null || a.shift > 0) return false;
  if (a.executionHeld) return a.nextSlot === null;
  const head = pendingSteps(a)[0];
  // Handoff overrides an unstarted weapon request. It must be able to earn its
  // ATB here, otherwise both the handoff and the weapon request would wait forever.
  if (head?.kind === 'skill' && head.skillId === 'handoff') return true;
  if (
    head?.sequenceId &&
    !a.sequences?.find((b) => b.key === head.sequenceId)?.started &&
    a.nextRow === null &&
    a.nextSlot === null
  )
    return true;
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
  handoff?: () => void;
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
  refreshSequences(a);
  const start = (p: PlannedStep & { kind: 'skill' }, comboIndex: number) => {
    if (!h.start(p, comboIndex)) return false;
    if (a.action && p.sequenceId !== undefined) a.action.sequenceId = p.sequenceId;
    return true;
  };
  // A direct row command starts at input, independently of the current action.
  // Entries still in a plan only reach nextRow after the scheduler starts them.
  // Keep the action's paid target, weapon, offense and recovery intact while moving.
  const moving = a.nextRow !== null;
  if (moving) {
    a.move += dt;
    if (a.move + 1e-9 >= rules.moveTime) {
      a.row = a.nextRow!;
      a.nextRow = null;
      a.move = 0;
      h.moved?.();
    }
  }
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
      start(next, action.comboIndex + 1)
    ) {
      pop(a);
      return;
    }
    if (action.remaining <= 1e-9) {
      a.action = null;
      refreshSequences(a);
    }
    return;
  }
  if (a.executionHeld && !moving && a.nextSlot === null) return;
  const head = pendingSteps(a)[0];
  if (
    !a.executionHeld &&
    head?.kind === 'skill' &&
    head.skillId === 'handoff' &&
    !moving &&
    !a.shift
  ) {
    if (!h.valid(head)) {
      pop(a);
      h.discarded?.(head);
    } else if (a.atb + 1e-9 >= SKILLS.handoff.cost && h.start(head, 1)) {
      // Only the handoff leaves the queue. Retain the actor's subsequent work,
      // sequence ownership and any direct weapon change waiting behind it.
      pop(a);
      h.handoff?.();
    }
    return;
  }
  let transitioning = moving;
  if (a.nextSlot !== null) {
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
  const sequence = a.sequences?.find((b) => b.key === head.sequenceId);
  if (sequence && !sequence.started) {
    if (!h.valid(head)) {
      pop(a);
      h.discarded?.(head);
      refreshSequences(a);
      return;
    }
    if (a.atb + 1e-9 < sequenceCost(a, sequence.key)) return;
    sequence.started = true;
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
  } else if (a.atb + 1e-9 >= SKILLS[head.skillId].cost && start(head, 1)) pop(a);
  refreshSequences(a);
}
