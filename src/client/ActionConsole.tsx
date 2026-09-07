import { useState } from 'react';
import { ROW_NAMES, SKILLS, WEAPONS } from '../content/data';
import {
  PLAN_LIMIT,
  planned,
  projectedSlot,
  pendingPotions,
  planTiming,
  stepName,
  targetName,
} from '../sim/plan';
import { weaponOf } from '../sim/engine';
import type { Command, State } from '../sim/types';

export function ActionConsole({
  state: s,
  pending,
  onChoose,
  onBack,
  onSelect,
  send,
}: {
  state: State;
  pending: string | null;
  onChoose: (id: string) => void;
  onBack: () => void;
  onSelect: (id: number) => void;
  send: (...cmds: Command[]) => void;
}) {
  const [tab, setTab] = useState<'skills' | 'move' | 'weapon'>('skills');
  const a = s.allies[s.selected],
    weapon = WEAPONS[a.weapons[projectedSlot(a)]],
    queue = planned(a),
    timings = planTiming(a, s.config),
    live = s.phase === 'battle' && !s.paused,
    canAct = live && a.hp > 0;
  const skill = pending ? SKILLS[pending] : null;
  return (
    <section className="action-console" aria-label="行動の予約">
      <div className="console-party" aria-label="仲間を選ぶ">
        <div className="console-label">
          <span>1</span>仲間を選ぶ<small>Q / E · 肩ボタン</small>
        </div>
        {s.allies.map((x) => {
          const q = planned(x);
          return (
            <button
              key={x.id}
              className={`party-card ${x.id === s.selected ? 'active' : ''} ${x.hp <= 0 ? 'fallen' : ''}`}
              disabled={!live || x.hp <= 0}
              onClick={() => onSelect(x.id)}
              aria-pressed={x.id === s.selected}
            >
              <div className="party-name">
                <kbd>{x.id + 1}</kbd>
                <strong>{x.name}</strong>
                <span>{ROW_NAMES[x.row]}</span>
                <b className={`role role-${weaponOf(x).role}`}>{weaponOf(x).role}</b>
                <small>
                  {Math.ceil(x.hp)} / {x.maxHp}
                </small>
              </div>
              <div
                className="meter hp"
                role="meter"
                aria-label={`${x.name}のHP`}
                aria-valuemin={0}
                aria-valuemax={x.maxHp}
                aria-valuenow={Math.ceil(x.hp)}
              >
                <i style={{ width: `${(x.hp / x.maxHp) * 100}%` }} />
              </div>
              <div className="atb" aria-label={`ATB ${x.atb.toFixed(1)} / 4`}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i}>
                    <i style={{ width: `${Math.max(0, Math.min(1, x.atb - i)) * 100}%` }} />
                  </span>
                ))}
              </div>
              <div className="actor-current">
                <span>今</span>
                {x.hp <= 0
                  ? '戦闘不能'
                  : x.action
                    ? `${SKILLS[x.action.skillId].name} ${x.action.remaining.toFixed(1)}秒`
                    : x.nextRow
                      ? `${ROW_NAMES[x.nextRow]}へ移動`
                      : x.nextSlot !== null
                        ? '武器変更中'
                        : `${ROW_NAMES[x.row]} · ${weaponOf(x).archetype}`}
              </div>
              <div className="actor-next">
                <span>次</span>
                {q.length
                  ? `${stepName(x, q[0])} ${q.length > 1 ? `ほか${q.length - 1}手` : ''}`
                  : s.controlMode === 'manual' && x.id === s.selected
                    ? '指示待ち（手動）'
                    : weaponOf(x).role === 'S'
                      ? '必要時に自動支援'
                      : '自動行動'}
              </div>
            </button>
          );
        })}
      </div>
      <div className="console-choices">
        <div className="console-label">
          <span>2</span>
          {pending ? '対象を選んで積む' : '行動を選ぶ'}
          <small>{a.name}</small>
        </div>
        {pending && skill ? (
          <div className="target-picker">
            <div className="target-heading">
              <button onClick={onBack} aria-label="行動選択に戻る">
                ← 戻る
              </button>
              <h2>{skill.name}</h2>
              <b>{skill.cost} ATB</b>
            </div>
            <p>{skill.description}</p>
            <p className="field-target-guide">
              ↑ 戦場の駒・列を選んで積みます。方向キーとEnterでも選べます。
            </p>
            <p className="draft-note">確定するまで、予約は変わりません。</p>
          </div>
        ) : (
          <>
            <div className="action-tabs" role="tablist" aria-label="行動の種類">
              {(['skills', 'move', 'weapon'] as const).map((t, i) => (
                <button role="tab" key={t} aria-selected={tab === t} onClick={() => setTab(t)}>
                  {['技', '移動', '武器変更'][i]}
                </button>
              ))}
            </div>
            {tab === 'skills' ? (
              <>
                <div className="available-weapon">
                  予約末尾の武器：<strong>{weapon.name}</strong>
                  <b className={`role role-${weapon.role}`}>{weapon.role}</b>
                </div>
                <div className="action-grid">
                  {[...weapon.skills, 'guard', 'potion'].map((id, i) => (
                    <button
                      key={id}
                      data-pad-default={i === 0 ? '' : undefined}
                      className="action-tile"
                      data-skill={id}
                      aria-label={`${SKILLS[id].name}を選ぶ`}
                      disabled={
                        !canAct ||
                        queue.length >= PLAN_LIMIT ||
                        (id === 'potion' && pendingPotions(s.allies) >= s.potions)
                      }
                      onClick={() => onChoose(id)}
                    >
                      <kbd>{['Z', 'X', 'C', 'V'][i]}</kbd>
                      <strong>{SKILLS[id].name}</strong>
                      <b>{SKILLS[id].cost} ATB</b>
                      <small>
                        {SKILLS[id].cast.toFixed(2)}秒 ·{' '}
                        {id === 'potion'
                          ? `未予約 ${Math.max(0, s.potions - pendingPotions(s.allies))}個`
                          : SKILLS[id].target === 'self'
                            ? '自分'
                            : SKILLS[id].target.includes('Row')
                              ? '列を指定'
                              : SKILLS[id].target === 'ally'
                                ? '味方を指定'
                                : '敵を指定'}
                      </small>
                    </button>
                  ))}
                </div>
              </>
            ) : tab === 'move' ? (
              <div className="action-grid move-grid">
                {(['back', 'front'] as const).map((row) => (
                  <button
                    key={row}
                    disabled={!canAct || queue.length >= PLAN_LIMIT}
                    onClick={() => send({ type: 'enqueue', id: a.id, step: { kind: 'move', row } })}
                  >
                    <strong>
                      {row === 'back' ? '←' : '→'} {ROW_NAMES[row]}へ
                    </strong>
                    <small>{s.config.moveTime}秒 · 末尾に積む</small>
                  </button>
                ))}
                <p>移動が終わってから、その次の技を実行します。</p>
              </div>
            ) : (
              <div className="action-grid weapon-grid">
                {a.weapons.map((id, slot) => (
                  <button
                    key={id}
                    disabled={!canAct || queue.length >= PLAN_LIMIT}
                    onClick={() =>
                      send({
                        type: 'enqueue',
                        id: a.id,
                        step: { kind: 'weapon', slot: slot as 0 | 1 },
                      })
                    }
                  >
                    <strong>{WEAPONS[id].name}</strong>
                    <b className={`role role-${WEAPONS[id].role}`}>{WEAPONS[id].role}</b>
                    <small>
                      {WEAPONS[id].archetype} · {s.config.shiftTime}秒
                    </small>
                    <span>武器変更を末尾に積む ＋</span>
                  </button>
                ))}
              </div>
            )}
            <p className="console-tip">
              実行中も追加できます。予約が空なら、選択中の仲間は指示を待ちます。
            </p>
          </>
        )}
      </div>
      <div className="console-plan">
        <div className="console-label">
          <span>3</span>積んだ予約
          <small>
            {queue.length} / {PLAN_LIMIT}
          </small>
          <button
            disabled={!live || !queue.length}
            onClick={() => send({ type: 'cancel', id: a.id })}
          >
            すべて取消
          </button>
        </div>
        <div className="executing">
          <small>実行中</small>
          <strong>
            {a.action
              ? SKILLS[a.action.skillId].name
              : a.nextRow
                ? `${ROW_NAMES[a.nextRow]}へ移動`
                : a.nextSlot !== null
                  ? '武器変更'
                  : a.hp <= 0
                    ? '戦闘不能'
                    : queue.length
                      ? 'ATB待ち'
                      : '指示待ち（手動）'}
          </strong>
          {a.action && <span>あと{a.action.remaining.toFixed(1)}秒</span>}
        </div>
        <ol className="plan-list" aria-label={`${a.name}の予約キュー`}>
          {queue.map((p, i) => (
            <li key={p.key}>
              <b>{i + 1}</b>
              <div>
                <strong>{stepName(a, p)}</strong>
                <small>
                  {p.kind === 'skill'
                    ? targetName(s, p.target)
                    : p.kind === 'move'
                      ? '列を変更'
                      : '以降の技が変わります'}{' '}
                  · 開始まで約{timings[i]?.starts.toFixed(1)}秒
                </small>
              </div>
              <button
                disabled={!live}
                onClick={() => send({ type: 'removePlan', id: a.id, key: p.key })}
                aria-label={`${i + 1}手目の${stepName(a, p)}を取消`}
              >
                取消 ×
              </button>
            </li>
          ))}
        </ol>
        {!queue.length && (
          <p className="queue-empty">行動と対象を選ぶと、ここへ順番に積まれます。</p>
        )}
        <p className="plan-note">
          上から順に実行。取消後は残りの予約を順に実行します。時間は現在の状態からの目安です。
        </p>
      </div>
    </section>
  );
}
