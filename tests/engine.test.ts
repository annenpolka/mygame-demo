import { describe, expect, it } from 'vitest';
import { BATTLE_TIMING, DT, SKILLS, VERSION } from '../src/content/data';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import type { EnemyCast, State } from '../src/sim/types';
import { runReplay, Session } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';

function battle() {
  const s = createState();
  command(s, { type: 'start' });
  for (const e of s.enemies) e.nextAttack = 1000;
  return s;
}
function cast(overrides: Partial<EnemyCast> = {}): EnemyCast {
  return {
    name: 'test',
    target: 'row',
    row: 'front',
    allyId: 0,
    remaining: 0.3,
    total: 0.3,
    power: 100,
    movable: true,
    push: false,
    ...overrides,
  };
}
function tactic(s: State) {
  const target =
    s.enemies.find((e) => e.kind === 'cannon' && e.hp > 0) ?? s.enemies.find((e) => e.hp > 0);
  if (target && s.target !== target.id) command(s, { type: 'target', id: target.id });
  const hurt = s.allies.some((a) => a.hp > 0 && a.hp < a.maxHp * 0.72);
  const preset = hurt ? 0 : s.enemies.some((e) => e.broken > 0) ? 2 : 1;
  if (s.activePreset !== preset) command(s, { type: 'optima', index: preset });
}
describe('two clocks and resources', () => {
  it.each(['skill', 'enqueue'] as const)(
    '%s guard waits for ATB, spends one segment at start, and cannot repeat for free',
    (input) => {
      const s = battle(),
        a = s.allies[0];
      s.config.atbRate = 1;
      a.atb = 0.25;
      const guard = () =>
        command(
          s,
          input === 'enqueue'
            ? {
                type: 'enqueue',
                id: 0,
                step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
              }
            : { type: 'skill', id: 0, skillId: 'guard', target: { kind: 'ally', id: 0 } },
        );
      expect(guard()).toBe(true);
      expect(a.atb).toBe(0.25);
      advance(s, 0.5);
      expect(a.atb).toBeCloseTo(0.75);
      expect(a.action).toBeNull();
      expect(a.shield).toBe(0);
      advance(s, 0.3);
      expect(a.action?.skillId).toBe('guard');
      expect(a.atb).toBeCloseTo(0.05);
      expect(a.shield).toBe(0);
      advance(s, 0.4);
      expect(a.shield).toBeGreaterThan(BATTLE_TIMING.guardDuration - 0.1);
      expect(a.atb).toBeCloseTo(0.45);
      expect(guard()).toBe(true);
      advance(s, 0.1);
      expect(a.action?.resolved).toBe(true);
      expect(a.atb).toBeCloseTo(0.55);
      expect(s.events.filter((e) => e.type === 'action' && e.source === 'a0')).toHaveLength(1);
    },
  );
  it('tactical stop drains focus while ATB, movement, casts and status timers remain frozen', () => {
    const s = battle();
    s.allies[0].shield = 5;
    s.enemies[0].cast = cast();
    s.enemies[1].broken = 5;
    command(s, { type: 'move', id: 0, row: 'back' });
    command(s, { type: 'time', mode: 'stop' });
    const before = copy(s);
    advance(s, 2);
    expect(s.time).toBe(before.time);
    expect(s.realTime).toBeCloseTo(2);
    expect(s.focus).toBeCloseTo(72);
    expect(s.allies).toEqual(before.allies);
    expect(s.enemies).toEqual(before.enemies);
  });
  it('slow is quarter speed; switching slow to stop does not charge entry twice', () => {
    const s = battle();
    command(s, { type: 'time', mode: 'slow' });
    advance(s, 2);
    expect(s.time).toBeCloseTo(0.5);
    expect(s.focus).toBeCloseTo(88);
    command(s, { type: 'time', mode: 'stop' });
    expect(s.focus).toBeCloseTo(88);
  });
  it('system pause freezes both clocks and rejects tactical commands', () => {
    const s = battle();
    command(s, { type: 'time', mode: 'stop' });
    command(s, { type: 'pause', value: true });
    const before = copy(s);
    advance(s, 10);
    command(s, { type: 'move', id: 0, row: 'back' });
    expect(s).toEqual(before);
  });
  it('returns to normal on exhaustion without negative focus', () => {
    const s = battle();
    command(s, { type: 'time', mode: 'stop' });
    advance(s, 9);
    expect(s.focus).toBe(0);
    expect(s.timeMode).toBe('normal');
    expect(s.time).toBeGreaterThan(0);
  });
});
describe('commands and weapon boundaries', () => {
  it('selection inserts a handoff ahead of legacy reservations without charging early', () => {
    const s = battle();
    command(s, { type: 'skill', id: 0, skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    const before = copy(s.allies);
    command(s, { type: 'select', id: 1 });
    expect(s.allies[0].atb).toEqual(before[0].atb);
    expect(s.allies[0].action).toEqual(before[0].action);
    expect(s.allies[0].plan?.map((p) => p.kind === 'skill' && p.skillId)).toEqual([
      'handoff',
      'sweep',
    ]);
  });
  it('a skill outside the active weapon is unavailable even manually', () => {
    const s = battle();
    expect(
      command(s, { type: 'skill', id: 0, skillId: 'heal', target: { kind: 'ally', id: 0 } }),
    ).toBe(false);
    expect(s.allies[0].queued).toBeNull();
  });
  it('switching weapons cancels only incompatible unstarted skills and retains movement', () => {
    const s = battle();
    command(s, { type: 'skill', id: 0, skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    command(s, { type: 'move', id: 0, row: 'back' });
    command(s, { type: 'optima', index: 3 });
    expect(s.allies[0].queued).toBeNull();
    expect(s.allies[0].nextRow).toBe('back');
    expect(s.events.at(-2)?.text).toContain('予約を解除');
  });
  it('row and weapon commands commute and share the transition time', () => {
    const a = battle(),
      b = battle();
    command(a, { type: 'move', id: 0, row: 'back' });
    command(a, { type: 'optima', index: 3 });
    command(b, { type: 'optima', index: 3 });
    command(b, { type: 'move', id: 0, row: 'back' });
    advance(a, a.config.moveTime);
    advance(b, b.config.moveTime);
    expect(a.allies).toEqual(b.allies);
    expect(a.allies[0].row).toBe('back');
    expect(a.allies[0].slot).toBe(1);
    expect(a.allies[0].atb).toBeCloseTo(1 + a.config.moveTime * a.config.atbRate);
  });
  it('an executing attack completes before a weapon change or normal movement', () => {
    const s = battle();
    s.allies[0].atb = 4;
    command(s, { type: 'skill', id: 0, skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    step(s);
    command(s, { type: 'optima', index: 3 });
    command(s, { type: 'move', id: 0, row: 'back' });
    advance(s, 0.5);
    expect(s.allies[0].action?.skillId).toBe('sweep');
    expect(s.allies[0].row).toBe('front');
    expect(s.allies[0].slot).toBe(0);
    advance(s, SKILLS.sweep.cast + SKILLS.sweep.recovery + s.config.moveTime - 0.5);
    expect(s.allies[0].row).toBe('back');
    expect(s.allies[0].slot).toBe(1);
    expect(s.enemies[0].hp).toBeLessThan(s.enemies[0].maxHp);
  });
  it('repeating a destination does not restart movement', () => {
    const s = battle();
    command(s, { type: 'move', id: 0, row: 'back' });
    advance(s, 0.4);
    command(s, { type: 'move', id: 0, row: 'back' });
    advance(s, s.config.moveTime - 0.4);
    expect(s.allies[0].row).toBe('back');
  });
  it('an ATB-starved manual reservation prevents auto spending', () => {
    const s = battle();
    s.allies[0].atb = 0;
    command(s, { type: 'skill', id: 0, skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    advance(s, 2);
    expect(s.allies[0].queued?.skillId).toBe('sweep');
    expect(s.allies[0].atb).toBeCloseTo(2 * s.config.atbRate);
    expect(s.allies[0].action).toBeNull();
  });
  it('paid shielding persists after changing weapons', () => {
    const s = battle();
    s.allies[0].shield = 6;
    command(s, { type: 'optima', index: 3 });
    advance(s, 0.6);
    expect(s.allies[0].shield).toBeCloseTo(5.4);
  });
});
describe('formation and impact timing', () => {
  it('all rear is permitted and has no automatic promotion', () => {
    const s = battle();
    command(s, { type: 'formation', index: 0 });
    advance(s, 1);
    expect(s.allies.every((a) => a.row === 'back')).toBe(true);
    command(s, { type: 'optima', index: 1 });
    advance(s, 2);
    expect(s.allies.every((a) => a.row === 'back')).toBe(true);
  });
  it('row membership changes on movement completion, not at the input time', () => {
    const s = battle();
    s.enemies[0].cast = cast();
    command(s, { type: 'move', id: 0, row: 'back' });
    advance(s, 0.3);
    expect(s.allies[0].hp).toBe(1200);
    expect(s.allies[0].row).toBe('front');
  });
  it('a completed escape avoids a row hit, but cannot dodge a homing attack', () => {
    const a = battle(),
      b = battle();
    a.enemies[0].cast = cast({ remaining: 1, total: 1 });
    b.enemies[0].cast = cast({ remaining: 1, total: 1, target: 'single' });
    for (const s of [a, b]) {
      command(s, { type: 'move', id: 0, row: 'back' });
      advance(s, 1);
    }
    expect(a.allies[0].hp).toBe(1300);
    expect(b.allies[0].hp).toBe(1228);
  });
  it('a row attack includes enemies pulled in after the attack began', () => {
    const s = battle();
    s.allies[0].atb = 4;
    s.allies[2].slot = 1;
    s.allies[2].atb = 4;
    s.enemies[1].cast = cast({ row: 'back', remaining: 2.4, total: 2.4 });
    command(s, { type: 'skill', id: 0, skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    command(s, { type: 'skill', id: 2, skillId: 'pull', target: { kind: 'enemy', id: 1 } });
    advance(s, SKILLS.sweep.cast + 2 * DT);
    expect(s.enemies[1].row).toBe('front');
    expect(s.enemies[1].cast).toBeNull();
    expect(
      s.events.some((e) => e.source === 'a0' && e.target === 'e1' && e.type === 'damage'),
    ).toBe(true);
    expect(s.enemies[1].chain).toBeGreaterThan(100);
  });
  it('heavy guards require break before displacement; steadfast prevents chain displacement', () => {
    const s = battle();
    s.inventory.push('hammer');
    s.allies[0].weapons[0] = 'hammer';
    const hit = () => {
      s.allies[0].action = null;
      s.allies[0].atb = 4;
      command(s, { type: 'skill', id: 0, skillId: 'push', target: { kind: 'enemy', id: 0 } });
      advance(s, SKILLS.push.cast + 2 * DT);
    };
    hit();
    expect(s.enemies[0].row).toBe('front');
    s.enemies[0].broken = 8;
    hit();
    expect(s.enemies[0].row).toBe('back');
    s.allies[2].slot = 1;
    s.allies[2].atb = 4;
    command(s, { type: 'skill', id: 2, skillId: 'pull', target: { kind: 'enemy', id: 0 } });
    advance(s, SKILLS.pull.cast + 2 * DT);
    expect(s.enemies[0].row).toBe('back');
  });
  it('forced allied movement remains in place instead of restoring a past formation', () => {
    const s = battle();
    s.enemies[0].cast = cast({ target: 'single', push: true });
    advance(s, 0.4);
    expect(s.allies[0].row).toBe('back');
    advance(s, 2);
    expect(s.allies[0].row).toBe('back');
  });
  it('emergency evacuation interrupts an ally cast without refunding the spent ATB', () => {
    const s = battle();
    s.inventory.push('banner');
    s.allies[2].weapons[0] = 'banner';
    s.allies[2].atb = 4;
    s.allies[0].atb = 4;
    command(s, { type: 'skill', id: 0, skillId: 'sweep', target: { kind: 'row', row: 'front' } });
    command(s, {
      type: 'skill',
      id: 2,
      skillId: 'evacuate',
      target: { kind: 'row', row: 'front' },
    });
    advance(s, SKILLS.evacuate.cast + 2 * DT);
    expect(s.allies[0].row).toBe('back');
    expect(s.allies[0].action?.skillId).not.toBe('sweep');
    expect(s.allies[0].atb).toBeLessThan(2.3);
    expect(s.events.some((e) => e.source === 'a0' && e.type === 'damage')).toBe(false);
  });
});
describe('loot and full loop', () => {
  it('weapon instances cannot be equipped twice or changed in battle', () => {
    const s = createState();
    expect(command(s, { type: 'equip', id: 0, slot: 1, weaponId: 'staff' })).toBe(false);
    command(s, { type: 'start' });
    expect(command(s, { type: 'equip', id: 0, slot: 1, weaponId: 'shield' })).toBe(false);
  });
  it('two encounters can be won with a weapon update and the same simulation', () => {
    const s = createState();
    command(s, { type: 'start' });
    for (let i = 0; i < 180 * 60 && s.phase === 'battle'; i++) {
      if (i % 60 === 0) tactic(s);
      step(s);
    }
    expect(s.phase).toBe('loot');
    expect(s.inventory).toContain('hammer');
    expect(s.allies.every((a) => a.hp === a.maxHp)).toBe(true);
    command(s, { type: 'equip', id: 0, slot: 1, weaponId: 'hammer' });
    command(s, { type: 'equip', id: 1, slot: 1, weaponId: 'starbow' });
    command(s, { type: 'next' });
    expect(s.focus).toBe(100);
    for (let i = 0; i < 240 * 60 && s.phase === 'battle'; i++) {
      if (i % 60 === 0) tactic(s);
      step(s);
    }
    expect(s.phase).toBe('victory');
    expect(s.metrics.breaks).toBeGreaterThan(0);
  });
  it('all deaths end the run and recoverable selection skips fallen allies', () => {
    const s = battle();
    s.allies[0].hp = 0;
    step(s);
    expect(s.selected).toBe(1);
    s.allies.forEach((a) => (a.hp = 0));
    step(s);
    expect(s.phase).toBe('defeat');
  });
  it('items are consumed only when their action starts and never go negative', () => {
    const s = battle();
    s.potions = 1;
    command(s, { type: 'skill', id: 0, skillId: 'potion', target: { kind: 'ally', id: 0 } });
    command(s, { type: 'skill', id: 1, skillId: 'potion', target: { kind: 'ally', id: 0 } });
    step(s);
    expect(s.potions).toBe(0);
    expect(s.allies[1].action).toBeNull();
  });
});
describe('recordings and snapshots', () => {
  it('retry preserves the chosen weapons, edited presets and initial formation', () => {
    const session = new Session();
    session.send({ type: 'labWeapons' }, { type: 'equip', id: 0, slot: 1, weaponId: 'hammer' });
    session.send(
      { type: 'editPreset', index: 0, id: 0, slot: 1 },
      { type: 'formation', index: 0 },
      { type: 'start' },
    );
    expect(session.state.allies[0].slot).toBe(1);
    for (let i = 0; i < 120; i++) session.advance(DT);
    session.retry();
    expect(session.state.phase).toBe('ready');
    expect(session.state.time).toBe(0);
    expect(session.state.allies[0].weapons[1]).toBe('hammer');
    expect(session.state.presets[0].slots[0]).toBe(1);
    expect(session.state.allies.every((a) => a.row === 'back')).toBe(true);
  });
  it('replays the exact seeded result, including ordered inputs while time is stopped', () => {
    const session = new Session();
    session.send({ type: 'start' });
    for (let i = 0; i < 300; i++) session.advance(DT);
    session.send({ type: 'time', mode: 'stop' });
    session.send(
      { type: 'move', id: 0, row: 'back' },
      { type: 'optima', index: 1 },
      { type: 'select', id: 2 },
    );
    for (let i = 0; i < 120; i++) session.advance(DT);
    session.send({ type: 'pause', value: true });
    session.send({ type: 'pause', value: false });
    session.send({ type: 'time', mode: 'normal' });
    for (let i = 0; i < 600; i++) session.advance(DT);
    const replayed = runReplay(parseRecording(JSON.stringify(session.recording())));
    expect(replayed).toEqual(session.state);
  });
  it('snapshot restoration includes pending movement, actions and RNG state', () => {
    const session = new Session();
    session.send({ type: 'start' });
    session.send({ type: 'move', id: 0, row: 'back' });
    session.advance(0.1);
    const before = copy(session.state),
      text = session.snapshot();
    session.advance(0.1);
    session.restore(text);
    expect(session.state).toEqual(before);
    expect(parseSnapshot(text)).toEqual(before);
  });
  it('rejects corrupt, incompatible, oversized and out-of-order recordings', () => {
    const session = new Session();
    const freeGuardReplay = session.recording();
    freeGuardReplay.version = freeGuardReplay.initial.version = 'orchestra-1';
    expect(() => parseRecording(JSON.stringify(freeGuardReplay))).toThrow();
    const freeGuardSnapshot = JSON.parse(session.snapshot());
    freeGuardSnapshot.version = freeGuardSnapshot.state.version = 'orchestra-1';
    expect(() => parseSnapshot(JSON.stringify(freeGuardSnapshot))).toThrow();
    expect(() => session.restore('{')).toThrow();
    expect(() =>
      parseSnapshot(JSON.stringify({ version: 'older', kind: 'snapshot', state: session.state })),
    ).toThrow();
    expect(() =>
      parseSnapshot(
        JSON.stringify({
          version: VERSION,
          kind: 'snapshot',
          state: { ...session.state, focus: -1 },
        }),
      ),
    ).toThrow();
    const replay = session.recording();
    replay.inputs.push({ tick: 0, order: 5, command: { type: 'start' } });
    expect(() => parseRecording(JSON.stringify(replay))).toThrow();
    expect(() => parseRecording(' '.repeat(5_000_001))).toThrow();
  });
  it('random legal command sequences preserve numeric and equipment invariants', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = battle();
      s.rng = seed;
      let rng = seed;
      const rand = () => {
        rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
        return rng;
      };
      for (let i = 0; i < 3600 && s.phase === 'battle'; i++) {
        if (i % 10 === 0) {
          const id = rand() % 3;
          switch (rand() % 5) {
            case 0:
              command(s, { type: 'select', id });
              break;
            case 1:
              command(s, { type: 'move', id, row: rand() % 2 ? 'front' : 'back' });
              break;
            case 2:
              command(s, { type: 'optima', index: rand() % 4 });
              break;
            case 3:
              command(s, {
                type: 'time',
                mode: ['normal', 'slow', 'stop'][rand() % 3] as 'normal' | 'slow' | 'stop',
              });
              break;
            case 4:
              command(s, { type: 'skill', id, skillId: 'guard', target: { kind: 'ally', id } });
          }
        }
        step(s);
        for (const a of s.allies) {
          expect(a.hp).toBeGreaterThanOrEqual(0);
          expect(a.hp).toBeLessThanOrEqual(a.maxHp);
          expect(a.atb).toBeGreaterThanOrEqual(0);
          expect(a.atb).toBeLessThanOrEqual(4);
        }
        expect(s.focus).toBeGreaterThanOrEqual(0);
        expect(s.focus).toBeLessThanOrEqual(100);
      }
      expect(() =>
        parseSnapshot(JSON.stringify({ version: VERSION, kind: 'snapshot', state: s })),
      ).not.toThrow();
    }
  });
});
