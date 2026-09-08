import { COMBAT_RULES } from '../content/rules';
import { partyBonus } from '../sim/bonuses';
import { skillTiming } from './timing';
import { SkillIcon } from './TargetVisuals';
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
  const flight = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (
      ui.feedback?.kind !== 'added' ||
      !ui.feedback.skillId ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const root = consoleRoot.current;
    const source = root?.querySelector(`[data-skill-id="${ui.feedback.skillId}"] .skill-icon`);
    const destination = [
      ...(root?.querySelectorAll('[data-plan-status="draft"] .plan-skill-token') ?? []),
    ].at(-1);
    const token = flight.current;
    if (!source || !destination || !token || !token.animate) return;
    const from = source.getBoundingClientRect(),
      to = destination.getBoundingClientRect();
    token.style.left = `${from.left}px`;
    token.style.top = `${from.top}px`;
    const animation = token.animate(
      [
        { opacity: 1, transform: 'translate(0, 0) scale(1)' },
        {
          opacity: 1,
          offset: 0.8,
          transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(0.9)`,
        },
        {
          opacity: 0,
          transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(0.9)`,
        },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
    return () => animation.cancel();
  }, [ui.stamp]);
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
    targetAllies: ',',
    targetEnemies: '.',
    queue: '—',
    log: 'L',
    menu: 'I',
    aux: 'I',
    tactics: 'U',
    execute: 'H',
    guard: 'C',
    slow: 'Space',
    rowBack: 'J',
    rowFront: 'K',
    weapon: 'W',
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
    move: '列を移動',
    weapon: '武器変更',
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
          {s.timeMode !== 'normal' ? ` · あと ${(s.focus / s.config.slowDrain).toFixed(1)}秒` : ''}
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
      {ui.feedback?.kind === 'added' && (
        <span className="input-flight" ref={flight} aria-hidden="true">
          <SkillIcon skillId={ui.feedback.skillId} />
        </span>
      )}
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
                  const candidate = !!preview?.candidateTarget;
                  const retry = candidate && ui.targetRecovery?.skillId === skill?.id;
                  const reason = skill ? unavailable(s, skill.id) : undefined;
                  const failed =
                    ui.feedback?.kind === 'blocked' && ui.feedback.skillId === skill?.id;
                  return (
                    <button
                      key={card.action}
                      className={`direct-command command-${card.action} ${candidate ? 'candidate-command' : ''} ${reason || failed ? 'blocked-command' : ''}`}
                      data-skill-id={skill?.id}
                      data-candidate={candidate || undefined}
                      title={
                        skill
                          ? `${skill.name} · ${preview?.label} · ${skill.cost} ATB · ${skillTiming(skill)}${reason ? ` · ${reason}` : ''}`
                          : '戻る。下書きと確定済み行動は変わりません。'
                      }
                      style={{
                        gridArea: keyboard
                          ? card.action
                          : (['south', 'east', 'west', 'north'][bindings[card.action]] ??
                            card.fallback),
                      }}
                      onClick={() => act(card.action)}
                      aria-label={
                        skill
                          ? `${card.title}：${skill.name}、${preview?.label}、${skill.cost} ATB${candidate ? (retry ? '。同じ技をもう一度押すと追加' : '。押すと対象候補を確認') : ''}${reason ? `。${reason}` : ''}`
                          : card.title
                      }
                    >
                      {glyph(card.action)}
                      <SkillIcon skillId={skill?.id} symbol={skill ? undefined : 'back'} />
                      <span className="command-identity">
                        <strong>{skill?.name ?? card.title}</strong>
                        {skill && (
                          <span className="command-cost">
                            <span className="skill-cost" aria-hidden="true">
                              {Array.from({ length: skill.cost }, (_, i) => (
                                <i key={i} />
                              ))}
                            </span>
                          </span>
                        )}
                      </span>
                      {retry && (
                        <span className="command-condition">
                          <SkillIcon symbol="retry" />
                        </span>
                      )}
                      {(reason || failed) && (
                        <span className="command-condition">
                          <SkillIcon symbol="blocked" />
                        </span>
                      )}
                    </button>
                  );
                })}
                <div className="diamond-center" aria-hidden="true">
                  ◈
                </div>
              </div>
              <div className="pad-direction-commands" aria-label="即時操作">
                <button
                  onClick={() => act('rowBack')}
                  aria-label="選択キャラを後列へ移動"
                  title="後列へ移動"
                >
                  {glyph('rowBack')}
                  <SkillIcon symbol="rear" />
                </button>
                <button
                  onClick={() => act('rowFront')}
                  aria-label="選択キャラを前列へ移動"
                  title="前列へ移動"
                >
                  {glyph('rowFront')}
                  <SkillIcon symbol="front" />
                </button>
                <button
                  onClick={() => act('tactics')}
                  aria-label="次のオプティマへ切り替え"
                  title="オプティマ変更"
                >
                  {glyph('tactics')}
                  <SkillIcon symbol="optima" />
                </button>
                <button
                  onClick={() => act('weapon')}
                  aria-label="選択キャラの武器を切り替え"
                  title="武器変更"
                >
                  {glyph('weapon')}
                  <SkillIcon symbol="weapon" />
                </button>
                <button onClick={() => act('aux')} aria-label="補助メニュー" title="補助メニュー">
                  {glyph('aux')}
                  <SkillIcon symbol="menu" />
                </button>
              </div>
            </div>
          ) : ui.page === 'target' ? (
            <div className="field-target-guide">
              <strong>↑ 戦場で対象を選択中</strong>
              <p>{ui.skillId && SKILLS[ui.skillId].description}</p>
              <p>
                {navigationName}で駒を選び、{glyph('confirm')}
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
                          ui.page !== 'move' &&
                          ui.page !== 'weapon' &&
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
          <div
            className={`pad-feedback ${ui.page === 'command' ? 'icon-feedback' : ''}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {ui.page === 'command' ? (
              <>
                {ui.message && (
                  <span
                    className={`feedback-receipt feedback-${ui.feedback?.kind ?? 'selection'}`}
                    title={ui.message}
                    aria-hidden="true"
                  >
                    {ui.feedback?.skillId && <SkillIcon skillId={ui.feedback.skillId} />}
                    <SkillIcon
                      symbol={
                        ui.feedback?.kind === 'blocked'
                          ? 'blocked'
                          : ui.feedback?.kind === 'candidate'
                            ? 'retry'
                            : 'check'
                      }
                    />
                  </span>
                )}
                <span className="sr-only" key={ui.stamp}>
                  {ui.message}
                </span>
              </>
            ) : (
              ui.message
            )}
          </div>
        </div>
        <aside
          className={`pad-plan ${ui.page === 'queue' ? 'editing' : ''}`}
          aria-label={`${a.name}の予約`}
        >
          {timeButtons}
          <div
            className="pad-plan-heading"
            title="予測は通常速度の戦闘秒。未来の撃破・編成変更は含みません。"
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
                  className={`${ui.page === 'queue' && choice?.key === String(p.key) ? 'selected' : ''} ${ui.feedback?.kind === 'added' && i === q.length - 1 && a.draft?.some((d) => d.key === p.key) ? 'new-draft' : ''}`}
                >
                  <button
                    aria-label={`${i + 1}手目の${stepName(a, p)}${p.kind === 'skill' ? `、${targetName(s, p.target)}` : ''}、${a.draft?.some((d) => d.key === p.key) ? '下書き' : '確定済み'}を取消`}
                    onClick={() => remove(String(p.key))}
                  >
                    <b>{timing[i].linked ? '↳' : i + 1}</b>
                    <span className="plan-skill-token" aria-hidden="true">
                      <SkillIcon
                        skillId={p.kind === 'skill' ? p.skillId : undefined}
                        symbol={
                          p.kind === 'move'
                            ? p.row === 'front'
                              ? 'front'
                              : 'rear'
                            : p.kind === 'weapon'
                              ? 'weapon'
                              : undefined
                        }
                      />
                    </span>
                    <span>
                      <strong>
                        {stepName(a, p)}{' '}
                        <em
                          className={`plan-stage-icon ${a.draft?.some((d) => d.key === p.key) ? 'draft' : 'committed'}`}
                          title={a.draft?.some((d) => d.key === p.key) ? '下書き' : '確定'}
                          aria-hidden="true"
                        >
                          <SkillIcon symbol="check" />
                        </em>
                        {timing[i].linked && <em className="link-tag">連結予定</em>}
                      </strong>
                      <span className="plan-arrival">
                        <small
                          title={
                            timing[i].status === 'invalid'
                              ? '開始不可・取消予定'
                              : timing[i].status === 'held'
                                ? '保留解除待ち'
                                : '通常速度での効果発生までの予測時間'
                          }
                        >
                          {Number.isFinite(timing[i].ends)
                            ? `◷ ${timing[i].ends.toFixed(1)}s`
                            : '◷ —'}
                        </small>
                      </span>
                    </span>
                    {ui.page === 'queue' && choice?.key === String(p.key) ? (
                      glyph('confirm')
                    ) : (
                      <i aria-hidden="true">×</i>
                    )}
                  </button>
                </li>
              </Fragment>
            ))}
            {receipt && receipt.index >= q.length && receiptRow}
          </ol>
          {!q.length && !receipt && (
            <div className="pad-plan-empty">
              <span className="empty-draft-symbol" aria-hidden="true">
                ＋
              </span>
              <span className="sr-only">まだ下書きはありません。技ボタンで追加できます。</span>
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
                ? 'H 行動開始 · B 後続取消 · U オプティマ · I 補助'
                : `${navigationName}で対象 · ${bindings.sideAxis < 0 ? '補助で敵味方' : '右スティックで敵味方'}`}
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
