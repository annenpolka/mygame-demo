import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { ENCOUNTER_SET_IDS } from '../src/content/encounters';
import { runPolicy, EXPERIMENT_VERSION, type RunSummary } from '../src/ai/runner';
import { POLICY_IDS } from '../src/ai/policies';
import type { LoadoutMode } from '../src/ai/composition';

const args = process.argv.slice(2);
const allowed = ['--seeds', '--levels', '--dir'];
for (let i = 0; i < args.length; i += 2)
  if (!allowed.includes(args[i]) || !args[i + 1]) throw new Error('不明・値なしの引数');
const arg = (key: string, fallback: string) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const seeds = Number(arg('--seeds', '5')),
  levels = arg('--levels', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
if (
  !Number.isInteger(seeds) ||
  seeds < 1 ||
  seeds > 100 ||
  levels.some((l) => !Number.isInteger(l) || l < 1 || l > 10) ||
  new Set(levels).size !== levels.length
)
  throw new Error('条件が範囲外');
const dir = resolve(arg('--dir', 'artifacts/party-bonus-study'));
if (existsSync(resolve(dir, 'receipt.json')))
  throw new Error('既存の実験へ上書きしません。別の--dirを指定してください。');
mkdirSync(dir, { recursive: true });
const paths = [
  'src/sim/engine.ts',
  'src/sim/types.ts',
  'src/sim/plan.ts',
  'src/sim/tactics.ts',
  'src/sim/bonuses.ts',
  'src/content/data.ts',
  'src/content/rules.ts',
  'src/content/encounters.ts',
  'src/ai/runner.ts',
  'src/ai/observation.ts',
  'src/ai/policies.ts',
  'src/ai/queue-policy.ts',
  'src/ai/adaptive-policy.ts',
  'src/ai/composition.ts',
  'src/lab/session.ts',
  'src/lab/validation.ts',
  'scripts/bonus-study.ts',
];
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const sourceHashes = Object.fromEntries(paths.map((p) => [p, hash(readFileSync(p))]));
const start = Date.now();
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
// Calibrate only on the unchanged ABS party in the basic encounter. Do not tune each AI.
const calibrationSeeds = [9101, 9102, 9103, 9104, 9105];
const calibration: {
  mode: string;
  scale: number;
  meanSeconds: number;
  wins: number;
  replays: number;
}[] = [];
function calibrate(mode: 'none' | 'strong', scale: number) {
  const runs = calibrationSeeds.map(
    (seed) =>
      runPolicy({
        policy: 'autopilot',
        loadout: 'keep',
        bonusMode: mode,
        enemyHpScale: scale,
        seed,
        maxSeconds: 360,
      }).summary,
  );
  if (runs.some((r) => !r.replayVerified || r.rejectedCommands))
    throw new Error('較正の再生・入力検証に失敗');
  const row = {
    mode,
    scale,
    meanSeconds: mean(runs.map((r) => r.seconds)),
    wins: runs.filter((r) => r.outcome === 'victory').length,
    replays: runs.length,
  };
  calibration.push(row);
  return row;
}
const baseline = calibrate('none', 1);
for (let i = 20; i <= 50; i++) calibrate('strong', i / 20);
const matched = calibration
  .filter((c) => c.mode === 'strong' && c.wins === calibrationSeeds.length)
  .sort(
    (a, b) =>
      Math.abs(a.meanSeconds - baseline.meanSeconds) -
      Math.abs(b.meanSeconds - baseline.meanSeconds),
  )[0];
if (!matched) throw new Error('速度比較の較正が勝利しません');
console.log(
  `較正：なし ${baseline.meanSeconds.toFixed(2)}秒 → 強めHP×${matched.scale} ${matched.meanSeconds.toFixed(2)}秒`,
);
const rows: (RunSummary & { condition: string; stock: string; variant: string })[] = [];
const conditions = [
  { id: 'none', bonusMode: 'none', enemyHpScale: 1 },
  { id: 'modest', bonusMode: 'modest', enemyHpScale: 1 },
  { id: 'strong', bonusMode: 'strong', enemyHpScale: 1 },
  { id: 'matched', bonusMode: 'strong', enemyHpScale: matched.scale },
] as const;
const variants = POLICY_IDS.map((policy) => ({
  id: policy,
  policy,
  loadout: (policy === 'adaptive' || policy === 'assault' ? policy : 'legacy') as LoadoutMode,
  planning: (['tactician', 'focus', 'adaptive', 'assault'].includes(policy)
    ? 'queue'
    : 'legacy') as 'queue' | 'legacy',
}));
const fullVariants = [
  { id: 'adaptive', policy: 'adaptive', loadout: 'adaptive', planning: 'queue' },
  { id: 'assault', policy: 'assault', loadout: 'assault', planning: 'queue' },
  { id: 'adaptive-assault-kit', policy: 'adaptive', loadout: 'assault', planning: 'queue' },
  { id: 'adaptive-kept-kit', policy: 'adaptive', loadout: 'keep', planning: 'queue' },
] as const;
let traceCount = 0;
for (const stock of ['standard', 'full'] as const)
  for (const variant of stock === 'full' ? fullVariants : variants)
    for (const condition of conditions)
      for (const encounterSet of ENCOUNTER_SET_IDS)
        for (const encounterLevel of levels)
          for (let i = 0; i < seeds; i++) {
            const run = runPolicy({
              policy: variant.policy,
              loadout: variant.loadout,
              planning: variant.planning,
              bonusMode: condition.bonusMode,
              enemyHpScale: condition.enemyHpScale,
              fullInventory: stock === 'full',
              encounterSet,
              encounterLevel,
              seed: 1307 + i,
              maxSeconds: 240,
            });
            if (!run.summary.replayVerified || run.summary.rejectedCommands) {
              writeFileSync(resolve(dir, 'failure.json'), JSON.stringify(run));
              throw new Error(
                `再生または入力検証に失敗：${variant.id} ${condition.id} ${encounterSet} ${encounterLevel}`,
              );
            }
            rows.push({ ...run.summary, condition: condition.id, stock, variant: variant.id });
            if (
              stock === 'standard' &&
              variant.policy === 'adaptive' &&
              condition.id === 'strong' &&
              i === 0 &&
              [1, 5, 10].includes(encounterLevel)
            ) {
              const name = `${encounterSet}-${encounterLevel}`;
              writeFileSync(resolve(dir, `${name}-replay.json`), JSON.stringify(run.recording));
              writeFileSync(
                resolve(dir, `${name}-trace.json`),
                JSON.stringify({
                  summary: run.summary,
                  decisions: run.decisions,
                  events: run.events,
                }),
              );
              traceCount++;
            }
            if (rows.length % 200 === 0)
              console.log(`${rows.length} runs · ${((Date.now() - start) / 1000).toFixed(1)}s`);
          }
const groups = new Map<string, typeof rows>();
for (const r of rows) {
  const key = [r.stock, r.variant, r.condition, r.encounterSet, r.encounterLevel].join('/');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(r);
}
const aggregate = [...groups].map(([key, runs]) => ({
  key,
  n: runs.length,
  wins: runs.filter((r) => r.outcome === 'victory').length,
  losses: runs.filter((r) => r.outcome === 'defeat').length,
  timeouts: runs.filter((r) => r.outcome === 'timeout').length,
  meanSeconds: mean(runs.map((r) => r.seconds)),
  victorySeconds: mean(runs.filter((r) => r.outcome === 'victory').map((r) => r.seconds)),
  meanTaken: mean(runs.map((r) => r.metrics.taken)),
  meanHealed: mean(runs.map((r) => r.metrics.healed)),
  meanBreaks: mean(runs.map((r) => r.metrics.breaks)),
  meanShifts: mean(runs.map((r) => r.shifts)),
  meanMoves: mean(runs.map((r) => r.moves)),
  meanCancellations: mean(runs.map((r) => r.cancellations)),
  meanFinalHp: mean(runs.map((r) => r.finalHp.reduce((a, b) => a + b, 0))),
}));
const roles: Record<string, Record<string, number>> = {};
for (const r of rows) {
  const key = `${r.stock}/${r.variant}/${r.condition}`;
  roles[key] ??= {};
  for (const [role, time] of Object.entries(r.activeRoleSeconds)) {
    const name = role.split('').sort().join('');
    roles[key][name] = (roles[key][name] ?? 0) + time;
  }
}
for (const [p, h] of Object.entries(sourceHashes))
  if (hash(readFileSync(p)) !== h) throw new Error(`実験中にソースが変わりました：${p}`);
const raw = gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(resolve(dir, 'runs.jsonl.gz'), raw);
const receipt = {
  version: EXPERIMENT_VERSION,
  sourceHashes,
  rows: rows.length,
  calibrationRuns: calibration.reduce((n, c) => n + c.replays, 0),
  replays: rows.length + calibration.reduce((n, c) => n + c.replays, 0),
  rejectedCommands: 0,
  seeds: Array.from({ length: seeds }, (_, i) => 1307 + i),
  levels,
  conditions,
  calibration,
  matched,
  baseline,
  aggregate,
  roles,
  traceCount,
  rawSha256: hash(raw),
  wallSeconds: (Date.now() - start) / 1000,
};
writeFileSync(resolve(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(
  JSON.stringify({
    runs: rows.length,
    matched: matched.scale,
    replays: receipt.replays,
    wallSeconds: receipt.wallSeconds,
    receipt: resolve(dir, 'receipt.json'),
  }),
);
