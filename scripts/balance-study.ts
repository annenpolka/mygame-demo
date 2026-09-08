import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { VERSION } from '../src/content/data';
import { ENCOUNTER_SET_IDS, type EncounterSetId } from '../src/content/encounters';
import type { PolicyId, Ablation } from '../src/ai/policies';
import type { LoadoutMode } from '../src/ai/composition';
import { EXPERIMENT_VERSION, runPolicy, stateHash, type RunOptions } from '../src/ai/runner';
import { playRules } from '../src/lab/playtest';
import { runReplay } from '../src/lab/session';
import { parseRecording } from '../src/lab/validation';
import { summarizeTelemetry } from './balance/telemetry';
import { runManualProbes } from './balance/manual-probes';
import { runBreakProbes } from './balance/break-probes';
import {
  aggregate,
  pairedComparison,
  cell,
  feasible,
  key,
  pareto,
  selectProfiles,
  type Candidate,
  type Parameters,
  type Row,
} from './balance/search';

const dir = resolve(process.argv[2] ?? 'artifacts/balance-20260908');
if (existsSync(dir)) throw new Error(`Choose a fresh output directory: ${dir}`);
const contractPath = 'autoresearch-results/balance-20260908/contract.json';
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
if (contract.version !== VERSION) throw new Error('Contract belongs to another combat version');
mkdirSync(dir, { recursive: true });
const write = (name: string, value: unknown) => {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
};
write('contract.json', contract);
const start = performance.now();
const rules = playRules();
const files = (path: string): string[] =>
  readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)],
  );
const sources = [
  ...files('src'),
  ...files('scripts/balance'),
  'scripts/balance-study.ts',
  contractPath,
];
const sourceHashes = Object.fromEntries(
  sources.sort().map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]),
);
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
write('provenance.json', {
  version: VERSION,
  experimentVersion: EXPERIMENT_VERSION,
  gitHead,
  createdAt: new Date().toISOString(),
  sourceHashes,
  rules: JSON.parse(rules),
  reproduction: 'npm run sim:balance -- <new-output-directory>',
  node: process.version,
  scope: 'Only existing Config values vary. No product constants are modified.',
});
const rows: Row[] = [];
const candidates: Candidate[] = [];
const archive = new Map<string, string>();
const packets: unknown[] = [];
const replayLines: string[] = [];
let runCount = 0;
function run(
  p: Parameters,
  stage: string,
  encounterSet: EncounterSetId,
  policy: PolicyId,
  seed: number,
  encounterLevel = 1,
  extra: Partial<RunOptions> = {},
) {
  const r = runPolicy({
    ...contract.fixed,
    ...p,
    encounterSet,
    encounterLevel,
    policy,
    seed,
    ...extra,
    verifyReplay: true,
  });
  const telemetry = summarizeTelemetry(r);
  if (!telemetry.replayVerified || playRules() !== rules)
    throw new Error('Replay or frozen rules guard failed');
  const row: Row = { candidate: key(p), stage, summary: r.summary, telemetry };
  rows.push(row);
  replayLines.push(
    JSON.stringify({
      candidate: row.candidate,
      stage,
      recording: r.recording,
      finalHash: r.summary.finalHash,
    }),
  );
  runCount++;
  return { r, row };
}
function packet(p: Parameters, description: string) {
  const id = key(p);
  if (candidates.some((c) => c.id === id)) return;
  const batch: Row[] = [];
  for (const set of contract.training.sets as EncounterSetId[])
    for (const policy of contract.training.policies as PolicyId[])
      for (const seed of contract.training.seeds as number[])
        batch.push(run(p, 'train', set, policy, seed).row);
  const c: Candidate = { id, parameters: p, aggregate: aggregate(batch) };
  candidates.push(c);
  const before = archive.size,
    slot = cell(c.aggregate);
  if (feasible(c.aggregate) && slot && !archive.has(slot)) archive.set(slot, id);
  const status = candidates.length === 1 ? 'baseline' : archive.size > before ? 'keep' : 'discard';
  const entry = {
    iteration: candidates.length - 1,
    id,
    parameters: p,
    metric: archive.size,
    delta: archive.size - before,
    status,
    feasible: feasible(c.aggregate),
    cell: slot,
    description,
  };
  packets.push(entry);
  appendFileSync(
    join(dir, 'results.tsv'),
    `${entry.iteration}\t${gitHead}\t${archive.size}\t${entry.delta}\t${status}\t${id}: ${description}\n`,
  );
  write('state.json', {
    phase: 'explore',
    iteration: entry.iteration,
    best_metric: archive.size,
    archive: Object.fromEntries(archive),
    last: entry,
  });
  console.log(
    JSON.stringify({
      packet: entry.iteration,
      id,
      status,
      cells: archive.size,
      runs: runCount,
      wins: c.aggregate.wins,
      seconds: c.aggregate.meanWinEncounterSeconds,
    }),
  );
}
writeFileSync(join(dir, 'results.tsv'), 'iteration\tcommit\tmetric\tdelta\tstatus\tdescription\n');
packet(contract.baseline, 'Baseline before all candidate changes');
for (const atbRate of contract.parameters.atbRate)
  for (const enemyHpScale of contract.parameters.enemyHpScale)
    for (const enemyPower of contract.parameters.enemyPower)
      packet({ atbRate, enemyHpScale, enemyPower }, 'Frozen full factorial grid');
const firstProfiles = selectProfiles(candidates);
const dims = ['atbRate', 'enemyHpScale', 'enemyPower'] as const;
for (const name of ['offense', 'resilience', 'intervention'] as const) {
  const parent = candidates.find((c) => c.id === firstProfiles[name])!;
  let added = 0;
  for (const dimension of dims) {
    const values: number[] = contract.parameters[dimension];
    const half = (values[1] - values[0]) / 2;
    for (const sign of [-1, 1]) {
      if (added >= 2) break;
      const p = {
        ...parent.parameters,
        [dimension]: Number((parent.parameters[dimension] + sign * half).toFixed(4)),
      };
      if (
        p[dimension] < values[0] ||
        p[dimension] > values.at(-1)! ||
        candidates.some((c) => c.id === key(p))
      )
        continue;
      packet(p, `${name}: one-axis half-step neighbor of ${parent.id}`);
      added++;
    }
    if (added >= 2) break;
  }
}
const profiles = selectProfiles(candidates);
const selected = [
  ...new Set([
    key(contract.baseline),
    profiles.offense,
    profiles.resilience,
    profiles.intervention,
  ]),
];
write('selection.json', {
  profiles,
  selected,
  selectionData: 'training only; frozen before validation',
  firstProfiles,
  candidates,
  paretoProxyFront: pareto(candidates),
  archive: Object.fromEntries(archive),
  packets,
});
for (const id of selected) {
  const p = candidates.find((c) => c.id === id)!.parameters;
  for (const level of contract.validation.levels as number[])
    for (const set of contract.validation.sets as EncounterSetId[])
      for (const policy of contract.validation.policies as PolicyId[])
        for (const seed of contract.validation.seeds as number[])
          run(p, 'validation', set, policy, seed, level);
  console.log(`Validation ${id}: ${runCount} verified runs`);
}
// These diagnostic comparisons cannot influence the frozen selection.
for (const id of selected) {
  const p = candidates.find((c) => c.id === id)!.parameters;
  for (const set of ENCOUNTER_SET_IDS)
    for (const loadout of ['keep', 'legacy', 'adaptive', 'assault'] as LoadoutMode[])
      for (const seed of [2601, 2602]) run(p, 'loadout', set, 'adaptive', seed, 1, { loadout });
  for (const set of ['belfry', 'crossfire', 'pursuit'] as EncounterSetId[])
    for (const ablation of ['none', 'no-pull', 'no-row', 'no-defense'] as Ablation[])
      for (const seed of [2601, 2602]) run(p, 'ablation', set, 'tactician', seed, 1, { ablation });
  console.log(`Diagnostic ${id}: ${runCount} verified runs`);
}
// Save scenes using declared mechanical selectors, including adverse outcomes.
const scenes: { title: string; why: string; row: Row }[] = [];
const validation = rows.filter((r) => r.stage === 'validation');
for (const id of selected) {
  const rs = validation.filter((r) => r.candidate === id);
  const select = (
    title: string,
    why: string,
    sort: (a: Row, b: Row) => number,
    filter = (r: Row) => true,
  ) => {
    const row = rs.filter(filter).sort(sort)[0];
    if (row) scenes.push({ title, why, row });
  };
  select(
    'break',
    'Largest broken-enemy exposure fraction at level 1',
    (a, b) => (b.telemetry.enemyBrokenFraction ?? 0) - (a.telemetry.enemyBrokenFraction ?? 0),
    (r) => r.summary.encounterLevel === 1,
  );
  select(
    'danger',
    'Most danger deaths, then largest per-hit HP fraction; includes held-out level 2',
    (a, b) =>
      b.telemetry.dangerDeaths - a.telemetry.dangerDeaths ||
      (b.telemetry.maxHitHpFraction ?? 0) - (a.telemetry.maxHitHpFraction ?? 0),
  );
  select(
    'recovery',
    'Most completed danger → recovery → offensive hit episodes',
    (a, b) => b.telemetry.recoveredEpisodes - a.telemetry.recoveredEpisodes,
    (r) => r.telemetry.recoveredEpisodes > 0,
  );
}
const sceneManifest = [];
for (let i = 0; i < scenes.length; i++) {
  const { row, title, why } = scenes[i],
    s = row.summary;
  const p = candidates.find((c) => c.id === row.candidate)!.parameters;
  const replay = runPolicy({
    ...contract.fixed,
    ...p,
    policy: s.policy,
    seed: s.seed,
    encounterSet: s.encounterSet,
    encounterLevel: s.encounterLevel,
    verifyReplay: true,
  });
  if (replay.summary.finalHash !== s.finalHash)
    throw new Error('Scene rerun differs from selected experiment');
  const parsed = parseRecording(JSON.stringify(replay.recording));
  if (stateHash(runReplay(parsed)) !== s.finalHash) throw new Error('Public replay import differs');
  const name = `scenes/${String(i + 1).padStart(2, '0')}-${title}-${s.policy}-${s.encounterSet}`;
  write(`${name}.replay.json`, parsed);
  const episode =
    title === 'recovery'
      ? row.telemetry.dangerWindows.find((w) => w.outcome === 'recovered')
      : row.telemetry.dangerWindows.find((w) => w.outcome === 'death');
  const largestHit = replay.events
    .filter((e) => e.type === 'damage' && e.source?.startsWith('e') && e.target?.startsWith('a'))
    .sort(
      (a, b) =>
        (b.value ?? 0) / replay.finalState.allies[Number(b.target!.slice(1))].maxHp -
        (a.value ?? 0) / replay.finalState.allies[Number(a.target!.slice(1))].maxHp,
    )[0];
  const time =
    episode?.startTime ??
    (title === 'break' ? replay.events.find((e) => e.type === 'break')?.time : largestHit?.time) ??
    Math.min(15, s.seconds);
  let markTick = parsed.endTick;
  runReplay(parsed, undefined, (state) => {
    if (state.time >= Math.max(0, time - 3) && markTick === parsed.endTick) markTick = state.tick;
  });
  const prefix = {
    ...parsed,
    endTick: markTick,
    inputs: parsed.inputs.filter((input) => input.tick <= markTick),
  };
  // Pause only the review prefix. The full original recording remains untouched.
  prefix.inputs.push({
    tick: markTick,
    order: prefix.inputs.length,
    command: { type: 'pause', value: true },
  });
  parseRecording(JSON.stringify(prefix));
  write(`${name}.scene.json`, prefix);
  write(`${name}.events.json`, replay.events);
  sceneManifest.push({
    title,
    why,
    candidate: row.candidate,
    policy: s.policy,
    set: s.encounterSet,
    seed: s.seed,
    level: s.encounterLevel,
    interestingTime: time,
    episode,
    startTick: markTick,
    replay: `${name}.replay.json`,
    scene: `${name}.scene.json`,
    summary: s,
    telemetry: row.telemetry,
  });
}
write('scenes.json', sceneManifest);
const manual = runManualProbes();
write('manual-probes.json', manual);
for (const [i, r] of manual.runs.entries())
  write(
    `manual/${String(i + 1).padStart(2, '0')}-${r.condition.id}-${r.mode}.replay.json`,
    r.recording,
  );
const breakProbes = runBreakProbes();
write('break-probes.json', breakProbes);
for (const [i, r] of breakProbes.runs.entries())
  write(`break/${String(i + 1).padStart(2, '0')}.replay.json`, r.recording);
const summarizeGroups = (stage: string, fields: (keyof Row['summary'])[]) => {
  const groups = new Map<string, Row[]>();
  for (const r of rows.filter((r) => r.stage === stage)) {
    const k = JSON.stringify([r.candidate, ...fields.map((f) => r.summary[f])]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()].map((rs) => ({
    candidate: rs[0].candidate,
    ...Object.fromEntries(fields.map((f) => [f, rs[0].summary[f]])),
    ...aggregate(rs),
  }));
};
write('report.json', {
  version: VERSION,
  runCount,
  sceneReruns: scenes.length,
  durationSeconds: (performance.now() - start) / 1000,
  profiles,
  selected,
  coverage: archive.size,
  candidates,
  validation: summarizeGroups('validation', ['encounterLevel']),
  pairedValidation: selected.flatMap((id) =>
    [1, 2].map((level) => ({
      candidate: id,
      level,
      ...pairedComparison(
        rows.filter(
          (r) =>
            r.stage === 'validation' &&
            r.candidate === key(contract.baseline) &&
            r.summary.encounterLevel === level,
        ),
        rows.filter(
          (r) =>
            r.stage === 'validation' && r.candidate === id && r.summary.encounterLevel === level,
        ),
        'candidate',
      ),
    })),
  ),
  pairedLoadout: selected.flatMap((id) =>
    ['legacy', 'adaptive', 'assault'].map((loadout) => ({
      candidate: id,
      loadout,
      ...pairedComparison(
        rows.filter(
          (r) => r.stage === 'loadout' && r.candidate === id && r.summary.loadout === 'keep',
        ),
        rows.filter(
          (r) => r.stage === 'loadout' && r.candidate === id && r.summary.loadout === loadout,
        ),
        'loadout',
      ),
    })),
  ),
  pairedAblation: selected.flatMap((id) =>
    ['no-pull', 'no-row', 'no-defense'].map((ablation) => ({
      candidate: id,
      ablation,
      ...pairedComparison(
        rows.filter(
          (r) => r.stage === 'ablation' && r.candidate === id && r.summary.ablation === 'none',
        ),
        rows.filter(
          (r) => r.stage === 'ablation' && r.candidate === id && r.summary.ablation === ablation,
        ),
        'ablation',
      ),
    })),
  ),
  manualRuns: manual.runs.length,
  breakProbeRuns: breakProbes.runs.length,
  byPolicy: summarizeGroups('validation', ['encounterLevel', 'policy']),
  bySet: summarizeGroups('validation', ['encounterLevel', 'encounterSet']),
  loadout: summarizeGroups('loadout', ['loadout']),
  loadoutBySet: summarizeGroups('loadout', ['loadout', 'encounterSet']),
  ablation: summarizeGroups('ablation', ['ablation']),
  scenes: sceneManifest.map(({ summary, telemetry, ...r }) => r),
});
writeFileSync(
  join(dir, 'runs.jsonl.gz'),
  gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'),
);
writeFileSync(join(dir, 'replays.jsonl.gz'), gzipSync(replayLines.join('\n') + '\n'));
write('state.json', {
  phase: 'complete',
  iteration: candidates.length - 1,
  best_metric: archive.size,
  selected,
  runCount,
  allReplaysVerified: rows.every((r) => r.telemetry.replayVerified && r.summary.replayVerified),
  archive: Object.fromEntries(archive),
  productAdoption: false,
});
console.log(`AUTORESEARCH_METRIC_VALUE=${archive.size}`);
console.log(`Completed ${runCount} runs; outputs: ${relative(process.cwd(), dir)}`);
