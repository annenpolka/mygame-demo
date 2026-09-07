import { COMBAT_RULES, percent } from '../content/rules';
import { HandoffStatus } from './HandoffStatus';
import { executionStatus } from './timing';
import { canAppend, planned, stepName } from '../sim/plan';
import { useEffect, useRef, type CSSProperties } from 'react';
import { BattleEffects } from './effects/BattleEffects';
import { BATTLE_TIMING, ROW_NAMES } from '../content/data';
import { weaponOf } from '../sim/engine';
import type { State, Skill, Target, Row } from '../sim/types';
const keyOf = (t: Target) => (t.kind === 'row' ? `row-${t.row}` : `${t.kind}-${t.id}`);
export function Battlefield({
  state: s,
  pending,
  onAlly,
  onEnemy,
  onTarget,
  aim = null,
  onAim,
  onBack,
  confirmLabel = 'Enter',
  backLabel = 'Esc',
}: {
  state: State;
  pending: Skill | null;
  onAlly: (id: number) => void;
  onEnemy: (id: number) => void;
  onTarget: (t: Target) => void;
  aim?: Target | null;
  onAim: (t: Target) => void;
  onBack: () => void;
  confirmLabel?: string;
  backLabel?: string;
}) {
  const field = useRef<HTMLDivElement>(null);
  const active = !!pending && s.phase === 'battle';
  const full = !canAppend(s.allies[s.selected], s.config, pending?.cost ?? 0);
  const sideForSkill = pending?.target.startsWith('enemy') ? 'enemy' : 'ally';
  const aimName = !aim
    ? ''
    : aim.kind === 'row'
      ? `${sideForSkill === 'enemy' ? '敵' : '味方'}${ROW_NAMES[aim.row]}`
      : (aim.kind === 'enemy' ? s.enemies : s.allies)[aim.id]?.name;
  useEffect(() => {
    if (active) field.current?.focus({ preventScroll: true });
  }, [active, pending?.id]);
  return (
    <div
      className={`battlefield ${active ? 'targeting' : ''}`}
      aria-label="敵味方の前後列"
      style={{ '--field-tracks': 3 } as CSSProperties}
    >
      {active ? (
        <div className="field-target-bar">
          <div>
            <small>TARGET · {pending.cost} ATB</small>
            <strong>
              {pending.name}
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
            ← 敵 <small>◎ 集中攻撃の対象</small>
          </span>
        </div>
      )}
      <div
        className="horizontal-field"
        ref={field}
        role={active ? 'listbox' : undefined}
        aria-label={active ? '戦場で対象を選ぶ' : undefined}
        tabIndex={active ? 0 : undefined}
        aria-activedescendant={active && aim ? `field-target-${keyOf(aim)}` : undefined}
      >
        {(['ally', 'enemy'] as const).map((side) =>
          (side === 'ally' ? ['back', 'front'] : ['front', 'back']).map((r) => {
            const row = r as Row;
            const danger =
              side === 'ally' &&
              s.enemies.some(
                (e) =>
                  e.hp > 0 &&
                  e.cast &&
                  (e.cast.target === 'all' || (e.cast.target === 'row' && e.cast.row === row)),
              );
            const rowTarget =
              active && pending.target === (side === 'ally' ? 'allyRow' : 'enemyRow');
            const aimedRow = rowTarget && aim?.kind === 'row' && aim.row === row;
            const rowName = `${side === 'ally' ? '味方' : '敵'}${ROW_NAMES[row]}`;
            return (
              <section
                key={`${side}-${row}`}
                className={`battle-lane ${side} ${row} ${danger ? 'danger-lane' : ''} ${rowTarget ? 'can-target' : ''} ${aimedRow ? 'aimed' : ''} ${active && side !== sideForSkill ? 'outside-target' : ''}`}
                aria-label={rowName}
                onPointerMove={(event) =>
                  (event.movementX || event.movementY) && rowTarget && onAim({ kind: 'row', row })
                }
                onClick={(e) => {
                  if (rowTarget && !full && e.target === e.currentTarget)
                    onTarget({ kind: 'row', row });
                }}
              >
                <button
                  className="lane-heading"
                  id={rowTarget ? `field-target-row-${row}` : undefined}
                  role={rowTarget ? 'option' : undefined}
                  aria-selected={rowTarget ? aimedRow : undefined}
                  aria-label={rowTarget ? `${rowName}に${pending.name}を積む` : undefined}
                  disabled={!rowTarget || full}
                  onClick={() => onTarget({ kind: 'row', row })}
                >
                  {rowName}
                  {side === 'ally' && row === 'front' && !rowTarget && !danger && (
                    <small className="front-bonus">
                      威力・崩し＋{percent(COMBAT_RULES.frontDamage - 1)}%
                    </small>
                  )}
                  {rowTarget && <small>{aimedRow ? '▼ この列へ' : 'この列を選ぶ'}</small>}
                  {danger && <small>⚠ 攻撃予告</small>}
                </button>
                {side === 'ally'
                  ? s.allies
                      .filter((a) => a.row === row)
                      .map((a) => {
                        const w = weaponOf(a),
                          targetable =
                            active &&
                            (pending.target === 'ally' ||
                              (pending.target === 'self' && a.id === s.selected));
                        const aimed = targetable && aim?.kind === 'ally' && aim.id === a.id;
                        const cast = s.enemies.find(
                          (e) => e.hp > 0 && e.cast?.target === 'single' && e.cast.allyId === a.id,
                        )?.cast;
                        return (
                          <button
                            key={a.id}
                            id={targetable ? `field-target-ally-${a.id}` : undefined}
                            data-unit={`a${a.id}`}
                            role={targetable ? 'option' : undefined}
                            aria-selected={targetable ? aimed : undefined}
                            style={{ '--unit-color': a.color } as CSSProperties}
                            className={`field-unit friend ${a.id === s.selected ? 'selected' : ''} ${targetable || rowTarget ? 'can-target' : ''} ${a.hp <= 0 ? 'fallen' : ''} ${aimed || aimedRow ? 'aimed' : ''} ${active && !targetable && !rowTarget ? 'outside-target' : ''}`}
                            disabled={
                              a.hp <= 0 ||
                              s.phase !== 'battle' ||
                              s.controlMode === 'ai' ||
                              (active && ((!targetable && !rowTarget) || full))
                            }
                            aria-label={
                              targetable ? `${a.name}に${pending.name}を積む` : `${a.name}を選択`
                            }
                            onPointerMove={(event) =>
                              (event.movementX || event.movementY) &&
                              targetable &&
                              onAim({ kind: 'ally', id: a.id })
                            }
                            onClick={() =>
                              targetable
                                ? onTarget({ kind: 'ally', id: a.id })
                                : rowTarget
                                  ? onTarget({ kind: 'row', row })
                                  : onAlly(a.id)
                            }
                          >
                            <span className="field-symbol">{w.glyph}</span>
                            <span className="field-unit-info">
                              <strong>
                                {a.name} <b className={`role role-${w.role}`}>{w.role}</b>
                                {a.id === s.selected && s.controlMode === 'manual' && (
                                  <i className="manual-tag">手動</i>
                                )}
                              </strong>
                              <small>
                                {targetable
                                  ? `HP ${Math.ceil(a.hp)} / ${a.maxHp}`
                                  : s.phase === 'battle'
                                    ? executionStatus(a, s.config, s)
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
                              {cast && <em>追尾 {cast.remaining.toFixed(1)}秒</em>}
                            </span>
                          </button>
                        );
                      })
                  : s.enemies
                      .filter((e) => e.row === row)
                      .map((e) => {
                        const targetable = active && pending.target === 'enemy',
                          aimed = targetable && aim?.kind === 'enemy' && aim.id === e.id;
                        return (
                          <button
                            key={e.id}
                            id={targetable ? `field-target-enemy-${e.id}` : undefined}
                            data-unit={`e${e.id}`}
                            role={targetable ? 'option' : undefined}
                            aria-selected={targetable ? aimed : undefined}
                            className={`field-unit foe ${s.target === e.id ? 'selected' : ''} ${e.broken ? 'broken' : ''} ${targetable || rowTarget ? 'can-target' : ''} ${e.hp <= 0 ? 'fallen' : ''} ${aimed || aimedRow ? 'aimed' : ''}`}
                            disabled={
                              e.hp <= 0 ||
                              s.phase !== 'battle' ||
                              s.controlMode === 'ai' ||
                              (active && ((!targetable && !rowTarget) || full))
                            }
                            aria-label={
                              targetable ? `${e.name}に${pending.name}を積む` : `${e.name}を狙う`
                            }
                            onPointerMove={(event) =>
                              (event.movementX || event.movementY) &&
                              targetable &&
                              onAim({ kind: 'enemy', id: e.id })
                            }
                            onClick={() =>
                              targetable
                                ? onTarget({ kind: 'enemy', id: e.id })
                                : rowTarget
                                  ? onTarget({ kind: 'row', row })
                                  : onEnemy(e.id)
                            }
                          >
                            <span className="field-symbol">{e.glyph}</span>
                            <span className="field-unit-info">
                              <strong>
                                {s.target === e.id && '◎ '}
                                {e.name}
                              </strong>
                              <span className="unit-gauges">
                                <UnitGauge
                                  label={`${e.name}のHP`}
                                  value={e.hp}
                                  max={e.maxHp}
                                  kind="enemy-hp"
                                  text={`${Math.ceil(e.hp)} / ${e.maxHp}`}
                                />
                                <UnitGauge
                                  label={`${e.name}のチェイン`}
                                  value={e.broken || e.chain - 100}
                                  max={
                                    e.broken
                                      ? BATTLE_TIMING.breakDuration
                                      : COMBAT_RULES.breakThreshold - 100
                                  }
                                  kind={e.broken ? 'break' : 'chain'}
                                  text={
                                    e.broken
                                      ? `BREAK ${e.broken.toFixed(1)}s`
                                      : `CHAIN ${e.chain.toFixed(0)}% / ${COMBAT_RULES.breakThreshold}%`
                                  }
                                />
                              </span>
                              <span className="unit-telegraph">
                                {e.cast ? (
                                  <>
                                    <span>
                                      <b>{e.cast.name}</b> <b>{e.cast.remaining.toFixed(1)}s</b>
                                    </span>
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
          }),
        )}
        <BattleEffects
          state={s}
          field={field}
          aim={active ? aim : null}
          targetSide={sideForSkill}
        />
      </div>
      <div className="field-footer">
        {s.controlMode === 'manual' && (s.pendingSelect !== null || s.handoffSlow > 0) ? (
          <HandoffStatus state={s} cancel={() => onAlly(s.selected)} />
        ) : (
          <div className="field-hint">
            {active
              ? '方向キーで対象を選ぶ · 駒・列を押しても積めます'
              : s.controlMode === 'ai'
                ? 'AI鑑賞中 · 下に全員の予約と判断を表示'
                : `${s.allies[s.selected].name}を手動操作 · 技を選んで戦場の対象へ`}
            <span>
              {s.timeMode === 'normal'
                ? '通常 ×1.00'
                : s.timeMode === 'slow'
                  ? `スロー ×${COMBAT_RULES.slowScale}`
                  : '戦術停止 ×0.00'}
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
  max,
  kind,
  text,
}: {
  label: string;
  value: number;
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
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.max(0, Math.min(max, value))}
      >
        <i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      </span>
    </span>
  );
}
