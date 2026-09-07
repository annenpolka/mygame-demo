import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  runPolicy,
  EXPERIMENT_VERSION,
  type PlanningMode,
  type RunSummary,
  type RunResult,
} from '../src/ai/runner';
import { ENCOUNTER_SETS, type EncounterSetId } from '../src/content/encounters';
import { makeTraceReport, aggregate } from '../src/ai/report';
const args = process.argv.slice(2);
const keys = ['--seeds', '--seed', '--levels', '--dir'];
for (let i = 0; i < args.length; i += 2)
  if (!keys.includes(args[i]) || !args[i + 1]) throw new Error(`不明な引数: ${args[i]}`);
const val = (key: string, fallback: string) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const count = Number(val('--seeds', '20')),
  seed = Number(val('--seed', '1307')),
  levels = val('--levels', '1,2,3,4,5,6,7,8,9,10')
    .split(',')
    .map(Number)
    .sort((a, b) => a - b),
  dir = resolve(val('--dir', 'artifacts/queue-study'));
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 1000 ||
  !Number.isInteger(seed) ||
  seed < 0 ||
  seed + count > 4294967296 ||
  levels.some((l) => !Number.isInteger(l) || l < 1 || l > 10) ||
  new Set(levels).size !== levels.length
)
  throw new Error('実行条件が範囲外です。');
const sets: EncounterSetId[] = ['bulwark', 'crossfire', 'pursuit', 'attrition'],
  modes: PlanningMode[] = ['legacy', 'next', 'queue'],
  policies = ['tactician', 'focus'] as const;
const paths = [
  'src/sim/engine.ts',
  'src/sim/plan.ts',
  'src/sim/types.ts',
  'src/content/data.ts',
  'src/content/encounters.ts',
  'src/ai/policies.ts',
  'src/ai/queue-policy.ts',
  'src/ai/observation.ts',
  'src/ai/runner.ts',
  'src/ai/report.ts',
  'src/lab/session.ts',
  'src/lab/validation.ts',
  'scripts/queue-study.ts',
];
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const sourceHashes = Object.fromEntries(paths.map((p) => [p, hash(p)]));
if (
  hash('src/ai/policies.ts') !== '292513ec6b6d8e1d8205fc4f44b0ec574278f6944cc79e0fe8cefed4c4097d67'
)
  throw new Error('比較元AIが変更されています。');
const baselinePath = 'artifacts/ai-limits/results.json';
const baseline: RunSummary[] = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8')).runs
  : [];
const prior = new Map(
  baseline.map((r) => [`${r.encounterSet}/${r.encounterLevel}/${r.policy}/${r.seed}`, r.finalHash]),
);
let checkedBaseline = 0;
const runs: RunSummary[] = [];
const started = performance.now();
mkdirSync(dir, { recursive: true });
function trace(path: string, r: RunResult) {
  mkdirSync(path, { recursive: true });
  writeFileSync(resolve(path, 'replay.json'), JSON.stringify(r.recording));
  writeFileSync(
    resolve(path, 'events.jsonl'),
    r.events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  writeFileSync(
    resolve(path, 'decisions.jsonl'),
    r.decisions.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  writeFileSync(resolve(path, 'trace.md'), makeTraceReport(r));
}
for (const set of sets)
  for (const level of levels) {
    for (const policy of policies)
      for (const planning of modes) {
        const seen = new Set<string>();
        for (let i = 0; i < count; i++) {
          const run = runPolicy({
            policy,
            planning,
            encounterSet: set,
            encounterLevel: level,
            seed: seed + i,
          });
          runs.push(run.summary);
          const previous = prior.get(`${set}/${level}/${policy}/${seed + i}`);
          if (planning === 'legacy' && previous) {
            if (run.summary.finalHash !== previous)
              throw new Error(`旧AIの結果が変わりました: ${set}/${level}/${policy}/${seed + i}`);
            checkedBaseline++;
          }
          if (!seen.has(run.summary.outcome)) {
            trace(
              resolve(dir, 'traces', set, `level-${level}`, policy, planning, run.summary.outcome),
              run,
            );
            seen.add(run.summary.outcome);
          }
        }
      }
    console.log(
      `${set} L${level}: ${policies.map((p) => `${p}[${modes.map((m) => `${m}=${runs.filter((r) => r.encounterSet === set && r.encounterLevel === level && r.policy === p && r.planning === m && r.outcome === 'victory').length}/${count}`).join(' ')}]`).join(' ')}`,
    );
  }
for (const [p, h] of Object.entries(sourceHashes))
  if (hash(p) !== h) throw new Error(`実行中にソースが変わりました: ${p}`);
const groups = sets.flatMap((set) =>
  policies.flatMap((policy) =>
    modes.map((planning) => {
      const cells = levels.map((level) => {
        const rs = runs.filter(
          (r) =>
            r.encounterSet === set &&
            r.encounterLevel === level &&
            r.policy === policy &&
            r.planning === planning,
        );
        return {
          level,
          ...aggregate(rs),
          duringAction: rs.reduce((n, r) => n + r.queuedDuringAction, 0),
          appended: rs.reduce((n, r) => n + r.appendedPlans, 0),
          maxQueueDepth: Math.max(...rs.map((r) => r.maxQueueDepth)),
        };
      });
      return {
        set,
        policy,
        planning,
        highest90: cells.filter((c) => c.wins / c.trials >= 0.9).at(-1)?.level ?? null,
        cells,
      };
    }),
  ),
);
const receipt = {
  version: EXPERIMENT_VERSION,
  sourceHashes,
  rules: {
    sets,
    levels,
    policies,
    modes,
    seed,
    count,
    maxSeconds: 180,
    decisionInterval: 0.25,
    reactionSeconds: 0.35,
    humanQueueLimit: 6,
    aiQueueDepth: { legacy: 1, next: 1, queue: 3 },
  },
  checkedBaseline,
  runs: runs.length,
  replayVerified: runs.filter((r) => r.replayVerified).length,
  rejected: runs.reduce((n, r) => n + r.rejectedCommands, 0),
  durationMs: performance.now() - started,
  groups,
};
writeFileSync(resolve(dir, 'results.json'), JSON.stringify({ ...receipt, runs }, null, 2));
writeFileSync(resolve(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
const lines = [
  '# 行動中・複数手の予約を使うAIの比較',
  '',
  `${runs.length}ラン。全リプレイ一致 ${receipt.replayVerified}、拒否入力 ${receipt.rejected}。以前の実行結果との最終状態ハッシュ一致 ${checkedBaseline}件。`,
  '',
  'legacyは以前のAI、nextは行動中にも次の1手を予約、queueは同じ新AIで最大3手先まで積む。人間・AIの共通上限は6手。緊急時は攻撃予約を取消してから防御・薬を追加し、並べ替えは使わない。',
  '',
  `各条件${count} seed、180実秒で打ち切り。勝率90%以上を観測上の突破基準とする。失敗の時間をクリア平均へ混ぜない。`,
  '',
];
for (const set of sets) {
  lines.push(
    `## ${ENCOUNTER_SETS[set].name}`,
    '',
    `| AI / 予約方式 | ${levels.map((l) => `L${l}`).join(' | ')} | 90%以上の上限 |`,
    `|---|${levels.map(() => '---:').join('|')}|---:|`,
  );
  for (const g of groups.filter((g) => g.set === set))
    lines.push(
      `| ${g.policy} / ${g.planning} | ${g.cells.map((c) => `${c.wins}/${c.trials}${c.timeouts ? ` (T${c.timeouts})` : ''}`).join(' | ')} | ${g.highest90 ?? 'なし'} |`,
    );
  lines.push('');
}
writeFileSync(resolve(dir, 'report.md'), lines.join('\n') + '\n');
console.log(`完了 ${runs.length}ラン / ${(receipt.durationMs / 1000).toFixed(1)}秒 → ${dir}`);
