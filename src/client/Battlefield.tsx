import { FIELD_COLUMNS } from '../input/field-navigation';
import { targetName } from '../sim/plan';
import type { BattlePad, PaletteCursor, UnitTarget } from '../input/battle-pad';
import { COMBAT_RULES, percent } from '../content/rules';
import { HandoffStatus } from './HandoffStatus';
import { executionStatus } from './timing';
import { canAppend, planned, stepName } from '../sim/plan';
import { useEffect, useRef, type CSSProperties } from 'react';
import { BattleEffects } from './effects/BattleEffects';
import { UnitEmblem } from './effects/UnitEmblem';
import { UnitTargetMarks, SkillIcon } from './TargetVisuals';
import { actionCues, effectCues } from './effects/events';
import { BATTLE_TIMING, ROW_NAMES } from '../content/data';
import { weaponOf } from '../sim/engine';
import type { State, Skill, Target } from '../sim/types';
const keyOf = (t: Target) => (t.kind === 'row' ? `row-${t.row}` : `${t.kind}-${t.id}`);
export function Battlefield({
  state: s,
  pending,
  palette = null,
  targets = null,
  recovery,
  onCandidate,
  onAlly,
  onTarget,
  aim = null,
  onAim,
  onBack,
  confirmLabel = 'Enter',
  backLabel = 'Esc',
  navigationLabel = '矢印：駒の位置へ移動 · , 味方 / . 敵',
}: {
  state: State;
  pending: Skill | null;
  palette?: PaletteCursor | null;
  targets?: { ally: UnitTarget; enemy: UnitTarget } | null;
  recovery?: BattlePad['targetRecovery'];
  onCandidate: (side: 'enemy' | 'ally', target: Target) => void;
  onAlly: (id: number) => void;
  onTarget: (t: Target) => void;
  aim?: Target | null;
  onAim: (t: Target) => void;
  onBack: () => void;
  confirmLabel?: string;
  backLabel?: string;
  navigationLabel?: string;
}) {
  const field = useRef<HTMLDivElement>(null);
  const tracks = Math.max(
    2,
    ...FIELD_COLUMNS.map(
      (c) => (c.side === 'ally' ? s.allies : s.enemies).filter((u) => u.row === c.row).length,
    ),
  );
  const effects = effectCues(s),
    actions = actionCues(s);
  const intent = (id: string) => actions.find((c) => c.source === id);
  const reaction = (id: string) =>
    effects.filter((c) => c.target === id && c.value !== undefined).at(-1);
  const receiving = (id: string) =>
    actions
      .filter((c) => c.hostile && !c.recovery && c.targets.includes(id))
      .sort((a, b) => a.remaining - b.remaining)[0];
  const intentLabel = (id: string) => {
    const c = intent(id);
    if (!c) return null;
    const names = c.targets
      .map(
        (id) =>
          (id.startsWith('a') ? s.allies : s.enemies).find((u) => `${id[0]}${u.id}` === id)?.name,
      )
      .filter(Boolean)
      .join('・');
    return (
      <span
        className={`unit-intent ${c.hostile ? 'hostile' : ''} ${c.recovery ? 'recovery' : ''}`}
        title={`${c.label} → ${names || '対象なし'}`}
      >
        <b>{c.label}</b>
        {c.hostile && <i className="intent-clock">{c.remaining.toFixed(1)}s</i>}
        <span>
          {c.recovery ? '終了硬直' : c.area ? '範囲' : '→'} {c.recovery ? '' : names || '対象なし'}
        </span>
      </span>
    );
  };
  if (palette) aim = palette.target;
  const active = (!!pending || !!palette) && s.phase === 'battle';
  const full = !palette && !canAppend(s.allies[s.selected], s.config, pending?.cost ?? 0);
  const sideForSkill = palette?.side ?? (pending?.target.startsWith('enemy') ? 'enemy' : 'ally');
  const aimName = !aim
    ? ''
    : aim.kind === 'row'
      ? `${sideForSkill === 'enemy' ? '敵' : '味方'}${ROW_NAMES[aim.row]}`
      : (aim.kind === 'enemy' ? s.enemies : s.allies)[aim.id]?.name;
  useEffect(() => {
    if (active && !palette) field.current?.focus({ preventScroll: true });
  }, [active, pending?.id, !!palette]);
  return (
    <div
      className={`battlefield ${active ? 'targeting' : ''} ${targets ? 'dual-target-field' : ''}`}
      aria-label="敵味方の前後列"
      style={{ '--field-tracks': tracks } as CSSProperties}
      data-density={tracks}
    >
      {palette ? (
        <div className="palette-target-bar">
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            攻撃対象：{targets ? s.enemies.find((u) => u.id === targets.enemy.id)?.name : ''}。
            支援対象：{targets ? s.allies.find((u) => u.id === targets.ally.id)?.name : ''}。
            {palette.side === 'ally' ? '味方' : '敵'}の対象を変更中：{aimName}。
            {recovery ? '破線は未確定の候補です。技ボタンをもう一度押すと下書きに追加します。' : ''}
          </span>
        </div>
      ) : active ? (
        <div className="field-target-bar">
          <div>
            <small>TARGET · {pending?.cost} ATB</small>
            <strong>
              {pending?.name}
              <span> → {aimName}</span>
            </strong>
          </div>
          <button
            className="field-confirm"
            disabled={!aim || full}
            onClick={() => aim && onTarget(aim)}
          >
            <kbd>{confirmLabel}</kbd>
            {full ? '予約が満杯' : '末尾に積む'}
          </button>
          <button aria-label="対象選択を戻る" onClick={onBack}>
            <kbd>{backLabel}</kbd>戻る
          </button>
        </div>
      ) : (
        <div className="field-legend">
          <span>
            味方 → <small>後列は被害 −{percent(1 - COMBAT_RULES.rearTaken)}%</small>
          </span>
          <span>
            ← 敵 <small>AIはロールと戦況から対象を選択</small>
          </span>
        </div>
      )}
      <div
        className="horizontal-field"
        ref={field}
        role={palette ? 'group' : active ? 'listbox' : undefined}
        aria-label={palette ? '行動の対象候補' : active ? '戦場で対象を選ぶ' : undefined}
        tabIndex={active && !palette ? 0 : undefined}
        aria-activedescendant={active && !palette && aim ? `field-target-${keyOf(aim)}` : undefined}
      >
        {FIELD_COLUMNS.map(({ side, row }) => {
          const danger =
            side === 'ally' &&
            s.enemies.some(
              (e) =>
                e.hp > 0 &&
                e.cast &&
                (e.cast.target === 'all' || (e.cast.target === 'row' && e.cast.row === row)),
            );
          const rowName = `${side === 'ally' ? '味方' : '敵'}${ROW_NAMES[row]}`;
          return (
            <section
              key={`${side}-${row}`}
              className={`battle-lane ${side} ${row} ${danger ? 'danger-lane' : ''} ${active && !palette && side !== sideForSkill ? 'outside-target' : ''}`}
              aria-label={rowName}
            >
              <button className="lane-heading" disabled>
                {rowName}
                {side === 'ally' && row === 'front' && !danger && (
                  <small className="front-bonus">
                    威力・崩し＋{percent(COMBAT_RULES.frontDamage - 1)}%
                  </small>
                )}
                {danger && <small>⚠ 攻撃予告</small>}
              </button>
              {side === 'ally'
                ? s.allies
                    .filter((a) => a.row === row)
                    .map((a) => {
                      const w = weaponOf(a),
                        targetable =
                          !!palette ||
                          (active &&
                            (pending?.target.startsWith('ally') ||
                              (pending?.target === 'self' && a.id === s.selected)));
                      const aimed = targetable && aim?.kind === 'ally' && aim.id === a.id;
                      const marked = targets?.ally.id === a.id;
                      const candidate =
                        !!recovery &&
                        recovery.target.kind === 'ally' &&
                        recovery.target.id === a.id;
                      return (
                        <button
                          key={a.id}
                          id={targetable ? `field-target-ally-${a.id}` : undefined}
                          data-unit={`a${a.id}`}
                          data-target={marked ? 'ally' : undefined}
                          data-editing={(!!palette && aimed) || undefined}
                          data-candidate={candidate || undefined}
                          aria-pressed={palette ? marked : undefined}
                          role={targetable && !palette ? 'option' : undefined}
                          aria-selected={targetable && !palette ? aimed : undefined}
                          style={{ '--unit-color': a.color } as CSSProperties}
                          className={`field-unit friend ${a.id === s.selected ? 'selected' : ''} ${targetable ? 'can-target' : ''} ${a.hp <= 0 ? 'fallen' : ''} ${aimed && !palette ? 'aimed' : ''} ${active && !targetable ? 'outside-target' : ''}`}
                          disabled={
                            a.hp <= 0 ||
                            s.phase !== 'battle' ||
                            s.controlMode === 'ai' ||
                            (active && (!targetable || full))
                          }
                          aria-label={
                            palette
                              ? `${a.name}を支援対象にする${marked ? '、現在の支援対象' : ''}${candidate ? '、未確定の候補' : ''}${aimed ? '、対象を変更中' : ''}${a.id === s.selected ? '、操作キャラ' : ''}`
                              : targetable
                                ? `${a.name}に${pending?.name}を積む`
                                : `${a.name}を選択`
                          }
                          onPointerMove={(event) =>
                            !palette &&
                            (event.movementX || event.movementY) &&
                            targetable &&
                            onAim({ kind: 'ally', id: a.id })
                          }
                          onClick={() =>
                            palette
                              ? onCandidate('ally', { kind: 'ally', id: a.id })
                              : targetable
                                ? onTarget({ kind: 'ally', id: a.id })
                                : onAlly(a.id)
                          }
                        >
                          {intentLabel(`a${a.id}`)}
                          {targets && (
                            <UnitTargetMarks
                              side="ally"
                              marked={marked}
                              editing={!!palette && aimed}
                              candidate={candidate}
                              dead={a.hp <= 0}
                              actor={a.id === s.selected && s.controlMode === 'manual'}
                            />
                          )}
                          <UnitEmblem
                            kind={
                              w.skills.includes('shot')
                                ? 'bow'
                                : w.skills.includes('jab')
                                  ? 'fist'
                                  : w.skills.includes('smash')
                                    ? 'hammer'
                                    : w.role
                            }
                            id={`a${a.id}`}
                            action={intent(`a${a.id}`)}
                            reaction={reaction(`a${a.id}`)}
                          />
                          <span className="field-unit-info">
                            <strong>
                              {a.name} <b className={`role role-${w.role}`}>{w.role}</b>
                              {!targets && a.id === s.selected && s.controlMode === 'manual' && (
                                <i className="manual-tag">手動</i>
                              )}
                            </strong>
                            <small
                              title={
                                a.action
                                  ? `${executionStatus(a, s.config, s)} → ${targetName(s, a.action.target)}`
                                  : undefined
                              }
                            >
                              {targetable && !palette
                                ? `HP ${Math.ceil(a.hp)} / ${a.maxHp}`
                                : s.phase === 'battle'
                                  ? a.action && (s.controlMode === 'ai' || a.id !== s.selected)
                                    ? `AI → ${targetName(s, a.action.target)} · ${executionStatus(a, s.config, s)}`
                                    : executionStatus(a, s.config, s)
                                  : w.archetype}
                            </small>
                            <span className="unit-gauges">
                              <UnitGauge
                                label={`${a.name}のHP`}
                                value={a.hp}
                                max={a.maxHp}
                                kind="hp"
                                text={`${Math.ceil(a.hp)} / ${a.maxHp}`}
                              />
                              <UnitGauge
                                label={`${a.name}のATB`}
                                value={a.atb}
                                max={s.config.atbMax}
                                kind="atb"
                                text={`ATB ${a.atb.toFixed(1)} / ${s.config.atbMax}`}
                              />
                            </span>
                            {receiving(`a${a.id}`) && (
                              <em className="unit-incoming">
                                {receiving(`a${a.id}`)!.area ? '範囲攻撃' : '狙われている'}{' '}
                                {receiving(`a${a.id}`)!.remaining.toFixed(1)}秒
                              </em>
                            )}
                          </span>
                        </button>
                      );
                    })
                : s.enemies
                    .filter((e) => e.row === row)
                    .map((e) => {
                      const targetable =
                          !!palette || (active && pending?.target.startsWith('enemy')),
                        aimed = !!targetable && aim?.kind === 'enemy' && aim.id === e.id;
                      const marked = targets?.enemy.id === e.id;
                      const candidate =
                        !!recovery &&
                        recovery.target.kind === 'enemy' &&
                        recovery.target.id === e.id;
                      return (
                        <button
                          key={e.id}
                          id={targetable ? `field-target-enemy-${e.id}` : undefined}
                          data-unit={`e${e.id}`}
                          data-target={marked ? 'enemy' : undefined}
                          data-editing={(!!palette && aimed) || undefined}
                          data-candidate={candidate || undefined}
                          aria-pressed={palette ? marked : undefined}
                          role={targetable && !palette ? 'option' : undefined}
                          aria-selected={targetable && !palette ? aimed : undefined}
                          className={`field-unit foe ${e.broken ? 'broken' : ''} ${targetable ? 'can-target' : ''} ${e.hp <= 0 ? 'fallen' : ''} ${aimed && !palette ? 'aimed' : ''}`}
                          disabled={
                            e.hp <= 0 ||
                            s.phase !== 'battle' ||
                            s.controlMode === 'ai' ||
                            (active && (!targetable || full))
                          }
                          aria-label={
                            palette
                              ? `${e.name}を攻撃対象にする${marked ? '、現在の攻撃対象' : ''}${candidate ? '、未確定の候補' : ''}${aimed ? '、対象を変更中' : ''}`
                              : targetable
                                ? `${e.name}に${pending?.name}を積む`
                                : `${e.name}を狙う`
                          }
                          onPointerMove={(event) =>
                            !palette &&
                            (event.movementX || event.movementY) &&
                            targetable &&
                            onAim({ kind: 'enemy', id: e.id })
                          }
                          onClick={() =>
                            palette
                              ? onCandidate('enemy', { kind: 'enemy', id: e.id })
                              : targetable
                                ? onTarget({ kind: 'enemy', id: e.id })
                                : undefined
                          }
                        >
                          {intentLabel(`e${e.id}`)}
                          {targets && (
                            <UnitTargetMarks
                              side="enemy"
                              marked={marked}
                              editing={!!palette && aimed}
                              candidate={candidate}
                              dead={e.hp <= 0}
                            />
                          )}
                          <UnitEmblem
                            kind={e.kind}
                            id={`e${e.id}`}
                            action={intent(`e${e.id}`)}
                            reaction={reaction(`e${e.id}`)}
                          />
                          <span className="field-unit-info">
                            <strong>{e.name}</strong>
                            <span className="unit-gauges">
                              <UnitGauge
                                label={`${e.name}のHP`}
                                value={e.hp}
                                max={e.maxHp}
                                kind="enemy-hp"
                                text={`${Math.ceil(e.hp)} / ${e.maxHp}`}
                              />
                              <span className="enemy-chain-status">
                                <UnitGauge
                                  label={`${e.name}のチェイン`}
                                  value={e.chain}
                                  min={100}
                                  max={
                                    e.broken ? COMBAT_RULES.chainMax : COMBAT_RULES.breakThreshold
                                  }
                                  kind="chain"
                                  text={`${e.chain.toFixed(0)}% · ×${(e.chain / 100).toFixed(2)}`}
                                />
                                {e.broken > 0 ? (
                                  <UnitGauge
                                    label={`${e.name}のブレイク残り時間`}
                                    value={e.broken}
                                    max={BATTLE_TIMING.breakDuration}
                                    kind="break"
                                    text={`BREAK ${e.broken.toFixed(1)}s`}
                                  />
                                ) : (
                                  <small className="break-threshold">
                                    BREAK {COMBAT_RULES.breakThreshold}%
                                  </small>
                                )}
                              </span>
                            </span>
                            <span className="unit-telegraph">
                              {e.cast ? (
                                <>
                                  <UnitGauge
                                    label={`${e.name}の行動予告`}
                                    value={e.cast.total - e.cast.remaining}
                                    max={e.cast.total}
                                    kind="danger"
                                  />
                                  <small>
                                    {e.cast.target === 'row'
                                      ? `列固定：${ROW_NAMES[e.cast.row]}`
                                      : e.cast.target === 'all'
                                        ? '全員：列移動で回避不可'
                                        : `追尾：${s.allies[e.cast.allyId].name}`}
                                    {e.cast.movable &&
                                      (e.kind === 'guard' && !e.broken
                                        ? '・重装で移動不可'
                                        : e.steadfast > 0
                                          ? '・踏ん張り中'
                                          : '・移動で中断可')}
                                  </small>
                                </>
                              ) : (
                                <small>
                                  {e.hp <= 0
                                    ? '撃破'
                                    : e.kind === 'guard' && !e.broken
                                      ? '重装・後列を防護'
                                      : e.steadfast > 0
                                        ? '踏ん張り中'
                                        : '強制移動可'}
                                </small>
                              )}
                            </span>
                          </span>
                        </button>
                      );
                    })}
            </section>
          );
        })}
        <BattleEffects
          state={s}
          cues={effects}
          actions={actions}
          field={field}
          aim={active && !palette ? aim : null}
          targetSide={sideForSkill}
        />
      </div>
      <div className="field-footer">
        {s.controlMode === 'manual' && (s.pendingSelect !== null || s.handoffSlow > 0) ? (
          <HandoffStatus state={s} cancel={() => onAlly(s.selected)} />
        ) : (
          <div className="field-hint">
            {palette ? (
              <details className="target-symbol-help">
                <summary aria-label="対象の印と操作のヘルプ">?</summary>
                <div>
                  <p>丸い環：支援対象。角形の照準：攻撃対象。頭上の印：操作キャラ。</p>
                  <p>
                    四隅の枠：選び直している対象。対象が不在になると、生存する別の対象へ自動で切り替えます。
                  </p>
                  <p>
                    {navigationLabel}
                    。技は表示中の宛先へ下書きします。対象が消えても、予約・発動中の技は新しい対象へ継続します。
                  </p>
                </div>
              </details>
            ) : (
              <span>
                {active
                  ? '薬の対象を選び、下書きへ追加'
                  : s.controlMode === 'ai'
                    ? 'AI鑑賞中'
                    : `${s.allies[s.selected].name}を手動操作`}
              </span>
            )}
            <span
              className="field-time-symbol"
              title={s.timeMode === 'slow' ? `スロー ×${COMBAT_RULES.slowScale}` : '通常 ×1.00'}
            >
              {s.timeMode === 'slow' && <SkillIcon symbol="slow" />}
              <span aria-label={s.timeMode === 'slow' ? 'スロー倍率' : '時間倍率'}>
                ×{s.timeMode === 'slow' ? COMBAT_RULES.slowScale : '1.00'}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function UnitGauge({
  label,
  value,
  min = 0,
  max,
  kind,
  text,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  kind: string;
  text?: string;
}) {
  return (
    <span className={`unit-gauge gauge-${kind}`}>
      {text && <small>{text}</small>}
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.max(0, Math.min(max, value))}
      >
        <i
          style={{ width: `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%` }}
        />
      </span>
    </span>
  );
}
