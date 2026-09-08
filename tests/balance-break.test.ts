import { describe, expect, it } from 'vitest';
import { runBreakProbes } from '../scripts/balance/break-probes';
import { stateHash } from '../src/ai/runner';
import { DT } from '../src/content/data';
import { runReplay } from '../src/lab/session';
import { parseRecording } from '../src/lab/validation';
import { command, copy, step } from '../src/sim/engine';

describe('synthetic post-break timing probes', () => {
  const result = runBreakProbes();

  it('compares four real timing policies from each identical finite-HP snapshot', () => {
    expect(result.conditions).toMatchObject({ synthetic: true, runCount: 24, seed: 1307 });
    const fixtures = [...new Set(result.runs.map((run) => run.fixture))];
    expect(fixtures).toHaveLength(6);
    for (const fixture of fixtures) {
      const runs = result.runs.filter((run) => run.fixture === fixture);
      expect(new Set(runs.map((run) => run.policy)).size).toBe(4);
      expect(new Set(runs.map((run) => run.initialStateHash)).size).toBe(1);
      for (const { recording } of runs) {
        const initial = recording.initial;
        expect(initial.allies.map((a) => a.row)).toEqual(['front', 'front', 'front']);
        expect(initial.allies.map((a) => a.slot)).toEqual([0, 0, 1]);
        expect(initial.allies.every((a) => a.atb === 1 && a.action === null)).toBe(true);
        expect(initial.enemies).toHaveLength(1);
        expect(initial.enemies[0]).toMatchObject({ nextAttack: 999, broken: 12, row: 'front' });
      }
    }
  });

  it('retains real shift delay and does not issue late switches after an early kill', () => {
    const highHp = result.runs.filter((run) => run.enemyHp === 10000);
    for (const run of highHp) {
      if (run.policy === 'keep-abb') {
        expect(run.recording.inputs).toEqual([]);
        continue;
      }
      const seconds = run.policy === 'aab-now' ? 0 : run.policy === 'aab-after-4s' ? 4 : 8;
      expect(run.recording.inputs).toEqual([
        { tick: Math.round(seconds / DT), order: 0, command: { type: 'optima', index: 2 } },
      ]);
      expect(run.switchIssuedSeconds).toBeCloseTo(seconds);
      expect(run.switchCompletedSeconds).not.toBeNull();
      expect(run.switchCompletedSeconds! - run.switchIssuedSeconds!).toBeGreaterThanOrEqual(
        run.recording.initial.config.shiftTime - 1e-9,
      );
      const atCommand = copy(run.recording.initial);
      for (let tick = 0; tick < Math.round(seconds / DT); tick++) step(atCommand);
      expect(command(atCommand, { type: 'optima', index: 2 })).toBe(true);
      expect(atCommand.allies[1].slot).toBe(0);
      expect(atCommand.allies[1].nextSlot).toBe(1);
    }
    for (const run of result.runs.filter((r) => r.killSeconds !== null)) {
      if (run.policy === 'aab-after-8s' && run.killSeconds! < 8) {
        expect(run.recording.inputs).toEqual([]);
        expect(run.switchIssuedSeconds).toBeNull();
      }
    }
  });

  it('uses capped HP loss and actual kill times while preserving growing chain and replay identity', () => {
    expect(result.runs.some((run) => run.killSeconds !== null)).toBe(true);
    expect(result.runs.some((run) => run.killSeconds === null)).toBe(true);
    for (const run of result.runs) {
      const parsed = parseRecording(JSON.stringify(run.recording));
      const finalState = runReplay(parsed);
      expect(stateHash(finalState)).toBe(run.finalStateHash);
      expect(run.replayVerified).toBe(true);
      expect(run.damage).toBe(run.enemyHp - finalState.enemies[0].hp);
      expect(run.damage).toBeLessThanOrEqual(run.enemyHp);
      expect(finalState.metrics.taken).toBe(0);
      expect(finalState.enemies[0].attackCount).toBe(0);
      expect(run.chainPeak).toBeGreaterThan(run.initialChain);
      expect(run.chainPeak).toBeLessThanOrEqual(500);
      if (run.killSeconds !== null) {
        expect(run.damage).toBe(run.enemyHp);
        expect(run.killSeconds).toBeCloseTo(run.observedSeconds);
        expect(run.killSeconds).toBeGreaterThan(0);
      } else {
        expect(run.observedSeconds).toBeCloseTo(12);
        expect(run.damage).toBeLessThan(run.enemyHp);
      }
    }
  });
});
