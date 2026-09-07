import { describe, expect, it } from 'vitest';
import { chooseTarget } from '../src/sim/targeting';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { makeAction } from '../src/sim/execution';
import { SKILLS, VERSION } from '../src/content/data';
import { observe } from '../src/ai/observation';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import type { State } from '../src/sim/types';

function battle() {
  const s = createState({ bonusMode: 'none' }, 'ai');
  command(s, { type: 'start' });
  for (const e of s.enemies) e.nextAttack = 1000;
  for (const a of s.allies) a.atb = 3;
  return s;
}
const target = (s: State, id: number, skill: string) =>
  chooseTarget(s, s.allies[id], SKILLS[skill], s.config.bonusMode);

describe('role and situation based targets', () => {
  it('A attacks a broken enemy while B builds the next break', () => {
    const s = battle();
    s.enemies[0].broken = 10;
    s.enemies[0].chain = 250;
    expect(target(s, 0, 'slash')).toEqual({ kind: 'enemy', id: 0 });
    expect(target(s, 1, 'spark')).toEqual({ kind: 'enemy', id: 1 });
  });
  it('A finishes a killable protected enemy before spending a break window elsewhere', () => {
    const s = battle();
    s.enemies[0].broken = 10;
    s.enemies[0].chain = 250;
    s.enemies[1].hp = 20;
    expect(target(s, 0, 'slash')).toEqual({ kind: 'enemy', id: 1 });
  });
  it('B prefers the enemy one hit from breaking over an untouched enemy', () => {
    const s = battle();
    s.enemies[1].chain = 190;
    expect(target(s, 1, 'spark')).toEqual({ kind: 'enemy', id: 1 });
  });
  it('B cooperates with an A action, but never treats a human draft as an active order', () => {
    const s = battle(),
      a = s.allies[0];
    a.draft = [{ key: 1, kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 1 } }];
    expect(target(s, 1, 'spark')).toEqual({ kind: 'enemy', id: 0 });
    a.action = makeAction(a, 'slash', { kind: 'enemy', id: 1 });
    expect(target(s, 1, 'spark')).toEqual({ kind: 'enemy', id: 1 });
  });
  it('A maintains the chain a B ally is building', () => {
    const s = battle(),
      b = s.allies[1];
    b.action = makeAction(b, 'spark', { kind: 'enemy', id: 1 });
    s.enemies[1].chain = 150;
    s.enemies[1].hold = 0.1;
    expect(target(s, 0, 'slash')).toEqual({ kind: 'enemy', id: 1 });
  });
  it('D protects an exposed rear ally from a visible attack instead of always choosing the front', () => {
    const s = battle();
    s.allies[0].slot = 1;
    s.enemies[1].cast = {
      name: '追尾',
      target: 'single',
      row: 'back',
      allyId: 2,
      remaining: 2,
      total: 2,
      power: 100,
      movable: false,
      push: false,
    };
    expect(target(s, 0, 'ward')).toEqual({ kind: 'ally', id: 2 });
    s.allies[2].shield = 5;
    expect(target(s, 0, 'ward')).toEqual({ kind: 'ally', id: 0 });
  });
  it('S accounts for a healing action already on its way and retargets to another hurt ally', () => {
    const s = battle();
    s.allies[0].hp -= 250;
    s.allies[1].hp -= 210;
    s.allies[0].action = makeAction(s.allies[0], 'heal', { kind: 'ally', id: 0 });
    expect(target(s, 2, 'heal')).toEqual({ kind: 'ally', id: 1 });
    s.allies[0].hp = s.allies[0].maxHp;
    s.allies[1].hp = s.allies[1].maxHp;
    expect(target(s, 2, 'heal')).toBeNull();
  });
  it('chooses a useful displacement and does not try to move a steadfast enemy', () => {
    const s = battle();
    s.allies[2].slot = 1;
    expect(target(s, 2, 'pull')).toEqual({ kind: 'enemy', id: 1 });
    s.enemies[1].steadfast = 3;
    expect(target(s, 2, 'pull')).toEqual({ kind: 'enemy', id: 0 });
  });
  it('scores the whole range, rejects dead enemies, and uses a stable tie order', () => {
    const s = battle();
    s.enemies[1].row = 'front';
    expect(target(s, 1, 'rain')).toEqual({ kind: 'row', row: 'front' });
    s.enemies[0].hp = 0;
    expect(target(s, 0, 'slash')).toEqual({ kind: 'enemy', id: 1 });
    s.enemies[1].hp = 0;
    expect(target(s, 0, 'slash')).toBeNull();
  });
  it('uses the same visible observations as the runtime without consuming RNG or mutating state', () => {
    const s = battle(),
      before = copy(s),
      v = observe(s);
    for (const a of v.allies) {
      expect(
        chooseTarget(
          v,
          a,
          SKILLS[a.id === 0 ? 'slash' : a.id === 1 ? 'spark' : 'heal'],
          v.rules.bonusMode,
        ),
      ).toEqual(target(s, a.id, a.id === 0 ? 'slash' : a.id === 1 ? 'spark' : 'heal'));
    }
    expect(s).toEqual(before);
    expect(v).toEqual(observe(s));
  });
});

describe('target selection boundaries', () => {
  it.each(['break', 'death'] as const)(
    'locks the current action and reconsiders AI-owned follow-ups after %s',
    (change) => {
      const s = battle(),
        a = s.allies[0];
      s.allies[1].executionHeld = true;
      s.allies[2].executionHeld = true;
      step(s);
      expect(a.action).toMatchObject({ target: { kind: 'enemy', id: 0 }, comboIndex: 1 });
      const paidAtb = a.atb;
      if (change === 'death') s.enemies[0].hp = 0;
      else {
        s.enemies[1].broken = 10;
        s.enemies[1].chain = 250;
      }
      advance(s, 0.5);
      expect(a.action).toMatchObject({ target: { kind: 'enemy', id: 0 }, resolved: false });
      advance(s, 0.7);
      expect(a.action).toMatchObject({ target: { kind: 'enemy', id: 1 }, comboIndex: 2 });
      expect(a.atb).toBeCloseTo(paidAtb - 1);
    },
  );
  it('preserves the targets in a human committed batch and a separate draft', () => {
    const s = battle(),
      a = s.allies[0];
    command(s, { type: 'control', mode: 'manual' });
    for (let i = 0; i < 2; i++)
      command(s, {
        type: 'draft',
        id: 0,
        step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
      });
    command(s, { type: 'executeSequence', id: 0 });
    command(s, {
      type: 'draft',
      id: 0,
      step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
    });
    step(s);
    s.enemies[1].broken = 10;
    s.enemies[1].chain = 250;
    advance(s, 1.2);
    expect(a.action).toMatchObject({ target: { kind: 'enemy', id: 0 }, comboIndex: 2 });
    expect(a.draft).toMatchObject([{ target: { kind: 'enemy', id: 0 } }]);
  });
  it('round-trips all automatic targeting through recorded inputs and rejects the removed shared target command', () => {
    const x = new Session({}, 'ai');
    x.send({ type: 'start' });
    for (let i = 0; i < 350; i++) x.advance(0.1);
    const recording = x.recording();
    expect(runReplay(parseRecording(JSON.stringify(recording)))).toEqual(x.state);
    expect(x.state).not.toHaveProperty('target');
    recording.inputs.push({ tick: 0, order: 10, command: { type: 'target', id: 1 } } as never);
    expect(() => parseRecording(JSON.stringify(recording))).toThrow();
    const old = { ...copy(x.state), version: 'orchestra-11', target: 0 };
    expect(VERSION).toBe('orchestra-12');
    expect(() =>
      parseSnapshot(JSON.stringify({ version: 'orchestra-11', kind: 'snapshot', state: old })),
    ).toThrow();
  });
});
