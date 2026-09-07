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
  target: number;
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
      'atbMax' | 'atbRate' | 'moveTime' | 'shiftTime' | 'enemyPower' | 'bonusMode'
    > & { baseAtbRate: number }
  >;
}

export function observe(s: State): Observation {
  return structuredClone({
    tick: s.tick,
    time: s.time,
    realTime: s.realTime,
    encounter: s.encounter,
    target: s.target,
    activePreset: s.activePreset,
    focus: s.focus,
    timeMode: s.timeMode,
    potions: s.potions,
    allies: s.allies,
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
        cast,
      }),
    ),
    presets: s.presets,
    rules: {
      atbMax: s.config.atbMax,
      atbRate: s.config.atbRate * partyBonus(s.allies, s.config.bonusMode).atb,
      baseAtbRate: s.config.atbRate,
      bonusMode: s.config.bonusMode,
      moveTime: s.config.moveTime,
      shiftTime: s.config.shiftTime,
      enemyPower: s.config.enemyPower,
    },
  });
}
