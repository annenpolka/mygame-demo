import { WEAPONS } from '../content/data';
import type { State, Row, Role } from './types';

const names: Record<string, string> = {
  AAA: '総攻撃',
  AAB: '終幕の一撃',
  ABB: '崩しの連奏',
  BBB: '総崩し',
  ABS: '均衡の調べ',
  AAS: '攻撃と支援',
  BBS: '崩しと支援',
  ASS: '攻撃支援',
  BSS: '崩し支援',
  SSS: '総支援',
  AAD: '防護と猛攻',
  ABD: '防護と連撃',
  BBD: '防護と崩し',
  ADS: '攻撃・防護・支援',
  BDS: '崩し・防護・支援',
  ADD: '重装攻撃',
  BDD: '重装崩し',
  DDS: '重装支援',
  DSS: '防護と総支援',
  DDD: '総防護',
};
export const roleName = (roles: Role[]) => names[roles.slice().sort().join('')] ?? roles.join('・');
export const rowName = (rows: Row[]) => {
  const front = rows.filter((r) => r === 'front').length;
  return front === 0
    ? '全員後列'
    : front === rows.length
      ? '全員前列'
      : `前衛${front}・後衛${rows.length - front}`;
};
/** Names are derived from the equipped weapons, not from a manually maintained label. */
export function renameTactics(s: Pick<State, 'presets' | 'formations' | 'allies'>) {
  s.presets.forEach((p) => {
    p.name = roleName(p.slots.map((slot, id) => WEAPONS[s.allies[id].weapons[slot]].role));
  });
  s.formations.forEach((f) => {
    f.name = rowName(f.rows);
  });
}
