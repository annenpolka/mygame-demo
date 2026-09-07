import { DT, SKILLS, WEAPONS } from '../content/data';
import { canAppend, planned, projectedSlot, pendingPotions } from '../sim/plan';
import type { Command, Target } from '../sim/types';
import type { Observation } from './observation';
import { SLOT_SETS, teamOutput } from './composition';

export function createAdaptivePolicy(style: 'adaptive' | 'assault', reaction = 0.35, depth = 3) {
  let lastShift = -Infinity,
    stage = 0,
    waitUntil = 0;
  const seen = new Set<string>();
  return {
    decide(v: Observation): { reason: string; commands: Command[] } {
      const commands: Command[] = [],
        notes: string[] = [];
      if (stage !== v.encounter) {
        stage = v.encounter;
        lastShift = -Infinity;
        seen.clear();
        waitUntil = 0;
      }
      const live = v.allies.filter((a) => a.hp > 0),
        enemies = v.enemies.filter((e) => e.hp > 0);
      if (!enemies.length || !live.length) return { reason: '戦闘終了', commands };
      const casts = enemies.filter((e) => e.cast);
      for (const e of casts) {
        const key = `${e.id}:${Math.round((v.time - e.cast!.total + e.cast!.remaining) / DT)}`;
        if (!seen.has(key)) {
          seen.add(key);
          waitUntil = Math.max(waitUntil, v.realTime + reaction);
        }
      }
      if (v.realTime + 1e-8 < waitUntil) return { reason: '予告を確認：反応時間を待つ', commands };
      const target = [...enemies].sort(
        (a, b) =>
          (b.broken > 0 ? 10000 : 0) +
          (b.chain >= 180 ? 2000 : 0) +
          (b.kind === 'cannon' ? 400 : 0) -
          b.hp * 0.1 -
          ((a.broken > 0 ? 10000 : 0) +
            (a.chain >= 180 ? 2000 : 0) +
            (a.kind === 'cannon' ? 400 : 0) -
            a.hp * 0.1),
      )[0];
      if (v.target !== target.id) commands.push({ type: 'target', id: target.id });
      const health = Math.min(...live.map((a) => a.hp / a.maxHp));
      const hurt = live.reduce((sum, a) => sum + (a.maxHp - a.hp) / a.maxHp, 0) / live.length;
      const incoming = casts.reduce(
        (sum, e) => sum + (e.cast!.power * v.rules.enemyPower) / (e.cast!.remaining + 1),
        0,
      );
      const chainWeight = target.broken > 0 ? 0.12 : Math.min(12, 3 + target.hp / 250);
      const evaluate = (slots: (typeof SLOT_SETS)[number]) => {
        const o = teamOutput(v.allies, slots, v.rules.bonusMode, v.rules.baseAtbRate);
        const changes = live.filter((a) => slots[a.id] !== a.slot).length;
        const healWeight =
          style === 'assault'
            ? health < 0.3
              ? 1.8
              : 0.03
            : health < 0.45
              ? 3.5
              : health < 0.7
                ? 1.6
                : hurt * 0.6;
        const defenseWeight = style === 'assault' ? 0.25 : health < 0.55 ? 2 : 1;
        const offense = o.damage * (target.broken > 0 ? 1.8 : 1) + o.chain * chainWeight;
        const protection =
          (1 - o.taken) * (25 + incoming) * defenseWeight + o.ward * (casts.length ? 18 : 2);
        return offense + o.heal * healWeight + protection - changes * 8;
      };
      const current = v.allies.map((a) => a.slot) as (typeof SLOT_SETS)[number];
      // Evaluate each of the eight compositions once, preserving stable tie order.
      const ranked = SLOT_SETS.map((slots) => ({ slots, score: evaluate(slots) })).sort(
        (a, b) => b.score - a.score,
      );
      const best = ranked[0].slots;
      const transition = live.some(
        (a) => a.nextSlot !== null || planned(a).some((p) => p.kind === 'weapon'),
      );
      if (
        !transition &&
        v.time - lastShift >= 4 &&
        ranked[0].score >
          ranked.find((o) => o.slots.every((slot, id) => slot === current[id]))!.score * 1.12 + 3
      ) {
        const changed = live.filter((a) => a.slot !== best[a.id]);
        for (const a of changed)
          for (const p of planned(a)) commands.push({ type: 'removePlan', id: a.id, key: p.key });
        const index = v.presets.findIndex((p) => p.slots.every((slot, id) => slot === best[id]));
        if (index >= 0) commands.push({ type: 'optima', index });
        else
          for (const a of changed)
            commands.push({
              type: 'enqueue',
              id: a.id,
              step: { kind: 'weapon', slot: best[a.id] },
            });
        lastShift = v.time;
        return {
          reason: `${target.broken > 0 ? 'ブレイクを削る' : health < 0.7 ? '被害を整える' : '編成の出力を比較'}：${best.map((slot, i) => WEAPONS[v.allies[i].weapons[slot]].role).join('・')}へ`,
          commands,
        };
      }
      for (const a of live) {
        if (a.nextRow !== null || a.nextSlot !== null || projectedSlot(a) !== a.slot) continue;
        const w = WEAPONS[a.weapons[a.slot]],
          q = planned(a);
        const dangers = casts.filter(
          (e) =>
            e.cast!.target === 'all' ||
            (e.cast!.target === 'single' ? e.cast!.allyId === a.id : e.cast!.row === a.row),
        );
        const earliest = Math.min(...dangers.map((e) => e.cast!.remaining));
        const freeAt = a.action?.remaining ?? 0;
        const other = a.row === 'front' ? 'back' : 'front';
        const canEscape =
          dangers.length &&
          dangers.every((e) => e.cast!.target === 'row') &&
          !casts.some((e) => e.cast!.target === 'row' && e.cast!.row === other);
        const clear = () => {
          for (const p of q) commands.push({ type: 'removePlan', id: a.id, key: p.key });
        };
        if (canEscape && freeAt + v.rules.moveTime + DT < earliest) {
          clear();
          commands.push({ type: 'move', id: a.id, row: other });
          notes.push(`${a.name}：予告列を退避`);
          continue;
        }
        if (
          dangers.length &&
          a.shield < earliest &&
          freeAt + SKILLS.guard.cast + Math.max(0, (1 - a.atb) / v.rules.atbRate) + DT < earliest &&
          earliest < 3
        ) {
          if (
            !q.some((p) => p.kind === 'skill' && p.skillId === 'guard') &&
            a.action?.skillId !== 'guard'
          ) {
            clear();
            commands.push({
              type: 'enqueue',
              id: a.id,
              step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: a.id } },
            });
            notes.push(`${a.name}：被弾前に防御`);
          }
          continue;
        }
        if (q.length >= Math.min(depth, v.rules.atbMax) || !canAppend(a, v.rules)) continue;
        const hurtAlly = [...live].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        const potionReserved =
          pendingPotions(v.allies) +
          commands.filter(
            (c) => c.type === 'enqueue' && c.step.kind === 'skill' && c.step.skillId === 'potion',
          ).length;
        let skillId: string | undefined,
          aim: Target = { kind: 'enemy', id: target.id };
        if (
          hurtAlly.hp / hurtAlly.maxHp < 0.3 &&
          v.potions > potionReserved &&
          !live.some((x) => x.action?.skillId === 'potion')
        ) {
          skillId = 'potion';
          aim = { kind: 'ally', id: hurtAlly.id };
        } else {
          const skills = w.skills.map((id) => SKILLS[id]);
          const heal = skills.find((sk) => sk.effect === 'heal');
          const shield = skills.find((sk) => sk.effect === 'shield');
          const pull = skills.find((sk) => sk.effect === 'pull');
          const rear = enemies.find((e) => e.row === 'back' && e.kind !== 'guard' && !e.steadfast);
          if (heal && hurtAlly.hp / hurtAlly.maxHp < 0.82) {
            skillId = heal.id;
            aim = { kind: 'ally', id: hurtAlly.id };
          } else if (shield) {
            const protect = [...live]
              .filter((x) => x.shield < 1)
              .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
            if (protect) {
              skillId = shield.id;
              aim =
                shield.target === 'allyRow'
                  ? { kind: 'row', row: protect.row }
                  : { kind: 'ally', id: protect.id };
            }
          } else if (
            pull &&
            rear &&
            (!rear.cast ||
              rear.cast.remaining >
                freeAt + pull.cast + Math.max(0, (pull.cost - a.atb) / v.rules.atbRate))
          ) {
            skillId = pull.id;
            aim = { kind: 'enemy', id: rear.id };
          } else if (!heal) {
            const best = skills
              .filter((sk) => ['damage', 'push', 'pull'].includes(sk.effect))
              .sort((a, b) => {
                const worth = (sk: typeof a) => {
                  const count =
                    sk.target === 'enemyRow'
                      ? enemies.filter((e) => e.row === target.row).length
                      : 1;
                  return (
                    (count * (sk.power * (target.broken > 0 ? 1.8 : 1) + sk.chain * chainWeight)) /
                    (sk.cast + sk.recovery + sk.cost / v.rules.atbRate)
                  );
                };
                return worth(b) - worth(a);
              })[0];
            if (best) {
              skillId = best.id;
              aim =
                best.target === 'enemyRow'
                  ? { kind: 'row', row: target.row }
                  : { kind: 'enemy', id: target.id };
            }
          }
        }
        if (skillId && canAppend(a, v.rules, SKILLS[skillId].cost)) {
          if (
            q.some((p) => p.kind === 'skill' && p.skillId === skillId) &&
            ['heal', 'shield', 'potion', 'pull'].includes(SKILLS[skillId].effect)
          )
            continue;
          commands.push({
            type: 'enqueue',
            id: a.id,
            step: { kind: 'skill', skillId, target: aim },
          });
          notes.push(`${a.name}：${SKILLS[skillId].name}`);
        }
      }
      return { reason: notes.join(' / ') || '現在の編成を維持・行動の切れ目を待つ', commands };
    },
  };
}
