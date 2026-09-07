import { SKILLS } from '../content/data';
import type { Action, Skill } from '../sim/types';

export const skillTiming = (skill: Skill) => `発動${skill.cast}秒 + 硬直${skill.recovery}秒`;
export function actionPhase(action: Action) {
  const skill = SKILLS[action.skillId];
  return action.resolved
    ? { label: '硬直', remaining: action.remaining, total: skill.recovery }
    : {
        label: '発動まで',
        remaining: Math.max(0, action.remaining - skill.recovery),
        total: skill.cast,
      };
}
export function actionStatus(action: Action) {
  const phase = actionPhase(action);
  return `${SKILLS[action.skillId].name} · ${phase.label} ${phase.remaining.toFixed(1)}秒`;
}
