import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG } from '../src/content/data';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ENCOUNTER_SET_IDS,
  ENCOUNTER_SETS,
  pressure,
  type EncounterSetId,
} from '../src/content/encounters';
import { POLICY_IDS, POLICY_INFO } from '../src/ai/policies';
import { EXPERIMENT_VERSION, runPolicy, type RunSummary, type RunResult } from '../src/ai/runner';
import { makeTraceReport } from '../src/ai/report';

const args = process.argv.slice(2);
const allowed = ['--seeds', '--seed', '--levels', '--sets', '--dir', '--max-seconds'];
for (let i = 0; i < args.length; i += 2)
  if (!allowed.includes(args[i]) || !args[i + 1]) throw new Error(`不明・値なし: ${args[i]}`);
const value = (key: string, fallback: string) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const count = Number(value('--seeds', '20')),
  seed = Number(value('--seed', '1307')),
  maxSeconds = Number(value('--max-seconds', '180'));
const levels = value('--levels', '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const sets = value('--sets', 'bulwark,crossfire,pursuit,attrition').split(',') as EncounterSetId[];
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 1000 ||
  !Number.isInteger(seed) ||
  seed < 0 ||
  seed + count - 1 > 4294967295 ||
  !Number.isFinite(maxSeconds) ||
  maxSeconds < 1 ||
  maxSeconds > 3600 ||
  levels.some((l) => !Number.isInteger(l) || l < 1 || l > 10) ||
  new Set(levels).size !== levels.length ||
  sets.some((s) => !ENCOUNTER_SET_IDS.includes(s)) ||
  new Set(sets).size !== sets.length
)
  throw new Error('実験条件が範囲外・重複です。');
levels.sort((a, b) => a - b);
const dir = resolve(value('--dir', 'artifacts/ai-limits'));
mkdirSync(dir, { recursive: true });
const hash = (path: string) =>
  createHash('sha256')
    .update(readFileSync(new URL(`../${path}`, import.meta.url)))
    .digest('hex');
const frozen = {
  'src/ai/policies.ts': '1b4722e815973cafd706df6fbd61ba7a43bd0c730ad9a81810a3acce09dc4357',
  'src/ai/observation.ts': 'd0b6928fa7b1bd1067893353a6c15aefeb01460f571337e2983d2eacfc643533',
  'src/ai/adaptive-policy.ts': '5b9a053cae75e3763b8ce73441387fa790c6f49c7484a6183500e653c0418d9a',
  'src/ai/composition.ts': '26310609efa549573a5555450dc896fff90d5c60b70a018cabf0e0fdbf0451d1',
  'src/ai/queue-policy.ts': 'dcca45f5dd1d26d60d88a87656b799f4ebf4f0514c275361ef240439eb0e479d',
};
for (const [path, expected] of Object.entries(frozen))
  if (hash(path) !== expected) throw new Error(`固定した現行AIが変更されています: ${path}`);
const paths = [
  ...Object.keys(frozen),
  'src/ai/runner.ts',
  'src/ai/report.ts',
  'src/sim/bonuses.ts',
  'src/ai/adaptive-policy.ts',
  'src/ai/composition.ts',
  'src/sim/engine.ts',
  'src/sim/types.ts',
  'src/sim/plan.ts',
  'src/sim/tactics.ts',
  'src/ai/queue-policy.ts',
  'src/content/data.ts',
  'src/content/encounters.ts',
  'src/lab/session.ts',
  'src/lab/validation.ts',
  'scripts/limits.ts',
];
const sourceHashes = Object.fromEntries(paths.map((p) => [p, hash(p)]));
function trace(path: string, run: RunResult) {
  mkdirSync(path, { recursive: true });
  writeFileSync(resolve(path, 'replay.json'), JSON.stringify(run.recording));
  writeFileSync(
    resolve(path, 'events.jsonl'),
    run.events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  writeFileSync(
    resolve(path, 'decisions.jsonl'),
    run.decisions.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  writeFileSync(resolve(path, 'samples.json'), JSON.stringify(run.samples));
  writeFileSync(resolve(path, 'trace.md'), makeTraceReport(run));
}
const runs: RunSummary[] = [];
const started = performance.now();
for (const encounterSet of sets)
  for (const encounterLevel of levels) {
    for (const policy of POLICY_IDS) {
      const saved = new Set<string>();
      for (let i = 0; i < count; i++) {
        const run = runPolicy({
          policy,
          encounterSet,
          encounterLevel,
          seed: seed + i,
          maxSeconds,
          verifyReplay: true,
        });
        runs.push(run.summary);
        if (!saved.has(run.summary.outcome)) {
          trace(
            resolve(
              dir,
              'traces',
              encounterSet,
              `level-${encounterLevel}`,
              policy,
              run.summary.outcome,
            ),
            run,
          );
          saved.add(run.summary.outcome);
        }
      }
    }
    console.log(
      `${encounterSet} L${encounterLevel}: ${POLICY_IDS.map((p) => `${p}=${runs.filter((r) => r.encounterSet === encounterSet && r.encounterLevel === encounterLevel && r.policy === p && r.outcome === 'victory').length}/${count}`).join(' ')} (${runs.length} runs)`,
    );
    writeFileSync(
      resolve(dir, 'results.json'),
      JSON.stringify(
        {
          version: EXPERIMENT_VERSION,
          sourceHashes,
          rules: {
            levels,
            sets,
            seed,
            count,
            maxSeconds,
            enemyPower: 1,
            atbRate: DEFAULT_CONFIG.atbRate,
            decisionInterval: 0.25,
            reactionSeconds: 0.35,
            reliableObservedWinRate: 0.9,
            pressure: levels.map((level) => ({ level, ...pressure(level) })),
          },
          durationMs: performance.now() - started,
          runs,
        },
        null,
        2,
      ),
    );
  }
for (const [path, expected] of Object.entries(sourceHashes))
  if (hash(path) !== expected) throw new Error(`実験中にソースが変更されました: ${path}`);
const lines = [
  '# 現行6 AIの攻略境界',
  '',
  `4系統を基本とする固定戦闘セットを、各条件 ${count} seed（${seed}〜${seed + count - 1}）で実行。今回 ${sets.length} セット × ${levels.length} 強度 × 6 AI = ${runs.length} ラン。`,
  '',
  '勝利は2連戦の両方を突破した場合のみ。各ラン実時間 ' +
    maxSeconds +
    ' 秒で打ち切り。敵HPは強度ごとに前段階の1.30倍、ダメージは1.40倍。攻撃周期・予告時間・配置は強度内で固定。',
  '',
  'AIは policies-2 の判断・観測コードをSHA-256で固定。共通の戦間装備更新も従来どおり。全入力を再生して最終状態の完全一致を検証。',
  '',
  '**表は観測勝率であり、真の勝率や単調性の保証ではない。強度を飛ばさず測定した範囲で比較し、未測定領域へ外挿しない。**',
  '',
  `完全一致 ${runs.filter((r) => r.replayVerified).length}/${runs.length}、拒否入力 ${runs.reduce((n, r) => n + r.rejectedCommands, 0)}。`,
  '',
];
const boundaries = [];
for (const set of sets) {
  lines.push(
    `## ${ENCOUNTER_SETS[set].name}`,
    '',
    ENCOUNTER_SETS[set].description,
    '',
    `| AI | ${levels.map((l) => `L${l}`).join(' | ')} | ≥90%の最高強度 |`,
    `| --- | ${levels.map(() => '---:').join(' | ')} | ---: |`,
  );
  for (const policy of POLICY_IDS) {
    const cells = levels.map((level) => {
      const rs = runs.filter(
        (r) => r.encounterSet === set && r.encounterLevel === level && r.policy === policy,
      );
      return {
        level,
        wins: rs.filter((r) => r.outcome === 'victory').length,
        defeats: rs.filter((r) => r.outcome === 'defeat').length,
        timeouts: rs.filter((r) => r.outcome === 'timeout').length,
      };
    });
    const reliable = cells.filter((c) => c.wins / count >= 0.9).at(-1)?.level ?? null;
    const perfect = cells.filter((c) => c.wins === count).at(-1)?.level ?? null;
    const firstBelow = cells.find((c) => c.wins / count < 0.9)?.level ?? null;
    boundaries.push({ set, policy, reliable, perfect, firstBelow, cells });
    lines.push(
      `| ${POLICY_INFO[policy].name} | ${cells.map((c) => `${c.wins}/${count}${c.timeouts ? ` (T${c.timeouts})` : ''}`).join(' | ')} | ${reliable === null ? 'なし' : `L${reliable}${reliable === levels.at(-1) ? '以上（上端到達）' : ''}`} |`,
    );
  }
  lines.push('');
}
lines.push(
  '## 記録',
  '',
  '`results.json` に全ランの勝敗、死亡数、残HP、被ダメージ、集中力、薬、行動内訳、ブレイク・移動・予告解決結果とソースハッシュを保存。`boundaries.json` に各強度の勝敗集計を保存。',
  '',
  '`traces/<セット>/level-N/<AI>/<victory|defeat|timeout>/` に、その条件で最初に観測した各勝敗のイベント全文・判断理由・時系列サンプル・リプレイを保存。ファイル名の勝敗だけでなく trace.md の seed を確認して再現できる。',
  '',
  '既存シミュレータ内での観測。戦闘セットの追加はゲーム全体のバランスや最適戦略の証明ではない。',
);
writeFileSync(resolve(dir, 'boundaries.json'), JSON.stringify(boundaries, null, 2));
writeFileSync(resolve(dir, 'report.md'), lines.join('\n') + '\n');
console.log(
  `完了: ${runs.length} runs / ${((performance.now() - started) / 1000).toFixed(1)}s → ${dir}`,
);
