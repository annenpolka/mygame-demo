import { weaponFunction } from './Loadout';
import { actionStatus, skillTiming } from './timing';
import { ROLE_NAMES, ROW_NAMES, SKILLS, WEAPONS } from '../content/data';
import { useEffect, useRef } from 'react';
import {
  planned,
  planTiming,
  projectedSlot,
  stepName,
  targetName,
  pendingPotions,
  plannedCost,
  projectedRow,
} from '../sim/plan';
import { weaponOf } from '../sim/engine';
import {
  choices,
  selectedChoice,
  unavailable,
  type BattlePad,
  type BattlePage,
} from '../input/battle-pad';
import { buttonName, type PadAction, type PadBindings, type PadFamily } from '../input/gamepad';
import type { State } from '../sim/types';
import type { LogEntry } from '../lab/session';

export function PadGlyph({
  action,
  bindings,
  family,
}: {
  action: PadAction;
  bindings: PadBindings;
  family: PadFamily;
}) {
  const index = bindings[action];
  return (
    <b className={`pad-glyph family-${family} button-${index} ${index < 4 ? 'face' : ''}`}>
      {buttonName(index, family)}
    </b>
  );
}
interface Props {
  keyboard?: boolean;
  state: State;
  ui: BattlePad;
  bindings: PadBindings;
  family: PadFamily;
  log: LogEntry[];
  act: (a: PadAction) => void;
  pick: (key: string) => void;
  remove: (key: string) => void;
  open: (page: BattlePage) => void;
  select: (id: number) => void;
}
export function PadBattleConsole({
  state: s,
  keyboard = false,
  ui,
  bindings,
  family,
  log,
  act,
  pick,
  remove,
  open,
  select,
}: Props) {
  const consoleRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!matchMedia('(max-width: 800px)').matches) return;
    const root = consoleRoot.current;
    const active =
      ui.page === 'target'
        ? document.querySelector('.battlefield.targeting')
        : ui.page === 'queue'
          ? (root?.querySelector('.pad-plan-list .selected') ?? root?.querySelector('.pad-plan'))
          : root?.querySelector('.pad-command-area');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [ui.page, ui.key, s.selected]);
  const a = s.allies[s.selected],
    w = WEAPONS[a.weapons[projectedSlot(a)]],
    q = planned(a),
    timing = planTiming(a, s.config);
  const list = choices(s, ui),
    choice = selectedChoice(s, ui);
  const keyNames: Record<PadAction, string> = {
    confirm: ui.page === 'command' ? 'Z' : 'Enter',
    skill: 'X',
    item: 'V',
    cancel: ui.page === 'command' ? '⌫' : 'Esc',
    previous: 'Q',
    next: 'E',
    up: '↑',
    down: 'C',
    left: 'R',
    right: 'W',
    queue: 'T',
    log: 'L',
    slow: 'Space',
    stop: 'F',
    pause: 'Esc',
  };
  const glyph = (action: PadAction) =>
    keyboard ? (
      <kbd className="pad-glyph keyboard-glyph">{keyNames[action]}</kbd>
    ) : (
      <PadGlyph action={action} bindings={bindings} family={family} />
    );
  const pageNames = {
    command: 'コマンド',
    target: '対象を選ぶ',
    move: '移動を積む',
    weapon: '武器変更を積む',
    tactics: '全員へ指示',
    queue: '予約を取り消す',
    log: '戦闘ログ',
  };
  const commandCards: { action: PadAction; skillId: string; title: string; fallback: string }[] = [
    { action: 'skill', skillId: w.skills[1], title: '主力技', fallback: 'north' },
    { action: 'item', skillId: 'potion', title: 'アイテム', fallback: 'west' },
    { action: 'cancel', skillId: 'guard', title: '先頭予約を取消', fallback: 'east' },
    { action: 'confirm', skillId: w.skills[0], title: '基本技', fallback: 'south' },
  ];
  const timeButtons = (
    <div className="pad-time-controls" aria-label="時間操作">
      <button className={s.timeMode === 'slow' ? 'engaged' : ''} onClick={() => act('slow')}>
        {glyph('slow')}
        <span>
          スロー<small>{s.timeMode === 'slow' ? '通常に戻す' : '×0.25'}</small>
        </span>
      </button>
      <button className={s.timeMode === 'stop' ? 'engaged' : ''} onClick={() => act('stop')}>
        {glyph('stop')}
        <span>
          戦術停止<small>{s.timeMode === 'stop' ? '通常に戻す' : '×0.00'}</small>
        </span>
      </button>
      <div
        className="pad-focus"
        role="meter"
        aria-label="集中力"
        aria-valuenow={Math.ceil(s.focus)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <strong>
          {Math.ceil(s.focus)}
          <small> / 100</small>
        </strong>
        <span>
          集中力
          {s.timeMode !== 'normal'
            ? ` · あと ${(s.focus / (s.timeMode === 'slow' ? s.config.slowDrain : s.config.stopDrain)).toFixed(1)}秒`
            : ''}
        </span>
        <i style={{ width: `${s.focus}%` }} />
      </div>
    </div>
  );
  return (
    <section
      ref={consoleRoot}
      className={`pad-console ${keyboard ? 'keyboard-console' : ''}`}
      aria-label={keyboard ? 'キーボード用戦闘コマンド' : 'パッド用戦闘コマンド'}
    >
      <div className="pad-desk">
        <div className="pad-command-area">
          <div className="pad-page-heading">
            <div>
              <span>
                {a.name} <b>{ROLE_NAMES[w.role]}</b>
              </span>
              <h2>{pageNames[ui.page]}</h2>
            </div>
            {ui.page !== 'command' && (
              <button className="pad-back" onClick={() => act('cancel')}>
                {glyph('cancel')} 戻る
              </button>
            )}
            <small>
              {projectedSlot(a) !== a.slot ? '変更後：' : ''}
              {w.name}
            </small>
          </div>
          {ui.page === 'command' ? (
            <div className="pad-command-root">
              <div className="command-diamond">
                {commandCards.map((card) => (
                  <button
                    key={card.action}
                    className={`direct-command command-${card.action}`}
                    style={{
                      gridArea: keyboard
                        ? card.action
                        : (['south', 'east', 'west', 'north'][bindings[card.action]] ??
                          card.fallback),
                    }}
                    disabled={card.action === 'cancel' ? !q.length : !!unavailable(s, card.skillId)}
                    onClick={() => act(card.action)}
                    aria-label={
                      card.action === 'cancel'
                        ? '先頭予約を取消'
                        : `${card.title}：${SKILLS[card.skillId].name}`
                    }
                  >
                    {glyph(card.action)}
                    <span>
                      <small>{card.title}</small>
                      <strong>
                        {card.action === 'cancel' ? '先頭を取消' : SKILLS[card.skillId].name}
                      </strong>
                      <em>
                        {card.action === 'cancel'
                          ? q[0]
                            ? stepName(a, q[0])
                            : '予約なし'
                          : `${SKILLS[card.skillId].cost} ATB · ${skillTiming(SKILLS[card.skillId])}`}
                        {card.skillId === 'potion' &&
                          ` · 残${Math.max(0, s.potions - pendingPotions(s.allies))}`}
                      </em>
                    </span>
                  </button>
                ))}
                <div className="diamond-center" aria-hidden="true">
                  ◈
                </div>
              </div>
              <div className="pad-direction-commands">
                <span>{keyboard ? '移動・武器・防御を一押し' : '方向キーで一押し'}</span>
                {(
                  [
                    ['up', '全員へ指示', 'tactics'],
                    ['left', `${projectedRow(a) === 'front' ? '後列' : '前列'}へ積む`, 'move'],
                    [
                      'right',
                      `${WEAPONS[a.weapons[projectedSlot(a) === 0 ? 1 : 0]].role}｜${weaponFunction(WEAPONS[a.weapons[projectedSlot(a) === 0 ? 1 : 0]])}へ`,
                      'weapon',
                    ],
                    ['down', '防御を積む', 'queue'],
                  ] as const
                ).map(([action, title, page]) => (
                  <button
                    key={action}
                    aria-label={
                      action === 'left'
                        ? '前後移動を積む'
                        : action === 'right'
                          ? '武器変更を積む'
                          : title
                    }
                    disabled={
                      action === 'left' || action === 'right'
                        ? !!unavailable(s)
                        : action === 'down'
                          ? !!unavailable(s, 'guard')
                          : false
                    }
                    onClick={() => act(action)}
                  >
                    {glyph(action)}
                    {title}
                  </button>
                ))}
              </div>
            </div>
          ) : ui.page === 'target' ? (
            <div className="field-target-guide">
              <strong>↑ 戦場で対象を選択中</strong>
              <p>{ui.skillId && SKILLS[ui.skillId].description}</p>
              <p>
                方向キーで駒・列を選び、{glyph('confirm')}
                で末尾へ。決定を押すたびに同じ対象へ追加できます。
              </p>
              <p>{glyph('cancel')} コマンドへ戻る</p>
            </div>
          ) : ui.page === 'queue' ? (
            <div className="pad-queue-help">
              <strong>取り消す手を選んでください。</strong>
              <p>右の一覧を上下で選択し、{glyph('confirm')}で取消。実行中の行動は続きます。</p>
              <button disabled={!q.length} onClick={() => act('item')}>
                {glyph('item')} 未実行をすべて取消
              </button>
              <p>残した手の順序は変わりません。</p>
            </div>
          ) : ui.page === 'log' ? (
            <div className="pad-log" role="log" aria-label="パッドの戦闘ログ">
              {log
                .slice(
                  Math.max(0, log.length - 6 - Math.min(ui.logOffset, Math.max(0, log.length - 6))),
                  log.length - Math.min(ui.logOffset, Math.max(0, log.length - 6)),
                )
                .map((e) => (
                  <p key={e.id} className={`pad-log-${e.type}`}>
                    <time>{e.time.toFixed(1)}s</time>
                    <span>{e.text}</span>
                  </p>
                ))}
              {!log.length && <p>まだログはありません。</p>}
            </div>
          ) : (
            <div className="pad-picker">
              {ui.page === 'tactics' && (
                <div className="pad-tactic-tabs">
                  <button
                    className={ui.tactics === 'optima' ? 'selected' : ''}
                    onClick={() => ui.tactics !== 'optima' && act('left')}
                  >
                    ◀ オプティマ
                  </button>
                  <button
                    className={ui.tactics === 'formation' ? 'selected' : ''}
                    onClick={() => ui.tactics !== 'formation' && act('right')}
                  >
                    一括隊列 ▶
                  </button>
                </div>
              )}
              <div className="pad-options" role="listbox" aria-label={pageNames[ui.page]}>
                {list.map((c) => (
                  <button
                    key={c.key}
                    role="option"
                    aria-selected={choice?.key === c.key}
                    className={choice?.key === c.key ? 'selected' : ''}
                    onClick={() => pick(c.key)}
                    disabled={ui.page !== 'tactics' && !!unavailable(s, ui.skillId ?? undefined)}
                  >
                    <b className="pad-choice-arrow">{choice?.key === c.key ? '▶' : '·'}</b>
                    <span>
                      <strong>{c.title}</strong>
                      <small>
                        {keyboard && ui.page === 'tactics'
                          ? `${ui.tactics === 'optima' ? ['A', 'S', 'D', 'G'][Number(c.key)] : Number(c.key) + 7} · `
                          : ''}
                        {c.detail}
                      </small>
                    </span>
                    {choice?.key === c.key && glyph('confirm')}
                  </button>
                ))}
              </div>
              {!list.length && (
                <p className="pad-no-choices">
                  {ui.page === 'tactics'
                    ? '個別操作モードです。「移動」から一人ずつ指示してください。'
                    : '選べる対象がいません。戻って別の手を選んでください。'}
                </p>
              )}
            </div>
          )}
          <div className="pad-feedback" role="status" key={ui.stamp}>
            {ui.message ||
              (q.length >= s.config.atbMax
                ? '先行入力が満杯です。先頭取消か予約一覧で整理できます。'
                : ui.page === 'target'
                  ? '決定を押すたび、同じ対象へ末尾に積みます。'
                  : `先行入力は${s.config.atbMax} ATBまで。実行中も追加できます。`)}
          </div>
        </div>
        <aside
          className={`pad-plan ${ui.page === 'queue' ? 'editing' : ''}`}
          aria-label={`${a.name}の予約`}
        >
          {timeButtons}
          <div className="pad-plan-heading">
            <button onClick={() => open('queue')}>
              積んだ手{' '}
              <b>
                {plannedCost(a)} / {s.config.atbMax} ATB · {q.length}/{s.config.atbMax}手
              </b>
              {glyph('queue')}
            </button>
            <span>
              {a.action
                ? actionStatus(a.action)
                : a.nextRow
                  ? '実行中：移動'
                  : a.nextSlot !== null
                    ? '実行中：武器変更'
                    : q.length
                      ? '次の手のATB待ち'
                      : '指示待ち（手動）'}
            </span>
          </div>
          <ol className="pad-plan-list">
            {q.map((p, i) => (
              <li
                key={p.key}
                className={ui.page === 'queue' && choice?.key === String(p.key) ? 'selected' : ''}
              >
                <button
                  aria-label={`${i + 1}手目の${stepName(a, p)}を取消`}
                  onClick={() => remove(String(p.key))}
                >
                  <b>{i + 1}</b>
                  <span>
                    <strong>{stepName(a, p)}</strong>
                    <small>
                      {p.kind === 'skill'
                        ? targetName(s, p.target)
                        : p.kind === 'move'
                          ? '列を変更'
                          : '以降の技が変わります'}{' '}
                      ·{' '}
                      {i > 0 && q[0]?.kind === 'skill' && q[0].skillId === 'handoff'
                        ? '交代開始時に解除'
                        : `約${timing[i].starts.toFixed(1)}秒後`}
                    </small>
                  </span>
                  {ui.page === 'queue' && choice?.key === String(p.key) ? (
                    glyph('confirm')
                  ) : (
                    <i>取消</i>
                  )}
                </button>
              </li>
            ))}
          </ol>
          {!q.length && (
            <div className="pad-plan-empty">
              まだ予約はありません。<small>技・移動・武器変更を、使いたい順に積めます。</small>
            </div>
          )}
        </aside>
      </div>
      <div className="pad-context-hints">
        {ui.page === 'command' ? (
          <>
            <span>{glyph('confirm')} 基本技</span>
            <span>{glyph('cancel')} 先頭を取消</span>
            <span>
              {keyboard
                ? '↑ 全員へ指示 · R 前後移動 · W 武器変更 · C 防御'
                : '↑ 全員 / ← 前後移動 / → 武器変更 / ↓ 防御'}
            </span>
          </>
        ) : (
          <>
            <span>
              {glyph('confirm')}{' '}
              {ui.page === 'queue'
                ? '選んだ予約を取消'
                : ui.page === 'log'
                  ? '最新へ'
                  : ui.page === 'tactics'
                    ? '切り替える'
                    : '末尾に積む'}
            </span>
            <span>{glyph('cancel')} コマンドへ</span>
            <span>方向キー {ui.page === 'log' ? '履歴を読む' : '選択'}</span>
          </>
        )}
        <button onClick={() => act('log')}>{glyph('log')} ログ</button>
        <button onClick={() => act('pause')}>{glyph('pause')} 休憩</button>
      </div>
    </section>
  );
}
