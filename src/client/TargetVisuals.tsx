import type { CSSProperties } from 'react';
import { SKILLS, WEAPONS } from '../content/data';
import type { State, Target } from '../sim/types';
import { UnitEmblem } from './effects/UnitEmblem';

export function SkillIcon({
  skillId,
  symbol,
}: {
  skillId?: string;
  symbol?:
    | 'back'
    | 'front'
    | 'rear'
    | 'weapon'
    | 'optima'
    | 'menu'
    | 'check'
    | 'retry'
    | 'blocked'
    | 'slow';
}) {
  const skill = skillId ? SKILLS[skillId] : undefined;
  const effect = skill?.effect;
  const shape =
    symbol ??
    (effect === 'heal' || effect === 'potion'
      ? 'heal'
      : effect === 'guard' || effect === 'shield'
        ? 'shield'
        : effect === 'pull' || effect === 'push' || effect === 'evacuate'
          ? 'move'
          : 'blade');
  return (
    <svg
      className={`skill-icon icon-${shape}`}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shape === 'heal' ? (
        <path d="M12 5h8v7h7v8h-7v7h-8v-7H5v-8h7Z" />
      ) : shape === 'shield' ? (
        <>
          <path d="m16 3 11 4v10c0 6-11 12-11 12S5 23 5 17V7Z" />
          <path d="M16 9v13m-6-7h12" />
        </>
      ) : shape === 'blade' ? (
        <>
          <path d="m11 21 4-10L28 3l-7 14-10 4Zm-3-5 8 8M5 27l6-6m-8 4 4 4" />
          {skill?.target.endsWith('Row') && <path d="M3 10Q10 1 21 4M22 29q8-4 8-15" />}
        </>
      ) : shape === 'back' ? (
        <path d="m11 7-8 8 8 8M4 15h16q9 0 9 10" />
      ) : shape === 'front' || shape === 'move' ? (
        <>
          <path d="M4 16h23m-9-9 9 9-9 9M5 6v20" />
        </>
      ) : shape === 'rear' ? (
        <path d="M28 16H5m9-9-9 9 9 9M27 6v20" />
      ) : shape === 'weapon' ? (
        <>
          <path d="m5 26 8-9m-5-4 9 9m-5-5 4-8 10-5-5 10-8 4M5 7h6m-6 0 3-3M27 25h-6m6 0-3 3" />
        </>
      ) : shape === 'optima' ? (
        <>
          <path d="m16 3 7 9-7 9-7-9Zm-8 10-6 8 7 9 7-9m8-8 6 8-7 9-7-9" />
        </>
      ) : shape === 'menu' ? (
        <>
          <circle cx="7" cy="7" r="3" />
          <circle cx="25" cy="7" r="3" />
          <circle cx="7" cy="25" r="3" />
          <circle cx="25" cy="25" r="3" />
        </>
      ) : shape === 'check' ? (
        <path d="m6 17 7 7L27 7" />
      ) : shape === 'retry' ? (
        <>
          <path d="M26 13A11 11 0 1 0 26 22m0-18v9h-9" />
        </>
      ) : shape === 'slow' ? (
        <>
          <path d="M5 4h22M5 28h22M8 5c0 7 8 7 8 11S8 20 8 27M24 5c0 7-8 7-8 11s8 4 8 11" />
        </>
      ) : (
        <>
          <circle cx="16" cy="16" r="12" />
          <path d="m7 25 18-18" />
        </>
      )}
    </svg>
  );
}

export function UnitTargetMarks({
  side,
  marked,
  editing,
  candidate,
  dead,
  actor,
}: {
  side: 'ally' | 'enemy';
  marked: boolean;
  editing: boolean;
  candidate: boolean;
  dead: boolean;
  actor?: boolean;
}) {
  return (
    <>
      {(marked || candidate || actor) && (
        <svg
          className={`unit-target-marks ${side} ${candidate ? 'candidate' : ''} ${dead ? 'invalid' : ''}`}
          viewBox="0 0 64 68"
          fill="none"
          aria-hidden="true"
        >
          {(marked || candidate) &&
            (side === 'ally' ? (
              <ellipse className="target-floor" cx="32" cy="60" rx="29" ry="7" />
            ) : (
              <path className="target-floor" d="m2 59 14-8h33l13 8-13 8H16Z" />
            ))}
          {(marked || candidate) && dead && <path className="target-slash" d="m10 68 45-17" />}
          {actor && <path className="actor-marker" d="m24 0 8 9 8-9Z" />}
        </svg>
      )}
      {editing && (
        <span className={`target-edit-corners ${candidate ? 'candidate' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </>
  );
}

export function recipientUnits(s: State, target: Target | null | undefined, skillId: string) {
  if (!target) return [];
  const side =
    target.kind === 'row'
      ? SKILLS[skillId]?.target.startsWith('enemy')
        ? 'enemy'
        : 'ally'
      : target.kind;
  const units = side === 'ally' ? s.allies : s.enemies;
  return units
    .filter((u) => (target.kind === 'row' ? u.row === target.row && u.hp > 0 : u.id === target.id))
    .map((u) => ({ unit: u, side }));
}

export function RecipientPortraits({
  state: s,
  target,
  skillId,
  candidate = false,
  invalid = false,
}: {
  state: State;
  target?: Target | null;
  skillId: string;
  candidate?: boolean;
  invalid?: boolean;
}) {
  const recipients = recipientUnits(s, target, skillId);
  return (
    <span
      className={`recipient-portraits ${target?.kind === 'row' ? 'recipient-row' : ''} ${candidate ? 'candidate' : ''} ${invalid ? 'invalid' : ''}`}
      aria-hidden="true"
    >
      {recipients.map(({ unit, side }) => {
        const weapon = 'weapons' in unit ? WEAPONS[unit.weapons[unit.slot]] : null;
        const kind = weapon
          ? weapon.skills.includes('shot')
            ? 'bow'
            : weapon.skills.includes('jab')
              ? 'fist'
              : weapon.skills.includes('smash')
                ? 'hammer'
                : weapon.role
          : 'kind' in unit
            ? unit.kind
            : 'A';
        return (
          <span
            key={`${side}-${unit.id}`}
            className={`recipient-portrait ${side} ${unit.hp <= 0 ? 'invalid' : ''}`}
            style={{ '--unit-color': 'color' in unit ? unit.color : '#e7b494' } as CSSProperties}
          >
            <UnitEmblem id={`${side === 'ally' ? 'a' : 'e'}${unit.id}`} kind={kind} />
            <i>{'initial' in unit ? unit.initial : unit.name.slice(0, 1)}</i>
          </span>
        );
      })}
      {!recipients.length && (
        <span className="recipient-missing">
          <SkillIcon symbol="blocked" />
        </span>
      )}
    </span>
  );
}
