import { describe, expect, it } from 'vitest';
import { createState, command, copy, step } from '../src/sim/engine';
import { LOADOUT_MODES, prepareLoadout, teamOutput } from '../src/ai/composition';
import { createAdaptivePolicy } from '../src/ai/adaptive-policy';
import { observe } from '../src/ai/observation';
import { runPolicy } from '../src/ai/runner';
import { WatchPlayer } from '../src/ai/watch-player';
import { Session } from '../src/lab/session';
import { DT } from '../src/content/data';

describe('loadout and composition AI', () => {
  it.each(LOADOUT_MODES)(
    '%s prepares legal unique loadouts without mutating the caller',
    (mode) => {
      const s = createState();
      command(s, { type: 'labWeapons' });
      const before = copy(s);
      const commands = prepareLoadout(s, mode);
      expect(s).toEqual(before);
      commands.forEach((c) => expect(command(s, c)).toBe(true));
      expect(new Set(s.allies.flatMap((a) => a.weapons)).size).toBe(6);
      command(s, { type: 'start' });
      expect(prepareLoadout(s, mode)).toEqual([]);
    },
  );
  it('values attainable skill throughput, and specialization trades recovery for offensive roles', () => {
    const s = createState();
    command(s, { type: 'labWeapons' });
    const o = teamOutput(s.allies, [0, 0, 0], 'strong', 0.55);
    expect(o.damage).toBeGreaterThan(40);
    expect(o.chain).toBeGreaterThan(5);
    expect(o.heal).toBeGreaterThan(40);
    const flexible = copy(s),
      assault = copy(s);
    prepareLoadout(flexible, 'adaptive').forEach((c) => command(flexible, c));
    prepareLoadout(assault, 'assault').forEach((c) => command(assault, c));
    expect(flexible.allies.flatMap((a) => a.weapons)).toContain('bell');
    expect(assault.allies.flatMap((a) => a.weapons)).not.toContain('bell');
  });
  it('changes composition at meaningful windows, waits for shifts, and honors a four-second decision interval', () => {
    const s = createState();
    prepareLoadout(s, 'adaptive').forEach((c) => command(s, c));
    command(s, { type: 'start' });
    s.allies[0].hp = 200;
    s.allies[1].hp = 300;
    const p = createAdaptivePolicy('adaptive', 0),
      first = p.decide(observe(s));
    expect(
      first.commands.some(
        (c) => c.type === 'optima' || (c.type === 'enqueue' && c.step.kind === 'weapon'),
      ),
    ).toBe(true);
    first.commands.forEach((c) => expect(command(s, c)).toBe(true));
    for (let i = 0; i < 180; i++) {
      step(s);
      if (i % 15 !== 0) continue;
      const d = p.decide(observe(s));
      expect(
        d.commands.some(
          (c) => c.type === 'optima' || (c.type === 'enqueue' && c.step.kind === 'weapon'),
        ),
      ).toBe(false);
      d.commands.forEach((c) => expect(command(s, c)).toBe(true));
    }
  });
  it.each(['adaptive', 'assault'] as const)(
    '%s has identical headless and Web decisions, equipment and final state',
    (policy) => {
      const session = new Session({}, 'ai'),
        player = new WatchPlayer();
      player.configure(policy, 'queue');
      player.speed = 4;
      session.send(...prepareLoadout(session.state, player.loadout), { type: 'start' });
      for (let i = 0; i < 12000 && !['victory', 'defeat'].includes(session.state.phase); i++)
        player.advance(session, DT);
      const run = runPolicy({ policy, planning: 'queue' });
      expect(session.state).toEqual(run.finalState);
      expect(run.summary.replayVerified).toBe(true);
      expect(run.summary.rejectedCommands).toBe(0);
    },
  );
});
