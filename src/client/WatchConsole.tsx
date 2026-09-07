import { POLICY_IDS, POLICY_INFO, type PolicyId } from '../ai/policies';
import { WatchPlayer, type WatchPlanning } from '../ai/watch-player';
import { ROW_NAMES, SKILLS } from '../content/data';
import { weaponOf } from '../sim/engine';
import { planned, stepName, targetName } from '../sim/plan';
import type { State } from '../sim/types';
export function WatchConsole({
  state: s,
  player,
  refresh,
  configure,
  select,
}: {
  state: State;
  player: WatchPlayer;
  refresh: () => void;
  configure: (policy: PolicyId, planning: WatchPlanning) => void;
  select: (id: number) => void;
}) {
  return (
    <section className="watch-console" aria-label="AI鑑賞">
      <div className="watch-toolbar">
        <div className="watch-heading">
          <span className={`watch-light ${player.paused ? 'paused' : ''}`} />
          <strong>{player.paused ? '鑑賞を停止中' : 'AI PLAY'}</strong>
          <small>全員をAIが操作 · 集中力 {Math.ceil(s.focus)} / 100</small>
        </div>
        <label>
          AI方針
          <select
            aria-label="AI方針"
            value={player.policyId}
            onChange={(e) => configure(e.target.value as PolicyId, player.planning)}
          >
            {POLICY_IDS.map((id) => (
              <option key={id} value={id}>
                {POLICY_INFO[id].name}
              </option>
            ))}
          </select>
        </label>
        <label>
          予約方式
          <select
            aria-label="AI予約方式"
            value={player.planning}
            onChange={(e) => configure(player.policyId, e.target.value as WatchPlanning)}
          >
            <option value="legacy">従来AI・1手</option>
            <option value="next">予約AI・1手</option>
            <option value="queue">予約AI・3手</option>
          </select>
        </label>
        <label>
          再生速度
          <select
            aria-label="AI再生速度"
            value={player.speed}
            onChange={(e) => {
              player.speed = Number(e.target.value) as 1 | 2 | 4;
              refresh();
            }}
          >
            <option value="1">×1</option>
            <option value="2">×2</option>
            <option value="4">×4</option>
          </select>
        </label>
        <button
          className="watch-pause"
          disabled={!['battle', 'loot'].includes(s.phase)}
          onClick={() => {
            player.paused = !player.paused;
            refresh();
          }}
        >
          {player.paused ? '▶ 鑑賞を再開' : 'Ⅱ 鑑賞を一時停止'}
        </button>
      </div>
      <p className="watch-description">{POLICY_INFO[player.policyId].description}</p>
      {s.phase === 'loot' && (
        <div className="watch-intermission" role="status">
          第一戦を突破。戦利品を装備して第二戦へ進みます。
        </div>
      )}
      <div className="watch-party">
        {s.allies.map((a) => (
          <article key={a.id} className={a.hp <= 0 ? 'fallen' : ''}>
            <button
              className="watch-actor"
              onClick={() => select(a.id)}
              aria-pressed={s.selected === a.id}
            >
              <span style={{ color: a.color }}>{weaponOf(a).glyph}</span>
              <strong>
                {a.name}
                <small>
                  {ROW_NAMES[a.row]} · {weaponOf(a).archetype}
                </small>
              </strong>
              <b>
                HP {Math.ceil(a.hp)} / {a.maxHp}
              </b>
            </button>
            <div className="watch-vitals">
              <i style={{ width: `${(a.hp / a.maxHp) * 100}%`, background: a.color }} />
            </div>
            <div className="watch-atb">
              ATB <b>{a.atb.toFixed(1)} / 4</b>
              <span>
                {a.hp <= 0
                  ? '戦闘不能'
                  : a.action
                    ? `${SKILLS[a.action.skillId].name} ${a.action.remaining.toFixed(1)}s`
                    : a.nextRow
                      ? '移動中'
                      : a.nextSlot !== null
                        ? '武器変更中'
                        : '自動行動・ATB待ち'}
              </span>
            </div>
            <ol aria-label={`${a.name}のAI予約`}>
              {planned(a).map((p) => (
                <li key={p.key}>
                  <strong>{stepName(a, p)}</strong>
                  <small>{p.kind === 'skill' ? targetName(s, p.target) : '予約順に実行'}</small>
                </li>
              ))}
            </ol>
            {!planned(a).length && <p className="watch-no-plan">予約なし</p>}
          </article>
        ))}
      </div>
      <div className="watch-decisions" role="log" aria-label="AIの判断">
        <div className="watch-decision-title">
          <b>判断の流れ</b>
          <small>{player.decisions}回 · 0.25秒ごとに観測</small>
        </div>
        {player.history.length ? (
          player.history.slice(0, 4).map((d, i) => (
            <div className={`watch-decision ${i === 0 ? 'latest' : ''}`} key={d.id}>
              <time>{d.time.toFixed(1)}s</time>
              <p>
                {d.reason}
                <small>{d.actions.join(' / ') || '新しい指示なし'}</small>
              </p>
            </div>
          ))
        ) : (
          <p className="watch-no-plan">戦闘を始めると、AIが選んだ行動とその理由を表示します。</p>
        )}
      </div>
    </section>
  );
}
