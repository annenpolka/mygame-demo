import { partyBonus } from '../sim/bonuses';
import type { Ally, Enemy, Preset, State } from '../sim/types';

export type ReadonlyDeep<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
  : T;

/** Only information exposed by the battle UI. No RNG or unannounced enemy timers. */
export interface Observation {
  tick: number;
  time: number;
  realTime: number;
  encounter: number;
  activePreset: number;
  focus: number;
  timeMode: State['timeMode'];
  potions: number;
  allies: ReadonlyDeep<Ally[]>;
  enemies: ReadonlyDeep<
    Pick<
      Enemy,
      | 'id'
      | 'name'
      | 'kind'
      | 'hp'
      | 'maxHp'
      | 'row'
      | 'chain'
      | 'hold'
      | 'broken'
      | 'steadfast'
      | 'cast'
    >[]
  >;
  presets: ReadonlyDeep<Preset[]>;
  rules: ReadonlyDeep<
    Pick<
      State['config'],
      | 'atbMax'
      | 'atbRate'
      | 'moveTime'
      | 'shiftTime'
      | 'enemyPower'
      | 'bonusMode'
      | 'atbMode'
      | 'chainActions'
    > & { baseAtbRate: number }
  >;
}

export function observe(s: State): Observation {
  return {
    tick: s.tick,
    time: s.time,
    realTime: s.realTime,
    encounter: s.encounter,
    activePreset: s.activePreset,
    focus: s.focus,
    timeMode: s.timeMode,
    potions: s.potions,
    allies: s.allies.map((a) => ({
      ...a,
      weapons: [...a.weapons],
      action: a.action
        ? { ...a.action, target: { ...a.action.target }, offense: { ...a.action.offense } }
        : null,
      queued: a.queued ? { ...a.queued, target: { ...a.queued.target } } : null,
      ...(a.draft
        ? {
            draft: a.draft.map((p) =>
              p.kind === 'skill' ? { ...p, target: { ...p.target } } : { ...p },
            ),
          }
        : {}),
      ...(a.sequences ? { sequences: a.sequences.map((b) => ({ ...b })) } : {}),
      ...(a.plan
        ? {
            plan: a.plan.map((p) =>
              p.kind === 'skill' ? { ...p, target: { ...p.target } } : { ...p },
            ),
          }
        : {}),
    })),
    enemies: s.enemies.map(
      ({ id, name, kind, hp, maxHp, row, chain, hold, broken, steadfast, cast }) => ({
        id,
        name,
        kind,
        hp,
        maxHp,
        row,
        chain,
        hold,
        broken,
        steadfast,
        cast: cast ? { ...cast } : null,
      }),
    ),
    presets: s.presets.map((p) => ({ ...p, slots: [...p.slots], rows: [...p.rows] })),
    rules: {
      atbMax: s.config.atbMax,
      atbRate: s.config.atbRate * partyBonus(s.allies, s.config.bonusMode).atb,
      baseAtbRate: s.config.atbRate,
      atbMode: s.config.atbMode,
      chainActions: s.config.chainActions,
      bonusMode: s.config.bonusMode,
      moveTime: s.config.moveTime,
      shiftTime: s.config.shiftTime,
      enemyPower: s.config.enemyPower,
    },
  };
}
