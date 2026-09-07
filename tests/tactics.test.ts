import { it, expect } from 'vitest';
import { command, createState, copy } from '../src/sim/engine';
import { roleName } from '../src/sim/tactics';
import { SKILLS, WEAPONS } from '../src/content/data';
import { parseSnapshot } from '../src/lab/validation';
it('assigns only the existing guardian to D, keeping its skills, numbers and independent row choice', () => {
  expect(
    Object.values(WEAPONS)
      .filter((w) => w.role === 'D')
      .map((w) => w.id),
  ).toEqual(['shield']);
  expect(WEAPONS.shield.skills).toEqual(['ward', 'rampart']);
  expect(SKILLS.ward).toMatchObject({ cost: 1, cast: 0.7, recovery: 0.9, effect: 'shield' });
  const s = createState(),
    rows = s.allies.map((a) => a.row);
  command(s, { type: 'optima', index: 3 });
  expect(s.allies.map((a) => a.row)).toEqual(rows);
  expect(s.presets[3].name).toBe('崩し・防護・支援');
});
it('updates automatic names after slot, weapon and formation edits and preserves the name on replay import', () => {
  const s = createState();
  command(s, { type: 'labWeapons' });
  command(s, { type: 'equip', id: 0, slot: 1, weaponId: 'hammer' });
  command(s, { type: 'editPreset', index: 1, id: 0, slot: 1 });
  expect(s.presets[1].name).toBe('総崩し');
  expect(s.presets[3].name).toBe('崩しと支援');
  command(s, { type: 'editFormation', index: 0, id: 0, row: 'front' });
  expect(s.formations[0].name).toBe('前衛1・後衛2');
  const parsed = parseSnapshot(JSON.stringify({ kind: 'snapshot', version: s.version, state: s }));
  expect(parsed).toEqual(s);
  expect(roleName(['D', 'A', 'B'])).toBe(roleName(['A', 'D', 'B']));
});
it('one-touch weapon switching toggles the direct request independently of queue capacity', () => {
  const s = createState();
  command(s, { type: 'start' });
  const unchanged = copy(s.allies[0].weapons);
  for (let i = 0; i < 4; i++)
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
  const before = copy(s.allies[0].plan);
  for (let i = 0; i < 6; i++) {
    expect(command(s, { type: 'toggleWeapon', id: 0 })).toBe(true);
    expect(s.allies[0].nextSlot).toBe(i % 2 ? null : 1);
    expect(s.allies[0].plan).toEqual(before);
  }
  command(s, { type: 'cancelFirst', id: 0 });
  expect(s.allies[0].plan?.map((p) => p.key)).toEqual([2, 3, 4]);
  expect(s.allies[0].nextSlot).toBeNull();
  expect(s.allies[0].weapons).toEqual(unchanged);
});
