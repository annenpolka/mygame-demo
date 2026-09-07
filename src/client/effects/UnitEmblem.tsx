import type { CSSProperties } from 'react';
import type { ActionCue, EffectCue } from './events';
import { clamp, PALETTE } from './geometry';

/** Fixed anchor with an independently posed figure: measurements never follow recoil. */
export function UnitEmblem({
  kind,
  action,
  reaction,
  id,
}: {
  kind: string;
  action?: ActionCue;
  reaction?: EffectCue;
  id: string;
}) {
  const t = action?.progress ?? 0;
  const struck = !!reaction && reaction.value !== undefined && reaction.type !== 'heal';
  const recoil = struck
    ? Math.sin(clamp(reaction!.age / 0.3) * Math.PI) * (id.startsWith('a') ? -1 : 1) * 9
    : 0;
  const lunge =
    action && !action.recovery
      ? Math.sin(clamp((t - 0.45) / 0.55) * Math.PI) * (action.hostile ? -1 : 1) * 10
      : 0;
  const lift =
    action && ['magic', 'heal', 'shield'].includes(action.type) && !action.recovery
      ? -4 * Math.sin(t * Math.PI)
      : 0;
  const recovering = action?.recovery ? 1 - t : 0;
  const style = {
    '--emblem-x': `${recoil + lunge}px`,
    '--emblem-y': `${lift}px`,
    '--emblem-tilt': `${struck ? recoil : recovering * 4}deg`,
    '--emblem-glow': reaction
      ? PALETTE[reaction.type]
      : action
        ? PALETTE[action.type]
        : 'transparent',
    '--emblem-flash': struck ? clamp(1 - reaction!.age / 0.25) : 0,
  } as CSSProperties;
  const enemy = ['guard', 'cannon', 'soldier'].includes(kind),
    shield = kind === 'D' || kind === 'guard';
  return (
    <span
      className={`field-symbol combat-emblem ${struck ? 'is-struck' : ''}`}
      style={style}
      data-pose={struck ? 'hit' : action ? (action.recovery ? 'recovery' : 'windup') : 'idle'}
    >
      <svg className="unit-figure" viewBox="0 0 64 68" aria-hidden="true">
        <ellipse className="emblem-ground" cx="32" cy="61" rx="24" ry="5" />
        <g className="emblem-body">
          {kind === 'cannon' ? (
            <>
              <path className="emblem-cloak" d="M22 27 12 57Q32 64 50 57L43 27 34 20Z" />
              <path className="emblem-metal" d="M23 15 28 6 39 9 43 20 35 29 24 24Z" />
              <path className="emblem-bright" d="m27 19 11-2-4 6Z" />
              <path className="emblem-metal" d="m17 34 33-5 4 13-34 5-9-4Z" />
              <path d="m20 35 2 10m19-14 2 12M8 40h9" />
              <circle className="emblem-core" cx="32" cy="35" r="4" />
            </>
          ) : (
            <>
              <path
                className="emblem-cloak"
                d={enemy ? 'M19 26 8 56 30 61 53 54 45 25Z' : 'M24 25 13 58 32 54 44 60 42 25Z'}
              />
              <path
                className="emblem-metal"
                d={shield ? 'M20 25 43 25 47 43 34 50 17 42Z' : 'M25 24 41 26 43 43 29 46 21 38Z'}
              />
              <path
                className="emblem-metal"
                d={
                  enemy
                    ? 'M22 15 27 6 39 7 44 17 38 26 25 23Z'
                    : 'M24 14 30 8 39 11 41 20 34 26 25 22Z'
                }
              />
              <path className="emblem-bright" d="m27 17 12-1-2 5-9-1Z" />
              <path className="emblem-limbs" d="m29 43-4 15m12-14 5 14M23 30l-8 11m26-11 9 10" />
              {shield ? (
                <>
                  <path className="emblem-metal" d="M7 29 22 25 29 34 24 49 15 55 6 43Z" />
                  <path className="emblem-bright" d="m11 32 8-2 6 6-7 13-7-8Z" />
                  <path d="M50 15v44m-4-41 4-11 4 11Z" />
                </>
              ) : kind === 'fist' || kind === 'hammer' ? (
                <>
                  {kind === 'hammer' ? (
                    <>
                      <path d="M47 20 39 57" />
                      <path className="emblem-metal" d="m35 10 23 5-3 15-23-5Z" />
                      <path d="m39 13-3 13m17-10-3 13" />
                    </>
                  ) : (
                    <>
                      <path className="emblem-metal" d="m6 29 13-4 8 10-7 13-16-6Z" />
                      <path className="emblem-metal" d="m44 27 13 3 3 11-12 5-8-9Z" />
                      <path d="m9 32 11 9m26-9 9 8" />
                    </>
                  )}
                </>
              ) : kind === 'B' || kind === 'S' ? (
                <>
                  <path d="m49 15-5 44" />
                  <path
                    className="emblem-core"
                    d={
                      kind === 'S'
                        ? 'm51 7 5 7-3 7-7 1-5-6 3-7Z'
                        : 'm50 6 3 9 8 3-9 4-4 9-3-9-7-4 9-3Z'
                    }
                  />
                </>
              ) : kind === 'bow' ? (
                <>
                  <path d="M48 12Q65 34 43 53L48 12M40 34h20m-4-3 4 3-4 3" />
                </>
              ) : (
                <>
                  <path className="emblem-blade" d="m45 37 8-28 4 1-5 29-4 5Z" />
                  <path d="m40 37 17 4m-10 0-3 10" />
                </>
              )}
            </>
          )}
          <path className="emblem-etch" d="m26 32 7 4 6-6m-11 10 6 2" />
        </g>
      </svg>
    </span>
  );
}
