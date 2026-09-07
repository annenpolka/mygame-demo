import { SKILLS } from '../content/data';
import type { Action, Skill } from '../sim/types';

export const skillTiming = (skill: Skill) =>
  `発動${skill.cast}秒 + 硬直${skill.recovery}秒${skill.link !== undefined ? ` · 同技接続${skill.link}秒` : ''}`;
export function actionPhase(action: Action) {
  return action.resolved
    ? { label: '硬直', remaining: action.remaining, total: action.recovery }
    : {
        label: '発動まで',
        remaining: Math.max(0, action.remaining - action.recovery),
        total: action.cast,
      };
}
export function actionStatus(action: Action) {
  const phase = actionPhase(action);
  return `${SKILLS[action.skillId].name} · ${phase.label} ${phase.remaining.toFixed(1)}秒`;
}

import {
  canLink,
  pendingSteps,
  validExecutionStep,
  type ExecutionRules,
  type ExecutionActor,
  type TargetView,
} from '../sim/execution';
export function executionStatus(a: ExecutionActor, rules: ExecutionRules, view: TargetView) {
  if (a.hp <= 0) return '戦闘不能';
  const head = pendingSteps(a)[0];
  const hold = a.executionHeld ? ' · この一手で保留' : '';
  if (a.action) {
    if (a.action.resolved) {
      if (canLink(a, head, rules, !!head && validExecutionStep(a, head, view)))
        return `接続待ち ${Math.max(0, (SKILLS[a.action.skillId].link ?? 0) - (a.action.recovery - a.action.remaining)).toFixed(1)}秒 · 補充停止`;
      return `終了硬直 ${a.action.remaining.toFixed(1)}秒 · 補充停止${hold}`;
    }
    return `${a.action.comboIndex > 1 ? `連続${a.action.comboIndex}手目 · ` : ''}${actionStatus(a.action)} · 補充停止${hold}`;
  }
  if (
    a.move > 0 ||
    a.shift > 0 ||
    (!a.executionHeld && (a.nextRow !== null || a.nextSlot !== null))
  )
    return `${a.nextRow !== null ? '移動中' : '武器変更中'} · 補充停止`;
  if (a.executionHeld) return '実行保留中 · ATB充填';
  return a.atb >= rules.atbMax
    ? 'ATB満タン · 指示待ち'
    : head
      ? 'ATB不足待ち · 充填中'
      : '指示待ち · ATB充填中';
}
