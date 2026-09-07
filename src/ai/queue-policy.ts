import { createAdaptivePolicy } from './adaptive-policy';
import { committed as planned, planTiming, canAppend } from '../sim/plan';
import { DT, SKILLS, WEAPONS } from '../content/data';
import type { Command, Row, Target } from '../sim/types';
import type { Observation } from './observation';

export const QUEUE_POLICY_VERSION = 'queue-policy-4';
import { ABLATIONS, POLICY_IDS, type PolicyId, type Ablation } from './policies';
export type CombatCommand = Command;
export interface Decision {
  reason: string;
  commands: CombatCommand[];
}
export interface Policy {
  decide(view: Observation): Decision;
}

type Actor = Observation['allies'][number];
const weapon = (a: Actor) => WEAPONS[a.weapons[a.slot]];
const alive = (v: Observation) => v.allies.filter((a) => a.hp > 0);
const targets = (v: Observation) => v.enemies.filter((e) => e.hp > 0);
const otherRow = (row: Row): Row => (row === 'front' ? 'back' : 'front');
const healthy = (a: Actor) => a.hp / a.maxHp;

function preferredTarget(v: Observation) {
  // Preserve a stagger window; otherwise remove the rear cannon first.
  return (
    targets(v).find((e) => e.broken > 0) ??
    targets(v).find((e) => e.kind === 'cannon') ??
    targets(v)[0]
  );
}
function setPreset(v: Observation, commands: CombatCommand[], index: number) {
  if (v.activePreset !== index) commands.push({ type: 'optima', index });
}
function usable(a: Actor, skillId: string) {
  return (
    a.hp > 0 &&
    a.nextSlot === null &&
    a.nextRow === null &&
    (['guard', 'potion'].includes(skillId) || weapon(a).skills.includes(skillId))
  );
}
function remainingAction(a: Actor) {
  return a.action?.remaining ?? 0;
}

export function createQueuePolicy(
  id: PolicyId,
  reactionSeconds = 0.35,
  ablation: Ablation = 'none',
  depth = 3,
): Policy {
  if ((id === 'adaptive' || id === 'assault') && ablation !== 'none')
    throw new Error('新AIでは切除比較は未対応です。noneを指定してください。');
  if (id === 'adaptive' || id === 'assault')
    return createAdaptivePolicy(id, reactionSeconds, depth);
  if (!POLICY_IDS.includes(id)) throw new Error(`不明なAI: ${id}`);
  if (!ABLATIONS.includes(ablation)) throw new Error(`不明な切除条件: ${ablation}`);
  let healing = false;
  let previousEncounter = 0;
  let lastShift = -Infinity;
  let pendingUntil: number | null = null;
  let slowed = false;
  const seenCasts = new Set<string>();

  return {
    decide(v) {
      if (previousEncounter !== v.encounter) {
        previousEncounter = v.encounter;
        healing = false;
        lastShift = -Infinity;
        pendingUntil = null;
        slowed = false;
        seenCasts.clear();
      }
      const commands: CombatCommand[] = [];
      const reasons: string[] = [];
      if (id === 'autopilot') return { reason: '自動行動を継続', commands };
      if (id === 'rush' || id === 'balanced' || id === 'rear') {
        if (id === 'rush' || id === 'rear') {
          const row = id === 'rush' ? 'front' : 'back';
          if (alive(v).some((a) => (a.nextRow ?? a.row) !== row))
            commands.push({ type: 'formation', index: row === 'front' ? 2 : 0 });
        }
        const hurt = alive(v).some((a) => healthy(a) < 0.72);
        const broken = targets(v).some((e) => e.broken > 0);
        const index = id === 'rear' || (id === 'balanced' && hurt) ? 0 : broken ? 2 : 1;
        setPreset(v, commands, index);
        return {
          reason:
            id === 'rear'
              ? '後列で回復を維持'
              : index === 0
                ? 'HP72%未満：回復構成へ'
                : index === 2
                  ? 'ブレイクをHP削りに変換'
                  : 'ABBでチェインを伸ばす',
          commands,
        };
      }

      // Model observation and deliberation explicitly in REAL time for the paired tactical AIs.
      // Slow buys battle time only while this identical decision delay elapses.
      const casts = targets(v).filter((e) => e.cast);
      for (const e of casts) {
        const cast = e.cast!;
        const key = `${v.encounter}:${e.id}:${cast.name}:${Math.round((v.time - (cast.total - cast.remaining)) / DT)}`;
        if (!seenCasts.has(key)) {
          seenCasts.add(key);
          pendingUntil ??= v.realTime + reactionSeconds;
          if (
            id === 'focus' &&
            !slowed &&
            reactionSeconds > 0 &&
            v.timeMode === 'normal' &&
            v.focus > 8
          ) {
            commands.push({ type: 'time', mode: 'slow' });
            slowed = true;
          }
        }
      }
      if (pendingUntil !== null && v.realTime + 1e-8 < pendingUntil) {
        return { reason: '予告を観測：反応時間を待つ', commands };
      }
      if (pendingUntil !== null) {
        pendingUntil = null;
        if (slowed && v.timeMode !== 'normal') commands.push({ type: 'time', mode: 'normal' });
        slowed = false;
      }

      const t = preferredTarget(v);
      if (!t) return { reason: '標的なし', commands };
      if (alive(v).some((a) => healthy(a) < 0.55)) healing = true;
      if (alive(v).every((a) => healthy(a) >= 0.82)) healing = false;
      const nextPreset = healing ? 0 : t.broken > 0 ? 2 : 1;
      if (nextPreset !== v.activePreset && v.time - lastShift >= 1.2) {
        setPreset(v, commands, nextPreset);
        lastShift = v.time;
        reasons.push(
          healing
            ? 'HP55%で回復、82%で攻勢へ復帰'
            : nextPreset === 2
              ? 'ブレイク中の火力構成'
              : '崩し構成を維持',
        );
      }
      const shift = commands.find((c) => c.type === 'optima');
      const changing = (a: Actor) =>
        shift?.type === 'optima' && v.presets[shift.index].slots[a.id] !== a.slot;
      const assigned = new Set<number>();
      const queue = (a: Actor, skillId: string, target: Target, reason: string) => {
        if (assigned.has(a.id) || changing(a) || !usable(a, skillId)) return false;
        const emergency = skillId === 'guard' || skillId === 'potion';
        const plan = planned(a);
        let retained = plan;
        if (emergency) {
          if (
            a.action?.skillId === skillId ||
            plan.some((p) => p.kind === 'skill' && p.skillId === skillId)
          )
            return false;
          // Cancel unfinished offensive plans before appending a defensive action. No reordering.
          if (
            plan.some(
              (p) =>
                p.kind !== 'skill' || !['guard', 'potion', 'heal', 'greatHeal'].includes(p.skillId),
            )
          ) {
            for (const p of plan)
              if (
                p.kind === 'skill' &&
                !['guard', 'potion', 'heal', 'greatHeal'].includes(p.skillId)
              )
                commands.push({ type: 'removePlan', id: a.id, key: p.key });
          }
          const kept = plan.filter(
            (p) =>
              p.kind !== 'skill' || ['guard', 'potion', 'heal', 'greatHeal'].includes(p.skillId),
          );
          if (kept.length >= depth) return false;
          retained = kept;
        } else {
          if (
            plan.length >= depth ||
            plan.some((p) => p.kind === 'skill' && ['guard', 'potion'].includes(p.skillId))
          )
            return false;
          if (
            skillId === 'pull' &&
            (a.action?.skillId === 'pull' ||
              plan.some((p) => p.kind === 'skill' && p.skillId === 'pull'))
          )
            return false;
        }
        if (!canAppend({ queued: null, plan: retained }, v.rules, SKILLS[skillId].cost))
          return false;
        commands.push({ type: 'enqueue', id: a.id, step: { kind: 'skill', skillId, target } });
        assigned.add(a.id);
        reasons.push((a.action ? '行動中に予約：' : '') + reason);
        return true;
      };

      // Pull a protected cannon out, or interrupt its movable cast. Hold enough ATB for the technique.
      const hook = alive(v).find((a) => weapon(a).skills.includes('pull') && !changing(a));
      const rear = targets(v).find(
        (e) => e.row === 'back' && e.kind !== 'guard' && e.steadfast === 0,
      );
      let interruptedEnemy: number | null = null;
      if (ablation !== 'no-pull' && hook && rear && usable(hook, 'pull')) {
        const arrival = planTiming(
          {
            ...hook,
            draft: [],
            queued: null,
            plan: [
              ...planned(hook),
              { key: -1, kind: 'skill', skillId: 'pull', target: { kind: 'enemy', id: rear.id } },
            ],
          },
          v.rules,
          v,
        ).at(-1)!.ends;
        const interruptible = rear.cast?.movable && arrival < rear.cast.remaining;
        const protectedRear = targets(v).some(
          (e) => e.kind === 'guard' && e.row === 'front' && e.broken === 0,
        );
        if (interruptible || (!rear.cast && protectedRear)) {
          if (
            queue(
              hook,
              'pull',
              { kind: 'enemy', id: rear.id },
              interruptible
                ? `${rear.name}の構えを引き寄せで中断`
                : `${rear.name}を防護から外して前列へ集める`,
            ) &&
            interruptible
          )
            interruptedEnemy = rear.id;
        }
      }

      // Compare row danger at impact; never alternate just to restore a preferred formation.
      const rowDanger = (row: Row) =>
        casts.filter(
          (e) => e.id !== interruptedEnemy && e.cast?.target === 'row' && e.cast.row === row,
        );
      for (const a of ablation === 'no-defense' ? [] : alive(v)) {
        const dangers = rowDanger(a.row);
        const earliest = Math.min(...dangers.map((e) => e.cast!.remaining));
        if (
          dangers.length &&
          !rowDanger(otherRow(a.row)).length &&
          remainingAction(a) + (v.rules.moveTime - a.move) + DT < earliest &&
          a.nextRow === null &&
          !assigned.has(a.id)
        ) {
          commands.push({ type: 'move', id: a.id, row: otherRow(a.row) });
          assigned.add(a.id);
          reasons.push(`${a.name}を列攻撃から退避`);
        } else {
          const threat = casts.find(
            (e) =>
              e.id !== interruptedEnemy &&
              e.cast &&
              (e.cast.target === 'single'
                ? e.cast.allyId === a.id
                : e.cast.target === 'all' || e.cast.row === a.row),
          );
          if (
            threat?.cast &&
            a.shield < threat.cast.remaining &&
            planTiming(
              {
                ...a,
                draft: [],
                queued: null,
                plan: [
                  ...planned(a).filter(
                    (p) =>
                      p.kind !== 'skill' ||
                      ['guard', 'potion', 'heal', 'greatHeal'].includes(p.skillId),
                  ),
                  { key: -1, kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: a.id } },
                ],
              },
              v.rules,
              v,
            ).at(-1)!.ends < threat.cast.remaining
          )
            queue(a, 'guard', { kind: 'ally', id: a.id }, `${a.name}は追尾・退避困難な攻撃を防御`);
        }
      }

      // A single supplier uses a potion; other characters do not duplicate the reservation.
      const critical = alive(v)
        .filter((a) => healthy(a) < 0.3)
        .sort((a, b) => healthy(a) - healthy(b))[0];
      const potionPending = alive(v).some(
        (a) =>
          planned(a).some((p) => p.kind === 'skill' && p.skillId === 'potion') ||
          a.action?.skillId === 'potion',
      );
      if (critical && v.potions > 0 && !potionPending) {
        const supplier = alive(v).find(
          (a) => !assigned.has(a.id) && usable(a, 'potion') && !changing(a),
        );
        if (supplier)
          queue(
            supplier,
            'potion',
            { kind: 'ally', id: critical.id },
            `${critical.name}を救急薬で救援`,
          );
      }

      // Attack a group already present at the destination, leaving displacement to the hook user.
      const rows: Row[] = ['front', 'back'];
      const group = rows.find((row) => targets(v).filter((e) => e.row === row).length >= 2);
      if (group && ablation !== 'no-row')
        for (const a of alive(v)) {
          const skill = SKILLS[weapon(a).skills[1]];
          // Reserve before auto reaches its 2-segment threshold, or it always spends first.
          if (skill.effect === 'damage' && skill.target === 'enemyRow' && a.atb >= skill.cost - 1)
            queue(
              a,
              skill.id,
              { kind: 'row', row: group },
              `${ROW_NAMES_LOCAL[group]}の敵を${skill.name}でまとめて攻撃`,
            );
        }
      return { reason: reasons.join(' / ') || '現在の指示を継続', commands };
    },
  };
}
const ROW_NAMES_LOCAL: Record<Row, string> = { front: '前列', back: '後列' };
