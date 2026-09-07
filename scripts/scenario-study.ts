import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG, DT, SKILLS } from '../src/content/data';
import { ENCOUNTER_SET_IDS } from '../src/content/encounters';
import { POLICY_IDS, type PolicyId } from '../src/ai/policies';
import { aggregate, makeTraceReport } from '../src/ai/report';
import {
  EXPERIMENT_VERSION,
  runPolicy,
  type PlanningMode,
  type RunSummary,
} from '../src/ai/runner';
import { command, createState, step } from '../src/sim/engine';

const args = process.argv.slice(2);
const allowed = ['--seeds', '--levels', '--dir', '--max-seconds', '--reaction', '--atb-max'];
for (let i = 0; i < args.length; i += 2)
  if (!allowed.includes(args[i]) || !args[i + 1]) throw new Error(`不明・値なし: ${args[i]}`);
const value = (key: string, fallback: string) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const count = Number(value('--seeds', '20'));
const atbMax = Number(value('--atb-max', String(DEFAULT_CONFIG.atbMax)));
const levels = value('--levels', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const maxSeconds = Number(value('--max-seconds', '240'));
const reactionSeconds = Number(value('--reaction', '0.35'));
if (
  !Number.isInteger(atbMax) ||
  atbMax < 2 ||
  atbMax > 8 ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 1000 ||
  !levels.length ||
  levels.some((l) => !Number.isInteger(l) || l < 1 || l > 10) ||
  new Set(levels).size !== levels.length ||
  !Number.isFinite(maxSeconds) ||
  maxSeconds < 1 ||
  maxSeconds > 3600 ||
  !Number.isFinite(reactionSeconds) ||
  reactionSeconds < 0 ||
  reactionSeconds > 5
)
  throw new Error('実験条件が範囲外・重複です。');
const dir = resolve(value('--dir', 'artifacts/scenario-study'));
if (existsSync(resolve(dir, 'receipt.json')))
  throw new Error('既存の測定を上書きできません。別の --dir を指定してください。');
mkdirSync(dir, { recursive: true });
const paths = [
  'src/content/data.ts',
  'src/content/encounters.ts',
  'src/sim/types.ts',
  'src/sim/engine.ts',
  'src/sim/plan.ts',
  'src/sim/tactics.ts',
  'src/ai/policies.ts',
  'src/ai/observation.ts',
  'src/ai/queue-policy.ts',
  'src/ai/runner.ts',
  'src/ai/report.ts',
  'src/lab/session.ts',
  'src/lab/validation.ts',
  'scripts/scenario-study.ts',
];
const hash = (p: string) =>
  createHash('sha256')
    .update(readFileSync(new URL(`../${p}`, import.meta.url)))
    .digest('hex');
const sourceHashes = Object.fromEntries(paths.map((p) => [p, hash(p)]));
const strategies: { policy: PolicyId; planning: PlanningMode }[] = [
  ...POLICY_IDS.map((policy) => ({ policy, planning: 'legacy' as const })),
  ...(['tactician', 'focus'] as const).flatMap((policy) =>
    (['next', 'queue'] as const).map((planning) => ({ policy, planning })),
  ),
];

// Fill the available reservation budget, with full ATB, one ally and an inert target.
// This exposes burst throughput independently of AI input rate and enemy deaths.
const bursts = ['slash', 'sweep', 'guard', 'potion'].map((skillId) => {
  const s = createState({ atbMax }),
    a = s.allies[0];
  command(s, { type: 'start' });
  a.atb = atbMax;
  s.allies.slice(1).forEach((x) => (x.hp = 0));
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  const n =
    skillId === 'potion'
      ? Math.min(3, s.config.atbMax)
      : Math.floor(s.config.atbMax / SKILLS[skillId].cost);
  for (let i = 0; i < n; i++) {
    const target =
      skillId === 'sweep'
        ? { kind: 'row' as const, row: 'front' as const }
        : skillId === 'slash'
          ? { kind: 'enemy' as const, id: 0 }
          : { kind: 'ally' as const, id: 0 };
    if (!command(s, { type: 'enqueue', id: 0, step: { kind: 'skill', skillId, target } }))
      throw new Error('連続予約プローブが拒否されました。');
  }
  for (let tick = 0; tick < 30 / DT; tick++) step(s);
  const starts = s.events
    .filter((e) => e.type === 'action' && e.source === 'a0')
    .map((e) => e.time);
  return {
    skillId,
    starts,
    startsIn3Seconds: starts.filter((t) => t <= 3).length,
    spentIn3Seconds: starts.filter((t) => t <= 3).length * SKILLS[skillId].cost,
  };
});
const runs: RunSummary[] = [];
const cells = [];
const pace: {
  set: string;
  level: number;
  policy: string;
  planning: string;
  seed: number;
  allyStarts: number;
  enemyWarnings: number;
  atbSpent: number;
  realSeconds: number;
  battleSeconds: number;
}[] = [];
const started = performance.now();
for (const encounterSet of ENCOUNTER_SET_IDS)
  for (const encounterLevel of levels) {
    const counts: string[] = [];
    for (const strategy of strategies) {
      const group: RunSummary[] = [];
      for (let i = 0; i < count; i++) {
        const run = runPolicy({
          ...strategy,
          atbMax,
          encounterSet,
          encounterLevel,
          seed: 1307 + i,
          maxSeconds,
          reactionSeconds,
          verifyReplay: true,
        });
        runs.push(run.summary);
        group.push(run.summary);
        const allyStarts = Object.values(run.summary.actions).reduce((n, v) => n + v, 0);
        const atbSpent = Object.entries(run.summary.actions).reduce(
          (n, [id, v]) => n + SKILLS[id].cost * v,
          0,
        );
        const enemyWarnings = run.events.filter(
          (e) =>
            e.type === 'warning' &&
            e.text.includes('：') &&
            !e.text.includes('戦闘不能') &&
            !e.text.includes('構えが崩れた'),
        ).length;
        pace.push({
          set: encounterSet,
          level: encounterLevel,
          ...strategy,
          seed: 1307 + i,
          allyStarts,
          enemyWarnings,
          atbSpent,
          realSeconds: run.summary.realSeconds,
          battleSeconds: run.summary.seconds,
        });
        if (i === 0 && strategy.planning === 'queue' && [1, 5, 6].includes(encounterLevel)) {
          const path = resolve(
            dir,
            'traces',
            `${encounterSet}-L${encounterLevel}-${strategy.policy}`,
          );
          mkdirSync(path, { recursive: true });
          writeFileSync(resolve(path, 'replay.json'), JSON.stringify(run.recording));
          writeFileSync(resolve(path, 'trace.md'), makeTraceReport(run));
        }
      }
      const cell = { set: encounterSet, level: encounterLevel, ...strategy, ...aggregate(group) };
      cells.push(cell);
      counts.push(`${strategy.policy}/${strategy.planning}=${cell.wins}/${count}`);
    }
    console.log(`${encounterSet} L${encounterLevel}: ${counts.join(' ')} (${runs.length})`);
  }
for (const [p, expected] of Object.entries(sourceHashes))
  if (hash(p) !== expected) throw new Error(`実験中にソースが変更されました: ${p}`);
const receipt = {
  version: EXPERIMENT_VERSION,
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes,
  config: { ...DEFAULT_CONFIG, atbMax },
  skillTimings: Object.values(SKILLS).map((s) => ({
    id: s.id,
    cost: s.cost,
    cast: s.cast,
    recovery: 'recovery' in s ? s.recovery : 0,
  })),
  rules: {
    seed: 1307,
    count,
    levels,
    sets: ENCOUNTER_SET_IDS,
    strategies,
    maxSeconds,
    reactionSeconds,
    decisionInterval: 0.25,
  },
  durationMs: performance.now() - started,
  total: runs.length,
  replayVerified: runs.filter((r) => r.replayVerified).length,
  rejectedCommands: runs.reduce((n, r) => n + r.rejectedCommands, 0),
  bursts,
  cells,
};
writeFileSync(resolve(dir, 'results.json'), JSON.stringify(runs));
writeFileSync(resolve(dir, 'pace.json'), JSON.stringify(pace));
writeFileSync(resolve(dir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(
  JSON.stringify({
    dir,
    total: receipt.total,
    replayVerified: receipt.replayVerified,
    rejectedCommands: receipt.rejectedCommands,
    durationMs: receipt.durationMs,
    bursts,
  }),
);
