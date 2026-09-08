import { COMBAT_RULES } from '../content/rules';
import { partyBonus } from '../sim/bonuses';
import { skillTiming } from './timing';
import { SkillIcon } from './TargetVisuals';
import { ROLE_NAMES, SKILLS, WEAPONS } from '../content/data';
import { useEffect, useRef } from 'react';
import { planned, planTiming, projectedSlot, stepName, targetName, plannedCost } from '../sim/plan';
import {
  choices,
  skillPreview,
  selectedChoice,
  unavailable,
  visiblePanel,
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
  scrollLog: (offset: number) => void;
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
  scrollLog,
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
          : root?.querySelector(ui.page === 'command' ? '.pad-command-area' : '.pad-auxiliary');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [ui.page, ui.key, s.selected]);
  useEffect(() => {
    // Directional navigation scrolls its own list without moving native keyboard focus.
    if (ui.page === 'command' || ui.page === 'target' || ui.page === 'queue') return;
    consoleRoot.current?.querySelector('.pad-options .selected')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant',
    });
  }, [ui.page, ui.key, ui.tactics]);
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
  const panel = visiblePanel(ui);
  useEffect(() => {
    const viewport = consoleRoot.current?.querySelector<HTMLElement>('.pad-log');
    // Each directional step ends at the chosen record, even when text wraps.
    // A reader using native focus keeps control of scrolling inside that record.
    if (viewport && document.activeElement !== viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [panel, ui.logOffset, log.length]);
  const panelUI = { ...ui, page: panel };
  const panelActive = ui.page !== 'command' && ui.page !== 'queue' && ui.page !== 'target';
  const list = choices(s, panelUI),
    choice = selectedChoice(s, ui),
    panelChoice = panelActive ? selectedChoice(s, panelUI) : undefined;
  const keyNames: Record<PadAction | 'log', string> = {
    mark: 'M',
    confirm: 'Enter',
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
  const commandCards: {
    action: 'basic' | 'skill' | 'guard';
    skillId: string;
    title: string;
    fallback: string;
  }[] = [
    { action: 'basic', skillId: w.skills[0], title: '基本技', fallback: 'south' },
    { action: 'skill', skillId: w.skills[1], title: '主力技', fallback: 'west' },
    { action: 'guard', skillId: 'guard', title: '防御', fallback: 'north' },
  ];
  const receipt =
    ui.queueFocus?.actorId === a.id && !q.some((p) => String(p.key) === ui.queueFocus!.key)
      ? ui.queueFocus
      : null;
  // Keep the same keyed row and native button after cancellation, including keyboard focus.
  const queueRows: { key: string; plan: (typeof q)[number] | null; index: number }[] = q.map(
    (plan, index) => ({ key: String(plan.key), plan, index }),
  );
  if (receipt)
    queueRows.splice(Math.min(receipt.index, q.length), 0, {
      key: receipt.key,
      plan: null,
      index: -1,
    });
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
      className={`pad-console persistent-desk ${keyboard ? 'keyboard-console' : ''}`}
      aria-label={keyboard ? 'キーボード用戦闘コマンド' : 'パッド用戦闘コマンド'}
    >
      {ui.feedback?.kind === 'added' && (
        <span className="input-flight" ref={flight} aria-hidden="true">
          <SkillIcon skillId={ui.feedback.skillId} />
        </span>
      )}
      <div className="pad-region-switches" role="group" aria-label="操作先">
        <span>操作先</span>
        <button
          aria-pressed={ui.page === 'command' || ui.page === 'target'}
          onClick={() => open('command')}
        >
          対象を選ぶ
        </button>
        <button aria-pressed={panelActive} onClick={() => open(panel)}>
          補助を選ぶ
        </button>
        <button aria-pressed={ui.page === 'queue'} onClick={() => open('queue')}>
          予約を選ぶ
        </button>
        <small>{glyph('menu')} で順に切替</small>
      </div>
      <div className="pad-desk">
        <div className={`pad-command-area ${ui.page === 'command' ? 'navigation-active' : ''}`}>
          <div className="pad-page-heading">
            <div>
              <span>
                {a.name} <b>{ROLE_NAMES[w.role]}</b>
              </span>
              <h2>コマンド</h2>
            </div>
            <small>
              {projectedSlot(a) !== a.slot ? '変更後：' : ''}
              {w.name}
            </small>
          </div>
          <div className="pad-command-root">
            <div className="command-diamond">
              {commandCards.map((card) => {
                const skill = card.skillId ? SKILLS[card.skillId] : undefined;
                const preview = skill ? skillPreview(s, ui, skill.id) : null;
                const candidate = !!preview?.candidateTarget;
                const retry = candidate && ui.targetRecovery?.skillId === skill?.id;
                const reason = skill ? unavailable(s, skill.id) : undefined;
                const failed = ui.feedback?.kind === 'blocked' && ui.feedback.skillId === skill?.id;
                return (
                  <button
                    key={card.action}
                    className={`direct-command command-${card.action} ${candidate ? 'candidate-command' : ''} ${reason || failed ? 'blocked-command' : ''}`}
                    data-skill-id={skill?.id}
                    data-candidate={candidate || undefined}
                    title={
                      skill
                        ? `${skill.name} · ${preview?.label} · ${skill.cost} ATB · ${skillTiming(skill)}${reason ? ` · ${reason}` : ''}`
                        : card.title
                    }
                    style={{
                      gridArea: keyboard
                        ? card.action === 'basic'
                          ? 'confirm'
                          : card.action
                        : (['south', 'east', 'west', 'north'][
                            bindings[card.action === 'basic' ? 'confirm' : card.action]
                          ] ?? card.fallback),
                    }}
                    onClick={() => act(card.action)}
                    aria-label={
                      skill
                        ? `${card.title}：${skill.name}、${preview?.label}、${skill.cost} ATB${candidate ? (retry ? '。同じ技をもう一度押すと追加' : '。押すと対象候補を確認') : ''}${reason ? `。${reason}` : ''}`
                        : card.title
                    }
                  >
                    {card.action === 'basic' ? (
                      keyboard ? (
                        <kbd className="pad-glyph keyboard-glyph">Z</kbd>
                      ) : ui.page === 'command' ? (
                        glyph('confirm')
                      ) : (
                        <span className="command-context">
                          対象選択時
                          <br />
                          {glyph('confirm')}
                        </span>
                      )
                    ) : (
                      glyph(card.action)
                    )}
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
              <button
                onClick={() => act('potion')}
                data-skill-id="potion"
                aria-label={`救急薬：${skillPreview(s, ui, 'potion').label}、${SKILLS.potion.cost} ATB${unavailable(s, 'potion') ? `。${unavailable(s, 'potion')}` : ''}`}
                title={`救急薬 → ${skillPreview(s, ui, 'potion').label}`}
              >
                {keyboard && <kbd className="pad-glyph keyboard-glyph">V</kbd>}
                <SkillIcon skillId="potion" />
                {!keyboard && <span>救急薬</span>}
              </button>
            </div>
          </div>
          <div
            className="pad-feedback icon-feedback"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {
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
            }
          </div>
        </div>
        <aside
          className={`pad-auxiliary ${panelActive ? 'navigation-active' : ''}`}
          data-panel={panel}
          aria-label="補助操作盤"
        >
          <div className="pad-panel-tabs" role="group" aria-label="補助の表示">
            <button
              aria-pressed={panel === 'aux' || panel === 'move' || panel === 'weapon'}
              onClick={() => act('auxPanel')}
            >
              補助
            </button>
            <button
              aria-pressed={panel === 'tactics' && ui.tactics === 'optima'}
              onClick={() => act('optimaMenu')}
            >
              オプティマ
            </button>
            <button
              aria-pressed={panel === 'tactics' && ui.tactics === 'formation'}
              onClick={() => act('formationMenu')}
            >
              隊列
            </button>
            <button aria-pressed={panel === 'log'} onClick={() => act('log')}>
              ログ
            </button>
          </div>
          {panel === 'log' ? (
            <>
              <div className="pad-log-navigation" role="group" aria-label="ログの表示位置">
                <button
                  onClick={() => scrollLog(ui.logOffset + 1)}
                  aria-disabled={ui.logOffset >= Math.max(0, log.length - 1)}
                >
                  古い記録
                </button>
                <button
                  onClick={() => scrollLog(ui.logOffset - 1)}
                  aria-disabled={ui.logOffset === 0}
                >
                  新しい記録
                </button>
                <button onClick={() => scrollLog(0)}>最新</button>
              </div>
              <div
                className="pad-log"
                role="log"
                aria-label="パッドの戦闘ログ"
                aria-live="off"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (
                    [
                      'ArrowUp',
                      'ArrowDown',
                      'ArrowLeft',
                      'ArrowRight',
                      'PageUp',
                      'PageDown',
                      'Home',
                      'End',
                      'Enter',
                      ' ',
                    ].includes(event.key)
                  )
                    event.stopPropagation();
                }}
              >
                {log
                  .slice(
                    Math.max(
                      0,
                      log.length - 6 - Math.min(ui.logOffset, Math.max(0, log.length - 1)),
                    ),
                    log.length - Math.min(ui.logOffset, Math.max(0, log.length - 1)),
                  )
                  .map((e) => (
                    <p key={e.id} className={`pad-log-${e.type}`}>
                      <time>{e.time.toFixed(1)}s</time>
                      <span>{e.text}</span>
                    </p>
                  ))}
                {!log.length && <p>まだログはありません。</p>}
              </div>
            </>
          ) : (
            <div className="pad-options" role="group" aria-label={pageNames[panel]}>
              {list.map((c) => (
                <button
                  key={`${panel}:${ui.tactics}:${c.key}`}
                  data-choice-key={c.key}
                  className={panelChoice?.key === c.key ? 'selected' : ''}
                  onClick={() => pick(c.key)}
                  aria-disabled={!!c.skillId && !!unavailable(s, c.skillId)}
                >
                  <span>
                    <strong>{c.title}</strong>
                    <small>{c.detail}</small>
                  </span>
                  {panelChoice?.key === c.key && glyph('confirm')}
                </button>
              ))}
              {!list.length && (
                <p className="pad-no-choices">
                  個別操作モードです。補助の「前後移動」で一人ずつ指示できます。
                </p>
              )}
            </div>
          )}
          <small className="pad-panel-hint">
            {panelActive
              ? `${navigationName}：左右で表示切替・上下で${panel === 'log' ? '履歴' : '選択'}`
              : '技と予約は、どの表示でも操作できます'}
          </small>
        </aside>
        <aside
          className={`pad-plan ${ui.page === 'queue' ? 'editing' : ''}`}
          aria-label={`${a.name}の予約`}
        >
          {timeButtons}
          <div
            className="pad-plan-heading"
            title="予測は通常速度の戦闘秒。未来の撃破・編成変更は含みません。"
          >
            <button onClick={() => open('queue')} aria-label="確定と下書きの予約一覧を選択">
              確定＋下書き{' '}
              <b>
                {plannedCost(a)} / {s.config.atbMax} ATB · {q.length}/{s.config.atbMax}手
              </b>
              {glyph('queue')}
            </button>
          </div>
          <ol className="pad-plan-list">
            {queueRows.map(({ key, plan: p, index: i }) => (
              <li
                key={key}
                data-plan-key={key}
                data-plan-status={
                  p
                    ? a.draft?.some((d) => d.key === p.key)
                      ? 'draft'
                      : 'committed'
                    : receipt!.status === 'removed'
                      ? 'removed'
                      : 'gone'
                }
                className={`${!p ? 'queue-receipt' : ''} ${ui.page === 'queue' && choice?.key === key ? 'selected' : ''} ${p && ui.feedback?.kind === 'added' && i === q.length - 1 && a.draft?.some((d) => d.key === p.key) ? 'new-draft' : ''}`}
              >
                <button
                  aria-disabled={!p || undefined}
                  aria-label={
                    p
                      ? `${i + 1}手目の${stepName(a, p)}${p.kind === 'skill' ? `、${targetName(s, p.target)}` : ''}、${a.draft?.some((d) => d.key === p.key) ? '下書き' : '確定済み'}を取消`
                      : `${receipt!.title}：${receipt!.status === 'removed' ? '取消済み' : '実行・取消済み'}`
                  }
                  onClick={() => {
                    if (p) remove(String(p.key));
                  }}
                >
                  {p ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <b>—</b>
                      <span>
                        <strong>
                          {receipt!.title} ·{' '}
                          {receipt!.status === 'removed' ? '取消済み' : '実行・取消済み'}
                        </strong>
                        <small>Tab または方向入力で次の予約を選択</small>
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
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
        <span>{glyph('menu')} 操作先切替</span>
        <span>
          {ui.page === 'command'
            ? `${navigationName}で対象を選択`
            : ui.page === 'queue'
              ? `${navigationName}で予約を選択・決定で一件取消`
              : `${navigationName}の左右で表示・上下で選択`}
        </span>
        <span>{glyph('execute')} 行動開始</span>
        <span>{glyph('cutQueue')} 後続取消</span>
        <button onClick={() => act('log')}>{keyboard && glyph('log')} ログ</button>
        <button onClick={() => act('pause')}>{glyph('pause')} 休憩</button>
      </div>
    </section>
  );
}
