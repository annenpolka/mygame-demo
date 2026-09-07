import { partyBonus, bonusText } from '../sim/bonuses';
import type { CSSProperties } from 'react';
import { ROW_NAMES } from '../content/data';
import { PadGlyph } from './PadBattleConsole';
import type { PadBindings, PadFamily, PadAction } from '../input/gamepad';
import { weaponOf } from '../sim/engine';
import { isHandoff, planCost, planned, stepName, targetName } from '../sim/plan';
import type { State, Command } from '../sim/types';
import { executionStatus } from './timing';

/** Paid reservations occupy exactly their cost in the segmented ATB budget. */
export function AtbTimeline({
  state: s,
  select,
  act,
  keyboard,
  bindings,
  family,
  send,
}: {
  state: State;
  select: (id: number) => void;
  act: (action: PadAction) => void;
  keyboard: boolean;
  bindings: PadBindings;
  family: PadFamily;
  send: (command: Command) => void;
}) {
  const a = s.allies[s.selected],
    q = planned(a),
    w = weaponOf(a);
  let offset = 0;
  const entries = q.map((p, i) => {
    const start = offset;
    offset += planCost(p);
    return { p, index: i + 1, start, cost: planCost(p) };
  });
  const columns = Math.max(s.config.atbMax, offset);
  return (
    <section className="atb-timeline" aria-label={`${a.name}のATBと行動予約`}>
      <header>
        <div className="atb-party" aria-label="仲間を選ぶ">
          <button aria-label="前の仲間" onClick={() => act('previous')}>
            {keyboard ? (
              <kbd>Q</kbd>
            ) : (
              <PadGlyph action="previous" bindings={bindings} family={family} />
            )}
          </button>
          {s.allies.map((x) => (
            <button
              key={x.id}
              className={`pad-actor ${x.id === s.selected ? 'active' : ''}`}
              aria-label={`${x.name}に指示`}
              aria-pressed={x.id === s.selected}
              disabled={x.hp <= 0}
              onClick={() => select(x.id)}
            >
              <b className={`role role-${weaponOf(x).role}`}>{weaponOf(x).role}</b> {x.name}
              <small>{s.pendingSelect === x.id ? '交代待ち' : ROW_NAMES[x.row]}</small>
            </button>
          ))}
          <button aria-label="次の仲間" onClick={() => act('next')}>
            {keyboard ? (
              <kbd>E</kbd>
            ) : (
              <PadGlyph action="next" bindings={bindings} family={family} />
            )}
          </button>
        </div>
        <span className="atb-action-now">{executionStatus(a, s.config, s)}</span>
        <b className="atb-number">
          {a.atb.toFixed(1)}
          <small> / {s.config.atbMax} ATB</small>
        </b>
        <div className="sequence-controls" aria-label="連続行動の操作">
          <button
            aria-pressed={a.executionHeld}
            disabled={s.controlMode !== 'manual'}
            title="現在の一手と硬直は続け、次の開始を保留。保留中も予約を編集できます。"
            onClick={() => send({ type: 'hold', id: a.id, value: !a.executionHeld })}
          >
            {keyboard && <kbd>H</kbd>} {a.executionHeld ? '保留解除・放つ' : '実行保留・貯める'}
          </button>
          <button
            disabled={!q.length || s.controlMode !== 'manual'}
            title="未開始の予約をすべて取り消し、残ったATBを保持。現在の一手と終了硬直は続きます。"
            onClick={() => act('cutQueue')}
          >
            {keyboard ? (
              <kbd>B</kbd>
            ) : (
              <PadGlyph action="cutQueue" bindings={bindings} family={family} />
            )}{' '}
            後続取消
          </button>
          <small>
            {keyboard
              ? 'Escは戻る専用 · Tで一件取消'
              : '戻るは予約を変更しません · 一件取消は予約一覧へ'}
          </small>
        </div>
      </header>
      <div className="atb-budget" style={{ '--atb-columns': columns } as CSSProperties}>
        {entries
          .filter((e) => e.cost > 0)
          .map(({ p, index, start, cost }) => (
            <div
              key={p.key}
              className={`atb-reservation ${index > 1 && q.some(isHandoff) ? 'will-reset' : ''}`}
              style={{ gridColumn: `${start + 1} / span ${cost}` }}
              title={`${index}. ${stepName(a, p)} · ${cost} ATB${p.kind === 'skill' ? ` → ${targetName(s, p.target)}` : ''}`}
            >
              <b>{index}</b>
              <strong>{stepName(a, p)}</strong>
              <small>{cost} ATB</small>
            </div>
          ))}
        {!offset && (
          <span className="atb-no-cost" style={{ gridColumn: `1 / span ${s.config.atbMax}` }}>
            技を選び、使う順に積む →
          </span>
        )}
        {Array.from({ length: columns }, (_, i) => (
          <div
            key={i}
            className={`atb-cell ${i >= s.config.atbMax ? 'overflow' : ''}`}
            style={{ gridColumn: i + 1, gridRow: 2 }}
            aria-hidden="true"
          >
            <i style={{ width: `${Math.max(0, Math.min(1, a.atb - i)) * 100}%` }} />
            <span>{i >= s.config.atbMax ? '交代の特別枠' : i + 1}</span>
          </div>
        ))}
      </div>
      <div className="atb-subline">
        <span className="active-bonus" title="成立済みの武器のロールだけを集計">
          {bonusText(partyBonus(s.allies, s.config.bonusMode))}
        </span>
        <span>
          {q.some(isHandoff)
            ? '交代は先頭優先 · 後続は交代開始時に解除'
            : `予約コスト ${offset} / ${s.config.atbMax} ATB · ${q.length}手（所持 ${a.atb.toFixed(1)}）`}
        </span>
        <span className="atb-free-steps">
          {entries
            .filter((e) => e.cost === 0)
            .map(({ p, index }) => (
              <span key={p.key}>
                {index}. {stepName(a, p)} <small>0 ATB</small>
              </span>
            ))}
        </span>
      </div>
      <div
        className="sr-only"
        role="meter"
        aria-label="操作キャラのATB"
        aria-valuenow={a.atb}
        aria-valuemin={0}
        aria-valuemax={s.config.atbMax}
      />
    </section>
  );
}
