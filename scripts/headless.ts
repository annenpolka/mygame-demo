import { DEFAULT_CONFIG } from '../src/content/data';
import type { EncounterSetId } from '../src/content/encounters';
import { performance } from 'node:perf_hooks';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runReplay } from '../src/lab/session';
import { parseRecording } from '../src/lab/validation';
import {
  POLICY_IDS,
  POLICY_INFO,
  ABLATIONS,
  type PolicyId,
  type Ablation,
} from '../src/ai/policies';
import { createHash } from 'node:crypto';
import { EXPERIMENT_VERSION, runPolicy, type RunSummary, type RunResult } from '../src/ai/runner';
import { aggregate, makeComparisonReport, makeTraceReport } from '../src/ai/report';
import type { Config } from '../src/sim/types';

const args = process.argv.slice(2);
const flags = new Set(['--compare', '--study', '--help', '--list']);
const values = new Set([
  '--planning',
  '--set',
  '--level',
  '--policy',
  '--seed',
  '--seeds',
  '--powers',
  '--enemy-power',
  '--atb',
  '--atb-max',
  '--out',
  '--dir',
  '--replay',
  '--interval',
  '--reaction',
  '--max-seconds',
  '--ablation',
]);
for (let i = 0; i < args.length; i++) {
  if (flags.has(args[i])) continue;
  if (!values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--'))
    throw new Error(`不明または値のないオプション: ${args[i]}`);
  i++;
}
const value = (key: string) => {
  const i = args.indexOf(key);
  return i < 0 ? undefined : args[i + 1];
};
function saveTrace(dir: string, run: RunResult) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'replay.json'), JSON.stringify(run.recording, null, 2));
  writeFileSync(resolve(dir, 'trace.md'), makeTraceReport(run));
  writeFileSync(
    resolve(dir, 'events.jsonl'),
    run.events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  writeFileSync(
    resolve(dir, 'decisions.jsonl'),
    run.decisions.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  writeFileSync(resolve(dir, 'samples.json'), JSON.stringify(run.samples));
}
function sourceHashes() {
  return Object.fromEntries(
    [
      'src/sim/engine.ts',
      'src/sim/types.ts',
      'src/sim/plan.ts',
      'src/sim/tactics.ts',
      'src/ai/queue-policy.ts',
      'src/content/data.ts',
      'src/content/encounters.ts',
      'src/lab/session.ts',
      'src/lab/validation.ts',
      'src/ai/policies.ts',
      'src/ai/observation.ts',
      'src/ai/runner.ts',
      'src/ai/report.ts',
      'scripts/headless.ts',
    ].map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(new URL(`../${path}`, import.meta.url)))
        .digest('hex'),
    ]),
  );
}
if (args.includes('--help') || args.includes('--list')) {
  console.log(
    'npm run sim -- --policy tactician --seed 1307 --dir artifacts/ai-run\n' +
      'npm run sim -- --compare --seeds 20 --seed 1307 --powers 1,2,3 --dir artifacts/ai-comparison\n' +
      'npm run sim -- --study --seeds 30 --seed 1307 --dir artifacts/ai-study\n' +
      'npm run sim -- --replay path/to/replay.json [--atb 1.2 --enemy-power 2]\n' +
      '追加設定: --planning legacy|next|queue --atb-max 2〜8 --set belfry|bulwark|crossfire|pursuit|attrition --level 1〜10 --interval 0.25 --reaction 0.35 --max-seconds 180 --ablation none|no-pull|no-row|no-defense\n',
  );
  console.log(POLICY_IDS.map((id) => `${id}: ${POLICY_INFO[id].description}`).join('\n'));
} else if (value('--replay')) {
  const start = performance.now();
  const recording = parseRecording(readFileSync(value('--replay')!, 'utf8'));
  const override: Partial<Config> = {};
  if (value('--atb-max'))
    throw new Error(
      '--atb-maxは新しい戦闘の設定です。既存の予約容量を変えるリプレイ比較には使えません。',
    );
  if (value('--atb')) override.atbRate = Number(value('--atb'));
  if (value('--enemy-power')) override.enemyPower = Number(value('--enemy-power'));
  if (
    Object.values(override).some(
      (x) => typeof x === 'number' && (!Number.isFinite(x) || x < 0.2 || x > 3),
    )
  )
    throw new Error('比較値は0.2〜3で指定してください。');
  const state = runReplay(recording, Object.keys(override).length ? override : undefined);
  console.log(
    JSON.stringify(
      {
        mode: Object.keys(override).length ? 'counterfactual-comparison' : 'exact-replay',
        phase: state.phase,
        battleTime: state.time,
        metrics: state.metrics,
        elapsedMs: performance.now() - start,
      },
      null,
      2,
    ),
  );
} else {
  const policy = (value('--policy') ?? 'balanced') as PolicyId;
  if (!POLICY_IDS.includes(policy)) throw new Error(`不明なAI: ${policy}`);
  const ablation = (value('--ablation') ?? 'none') as Ablation;
  if (!ABLATIONS.includes(ablation)) throw new Error(`不明な切除条件: ${ablation}`);
  const seed = Number(value('--seed') ?? 1307);
  const opts = {
    planning: (value('--planning') ?? 'legacy') as import('../src/ai/runner').PlanningMode,
    encounterSet: value('--set') as EncounterSetId | undefined,
    encounterLevel: value('--level') ? Number(value('--level')) : undefined,
    ablation,
    seed,
    atbRate: Number(value('--atb') ?? DEFAULT_CONFIG.atbRate),
    atbMax: Number(value('--atb-max') ?? DEFAULT_CONFIG.atbMax),
    decisionInterval: Number(value('--interval') ?? 0.25),
    reactionSeconds: Number(value('--reaction') ?? 0.35),
    maxSeconds: Number(value('--max-seconds') ?? 180),
  };
  const start = performance.now();
  if (args.includes('--study')) {
    const count = Number(value('--seeds') ?? 30);
    if (!Number.isInteger(count) || count < 1 || count > 1000)
      throw new Error('seed数は1〜1000の整数にしてください。');
    const dir = resolve(value('--dir') ?? 'artifacts/ai-study');
    mkdirSync(dir, { recursive: true });
    const runs: (RunSummary & { study: 'ablation' | 'reaction' })[] = [];
    for (const enemyPower of [1, 3])
      for (const ablation of ABLATIONS) {
        for (let i = 0; i < count; i++) {
          const run = runPolicy({
            ...opts,
            policy: 'tactician',
            enemyPower,
            ablation,
            seed: seed + i,
          });
          runs.push({ ...run.summary, study: 'ablation' });
          if (i === 0) saveTrace(resolve(dir, 'traces', `power-${enemyPower}`, ablation), run);
        }
      }
    for (const reactionSeconds of [0, 0.35, 1.25])
      for (const policy of ['tactician', 'focus'] as const) {
        for (let i = 0; i < count; i++) {
          const run = runPolicy({
            ...opts,
            policy,
            enemyPower: 3,
            ablation: 'none',
            reactionSeconds,
            seed: seed + i,
          });
          runs.push({ ...run.summary, study: 'reaction' });
          if (i === 0)
            saveTrace(resolve(dir, 'traces', `reaction-${reactionSeconds}`, policy), run);
        }
      }
    const durationMs = performance.now() - start;
    writeFileSync(
      resolve(dir, 'results.json'),
      JSON.stringify(
        { version: EXPERIMENT_VERSION, sourceHashes: sourceHashes(), durationMs, runs },
        null,
        2,
      ),
    );
    const lines = [
      '# 予告対応AIの追加比較',
      '',
      `各条件 ${count} seed、合計 ${runs.length} ラン。`,
      '',
      '## 機能を一つずつ外す',
      '',
      '| 敵攻撃 | 外した機能 | 勝利 | 戦闘秒 | 被ダメージ |',
      '| --- | --- | ---: | ---: | ---: |',
    ];
    for (const enemyPower of [1, 3])
      for (const ablation of ABLATIONS) {
        const a = aggregate(
          runs.filter(
            (r) => r.study === 'ablation' && r.enemyPower === enemyPower && r.ablation === ablation,
          ),
        );
        lines.push(
          `| ${enemyPower} | ${ablation} | ${a.wins}/${count} | ${a.winSeconds?.toFixed(2) ?? '—'} | ${a.winTaken?.toFixed(0) ?? '—'} |`,
        );
      }
    lines.push(
      '',
      '## 反応時間とスロー（敵攻撃3倍）',
      '',
      '| 反応待ち（実秒） | AI | 勝利 | 戦闘秒 | 実秒 | 被ダメージ | 集中力 |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const reactionSeconds of [0, 0.35, 1.25])
      for (const policy of ['tactician', 'focus'] as const) {
        const a = aggregate(
          runs.filter(
            (r) =>
              r.study === 'reaction' &&
              r.reactionSeconds === reactionSeconds &&
              r.policy === policy,
          ),
        );
        lines.push(
          `| ${reactionSeconds} | ${policy} | ${a.wins}/${count} | ${a.winSeconds?.toFixed(2) ?? '—'} | ${a.winRealSeconds?.toFixed(2) ?? '—'} | ${a.winTaken?.toFixed(0) ?? '—'} | ${a.winFocus?.toFixed(1) ?? '—'} |`,
        );
      }
    lines.push(
      '',
      '平均は勝利ランのみ。反応待ちは人間の実測値ではなく人工的な遅延。指示は次の観測時点に発行されるため観測周期の倍数へ切り上がる。',
      `完全一致リプレイ ${runs.filter((r) => r.replayVerified).length}/${runs.length}。拒否されたコマンド ${runs.reduce((n, r) => n + r.rejectedCommands, 0)}。`,
      '',
    );
    writeFileSync(resolve(dir, 'report.md'), lines.join('\n'));
    console.log(
      JSON.stringify(
        { mode: 'study', runs: runs.length, durationMs, report: resolve(dir, 'report.md') },
        null,
        2,
      ),
    );
  } else if (args.includes('--compare')) {
    const count = Number(value('--seeds') ?? 20);
    if (!Number.isInteger(count) || count < 1 || count > 1000)
      throw new Error('seed数は1〜1000の整数にしてください。');
    const powers = (value('--powers') ?? '1,2,3').split(',').map(Number);
    if (
      !powers.length ||
      powers.some((x) => !Number.isFinite(x) || x < 0.2 || x > 3) ||
      new Set(powers).size !== powers.length
    )
      throw new Error('倍率は重複しない0.2〜3の数値リストにしてください。');
    const dir = resolve(value('--dir') ?? 'artifacts/ai-comparison');
    mkdirSync(dir, { recursive: true });
    const runs: RunSummary[] = [];
    for (const enemyPower of powers)
      for (const id of POLICY_IDS) {
        for (let i = 0; i < count; i++) {
          const run = runPolicy({ ...opts, policy: id, seed: seed + i, enemyPower });
          runs.push(run.summary);
          if (i === 0) saveTrace(resolve(dir, 'traces', `power-${enemyPower}`, id), run);
        }
        const a = aggregate(runs.filter((r) => r.enemyPower === enemyPower && r.policy === id));
        process.stderr.write(
          `${id} power=${enemyPower}: ${a.wins}/${a.trials} victories, ${a.winSeconds?.toFixed(2) ?? '—'}s\n`,
        );
      }
    const durationMs = performance.now() - start;
    writeFileSync(
      resolve(dir, 'results.json'),
      JSON.stringify(
        { version: EXPERIMENT_VERSION, sourceHashes: sourceHashes(), durationMs, runs },
        null,
        2,
      ),
    );
    writeFileSync(resolve(dir, 'report.md'), makeComparisonReport(runs, durationMs));
    console.log(
      JSON.stringify(
        {
          mode: 'comparison',
          runs: runs.length,
          durationMs,
          verified: runs.filter((r) => r.replayVerified).length,
          report: resolve(dir, 'report.md'),
        },
        null,
        2,
      ),
    );
  } else {
    const run = runPolicy({ ...opts, policy, enemyPower: Number(value('--enemy-power') ?? 1) });
    if (value('--out')) writeFileSync(value('--out')!, JSON.stringify(run.recording, null, 2));
    if (value('--dir')) saveTrace(resolve(value('--dir')!), run);
    console.log(
      JSON.stringify(
        {
          mode: 'policy-run',
          version: EXPERIMENT_VERSION,
          ...run.summary,
          elapsedMs: performance.now() - start,
        },
        null,
        2,
      ),
    );
    if (run.summary.outcome !== 'victory') process.exitCode = 1;
  }
}
