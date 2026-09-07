import { expect, it } from 'vitest';
import { DT, SKILLS, WEAPONS } from '../src/content/data';
import { positionBonus } from '../src/sim/bonuses';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { parseSnapshot } from '../src/lab/validation';
import { teamOutput } from '../src/ai/composition';
import type { Row } from '../src/sim/types';

function start(weaponId: string, row: Row) {
  const s = createState({ bonusMode: 'none', atbRate: 0.2 });
  command(s, { type: 'start' });
  s.allies.forEach((a) => (a.atb = 0));
  const a = s.allies[0];
  a.weapons[0] = weaponId;
  a.row = row;
  a.atb = 4;
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  const skillId = WEAPONS[weaponId].skills[0];
  expect(
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId, target: { kind: 'enemy', id: 0 } },
    }),
  ).toBe(true);
  step(s);
  return s;
}

it.each(['sword', 'staff', 'bow', 'hook', 'hammer', 'starbow'])(
  '%s applies universal front offense exactly once, with independent rear and weapon traits',
  (id) => {
    const front = start(id, 'front'),
      back = start(id, 'back');
    const frontBonus = positionBonus('front', WEAPONS[id]);
    expect(front.allies[0].action?.offense).toEqual(frontBonus);
    expect(frontBonus.damage).toBe(1.25);
    expect(frontBonus.chain).toBe(id === 'hammer' ? 1.5 : 1.25);
    const expectedRatio = 1.25 / (WEAPONS[id].melee ? 0.85 : 1);
    const cast = SKILLS[front.allies[0].action!.skillId].cast;
    advance(front, cast);
    advance(back, cast);
    const damage = (s: typeof front) =>
      s.events.find((e) => e.type === 'damage' && e.source === 'a0')!.value!;
    expect(Math.abs(damage(front) - damage(back) * expectedRatio)).toBeLessThanOrEqual(1.3);
    const countChain = (s: typeof front) => s.enemies[0].chain - 100;
    expect(countChain(front) / countChain(back)).toBeCloseTo(frontBonus.chain);
    const oFront = teamOutput([front.allies[0]], [0], 'none', 0.55);
    const oBack = teamOutput([back.allies[0]], [0], 'none', 0.55);
    expect(oFront.damage / oBack.damage).toBeCloseTo(expectedRatio);
    expect(oFront.chain / oBack.chain).toBeCloseTo(frontBonus.chain);
  },
);

it('uses the row at action start, including a move queued before it, and retains it after displacement', () => {
  const s = createState();
  command(s, { type: 'start' });
  s.enemies.forEach((e) => (e.nextAttack = 999));
  command(s, { type: 'enqueue', id: 0, step: { kind: 'move', row: 'back' } });
  command(s, {
    type: 'enqueue',
    id: 0,
    step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
  });
  advance(s, s.config.moveTime + DT * 2);
  expect(s.allies[0].action?.offense.damage).toBe(1.25 * 0.85);
  const control = copy(s);
  s.allies[0].row = 'front'; // Forced displacement during windup must not resnapshot offense.
  advance(s, SKILLS.slash.cast);
  advance(control, SKILLS.slash.cast);
  expect(s.enemies.map((e) => [e.hp, e.chain])).toEqual(
    control.enemies.map((e) => [e.hp, e.chain]),
  );
  expect(
    parseSnapshot(
      JSON.stringify({
        version: s.version,
        kind: 'snapshot',
        state: s,
        log: s.events.map((e) => ({ ...e, encounter: s.encounter })),
      }),
    ),
  ).toEqual(s);
});

it('does not increase healing or shield duration from the front', () => {
  for (const id of ['bell', 'shield']) {
    const results = (['front', 'back'] as const).map((row) => {
      const s = createState({ atbRate: 0.2 });
      command(s, { type: 'start' });
      s.allies.forEach((a) => {
        a.atb = 0;
        a.hp = 200;
      });
      const a = s.allies[0];
      a.weapons[0] = id;
      a.row = row;
      a.atb = 4;
      s.enemies.forEach((e) => (e.nextAttack = 999));
      const skillId = WEAPONS[id].skills[0];
      command(s, {
        type: 'enqueue',
        id: 0,
        step: { kind: 'skill', skillId, target: { kind: 'ally', id: 0 } },
      });
      advance(s, SKILLS[skillId].cast + DT * 2);
      return [a.hp, a.shield];
    });
    expect(results[0]).toEqual(results[1]);
  }
});
