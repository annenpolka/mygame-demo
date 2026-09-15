import { BATTLE_TIMING, DT, SKILLS } from '../content/data';
import { partyBonus } from '../sim/bonuses';
import { canAppend, canExecuteSequence, planTiming, planned } from '../sim/plan';
import type { Ally, EnemyCast, PlannedStep, State } from '../sim/types';

export type GuardSource = 'shield' | 'committed' | 'draft' | 'preview';
export type GuardForecast = {
  /** Battle seconds until the soonest telegraphed hit on this ally. */
  hit: number;
  enemyId: number;
  source: GuardSource;
  /** The guard protects this hit: already active, or its 0.4s stance resolves first. */
  ready: boolean;
  /** Battle seconds until the guard resolves; Infinity when it would not start. */
  at: number;
  /** Why a late guard is late: waiting behind reservations, or ATB/recovery cannot be earned. */
  blocked?: 'queue' | 'atb' | 'full';
};

export const hitsAlly = (cast: EnemyCast, a: Pick<Ally, 'id' | 'row' | 'hp'>) =>
  a.hp > 0 &&
  (cast.target === 'all' || (cast.target === 'row' ? cast.row === a.row : cast.allyId === a.id));

/** The ally resolves before enemies inside one fixed step, so resolving on the hit tick protects it. */
const covers = (at: number, hit: number) =>
  at <= Math.ceil(hit / DT - 1e-6) * DT + 1e-6 && at + BATTLE_TIMING.guardDuration > hit + DT;

/**
 * Whether a guard protects this ally from the soonest telegraphed hit.
 * Uses the runtime execution scheduler with the current party ATB supply. The forecast assumes
 * the current reservations stay unchanged; it does not predict future AI actions or knockbacks.
 * `preview` is the result of adding a guard now and starting the drafts (the C → H input).
 */
export function guardForecast(s: State, allyId: number): GuardForecast | null {
  const a = s.allies[allyId];
  const threat = s.enemies
    .filter((e) => e.hp > 0 && e.cast && hitsAlly(e.cast, a))
    .sort((x, y) => x.cast!.remaining - y.cast!.remaining)[0];
  if (!a || !threat?.cast) return null;
  const hit = threat.cast.remaining;
  const base = { hit, enemyId: threat.id };
  if (a.shield > hit + DT) return { ...base, source: 'shield', ready: true, at: 0 };
  const rules = {
    ...s.config,
    atbRate: s.config.atbRate * partyBonus(s.allies, s.config.bonusMode).atb,
  };
  const guardStep = (key: number): PlannedStep => ({
    key,
    kind: 'skill',
    skillId: 'guard',
    target: { kind: 'ally', id: a.id },
  });
  const queue = planned(a);
  const existing = queue.find((p) => p.kind === 'skill' && p.skillId === 'guard');
  const inDraft = !!existing && !!a.draft?.some((d) => d.key === existing.key);
  const source: GuardSource = existing ? (inDraft ? 'draft' : 'committed') : 'preview';
  let at = Infinity;
  if (existing) {
    const timing = planTiming(a, rules, s).find((t) => t.key === existing.key)!;
    // A draft forecast is conditional on pressing start now; that start must be accepted.
    if (!inDraft || canExecuteSequence(a)) at = timing.ends;
  } else if (canAppend(a, s.config, SKILLS.guard.cost)) {
    const key = Math.max(0, ...queue.map((p) => p.key)) + 1;
    const preview = { ...a, draft: [...(a.draft ?? []), guardStep(key)] };
    if (canExecuteSequence(preview))
      at = planTiming(preview, rules, s).find((t) => t.key === key)!.ends;
  } else return { ...base, source, ready: false, at, blocked: 'full' };
  if (covers(at, hit)) return { ...base, source, ready: true, at };
  // Alone behind the running action: would clearing reservations make the stance in time?
  const alone = planTiming(
    { ...a, queued: null, plan: [guardStep(-1)], draft: [], sequences: [] },
    rules,
    s,
  )[0].ends;
  return { ...base, source, ready: false, at, blocked: covers(alone, hit) ? 'queue' : 'atb' };
}

const LEAD = { committed: '防御', draft: '開始で防御', preview: '防御なら' } as const;
const REASON = { queue: '予約待ち', atb: '間に合わない', full: '予約が満杯' } as const;

export function guardForecastText(f: GuardForecast) {
  if (f.source === 'shield') return '防護中 ✓ 軽減';
  return `${LEAD[f.source]} ${f.ready ? '✓ 間に合う' : `✗ ${REASON[f.blocked ?? 'atb']}`}`;
}

/** Full sentence for title and assistive reading. */
export function guardForecastDetail(f: GuardForecast) {
  const hit = `着弾まで${f.hit.toFixed(1)}秒`;
  if (f.source === 'shield') return `${hit}。防護・防御の効果中に着弾し、被ダメージを軽減します。`;
  const subject = {
    committed: '確定済みの防御',
    draft: '下書きの防御は、今すぐ行動開始すると',
    preview: '今すぐ防御を追加して行動開始すると',
  }[f.source];
  if (f.ready) return `${hit}。${subject}、${f.at.toFixed(1)}秒後に構えが完了し間に合います。`;
  const reason = {
    queue: '先に並んだ予約を待つため間に合いません。未開始の予約を取り消せば間に合います。',
    atb: '実行中の行動・硬直とATBの充填を待つため間に合いません。',
    full: '予約が満杯のため追加できません。',
  }[f.blocked ?? 'atb'];
  return `${hit}。${subject}、${reason}`;
}
