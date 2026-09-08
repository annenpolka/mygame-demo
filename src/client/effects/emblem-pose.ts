import type { ActionCue, EffectCue } from './events';
import { clamp } from './geometry';
import type { MovementCue } from './movement';

const smooth = (value: number) => {
  const t = clamp(Number.isFinite(value) ? value : 0);
  return t * t * (3 - 2 * t);
};

/** Pose only the figure's inner parts. Its measurement anchor never moves. */
export function emblemPose(
  id: string,
  action?: ActionCue,
  reaction?: EffectCue,
  movement?: Pick<MovementCue, 'phase' | 'progress'>,
) {
  const t = clamp(action?.progress ?? 0);
  const direction = id.startsWith('a') ? 1 : -1;
  const struck = !!reaction && reaction.value !== undefined && reaction.type !== 'heal';
  const recoil = struck ? Math.sin(clamp(reaction.age / 0.3) * Math.PI) * -direction * 9 : 0;
  const recovering = !!action?.recovery;
  const recovery = 1 - smooth(t);
  const physical = !!action && ['slash', 'impact', 'hit'].includes(action.type);
  const shooting = !!action && ['shot', 'blast'].includes(action.type);
  const channeling = !!action && ['magic', 'heal'].includes(action.type);
  const shielding = action?.type === 'shield';
  const draw = smooth(t / 0.52);
  const release = smooth((t - 0.52) / 0.48);
  const settle = recovering ? recovery : smooth(t / 0.35);
  const charge = channeling ? (recovering ? recovery : smooth(t)) : 0;
  const guard = shielding ? settle : 0;
  const walking = movement?.phase === 'moving';
  const stride = walking ? Math.sin(clamp(movement.progress) * Math.PI * 4) : 0;
  let x = 0,
    y = 0,
    tilt = 0,
    weaponAngle = 0,
    weaponX = 0,
    weaponY = 0,
    armAngle = 0,
    strike = 0;

  if (physical) {
    const heavy = action.type === 'impact' || action.type === 'hit';
    const endingAngle = heavy ? 26 : 32;
    x = direction * (recovering ? 5 * recovery : -2 * draw + 7 * release);
    tilt = direction * (recovering ? 7 * recovery : -4 * draw + 11 * release);
    weaponAngle =
      direction * (recovering ? endingAngle * recovery : -32 * draw + (endingAngle + 32) * release);
    weaponX = direction * (heavy ? (recovering ? 4 * recovery : -2 * draw + 6 * release) : 0);
    armAngle = weaponAngle * (heavy ? 0.25 : 0.15);
    strike = recovering ? 0 : Math.sin(release * Math.PI);
  } else if (shooting) {
    const drawBack = recovering ? recovery : draw * (1 - release);
    x = -direction * (recovering ? 3 * recovery : 3 * release);
    tilt = -direction * (recovering ? 3 * recovery : 3 * release);
    weaponX = -direction * (recovering ? 3 * recovery : 3 * release);
    armAngle = direction * (recovering ? 3 * recovery : -12 * drawBack + 3 * release);
    strike = recovering ? 0 : Math.sin(release * Math.PI);
  } else if (channeling) {
    y = -4 * charge;
    weaponY = -3 * charge;
    weaponAngle = -direction * 9 * charge;
    armAngle = -direction * 12 * charge;
  } else if (shielding) {
    y = 3 * guard;
    tilt = -direction * 5 * guard;
    weaponAngle = direction * 17 * guard;
    weaponX = direction * 3 * guard;
    armAngle = direction * 17 * guard;
  }

  return {
    struck,
    phase: struck
      ? 'hit'
      : !action
        ? walking
          ? 'walking'
          : 'idle'
        : recovering
          ? 'recover'
          : shielding
            ? 'brace'
            : channeling
              ? 'gather'
              : physical || shooting
                ? t < 0.52
                  ? 'windup'
                  : 'strike'
                : 'idle',
    x: x + recoil,
    y: y - Math.abs(stride) * 0.8,
    tilt: struck ? recoil : tilt,
    weaponAngle,
    weaponX,
    weaponY,
    armAngle,
    leftLegY: stride * 1.8,
    rightLegY: -stride * 1.8,
    charge,
    guard,
    strike,
    focusScale: 1.5 - charge * 0.75,
    focusTurn: 100 * charge,
    flash: struck ? clamp(1 - reaction.age / 0.25) : 0,
  };
}
