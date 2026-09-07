import { COMBAT_RULES } from '../content/rules';
import { partyBonus } from '../sim/bonuses';
import { skillTiming } from './timing';
import { ROLE_NAMES, SKILLS, WEAPONS } from '../content/data';
import { Fragment, useEffect, useRef } from 'react';
import {
  planned,
  committed,
  planTiming,
  projectedSlot,
  stepName,
  targetName,
  plannedCost,
} from '../sim/plan';
import {
  choices,
  skillPreview,
  selectedChoice,
  unavailable,
  type BattlePad,
  type BattleAction,
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
    <b
      className={`pad-glyph family-${family} button-${index} ${index >= 0 && index < 4 ? 'face' : ''}`}
    >
      {index < 0 ? '一覧' : buttonName(index, family)}
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
  act: (a: BattleAction) => void;
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
    timing = planTiming(
      a,
      {
        ...s.config,
        atbRate: s.config.atbRate * partyBonus(s.allies, s.config.bonusMode).atb,
      },
      s,
    );
  const list = choices(s, ui),
    choice = selectedChoice(s, ui);
  const keyNames: Record<PadAction | 'log', string> = {
    mark: 'M',
    confirm: ui.page === 'command' ? 'Z' : 'Enter',
    skill: 'X',
    cutQueue: 'B',
    back: 'Esc',
    previous: 'Q',
    next: 'E',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    queue: 'T',
    log: 'L',
    menu: 'I',
    aux: 'I',
    tactics: 'U',
    execute: 'H',
    guard: 'C',
    slow: 'Space',
    stop: 'F',
    pause: 'P',
  };
  const glyph = (action: PadAction | 'log') =>
    keyboard ? (
      <kbd className="pad-glyph keyboard-glyph">{keyNames[action]}</kbd>
    ) : (
      <PadGlyph action={action === 'log' ? 'menu' : action} bindings={bindings} family={family} />
    );
  const navigationName = keyboard
    ? '矢印キー'
    : bindings.navigation === 'dpad'
      ? '十字キー'
      : '左スティック';
  const pageNames = {
    command: 'コマンド',
    target: '対象を選ぶ',
    move: '移動を積む',
    weapon: '武器変更を積む',
    tactics: '指示・道具',
    queue: '予約を取り消す',
    log: '戦闘ログ',
    aux: '補助メニュー',
  };
  const commandCards: { action: PadAction; skillId?: string; title: string; fallback: string }[] = [
    { action: 'skill', skillId: w.skills[1], title: '主力技', fallback: 'west' },
    { action: 'guard', skillId: 'guard', title: '防御', fallback: 'north' },
    { action: 'back', title: '戻る', fallback: 'east' },
    { action: 'confirm', skillId: w.skills[0], title: '基本技', fallback: 'south' },
  ];
  const receipt =
    ui.page === 'queue' &&
    ui.queueFocus?.actorId === a.id &&
    !q.some((p) => String(p.key) === ui.queueFocus!.key)
      ? ui.queueFocus
      : null;
  const receiptRow = receipt && (
    <li className="queue-receipt" role="status">
      <button
        disabled
        aria-label={`${receipt.title}：${receipt.status === 'removed' ? '取消済み' : '実行・取消済み'}`}
      >
        <b>—</b>
        <span>
          <strong>
            {receipt.title} · {receipt.status === 'removed' ? '取消済み' : '実行・取消済み'}
          </strong>
          <small>方向入力で次の予約を選択</small>
        </span>
      </button>
    </li>
  );
  const timeButtons = (
    <div className="pad-time-controls" aria-label="時間操作">
      <button className={s.timeMode === 'slow' ? 'engaged' : ''} onClick={() => act('slow')}>
        {glyph('slow')}
        <span>
          スロー<small>{s.timeMode === 'slow' ? '通常に戻す' : `×${COMBAT_RULES.slowScale}`}</small>
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
              <button className="pad-back" onClick={() => act('back')}>
                {glyph('back')} 戻る
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
                {commandCards.map((card) => {
                  const skill = card.skillId ? SKILLS[card.skillId] : undefined;
                  const preview = skill ? skillPreview(s, ui, skill.id) : null;
                  return (
                    <button
                      key={card.action}
                      className={`direct-command command-${card.action}`}
                      style={{
                        gridArea: keyboard
                          ? card.action
                          : (['south', 'east', 'west', 'north'][bindings[card.action]] ??
                            card.fallback),
                      }}
                      disabled={
                        card.action === 'cutQueue'
                          ? !q.length
                          : skill
                            ? !!unavailable(s, skill.id) || !preview?.target
                            : false
                      }
                      onClick={() => act(card.action)}
                      aria-label={
                        card.action === 'guard'
                          ? '防御を下書き'
                          : skill
                            ? `${card.title}：${skill.name}`
                            : card.title
                      }
                    >
                      {glyph(card.action)}
                      <span>
                        <small>{card.title}</small>
                        <strong>{skill?.name ?? card.title}</strong>
                        <em>
                          {skill
                            ? `${preview?.label} · ${skill.cost} ATB · ${skillTiming(skill)}`
                            : card.action === 'back'
                              ? '予約は変えない'
                              : '未開始分を取消 · 今の一手は続行'}
                        </em>
                      </span>
                    </button>
                  );
                })}
                <div className="diamond-center" aria-hidden="true">
                  ◈
                </div>
              </div>
              <div className="pad-direction-commands">
                <span>対象を選び、技を下書きへ</span>
                <button onClick={() => act('tactics')}>{glyph('tactics')} 全体指示</button>
                <button onClick={() => act('aux')}>{glyph('aux')} 補助メニュー</button>
                <small>移動・武器変更・薬は補助へ</small>
              </div>
            </div>
          ) : ui.page === 'target' ? (
            <div className="field-target-guide">
              <strong>↑ 戦場で対象を選択中</strong>
              <p>{ui.skillId && SKILLS[ui.skillId].description}</p>
              <p>
                {navigationName}で駒・列を選び、{glyph('confirm')}
                で末尾へ。決定を押すたびに同じ対象へ追加できます。
              </p>
              <p>{glyph('back')} コマンドへ戻る</p>
            </div>
          ) : ui.page === 'queue' ? (
            <div className="pad-queue-help">
              <strong>取り消す手を選んでください。</strong>
              <p>
                一覧を{navigationName}の上下で選択し、{glyph('confirm')}
                で1件取消。現在の一手と硬直は続きます。
              </p>
              <button disabled={!committed(a).length} onClick={() => act('cutQueue')}>
                {glyph('cutQueue')} 後続取消
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
                    onClick={() => act('optimaMenu')}
                  >
                    オプティマ
                  </button>
                  <button
                    className={ui.tactics === 'formation' ? 'selected' : ''}
                    onClick={() => act('formationMenu')}
                  >
                    一括隊列
                  </button>
                  <button
                    className={ui.tactics === 'items' ? 'selected' : ''}
                    onClick={() => act('itemMenu')}
                  >
                    道具
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
                    disabled={
                      !!c.skillId
                        ? !!unavailable(s, c.skillId)
                        : ui.page !== 'tactics' &&
                          ui.page !== 'aux' &&
                          !!unavailable(s, ui.skillId ?? undefined)
                    }
                  >
                    <b className="pad-choice-arrow">{choice?.key === c.key ? '▶' : '·'}</b>
                    <span>
                      <strong>{c.title}</strong>
                      <small>
                        {keyboard && ui.page === 'tactics' && ui.tactics !== 'items'
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
                ? '確定分＋下書きが満杯です。下書きの訂正は予約一覧、攻撃の打ち切りは後続取消。'
                : ui.page === 'target'
                  ? '決定を押すたび、同じ対象へ末尾に積みます。'
                  : `下書きを組んだら行動開始。確定分と合わせて${s.config.atbMax} ATBまで。`)}
          </div>
        </div>
        <aside
          className={`pad-plan ${ui.page === 'queue' ? 'editing' : ''}`}
          aria-label={`${a.name}の予約`}
        >
          {timeButtons}
          <div
            className="pad-plan-heading"
            title="予測は通常速度の戦闘秒。時間停止中は進まず、未来の撃破・編成変更は含みません。"
          >
            <button onClick={() => open('queue')}>
              確定＋下書き{' '}
              <b>
                {plannedCost(a)} / {s.config.atbMax} ATB · {q.length}/{s.config.atbMax}手
              </b>
              {glyph('queue')}
            </button>
          </div>
          <ol className="pad-plan-list">
            {q.map((p, i) => (
              <Fragment key={p.key}>
                {receipt?.index === i && receiptRow}
                <li
                  data-plan-key={p.key}
                  data-plan-status={a.draft?.some((d) => d.key === p.key) ? 'draft' : 'committed'}
                  key={p.key}
                  className={ui.page === 'queue' && choice?.key === String(p.key) ? 'selected' : ''}
                >
                  <button
                    aria-label={`${i + 1}手目の${stepName(a, p)}を取消`}
                    onClick={() => remove(String(p.key))}
                  >
                    <b>{timing[i].linked ? '↳' : i + 1}</b>
                    <span>
                      <strong>
                        {stepName(a, p)}{' '}
                        <em className="plan-stage">
                          {a.draft?.some((d) => d.key === p.key) ? '下書き' : '確定'}
                        </em>
                        {timing[i].linked && <em className="link-tag">連結予定</em>}
                      </strong>
                      <small>
                        {p.kind === 'skill'
                          ? targetName(s, p.target)
                          : p.kind === 'move'
                            ? '列を変更'
                            : '以降の技が変わります'}{' '}
                        ·{' '}
                        {i > 0 && q[0]?.kind === 'skill' && q[0].skillId === 'handoff'
                          ? '交代開始時に解除'
                          : timing[i].status === 'draft'
                            ? Number.isFinite(timing[i].ends)
                              ? `今開始なら効果まで約${timing[i].ends.toFixed(1)}秒`
                              : '次の列の確定待ち'
                            : timing[i].status === 'held'
                              ? '保留解除待ち'
                              : timing[i].status === 'invalid'
                                ? '開始不可・取消予定'
                                : `効果まで約${timing[i].ends.toFixed(1)}秒`}
                      </small>
                    </span>
                    {ui.page === 'queue' && choice?.key === String(p.key) ? (
                      glyph('confirm')
                    ) : (
                      <i>取消</i>
                    )}
                  </button>
                </li>
              </Fragment>
            ))}
            {receipt && receipt.index >= q.length && receiptRow}
          </ol>
          {!q.length && !receipt && (
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
            <span>{glyph('back')} 戻る</span>
            <span>
              {keyboard
                ? 'H 行動開始 · B 後続取消 · U 全体指示 · I 補助'
                : '左スティックで対象 · 補助に移動・武器・薬'}
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
            <span>{glyph('back')} コマンドへ</span>
            <span>
              {navigationName} {ui.page === 'log' ? '履歴を読む' : '選択'}
            </span>
          </>
        )}
        <span>{glyph('execute')} 行動開始</span>
        <span>{glyph('cutQueue')} 後続取消</span>
        <button onClick={() => act('log')}>{glyph('log')} ログ</button>
        <button onClick={() => act('pause')}>{glyph('pause')} 休憩</button>
      </div>
    </section>
  );
}
