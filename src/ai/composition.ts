import { SKILLS, WEAPONS } from '../content/data';
import { partyBonus, positionBonus } from '../sim/bonuses';
import { command, copy } from '../sim/engine';
import type { Ally, BonusMode, Command, Slot, State } from '../sim/types';

export const LOADOUT_MODES = ['legacy', 'keep', 'adaptive', 'assault'] as const;
export type LoadoutMode = (typeof LOADOUT_MODES)[number];
export const LOADOUT_NAMES = {
  legacy: '従来の戦利品交換',
  keep: '持ち込みを維持',
  adaptive: '対応範囲を重視',
  assault: '攻撃・崩しへ特化',
};
export const SLOT_SETS: [Slot, Slot, Slot][] = Array.from(
  { length: 8 },
  (_, n) => [n & 1, (n >> 1) & 1, (n >> 2) & 1] as [Slot, Slot, Slot],
);
type Member = Pick<Ally, 'hp' | 'maxHp' | 'row' | 'slot'> & { weapons: readonly string[] };
export function teamOutput(
  allies: readonly Member[],
  slots: readonly Slot[],
  mode: BonusMode,
  rate: number,
) {
  const members = allies.map((a, id) => ({ ...a, slot: slots[id] })),
    bonus = partyBonus(members, mode);
  let damage = 0,
    chain = 0,
    heal = 0,
    ward = 0;
  for (const a of members) {
    if (a.hp <= 0) continue;
    const w = WEAPONS[a.weapons[a.slot]],
      skills = w.skills.map((id) => SKILLS[id]),
      position = positionBonus(a.row, w);
    const output = (sk: (typeof skills)[number], value: number) =>
      value /
      (sk.cast + ((sk.link ?? sk.recovery) + sk.recovery) / 2 + sk.cost / (rate * bonus.atb));
    damage +=
      Math.max(
        ...skills.map((sk) =>
          output(sk, sk.power * (['damage', 'push', 'pull'].includes(sk.effect) ? 1 : 0)),
        ),
      ) *
      bonus.damage *
      position.damage;
    chain += Math.max(...skills.map((sk) => output(sk, sk.chain))) * bonus.chain * position.chain;
    heal += Math.max(...skills.map((sk) => output(sk, sk.effect === 'heal' ? sk.power : 0)));
    ward += skills.some((sk) => sk.effect === 'shield') ? 1 : 0;
  }
  return { ...bonus, damage, chain, heal, ward };
}
/** Only legal replacements with currently unassigned inventory. Never duplicates a weapon. */
export function prepareLoadout(state: State, mode: LoadoutMode): Command[] {
  if (!['ready', 'loot'].includes(state.phase) || mode === 'keep') return [];
  const s = copy(state),
    commands: Command[] = [];
  const send = (c: Command) => {
    if (command(s, c)) commands.push(c);
  };
  if (mode === 'legacy') {
    if (s.phase === 'loot')
      for (const [id, weaponId] of [
        [0, 'hammer'],
        [1, 'starbow'],
      ] as const)
        if (s.inventory.includes(weaponId) && !s.allies.some((a) => a.weapons.includes(weaponId)))
          send({ type: 'equip', id, slot: 1, weaponId });
    return commands;
  }
  const used = new Set(s.allies.flatMap((a) => a.weapons));
  const spare = s.inventory.filter((w) => !used.has(w));
  let best = s.allies.map((a) => [...a.weapons] as [string, string]),
    bestScore = -Infinity;
  // Reserve choices do not affect the output of an identical active trio.
  // Keep this memo local: health, rows, inventory and rules may change next call.
  const outputMemo = new Map<string, ReturnType<typeof teamOutput>>();
  function score(weapons: string[][]) {
    const team = s.allies.map((a, i) => ({ ...a, weapons: weapons[i] }));
    const all = SLOT_SETS.map((slots) => {
      const key = slots.map((slot, id) => weapons[id][slot]).join(',');
      let output = outputMemo.get(key);
      if (!output) {
        output = teamOutput(team, slots, s.config.bonusMode, s.config.atbRate);
        outputMemo.set(key, output);
      }
      return output;
    });
    const d = Math.max(...all.map((o) => o.damage)),
      b = Math.max(...all.map((o) => o.chain));
    const h = Math.max(...all.map((o) => o.heal)),
      def = Math.max(...all.map((o) => (1 - o.taken) * 160 + o.ward * 18));
    // Value the available envelope, not only the weapons currently facing out.
    return mode === 'assault'
      ? d + b * 3 + h * 0.035 + def * 0.08
      : d + b * 6 + h * 0.85 + def * (s.config.encounterSet === 'attrition' ? 1.3 : 0.8);
  }
  function search(index: number, weapons: [string, string][], taken: Set<string>) {
    if (index === 6) {
      const value =
        score(weapons) -
        weapons.flat().filter((w, i) => w !== state.allies[Math.floor(i / 2)].weapons[i % 2])
          .length *
          0.01;
      if (value > bestScore + 1e-9) {
        bestScore = value;
        best = weapons.map((w) => [...w]);
      }
      return;
    }
    const id = Math.floor(index / 2),
      slot = index % 2;
    for (const w of [state.allies[id].weapons[slot], ...spare]) {
      if (taken.has(w)) continue;
      weapons[id][slot] = w;
      taken.add(w);
      search(index + 1, weapons, taken);
      taken.delete(w);
    }
  }
  search(
    0,
    s.allies.map((a) => [...a.weapons]),
    new Set(),
  );
  best.forEach((weapons, id) =>
    weapons.forEach((weaponId, slot) => {
      if (s.allies[id].weapons[slot] !== weaponId)
        send({ type: 'equip', id, slot: slot as Slot, weaponId });
    }),
  );
  const outputs = SLOT_SETS.map((slots) => ({
    slots,
    ...teamOutput(s.allies, slots, s.config.bonusMode, s.config.atbRate),
  }));
  const goals = [
    (o: (typeof outputs)[number]) => o.damage + o.chain * 1.3,
    (o: (typeof outputs)[number]) => o.chain * 5 + o.damage * 0.3,
    (o: (typeof outputs)[number]) => o.heal * 2 + o.damage + o.chain,
    (o: (typeof outputs)[number]) =>
      (1 - o.taken) * 500 + o.ward * 60 + o.heal * 0.7 + o.damage * 0.2,
  ];
  const assigned = new Set<string>();
  goals.forEach((evaluate, index) => {
    const picked =
      [...outputs]
        .sort((a, b) => evaluate(b) - evaluate(a))
        .find((o) => !assigned.has(o.slots.join(''))) ?? outputs[0];
    assigned.add(picked.slots.join(''));
    picked.slots.forEach((slot, id) => {
      if (s.presets[index].slots[id] !== slot) send({ type: 'editPreset', index, id, slot });
    });
  });
  return commands;
}
