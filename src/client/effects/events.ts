import { SKILLS } from '../../content/data';
import type { State } from '../../sim/types';
export type VisualEffect =
  'slash' | 'shot' | 'magic' | 'impact' | 'hit' | 'heal' | 'shield' | 'move' | 'shift' | 'break';
export interface EffectCue {
  id: number;
  type: VisualEffect;
  target: string;
  source?: string;
  progress: number;
  value?: number;
  label: string;
}
/** Derived from resolved events only. Presentation never advances or mutates battle state. */
export function effectCues(s: State): EffectCue[] {
  return s.events
    .flatMap((event, index): EffectCue[] => {
      if (!event.target) return [];
      const age = s.time - event.time,
        duration = event.type === 'break' ? 1.3 : 0.8;
      if (age < 0 || age >= duration) return [];
      let type: VisualEffect,
        label = '';
      if (event.type === 'damage') {
        const action = s.events
          .slice(0, index)
          .reverse()
          .find((e) => e.type === 'action' && e.source === event.source);
        const skill = action
          ? Object.values(SKILLS).find((sk) => action.text.endsWith(`→ ${sk.name}`))
          : null;
        type = event.source?.startsWith('e')
          ? 'hit'
          : skill && ['shot', 'volley'].includes(skill.id)
            ? 'shot'
            : skill && ['spark', 'rain'].includes(skill.id)
              ? 'magic'
              : skill && ['jab', 'smash', 'push'].includes(skill.id)
                ? 'impact'
                : 'slash';
        label = skill?.name ?? '被弾';
      } else if (event.type === 'heal') {
        type = event.value === undefined ? 'shield' : 'heal';
        label = type === 'shield' ? '防護' : '回復';
      } else if (event.type === 'break') {
        type = 'break';
        label = 'BREAK';
      } else if (event.type === 'move') {
        type = 'move';
        label = event.text.includes('緊急')
          ? '緊急退避'
          : event.target.startsWith('e')
            ? '強制移動'
            : '移動';
      } else if (event.type === 'shift') {
        type = 'shift';
        label = '武器変更';
      } else return [];
      return [
        {
          id: event.id,
          type,
          target: event.target,
          source: event.source,
          progress: age / duration,
          value: event.value,
          label,
        },
      ];
    })
    .slice(-24);
}
