import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { runPolicy, EXPERIMENT_VERSION, type RunOptions } from '../src/ai/runner';
import { POLICY_IDS } from '../src/ai/policies';
import { ENCOUNTER_SET_IDS } from '../src/content/encounters';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2)
  if (!['--dir', '--repeat'].includes(args[i]) || !args[i + 1])
    throw new Error('不明・値なしの引数');
const arg = (k: string, v: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : v);
const dir = resolve(arg('--dir', 'artifacts/headless-bench'));
const repeats = Number(arg('--repeat', '3'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20)
  throw new Error('repeat must be 1..20');
if (existsSync(resolve(dir, 'receipt.json'))) throw new Error('既存の計測は上書きしません');
mkdirSync(dir, { recursive: true });
const hash = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
const paths = [
  'src/sim/engine.ts',
  'src/sim/bonuses.ts',
  'src/content/data.ts',
  'src/ai/runner.ts',
  'src/ai/observation.ts',
  'src/ai/composition.ts',
  'src/ai/adaptive-policy.ts',
  'src/ai/policies.ts',
  'src/ai/queue-policy.ts',
  'src/lab/session.ts',
  'scripts/headless-bench.ts',
];
const sourceHashes = Object.fromEntries(paths.map((p) => [p, hash(readFileSync(p))]));
const cases: RunOptions[] = [];
for (const policy of POLICY_IDS)
  for (const encounterSet of ENCOUNTER_SET_IDS)
    for (const encounterLevel of [1, 5])
      for (const fullInventory of [false, true])
        cases.push({
          policy,
          encounterSet,
          encounterLevel,
          fullInventory,
          bonusMode: 'strong',
          planning: ['tactician', 'focus', 'adaptive', 'assault'].includes(policy)
            ? 'queue'
            : 'legacy',
          seed: 1307,
          maxSeconds: 240,
        });
// Warm the engine and policy code; cold loadout keys remain represented in pass 1.
for (const policy of POLICY_IDS) runPolicy({ policy, maxSeconds: 10 });
const samples: { milliseconds: number; digests: string[] }[] = [];
let rows: unknown[] = [];
for (let pass = 0; pass < repeats; pass++) {
  let milliseconds = 0;
  const digests: string[] = [];
  const summaries: unknown[] = [];
  for (const options of cases) {
    const start = performance.now();
    const run = runPolicy(options);
    milliseconds += performance.now() - start;
    if (!run.summary.replayVerified || run.summary.rejectedCommands)
      throw new Error('再生・入力検証に失敗');
    const digest = hash(JSON.stringify({ summary: run.summary, recording: run.recording }));
    digests.push(digest);
    summaries.push(run.summary);
  }
  if (pass && JSON.stringify(digests) !== JSON.stringify(samples[0].digests))
    throw new Error('繰り返し結果が不一致');
  samples.push({ milliseconds, digests });
  rows = summaries;
  console.log(`pass ${pass + 1}: ${cases.length} runs in ${(milliseconds / 1000).toFixed(3)}s`);
}
for (const p of paths)
  if (hash(readFileSync(p)) !== sourceHashes[p]) throw new Error(`実行中に変更: ${p}`);
const raw = gzipSync(JSON.stringify(rows));
writeFileSync(resolve(dir, 'summaries.json.gz'), raw);
writeFileSync(
  resolve(dir, 'receipt.json'),
  JSON.stringify(
    {
      version: EXPERIMENT_VERSION,
      node: process.version,
      cpu: cpus()[0]?.model,
      cases: cases.length,
      repeats,
      replayChecks: cases.length * repeats,
      samples,
      sourceHashes,
      rawSha256: hash(raw),
    },
    null,
    2,
  ),
);
