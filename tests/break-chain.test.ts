import { describe, expect, it } from 'vitest';
import { BATTLE_TIMING, DT, SKILLS, VERSION } from '../src/content/data';
import { COMBAT_RULES } from '../src/content/rules';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { makeAction } from '../src/sim/execution';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import { playRules } from '../src/lab/playtest';

function broken() {
  const s = createState({ bonusMode: 'none' });
  command(s, { type: 'start' });
  for (const a of s.allies) a.executionHeld = true;
  for (const e of s.enemies) e.nextAttack = 999;
  s.enemies[0].broken = BATTLE_TIMING.breakDuration;
  s.enemies[0].chain = COMBAT_RULES.breakThreshold;
  return s;
}
function hit(s: ReturnType<typeof broken>, skillId: string) {
  const a = s.allies[0];
  a.action = makeAction(a, skillId, { kind: 'enemy', id: 0 });
  a.action.remaining = a.action.recovery + DT;
  step(s);
}

describe('chain growth during break', () => {
  it('keeps accumulating chain and increases subsequent damage without refreshing break time', () => {
    const s = broken();
    hit(s, 'spark');
    expect(s.enemies[0].chain).toBe(COMBAT_RULES.breakThreshold + SKILLS.spark.chain);
    expect(s.enemies[0].broken).toBeCloseTo(BATTLE_TIMING.breakDuration - DT);
    expect(s.metrics.breaks).toBe(0);
    const control = copy(s);
    control.enemies[0].chain = COMBAT_RULES.breakThreshold;
    const hp = s.enemies[0].hp;
    hit(s, 'slash');
    hit(control, 'slash');
    expect(hp - s.enemies[0].hp).toBeGreaterThan(hp - control.enemies[0].hp);
    expect(s.enemies[0].chain).toBe(200 + SKILLS.spark.chain + SKILLS.slash.chain);
  });
  it('caps at 500%, holds during break, and resets to 100% when the duration ends', () => {
    const s = broken();
    s.enemies[0].chain = COMBAT_RULES.chainMax - 1;
    hit(s, 'spark');
    expect(s.enemies[0].chain).toBe(500);
    s.allies[0].action = null;
    advance(s, 1);
    expect(s.enemies[0].chain).toBe(500);
    s.enemies[0].broken = DT;
    step(s);
    expect(s.enemies[0]).toMatchObject({ chain: 100, broken: 0, hold: 0 });
  });
  it('identifies the chain limit in rule fingerprints and replays post-break growth to the saved state', () => {
    expect(JSON.parse(playRules()).rules.chainMax).toBe(COMBAT_RULES.chainMax);
    const initial = broken();
    initial.allies[0].executionHeld = false;
    initial.allies[0].atb = 4;
    const session = new Session();
    session.restore(JSON.stringify({ version: VERSION, kind: 'snapshot', state: initial }));
    session.send({
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
    });
    for (let i = 0; i < 12; i++) session.advance(0.1);
    expect(session.state.enemies[0].chain).toBeGreaterThan(200);
    expect(session.state.enemies[0].broken).toBeGreaterThan(0);
    expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(
      parseSnapshot(session.snapshot()),
    );
  });
});
