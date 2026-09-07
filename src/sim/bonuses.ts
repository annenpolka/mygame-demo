import { COMBAT_RULES } from '../content/rules';
import { WEAPONS } from '../content/data';
import type { Ally, BonusMode, Role, Row, Weapon } from './types';

export const BONUS_MODES = ['none', 'modest', 'strong'] as const;
export const BONUS_LABELS = { none: 'なし', modest: '控えめ', strong: '強め' };
export const BONUS_VALUES = {
  none: { A: 0, B: 0, D: 0, S: 0 },
  modest: { A: 0.1, B: 0.15, D: 0.1, S: 0.075 },
  strong: { A: 0.25, B: 0.3, D: 0.2, S: 0.15 },
};
export type RoleCounts = Record<Role, number>;
export function roleMultipliers(counts: RoleCounts, mode: BonusMode) {
  const v = BONUS_VALUES[mode];
  return {
    damage: 1 + counts.A * v.A,
    chain: 1 + counts.B * v.B,
    taken: (1 - v.D) ** counts.D,
    atb: 1 + counts.S * v.S,
  };
}
type Member = Pick<Ally, 'hp' | 'slot'> & { weapons: readonly string[] };
export function partyBonus(allies: readonly Member[], mode: BonusMode) {
  const counts: RoleCounts = { A: 0, B: 0, D: 0, S: 0 };
  for (const a of allies) if (a.hp > 0) counts[WEAPONS[a.weapons[a.slot]].role]++;
  return { counts, ...roleMultipliers(counts, mode) };
}
export function bonusText(b: ReturnType<typeof partyBonus>) {
  return `威力 ×${b.damage.toFixed(2)} · チェイン ×${b.chain.toFixed(2)} · 被害 ×${b.taken.toFixed(2)} · ATB ×${b.atb.toFixed(2)}`;
}

/** Position is independent of role; weapon traits compose only once. */
export function positionBonus(row: Row, weapon: Pick<Weapon, 'melee' | 'bonus'>) {
  return {
    damage:
      row === 'front' ? COMBAT_RULES.frontDamage : weapon.melee ? COMBAT_RULES.rearMeleeDamage : 1,
    chain:
      row === 'front'
        ? COMBAT_RULES.frontChain *
          (weapon.bonus === 'frontChain' ? COMBAT_RULES.weaponFrontChain : 1)
        : 1,
  };
}
