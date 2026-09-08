import { describe, expect, it } from 'vitest';
import {
  aggregate,
  cell,
  feasible,
  pareto,
  pairedComparison,
  selectProfiles,
  type Candidate,
  type Row,
} from '../scripts/balance/search';
import { runPolicy } from '../src/ai/runner';
import { summarizeTelemetry } from '../scripts/balance/telemetry';

describe('balance research selection', () => {
  const run = runPolicy({ policy: 'autopilot', loadout: 'keep', maxSeconds: 180 });
  const row: Row = {
    candidate: 'baseline',
    stage: 'train',
    summary: run.summary,
    telemetry: summarizeTelemetry(run),
  };
  const base = aggregate([row]);
  const candidate = (id: string, changes: Partial<typeof base>): Candidate => ({
    id,
    parameters: { atbRate: 0.85, enemyHpScale: 1, enemyPower: 1 },
    aggregate: { ...base, ...changes },
  });
  it('never treats a short failed run as a fast win and retains censoring', () => {
    const failure: Row = { ...row, summary: { ...row.summary, outcome: 'timeout', seconds: 1 } };
    const mixed = aggregate([row, failure]);
    expect(mixed.meanWinSeconds).toBe(run.summary.seconds);
    expect(mixed.winFraction).toBe(0.5);
    expect(mixed.timeouts).toBe(1);
    expect(feasible(mixed)).toBe(false);
    expect(aggregate([failure]).meanWinSeconds).toBeNull();
    expect(cell(aggregate([failure]))).toBeNull();
  });
  it('preserves incomparable cost profiles while removing strictly dominated points', () => {
    const cs = [
      candidate('fast', { meanWinEncounterSeconds: 20, meanDeaths: 1, meanAcceptedCommands: 100 }),
      candidate('safe', { meanWinEncounterSeconds: 40, meanDeaths: 0, meanAcceptedCommands: 10 }),
      candidate('worse', { meanWinEncounterSeconds: 50, meanDeaths: 2, meanAcceptedCommands: 110 }),
    ];
    expect(pareto(cs)).toEqual(['fast', 'safe']);
  });
  it('compares matched winning pairs while separately reporting changed outcomes', () => {
    const r = (seed: number, outcome: Row['summary']['outcome'], seconds: number): Row => ({
      ...row,
      summary: { ...row.summary, seed, outcome, seconds },
    });
    const result = pairedComparison(
      [r(1, 'victory', 50), r(2, 'victory', 100)],
      [r(2, 'defeat', 2), r(1, 'victory', 40)],
      'candidate',
    );
    expect(result.pairs).toBe(2);
    expect(result.bothWon).toBe(1);
    expect(result.secondsDelta).toBe(-10);
    expect(result.winDelta).toBe(-0.5);
  });
  it('selects distinct feasible directions and explicitly marks insufficient-feasibility fallback', () => {
    const cs = [
      candidate('fast', { meanWinEncounterSeconds: 20, meanDeaths: 0.1, meanTaken: 500 }),
      candidate('safe', { meanWinEncounterSeconds: 40, meanDeaths: 0, meanTaken: 100 }),
      candidate('intervention', {
        meanWinEncounterSeconds: 35,
        meanDeaths: 0.1,
        meanTaken: 500,
        aiWinDelta: 1,
      }),
      candidate('fake-fast', { meanWinEncounterSeconds: 1, winFraction: 0.1 }),
    ];
    expect(selectProfiles(cs)).toEqual({
      offense: 'fast',
      resilience: 'safe',
      intervention: 'intervention',
      fallbackIncludesNonfeasible: false,
    });
    expect(
      selectProfiles(cs.map((c) => ({ ...c, aggregate: { ...c.aggregate, timeouts: 1 } })))
        .fallbackIncludesNonfeasible,
    ).toBe(true);
  });
});
