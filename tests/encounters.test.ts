import { describe, it, expect } from 'vitest';
import { createState, command, advance, copy } from '../src/sim/engine';
import { BATTLE_TIMING, DT } from '../src/content/data';
import { ENCOUNTER_SET_IDS, pressure } from '../src/content/encounters';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording, parseSnapshot } from '../src/lab/validation';
import { runPolicy } from '../src/ai/runner';

function runSeconds(session: Session, seconds: number) {
  for (let i = 0; i < seconds / DT; i++) session.advance(DT);
}
describe('persistent battle log', () => {
  it('retains overwritten reservations beyond the engine ring and roundtrips snapshot/replay', () => {
    const session = new Session();
    session.send({ type: 'start' });
    for (let i = 0; i < 220; i++)
      session.send({ type: 'skill', id: 0, skillId: 'guard', target: { kind: 'ally', id: 0 } });
    expect(session.state.events).toHaveLength(160);
    expect(session.log.length).toBeGreaterThan(220);
    expect(session.log[0].text).toContain('戦闘開始');
    const before = copy(session.log),
      saved = session.snapshot();
    const replay = new Session();
    replay.replay(JSON.stringify(session.recording()));
    expect(replay.log).toEqual(before);
    runSeconds(session, 3);
    session.restore(saved);
    expect(session.log).toEqual(before);
    runSeconds(session, 3);
    expect(new Set(session.log.map((e) => e.id)).size).toBe(session.log.length);
    session.retry();
    expect(session.log.length).toBe(before.slice(-160).length);
    session.reset();
    expect(session.log).toEqual([]);
  });
  it('reconstructs both encounter tags and rejects malformed archived logs', () => {
    const run = runPolicy({ policy: 'tactician' });
    const session = new Session();
    session.replay(JSON.stringify(run.recording));
    expect(session.log).toEqual(run.events);
    const before = copy(session.state);
    const invalid = JSON.parse(session.snapshot());
    invalid.log[1].id = invalid.log[0].id;
    expect(() => session.restore(JSON.stringify(invalid))).toThrow('戦闘ログ');
    expect(session.state).toEqual(before);
    const snapshot = JSON.parse(session.snapshot());
    delete snapshot.log;
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(session.state);
  });
});
describe('fixed encounter pressure sets', () => {
  it('keeps the default encounter optional and replays the current rules exactly', () => {
    expect(createState().config).not.toHaveProperty('encounterSet');
    const run = runPolicy({ policy: 'tactician', seed: 1307 });
    expect(run.summary.outcome).toBe('victory');
    expect(run.finalState.controlMode).toBe('ai');
    expect(runReplay(parseRecording(JSON.stringify(run.recording)))).toEqual(run.finalState);
  });
  it.each(ENCOUNTER_SET_IDS)(
    '%s supports two stages, pressure and exact input replay',
    (encounterSet) => {
      const one = createState({ encounterSet, encounterLevel: 1 }),
        ten = createState({ encounterSet, encounterLevel: 10 });
      expect(ten.enemies[0].hp).toBe(Math.round(one.enemies[0].hp * pressure(10).hp));
      const run = runPolicy({ policy: 'focus', encounterSet, encounterLevel: 2 });
      expect(run.summary.replayVerified).toBe(true);
      expect(run.summary.rejectedCommands).toBe(0);
      expect(runReplay(parseRecording(JSON.stringify(run.recording)))).toEqual(run.finalState);
      one.phase = 'loot';
      command(one, { type: 'next' });
      expect(one.enemies.every((e) => e.hp === e.maxHp)).toBe(true);
      expect(one.encounter).toBe(2);
    },
  );
  it('crossfire warns both rows simultaneously, pursuit homes, and ash cannon targets everyone', () => {
    const crossfire = createState({ encounterSet: 'crossfire' });
    command(crossfire, { type: 'start' });
    advance(crossfire, 2.8 * BATTLE_TIMING.enemyIntervalScale + 2 * DT);
    expect(crossfire.enemies.slice(1).map((e) => [e.cast?.target, e.cast?.row])).toEqual([
      ['row', 'back'],
      ['row', 'front'],
    ]);
    const pursuit = createState({ encounterSet: 'pursuit' });
    command(pursuit, { type: 'start' });
    advance(pursuit, 3.2 * BATTLE_TIMING.enemyIntervalScale + 2 * DT);
    expect(
      pursuit.enemies.every((e) => e.cast?.target === 'single' && e.cast.movable === false),
    ).toBe(true);
    const ash = createState({ encounterSet: 'attrition' });
    command(ash, { type: 'start' });
    advance(ash, 4 * BATTLE_TIMING.enemyIntervalScale + 2 * DT);
    expect(ash.enemies[1].cast?.target).toBe('all');
    // All-target attack damages both rows, including a member moved after its warning.
    const cast = ash.enemies[1].cast!;
    cast.remaining = DT;
    ash.allies.forEach((a) => {
      a.shield = 0;
      a.action = null;
      a.queued = null;
      a.row = a.id === 0 ? 'front' : 'back';
    });
    const hp = ash.allies.map((a) => a.hp);
    advance(ash, DT);
    expect(ash.allies.every((a, i) => a.hp < hp[i])).toBe(true);
  });
  it('validates identifiers and bounds when importing or running experiments', () => {
    expect(() => runPolicy({ policy: 'focus', encounterLevel: 11 })).toThrow('強度');
    expect(() => runPolicy({ policy: 'focus', encounterLevel: NaN })).toThrow('強度');
    const snapshot = JSON.parse(new Session().snapshot());
    snapshot.state.config.encounterSet = 'unknown';
    expect(() => parseSnapshot(JSON.stringify(snapshot))).toThrow('不正');
  });
});
