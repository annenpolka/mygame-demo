/** Shared values for combat and its explanations. Moving a value here does not rebalance it. */
export const COMBAT_RULES = {
  frontDamage: 1.25,
  frontChain: 1.25,
  rearMeleeDamage: 0.85,
  rearTaken: 0.72,
  shieldTaken: 0.5,
  weaponFrontChain: 1.2,
  weaponBreakDamage: 1.35,
  breakThreshold: 200,
  focusActivation: 4,
  slowScale: 0.25,
};
export const percent = (fraction: number) => Number((fraction * 100).toFixed(2));
