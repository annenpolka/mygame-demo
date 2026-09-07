import { SKILLS } from '../../content/data';
import type { State, Row } from '../../sim/types';
export type VisualEffect =
  | 'slash'
  | 'shot'
  | 'magic'
  | 'impact'
  | 'hit'
  | 'blast'
  | 'heal'
  | 'shield'
  | 'move'
  | 'shift'
  | 'break'
  | 'defeat'
  | 'interrupt'
  | 'miss'
  | 'resist';
export const EFFECT_LIMIT = 24;
export interface EffectCue {
  id: number;
  type: VisualEffect;
  target: string;
  source?: string;
  progress: number;
  age: number;
  value?: number;
  label: string;
  combo: number;
  shielded: boolean;
  fromRow?: Row;
  toRow?: Row;
  /** Stable lane assigned against the whole retained event window, not the fading subset. */
  lane: number;
}
export function skillEffect(id: string): VisualEffect {
  const skill = SKILLS[id];
  if (!skill) return 'slash';
  if (['heal', 'potion'].includes(skill.effect)) return 'heal';
  if (['shield', 'guard'].includes(skill.effect)) return 'shield';
  if (['evacuate', 'handoff'].includes(skill.effect)) return 'move';
  if (['shot', 'volley'].includes(id)) return 'shot';
  if (['spark', 'rain', 'pull'].includes(id)) return 'magic';
  if (['jab', 'smash', 'push'].includes(id)) return 'impact';
  return 'slash';
}
/** Pure, bounded, battle-clock-only presentation. No simulation RNG or wall-clock animation. */
export function effectCues(s: State): EffectCue[] {
  const lanes: Record<string, { until: number; lane: number }[]> = {};
  return s.events
    .flatMap((event): EffectCue[] => {
      if (!event.target) return [];
      const age = s.time - event.time;
      const duration = event.type === 'break' || event.visual?.outcome === 'defeat' ? 1.3 : 1.05;
      // Allocate against earlier overlapping events even after they expire, so a number never jumps.
      const occupied = (lanes[event.target] ?? []).filter((x) => x.until > event.time);
      const lane = [0, 1, 2, 3].find((i) => !occupied.some((x) => x.lane === i)) ?? 3;
      if (event.value !== undefined) occupied.push({ until: event.time + duration, lane });
      lanes[event.target] = occupied;
      if (age < 0 || age >= duration) return [];
      let type: VisualEffect,
        label = '';
      const v = event.visual;
      if (v?.outcome) {
        type = v.outcome;
        label = {
          defeat: event.target.startsWith('a') ? '戦闘不能' : '撃破',
          interrupt: '構えを中断',
          miss: '空振り',
          resist: '移動を防いだ',
        }[type];
      } else if (event.type === 'damage') {
        type = event.source?.startsWith('e')
          ? s.enemies.find((e) => `e${e.id}` === event.source)?.kind === 'cannon'
            ? 'blast'
            : 'hit'
          : skillEffect(v?.skillId ?? 'slash');
        label = v?.actionName ?? '被弾';
      } else if (event.type === 'heal') {
        type = event.value === undefined ? 'shield' : 'heal';
        label = v?.actionName ?? (type === 'shield' ? '防護' : '回復');
      } else if (event.type === 'break') {
        type = 'break';
        label = 'BREAK';
      } else if (event.type === 'move') {
        type = 'move';
        label =
          v?.skillId === 'evacuate'
            ? '緊急退避'
            : event.source && event.source !== event.target
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
          age,
          value: event.value,
          label,
          combo: v?.comboIndex ?? 1,
          shielded: v?.shielded ?? false,
          fromRow: v?.fromRow,
          toRow: v?.toRow,
          lane,
        },
      ];
    })
    .slice(-EFFECT_LIMIT);
}
export interface ActionCue {
  source: string;
  targets: string[];
  area?: { side: 'ally' | 'enemy'; row?: Row };
  type: VisualEffect;
  label: string;
  progress: number;
  remaining: number;
  hostile: boolean;
  recovery: boolean;
  combo: number;
}
export function actionCues(s: State): ActionCue[] {
  const cues: ActionCue[] = [];
  for (const a of s.allies) {
    if (a.hp <= 0 || !a.action) continue;
    const action = a.action,
      skill = SKILLS[action.skillId],
      target = action.target;
    const side = skill.target.startsWith('enemy') ? 'enemy' : 'ally';
    const units = side === 'enemy' ? s.enemies : s.allies;
    const remaining = action.resolved
      ? action.remaining
      : Math.max(0, action.remaining - action.recovery);
    const total = action.resolved ? action.recovery : action.cast;
    cues.push({
      source: `a${a.id}`,
      targets: units
        .filter(
          (u) => u.hp > 0 && (target.kind === 'row' ? u.row === target.row : u.id === target.id),
        )
        .map((u) => `${side === 'ally' ? 'a' : 'e'}${u.id}`),
      area: target.kind === 'row' ? { side, row: target.row } : undefined,
      type: skillEffect(skill.id),
      label: skill.name,
      progress: Math.max(0, Math.min(1, 1 - remaining / Math.max(0.001, total))),
      remaining,
      hostile: false,
      recovery: action.resolved,
      combo: action.comboIndex,
    });
  }
  for (const e of s.enemies) {
    if (e.hp <= 0 || e.broken > 0 || !e.cast) continue;
    const c = e.cast;
    cues.push({
      source: `e${e.id}`,
      targets: s.allies
        .filter(
          (a) =>
            a.hp > 0 &&
            (c.target === 'all' || (c.target === 'row' ? a.row === c.row : a.id === c.allyId)),
        )
        .map((a) => `a${a.id}`),
      area:
        c.target === 'single'
          ? undefined
          : { side: 'ally', row: c.target === 'row' ? c.row : undefined },
      type: e.kind === 'cannon' ? 'blast' : 'hit',
      label: c.name,
      progress: Math.max(0, Math.min(1, 1 - c.remaining / c.total)),
      remaining: c.remaining,
      hostile: true,
      recovery: false,
      combo: 1,
    });
  }
  return cues;
}
