import type { Config, Enemy, Row } from '../sim/types';
import { BATTLE_TIMING } from './data';

export const ENCOUNTER_SET_IDS = [
  'belfry',
  'bulwark',
  'crossfire',
  'pursuit',
  'attrition',
] as const;
export type EncounterSetId = (typeof ENCOUNTER_SET_IDS)[number];
type Pattern = 'default' | 'front' | 'back' | 'single' | 'all';
interface EnemyRecipe {
  name: string;
  kind: Enemy['kind'];
  row: Row;
  hp: number;
  first: number;
  pattern?: Pattern;
  cast?: number;
  interval?: number;
  power?: number;
}
interface EncounterSet {
  name: string;
  description: string;
  stages: [string, string];
  enemies: [EnemyRecipe[], EnemyRecipe[]];
}
const enemy = (
  name: string,
  kind: Enemy['kind'],
  row: Row,
  hp: number,
  first: number,
  extras: Partial<EnemyRecipe> = {},
): EnemyRecipe => ({ name, kind, row, hp, first, ...extras });
export const ENCOUNTER_SETS: Record<EncounterSetId, EncounterSet> = {
  belfry: {
    name: '鐘楼の関門',
    description: '基本の2連戦。列移動・引き寄せ・ブレイクを試す。',
    stages: ['鐘楼の関門', '夜渡りの包囲陣'],
    enemies: [
      [
        enemy('鐘楼の衛兵', 'guard', 'front', 1500, 3),
        enemy('灰の砲術師', 'cannon', 'back', 1250, 6),
      ],
      [
        enemy('鉄殻の衛兵', 'guard', 'front', 2000, 3),
        enemy('夜渡りの砲術師', 'cannon', 'back', 1650, 5),
        enemy('流浪の剣兵', 'soldier', 'front', 1300, 7),
      ],
    ],
  },
  bulwark: {
    name: '双盾の城門',
    description: '前衛の衛兵が2体。砲術師を引き出し、複数のブレイクをつなげる。',
    stages: ['双盾の城門', '重装の奥陣'],
    enemies: [
      [
        enemy('左翼の大盾', 'guard', 'front', 1800, 3),
        enemy('右翼の大盾', 'guard', 'front', 1700, 3.6),
        enemy('城門の砲手', 'cannon', 'back', 1400, 4.2),
      ],
      [
        enemy('左翼の鉄盾', 'guard', 'front', 2100, 2.8),
        enemy('右翼の鉄盾', 'guard', 'front', 2000, 3.4),
        enemy('城塞の砲手', 'cannon', 'back', 1650, 4),
      ],
    ],
  },
  crossfire: {
    name: '交差砲火',
    description: '前列砲・後列砲が同時に構える。退避先も危険になる戦場。',
    stages: ['交差砲火', '逃げ場のない砲列'],
    enemies: [
      [
        enemy('砲列の衛兵', 'guard', 'front', 1600, 2.6),
        enemy('後列狙いの砲手', 'cannon', 'back', 1250, 2.8, {
          pattern: 'back',
          cast: 2.1,
          interval: 3.4,
        }),
        enemy('前列狙いの砲手', 'cannon', 'back', 1250, 2.8, {
          pattern: 'front',
          cast: 2.1,
          interval: 3.4,
        }),
      ],
      [
        enemy('砲列の重衛兵', 'guard', 'front', 1850, 2.4),
        enemy('後列狙いの重砲', 'cannon', 'back', 1500, 2.6, {
          pattern: 'back',
          cast: 2,
          interval: 3.2,
        }),
        enemy('前列狙いの重砲', 'cannon', 'back', 1500, 2.6, {
          pattern: 'front',
          cast: 2,
          interval: 3.2,
        }),
      ],
    ],
  },
  pursuit: {
    name: '追撃の猟兵',
    description: '3体が個体追尾を連発。列回避が効かず、防御と回復の配分を問う。',
    stages: ['追撃の猟兵', '止まらない追跡'],
    enemies: [
      [
        enemy('一番槍の猟兵', 'soldier', 'front', 1200, 2, {
          pattern: 'single',
          interval: 2.8,
          power: 230,
        }),
        enemy('二番槍の猟兵', 'soldier', 'back', 1300, 2.6, {
          pattern: 'single',
          interval: 2.8,
          power: 230,
        }),
        enemy('三番槍の猟兵', 'soldier', 'front', 1400, 3.2, {
          pattern: 'single',
          interval: 2.8,
          power: 230,
        }),
      ],
      [
        enemy('先駆けの猟兵', 'soldier', 'front', 1400, 1.8, {
          pattern: 'single',
          interval: 2.6,
          power: 250,
        }),
        enemy('追い立ての猟兵', 'soldier', 'back', 1500, 2.4, {
          pattern: 'single',
          interval: 2.6,
          power: 250,
        }),
        enemy('追い詰めの猟兵', 'soldier', 'front', 1600, 3, {
          pattern: 'single',
          interval: 2.6,
          power: 250,
        }),
      ],
    ],
  },
  attrition: {
    name: '灰雨の消耗戦',
    description: '全体砲撃と追尾が重なる。集中力・救急薬・回復の持続力を試す。',
    stages: ['灰雨の消耗戦', '降り止まぬ灰雨'],
    enemies: [
      [
        enemy('灰雨の衛兵', 'guard', 'front', 1900, 3),
        enemy('灰雨の全域砲', 'cannon', 'back', 1700, 4, {
          pattern: 'all',
          cast: 3,
          interval: 3.8,
          power: 230,
        }),
        enemy('灰雨の剣兵', 'soldier', 'front', 1500, 5),
      ],
      [
        enemy('灰雨の重衛兵', 'guard', 'front', 2200, 2.8),
        enemy('灰雨の全域重砲', 'cannon', 'back', 1950, 3.8, {
          pattern: 'all',
          cast: 2.8,
          interval: 3.6,
          power: 250,
        }),
        enemy('灰雨の追撃兵', 'soldier', 'front', 1750, 4.8),
      ],
    ],
  },
};
export function encounterSet(config: Partial<Config>) {
  return ENCOUNTER_SETS[config.encounterSet ?? 'belfry'];
}
export function pressure(level = 1) {
  return { hp: 1.3 ** (level - 1), damage: 1.4 ** (level - 1) };
}
export function enemyRecipe(config: Partial<Config>, stage: 1 | 2, id: number) {
  return encounterSet(config).enemies[stage - 1][id];
}
export function createEnemies(config: Partial<Config>, stage: 1 | 2): Enemy[] {
  return encounterSet(config).enemies[stage - 1].map((r, id) => {
    const hp = Math.round(r.hp * pressure(config.encounterLevel).hp);
    return {
      id,
      name: r.name,
      kind: r.kind,
      row: r.row,
      hp,
      maxHp: hp,
      glyph: r.kind === 'guard' ? '♜' : r.kind === 'cannon' ? '♝' : '♞',
      chain: 100,
      hold: 0,
      broken: 0,
      nextAttack: r.first * BATTLE_TIMING.enemyIntervalScale,
      cast: null,
      steadfast: 0,
      attackCount: 0,
    };
  });
}
