import { ENCOUNTER_SETS } from '../content/encounters';
import { POLICY_IDS, POLICY_INFO } from './policies';
import { EXPERIMENT_VERSION, type RunResult, type RunSummary } from './runner';

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const display = (x: number | null, digits = 1) => (x === null ? '—' : x.toFixed(digits));
export function aggregate(runs: RunSummary[]) {
  const wins = runs.filter((r) => r.outcome === 'victory');
  return {
    trials: runs.length,
    wins: wins.length,
    defeats: runs.filter((r) => r.outcome === 'defeat').length,
    timeouts: runs.filter((r) => r.outcome === 'timeout').length,
    // Failed partial runs are never counted as fast clears.
    winSeconds: average(wins.map((r) => r.seconds)),
    winRealSeconds: average(wins.map((r) => r.realSeconds)),
    winTaken: average(wins.map((r) => r.metrics.taken)),
    winFocus: average(wins.map((r) => r.metrics.focusUsed)),
    winInputs: average(wins.map((r) => r.metrics.inputs)),
    winMoves: average(wins.map((r) => r.moves)),
    winBreaks: average(wins.map((r) => r.metrics.breaks)),
    winMinSeconds: wins.length ? Math.min(...wins.map((r) => r.seconds)) : null,
    winMaxSeconds: wins.length ? Math.max(...wins.map((r) => r.seconds)) : null,
    rejectedCommands: runs.reduce((sum, r) => sum + r.rejectedCommands, 0),
    replayVerified: runs.every((r) => r.replayVerified),
  };
}
export function makeComparisonReport(runs: RunSummary[], durationMs: number) {
  const powers = [...new Set(runs.map((r) => r.enemyPower))].sort((a, b) => a - b);
  const first = runs[0];
  const lines = [
    '# 戦闘AIのヘッドレス比較',
    '',
    `実験バージョン: \`${EXPERIMENT_VERSION}\`。${runs.length}ラン（各ラン最大2戦）を${(durationMs / 1000).toFixed(2)}秒で実行。`,
    '',
    '## 条件',
    '',
    `- 戦闘セット: ${ENCOUNTER_SETS[first.encounterSet ?? 'belfry'].name} (${first.encounterSet ?? 'belfry'}) / 強度 ${first.encounterLevel ?? 1}。`,
    `- 予約方式: ${first.planning ?? 'legacy'}（legacy: 従来AI、next: 次の1手、queue: 3手まで）。`,
    '',
    '- 全AIに同じseed集合・敵・初期装備・第一戦後の武器更新（盾槍→轟砕の槌、弓→流星の弓）を適用。戦闘ルールの変更なし。',
    `- 観測間隔 ${first.decisionInterval} 実秒。予告対応と時間操作併用の反応待ち ${first.reactionSeconds} 実秒。上限 ${first.maxSeconds} 実秒／ラン。`,
    '- 反応待ちは人間の実測値ではなく、時間操作の差を見るための仮定。論理評価の実行時間とは別。',
    '- 反応待ち後の指示は次の観測時点で発行する。既定0.35秒は0.25秒周期では実効0.5秒に切り上がる。',
    `- 切除条件: ${first.ablation}。noneは全機能、no-pullは引き寄せなし、no-rowは手動列攻撃なし、no-defenseは列退避と防御なし。`,
    '- AIはHP・ATB・現在列・予告などを観測。乱数状態と未予告の敵行動タイマーは渡さない。未来のシミュレーションも行わない。',
    '- 入力は戦闘コアへ直接送信。指示数はコアコマンド数であり、クリック数や人間の操作負荷を表さない。',
    '- seedを揃えても入力により乱数消費順が変わるため、被ダメージ列まで同一になる比較ではない。',
    '- 平均時間・被害・集中力・指示数は勝利ランのみ。失敗を短時間クリアとして平均しない。高倍率は難度の感度確認用。',
    '- スコアや報酬の追加は行わず、独立した結果指標を並べる。',
    '- 表の移動数は味方の移動完了数。敵から押された移動も含み、AIの移動指示数とは区別する。',
    '',
    '## AIの方針',
    '',
    ...POLICY_IDS.filter((id) => runs.some((r) => r.policy === id)).map(
      (id) => `- **${POLICY_INFO[id].name}** (\`${id}\`): ${POLICY_INFO[id].description}`,
    ),
  ];
  for (const power of powers) {
    lines.push(
      '',
      `## 敵の攻撃倍率 ${power}`,
      '',
      '| AI | 勝利 | 敗北 / 時間切れ | 戦闘秒 | 実秒 | 被ダメージ | 集中力消費 | 指示数 | 移動数 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const id of POLICY_IDS) {
      const selected = runs.filter((r) => r.enemyPower === power && r.policy === id);
      if (!selected.length) continue;
      const a = aggregate(selected);
      lines.push(
        `| ${POLICY_INFO[id].name} | ${a.wins}/${a.trials} | ${a.defeats} / ${a.timeouts} | ${display(a.winSeconds)} | ${display(a.winRealSeconds)} | ${display(a.winTaken, 0)} | ${display(a.winFocus)} | ${display(a.winInputs)} | ${display(a.winMoves)} |`,
      );
    }
  }
  lines.push(
    '',
    '## 検証と保存物',
    '',
    `- 完全一致リプレイ: ${runs.filter((r) => r.replayVerified).length}/${runs.length}。`,
    `- 拒否されたコマンド: ${runs.reduce((n, r) => n + r.rejectedCommands, 0)}。`,
    '- `results.json`: 個別ランの結果、戦闘ごとの指標、技使用数、敵予告の結末、行動／移動／待機時間。',
    '- `traces/`: 各倍率・各AIの先頭seedの全イベント、AIの理由付き判断、0.5実秒ごとの状態、UIへ読み込めるリプレイ。',
    '- 同一ルール・同一seedの固定2遭遇の結果であり、他の敵編成、ランダムドロップ、人間のUI操作へは未検証。',
    '',
  );
  return lines.join('\n');
}
export function makeTraceReport(run: RunResult) {
  const r = run.summary;
  return [
    `# ${POLICY_INFO[r.policy].name} / seed ${r.seed} / 敵攻撃 ${r.enemyPower}`,
    '',
    `戦闘セット: ${ENCOUNTER_SETS[r.encounterSet ?? 'belfry'].name} (${r.encounterSet ?? 'belfry'}) / 強度 ${r.encounterLevel ?? 1}。`,
    '',
    `結果: ${r.outcome}。切除条件: ${r.ablation}。戦闘 ${r.seconds.toFixed(2)}秒、実時間 ${r.realSeconds.toFixed(2)}秒、被害 ${r.metrics.taken}、ブレイク ${r.metrics.breaks}回。`,
    `予約方式: ${r.planning ?? 'legacy'}。積み込み ${r.appendedPlans ?? 0}回（実行中の予約 ${r.queuedDuringAction ?? 0}回）、最大 ${r.maxQueueDepth ?? 0}手。`,
    '',
    '## 実際に開始した技',
    '',
    ...Object.entries(r.actions).map(([skill, count]) => `- ${skill}: ${count}`),
    '',
    '## AIの判断',
    '',
    '| 戦闘秒 / 実秒 | 戦闘 | HP | 編成・位置 | 判断 | 指示 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...run.decisions.map(
      (d) =>
        `| ${d.time.toFixed(2)} / ${d.realTime.toFixed(2)} | ${d.encounter} | ${d.hp.join('/')} | ${d.roles.join('')} ${d.rows.join('/')} | ${d.reason} | ${d.commands.map((c) => `${c.accepted ? '' : 'REJECT '}${JSON.stringify(c.command)}`).join(' ; ')} |`,
    ),
    '',
    '## 敵予告の結末',
    '',
    ...run.enemyActions.map(
      (e) =>
        `- ${e.time.toFixed(2)}秒 [${e.encounter}] ${e.enemy} / ${e.action}: ${e.outcome} (${e.targetsHit}人命中)`,
    ),
    '',
    '## 全イベント',
    '',
    '```text',
    ...run.events.map(
      (e) => `${e.time.toFixed(2).padStart(7)} [戦闘${e.encounter}] #${e.id} ${e.text}`,
    ),
    '```',
    '',
  ].join('\n');
}
