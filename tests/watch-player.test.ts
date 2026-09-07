import { describe, expect, it } from 'vitest';
import { DT } from '../src/content/data';
import { createState, command, advance, step, copy } from '../src/sim/engine';
import { Session, runReplay } from '../src/lab/session';
import { parseRecording } from '../src/lab/validation';
import { WatchPlayer } from '../src/ai/watch-player';
import { runPolicy } from '../src/ai/runner';

describe('manual actor control', () => {
  it.each([0, 1, 2])(
    'selected actor %s waits, while companions act and explicit plans still execute',
    (id) => {
      const s = createState();
      s.selected = id;
      s.allies.forEach((a) => (a.atb = 4));
      s.allies[0].hp = 700;
      command(s, { type: 'start' });
      s.enemies.forEach((e) => (e.nextAttack = 999));
      advance(s, 1);
      expect(s.allies[id].atb).toBe(4);
      expect(s.events.filter((e) => e.type === 'action' && e.source === `a${id}`)).toHaveLength(0);
      expect(s.events.some((e) => e.type === 'action' && e.source !== `a${id}`)).toBe(true);
      command(s, {
        type: 'enqueue',
        id,
        step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id } },
      });
      step(s);
      expect(s.allies[id].action?.skillId).toBe('guard');
      expect(s.allies[id].atb).toBe(3);
      command(s, { type: 'cancel', id });
      advance(s, 2);
      expect(s.events.filter((e) => e.type === 'action' && e.source === `a${id}`)).toHaveLength(1);
    },
  );
  it('switching selection releases the old actor and finishes the new actor’s current action without starting another', () => {
    const s = createState();
    command(s, { type: 'start' });
    s.enemies.forEach((e) => (e.nextAttack = 999));
    s.allies.forEach((a) => (a.atb = 4));
    step(s);
    expect(s.allies[0].action).toBeNull();
    expect(s.allies[1].action?.skillId).toBe('spark');
    command(s, { type: 'select', id: 1 });
    step(s);
    expect(s.allies[0].action?.skillId).toBe('handoff');
    expect(s.allies[1].action?.skillId).toBe('spark');
    advance(s, 3);
    expect(s.allies[1].action).toBeNull();
    expect(s.events.filter((e) => e.type === 'action' && e.source === 'a1')).toHaveLength(1);
  });
});
describe('live AI viewing', () => {
  it.each(['legacy', 'next', 'queue'] as const)(
    '%s reaches the same two-battle outcome at 4x as the headless runner and replays exactly',
    (planning) => {
      const session = new Session({}, 'ai'),
        player = new WatchPlayer();
      player.configure('tactician', planning);
      player.speed = 4;
      session.send({ type: 'start' });
      for (
        let frames = 0;
        frames < 180 / DT && !['victory', 'defeat'].includes(session.state.phase);
        frames++
      )
        player.advance(session, DT);
      const expected = runPolicy({ policy: 'tactician', planning });
      expect(session.state).toEqual(expected.finalState);
      expect(player.history.some((d) => d.actions.length)).toBe(true);
      expect(runReplay(parseRecording(JSON.stringify(session.recording())))).toEqual(session.state);
    },
  );
  it('pauses without draining either clock, and stops issuing AI orders when control is handed back', () => {
    const session = new Session({}, 'ai'),
      player = new WatchPlayer();
    session.send({ type: 'start' });
    player.advance(session, 0.1);
    player.paused = true;
    const paused = copy(session.state),
      inputs = session.inputs.length;
    for (let i = 0; i < 20; i++) player.advance(session, 0.1);
    expect(session.state).toEqual(paused);
    expect(session.inputs.length).toBe(inputs);
    session.send({ type: 'control', mode: 'manual' });
    const count = session.inputs.length;
    for (let i = 0; i < 20; i++) player.advance(session, 0.1);
    expect(session.inputs.length).toBe(count);
    expect(session.state.tick).toBeGreaterThan(paused.tick);
    expect(player.paused).toBe(false);
  });
});
