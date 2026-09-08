import type { RunSummary } from '../../src/ai/runner';
import type { summarizeTelemetry } from './telemetry';

export type Parameters = { atbRate: number; enemyHpScale: number; enemyPower: number };
export type Row = {
  candidate: string;
  stage: string;
  summary: RunSummary;
  telemetry: ReturnType<typeof summarizeTelemetry>;
};
export const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export const key = (p: Parameters) =>
  `atb${p.atbRate.toFixed(3)}-hp${p.enemyHpScale.toFixed(3)}-power${p.enemyPower.toFixed(3)}`;
export function aggregate(rows: Row[]) {
  const winners = rows.filter((r) => r.summary.outcome === 'victory');
  const completed = winners.flatMap((r) => r.summary.encounters.map((e) => e.seconds));
  const pairs = rows
    .filter((r) => r.summary.policy === 'tactician')
    .flatMap((r) => {
      const a = rows.find(
        (a) =>
          a.summary.policy === 'autopilot' &&
          a.summary.seed === r.summary.seed &&
          a.summary.encounterSet === r.summary.encounterSet &&
          a.summary.encounterLevel === r.summary.encounterLevel,
      );
      return a ? [{ ai: r.summary, auto: a.summary }] : [];
    });
  const enemyBrokenFraction = mean(
    rows.flatMap((r) =>
      r.telemetry.enemyBrokenFraction === null ? [] : [r.telemetry.enemyBrokenFraction],
    ),
  );
  const encounterSeconds = mean(completed);
  const result = {
    runs: rows.length,
    wins: winners.length,
    winFraction: rows.length ? winners.length / rows.length : 0,
    timeouts: rows.filter((r) => r.summary.outcome === 'timeout').length,
    meanWinSeconds: mean(winners.map((r) => r.summary.seconds)),
    meanWinEncounterSeconds: encounterSeconds,
    meanTaken: mean(rows.map((r) => r.summary.metrics.taken)),
    meanDeaths: mean(rows.map((r) => r.summary.deaths)),
    meanBreaks: mean(rows.map((r) => r.summary.metrics.breaks)),
    meanEnemyBrokenFraction: enemyBrokenFraction,
    meanBreakDamageShare: mean(
      rows.flatMap((r) =>
        r.telemetry.breakDamageShare === null ? [] : [r.telemetry.breakDamageShare],
      ),
    ),
    meanWaitingFraction: mean(
      rows.flatMap((r) =>
        r.telemetry.waitingFraction === null ? [] : [r.telemetry.waitingFraction],
      ),
    ),
    meanAcceptedCommands: mean(rows.map((r) => r.telemetry.acceptedCommands)),
    meanCancellations: mean(rows.map((r) => r.telemetry.cancellations)),
    dangerEpisodes: rows.reduce((n, r) => n + r.telemetry.dangerEpisodes, 0),
    recoveredEpisodes: rows.reduce((n, r) => n + r.telemetry.recoveredEpisodes, 0),
    dangerDeaths: rows.reduce((n, r) => n + r.telemetry.dangerDeaths, 0),
    censoredEpisodes: rows.reduce((n, r) => n + r.telemetry.censoredEpisodes, 0),
    pairCount: pairs.length,
    aiWinDelta: mean(
      pairs.map((p) => Number(p.ai.outcome === 'victory') - Number(p.auto.outcome === 'victory')),
    ),
    pairedWinSecondsSaved: mean(
      pairs
        .filter((p) => p.ai.outcome === 'victory' && p.auto.outcome === 'victory')
        .map((p) => p.auto.seconds - p.ai.seconds),
    ),
    zeroDamageWins: winners.filter((r) => r.summary.metrics.taken === 0).length,
    replayVerified: rows.every((r) => r.summary.replayVerified && r.telemetry.replayVerified),
  };
  return result;
}
export type Aggregate = ReturnType<typeof aggregate>;
/** Differences use matched conditions; speed uses only pairs where both runs won. */
export function pairedComparison(
  baseline: Row[],
  candidate: Row[],
  varying: 'candidate' | 'loadout' | 'ablation',
) {
  const signature = (r: Row) =>
    JSON.stringify([
      varying === 'candidate' ? null : r.candidate,
      r.summary.encounterSet,
      r.summary.encounterLevel,
      r.summary.policy,
      r.summary.seed,
      varying === 'loadout' ? null : r.summary.loadout,
      varying === 'ablation' ? null : r.summary.ablation,
    ]);
  const index = new Map(baseline.map((r) => [signature(r), r]));
  if (index.size !== baseline.length) throw new Error('Duplicate baseline comparison conditions');
  const pairs = candidate.flatMap((r) => {
    const b = index.get(signature(r));
    return b ? [{ b, c: r }] : [];
  });
  const wins = pairs.filter(
    ({ b, c }) => b.summary.outcome === 'victory' && c.summary.outcome === 'victory',
  );
  const delta = wins.map(({ b, c }) => c.summary.seconds - b.summary.seconds);
  const distributionDistance = (a: Record<string, number>, b: Record<string, number>) => {
    const sa = Object.values(a).reduce((n, x) => n + x, 0),
      sb = Object.values(b).reduce((n, x) => n + x, 0);
    if (!sa || !sb) return null;
    return (
      [...new Set([...Object.keys(a), ...Object.keys(b)])].reduce(
        (n, k) => n + Math.abs((a[k] ?? 0) / sa - (b[k] ?? 0) / sb),
        0,
      ) / 2
    );
  };
  return {
    pairs: pairs.length,
    bothWon: wins.length,
    winDelta: mean(
      pairs.map(
        ({ b, c }) =>
          Number(c.summary.outcome === 'victory') - Number(b.summary.outcome === 'victory'),
      ),
    ),
    secondsDelta: mean(delta),
    secondsDeltaMin: delta.length ? Math.min(...delta) : null,
    secondsDeltaMax: delta.length ? Math.max(...delta) : null,
    takenDelta: mean(wins.map(({ b, c }) => c.summary.metrics.taken - b.summary.metrics.taken)),
    cancellationsDelta: mean(
      wins.map(({ b, c }) => c.telemetry.cancellations - b.telemetry.cancellations),
    ),
    meanSkillDistributionDistance: mean(
      wins.flatMap(({ b, c }) => {
        const d = distributionDistance(b.summary.actions, c.summary.actions);
        return d === null ? [] : [d];
      }),
    ),
    meanRoleDistributionDistance: mean(
      wins.flatMap(({ b, c }) => {
        const d = distributionDistance(b.summary.activeRoleSeconds, c.summary.activeRoleSeconds);
        return d === null ? [] : [d];
      }),
    ),
  };
}
export type Candidate = { id: string; parameters: Parameters; aggregate: Aggregate };
export function feasible(a: Aggregate) {
  return (
    a.winFraction >= 0.75 &&
    a.timeouts === 0 &&
    a.meanWinEncounterSeconds !== null &&
    a.meanWinEncounterSeconds >= 15 &&
    a.meanWinEncounterSeconds <= 90
  );
}
export function cell(a: Aggregate) {
  if (a.meanWinEncounterSeconds === null || a.meanEnemyBrokenFraction === null) return null;
  const bucket = (n: number, cuts: number[]) => cuts.filter((c) => n >= c).length;
  return `${bucket(a.meanWinEncounterSeconds, [25, 40])}:${bucket(a.meanEnemyBrokenFraction, [0.2, 0.4])}`;
}
export function selectProfiles(cs: Candidate[]) {
  const eligible = cs.filter((c) => feasible(c.aggregate));
  const pool = eligible.length >= 3 ? eligible : cs;
  const selected = new Set<string>();
  const take = (compare: (a: Aggregate, b: Aggregate) => number) => {
    const c = [...pool]
      .filter((c) => !selected.has(c.id))
      .sort((a, b) => compare(a.aggregate, b.aggregate) || a.id.localeCompare(b.id))[0];
    if (!c) throw new Error('At least three distinct candidates are required');
    selected.add(c.id);
    return c.id;
  };
  return {
    fallbackIncludesNonfeasible: eligible.length < 3,
    offense: take(
      (a, b) => (a.meanWinEncounterSeconds ?? Infinity) - (b.meanWinEncounterSeconds ?? Infinity),
    ),
    resilience: take(
      (a, b) =>
        (a.meanDeaths ?? Infinity) - (b.meanDeaths ?? Infinity) ||
        (a.meanTaken ?? Infinity) - (b.meanTaken ?? Infinity),
    ),
    intervention: take(
      (a, b) =>
        (b.aiWinDelta ?? -Infinity) - (a.aiWinDelta ?? -Infinity) ||
        (b.pairedWinSecondsSaved ?? -Infinity) - (a.pairedWinSecondsSaved ?? -Infinity),
    ),
  };
}
/** An illustrative Pareto front for cost proxies, not a Pareto front of enjoyment. */
export function pareto(cs: Candidate[]) {
  const vector = (a: Aggregate) => [
    1 - a.winFraction,
    a.meanWinEncounterSeconds ?? Infinity,
    a.meanDeaths ?? Infinity,
    a.meanAcceptedCommands ?? Infinity,
  ];
  return cs
    .filter(
      (c) =>
        !cs.some((other) => {
          const a = vector(other.aggregate),
            b = vector(c.aggregate);
          return a.every((n, i) => n <= b[i]) && a.some((n, i) => n < b[i]);
        }),
    )
    .map((c) => c.id);
}
