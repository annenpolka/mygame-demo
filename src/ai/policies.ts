import { createAdaptivePolicy } from './adaptive-policy';
import { DT, SKILLS, WEAPONS } from '../content/data';
import type { Command, Row, Target } from '../sim/types';
import type { Observation } from './observation';

export const POLICY_VERSION = 'policies-4';
export const ABLATIONS = ['none', 'no-pull', 'no-row', 'no-defense'] as const;
export type Ablation = (typeof ABLATIONS)[number];
export const LEGACY_POLICY_IDS = [
  'autopilot',
  'rush',
  'balanced',
  'rear',
  'tactician',
  'focus',
] as const;
export const POLICY_IDS = [...LEGACY_POLICY_IDS, 'adaptive', 'assault'] as const;
export type PolicyId = (typeof POLICY_IDS)[number];
export type CombatCommand = Command;
export interface Decision {
  reason: string;
  commands: CombatCommand[];
}
export interface Policy {
  decide(view: Observation): Decision;
}
export const POLICY_INFO: Record<PolicyId, { name: string; description: string }> = {
  adaptive: {
    name: '編成適応',
    description:
      '8通りの武器構成を評価。ロールの波及・HP・予告・ブレイクに応じて武器とオプティマを変更する。',
  },
  assault: {
    name: '攻勢特化',
    description: '攻撃とチェインを重視して構成を評価。必要な場面の退避・防御・救急薬は使う。',
  },
  autopilot: {
    name: '自動行動任せ',
    description: '初期ABS・初期隊列。対象はロールと戦況から自動選択。戦闘中の外部指示なし。',
  },
  rush: {
    name: '攻撃優先',
    description: '全員前列。ABBで崩し、ブレイク中はAAB。回復指示なし。',
  },
  balanced: {
    name: '均衡型',
    description: '既存AIの方針。HP72%未満でABS、それ以外はABB→AAB。隊列は維持。',
  },
  rear: {
    name: '後列維持',
    description: '全員後列のABSを維持。範囲予告にも移動しない。',
  },
  tactician: {
    name: '予告対応',
    description: '回復判断に復帰幅を設け、引き寄せ→列攻撃、列退避、追尾への防御、救急薬を使う。',
  },
  focus: {
    name: '時間操作併用',
    description: '予告対応と同じ方針。新しい攻撃予告を見た時、反応待ちの間だけスローを使う。',
  },
};

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
    !a.queued &&
    !a.action &&
    (['guard', 'potion'].includes(skillId) || weapon(a).skills.includes(skillId))
  );
}
function remainingAction(a: Actor) {
  return a.action?.remaining ?? 0;
}

export function createPolicy(
  id: PolicyId,
  reactionSeconds = 0.35,
  ablation: Ablation = 'none',
): Policy {
  if (id === 'adaptive' || id === 'assault') return createAdaptivePolicy(id, reactionSeconds, 1);
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
        commands.push({ type: 'skill', id: a.id, skillId, target });
        assigned.add(a.id);
        reasons.push(reason);
        return true;
      };

      // Pull a protected cannon out, or interrupt its movable cast. Hold enough ATB for the technique.
      const hook = alive(v).find((a) => weapon(a).skills.includes('pull') && !changing(a));
      const rear = targets(v).find(
        (e) => e.row === 'back' && e.kind !== 'guard' && e.steadfast === 0,
      );
      let interruptedEnemy: number | null = null;
      if (ablation !== 'no-pull' && hook && rear && usable(hook, 'pull')) {
        const arrival = Math.max(0, (2 - hook.atb) / v.rules.atbRate) + SKILLS.pull.cast + DT;
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
            SKILLS.guard.cast + DT < threat.cast.remaining
          )
            queue(a, 'guard', { kind: 'ally', id: a.id }, `${a.name}は追尾・退避困難な攻撃を防御`);
        }
      }

      // A single supplier uses a potion; other characters do not duplicate the reservation.
      const critical = alive(v)
        .filter((a) => healthy(a) < 0.3)
        .sort((a, b) => healthy(a) - healthy(b))[0];
      const potionPending = alive(v).some(
        (a) => a.queued?.skillId === 'potion' || a.action?.skillId === 'potion',
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
