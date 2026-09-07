import { describe, it, expect } from 'vitest';
import { createState, command, copy } from '../src/sim/engine';
import { makeAction } from '../src/sim/execution';
import { effectCues, actionCues, EFFECT_LIMIT } from '../src/client/effects/events';
import { noise } from '../src/client/effects/geometry';

const battle = () => {
  const s = createState();
  command(s, { type: 'start' });
  return s;
};
describe('visual causality and presentation bounds', () => {
  it('uses the active locked target for preparation and current row membership for area threats', () => {
    const s = battle();
    s.allies[0].action = makeAction(s.allies[0], 'slash', { kind: 'enemy', id: 1 });
    s.enemies[0].cast = {
      name: '列砲',
      target: 'row',
      row: 'back',
      allyId: 0,
      remaining: 1,
      total: 2,
      power: 50,
      movable: true,
      push: false,
    };
    expect(actionCues(s).find((c) => c.source === 'a0')?.targets).toEqual(['e1']);
    expect(actionCues(s).find((c) => c.source === 'e0')?.targets).toEqual(['a1', 'a2']);
    s.allies[1].row = 'front';
    expect(actionCues(s).find((c) => c.source === 'e0')?.targets).toEqual(['a2']);
    expect(effectCues(s)).toEqual([]);
    s.enemies[0].cast = null;
    expect(actionCues(s).some((c) => c.source === 'e0')).toBe(false);
  });
  it('keeps recovery separate from a second shot and does not draw dead or broken actors preparing', () => {
    const s = battle();
    s.allies[0].action = makeAction(s.allies[0], 'slash', { kind: 'enemy', id: 0 });
    s.allies[0].action.resolved = true;
    expect(actionCues(s)[0].recovery).toBe(true);
    s.allies[0].hp = 0;
    expect(actionCues(s)).toEqual([]);
  });
  it('uses resolved metadata even if the actor has begun a different skill', () => {
    const s = battle();
    s.time = 4;
    s.events = [
      {
        id: 1,
        time: 3.5,
        type: 'damage',
        text: 'localized',
        source: 'a0',
        target: 'e1',
        value: 125,
        visual: { skillId: 'shot', actionName: '矢', comboIndex: 2, shielded: true },
      },
      {
        id: 2,
        time: 3.6,
        type: 'action',
        text: 'wrong',
        source: 'a0',
        visual: { skillId: 'slash' },
      },
    ];
    expect(effectCues(s)[0]).toMatchObject({
      type: 'shot',
      target: 'e1',
      value: 125,
      label: '矢',
      combo: 2,
      shielded: true,
    });
  });
  it('retains number lanes after earlier hits fade and separates misses from hits', () => {
    const s = battle();
    s.events = [
      { id: 1, time: 1, type: 'damage', text: '', target: 'e0', value: 40 },
      { id: 2, time: 1.7, type: 'damage', text: '', target: 'e0', value: 55 },
      { id: 3, time: 2, type: 'system', text: '', target: 'a0', visual: { outcome: 'miss' } },
    ];
    s.time = 2;
    const lane = effectCues(s).find((c) => c.id === 2)!.lane;
    s.time = 2.1;
    expect(effectCues(s).find((c) => c.id === 2)!.lane).toBe(lane);
    expect(effectCues(s).find((c) => c.id === 3)).toMatchObject({ type: 'miss', value: undefined });
  });
  it('bounds bursts, rejects future events, and remains deterministic without mutating State', () => {
    const s = battle();
    s.time = 3;
    s.events = Array.from({ length: 160 }, (_, i) => ({
      id: i,
      time: 2.8,
      type: 'damage' as const,
      text: '',
      target: 'e0',
      value: i,
    }));
    const before = copy(s);
    expect(effectCues(s)).toHaveLength(EFFECT_LIMIT);
    expect(effectCues(s)).toEqual(effectCues(s));
    actionCues(s);
    expect(s).toEqual(before);
    expect(noise(123)).toBe(noise(123));
    s.time = 2;
    expect(effectCues(s)).toEqual([]);
  });
});
