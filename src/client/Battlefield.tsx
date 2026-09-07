import { planned, stepName } from '../sim/plan';
import type { CSSProperties } from 'react';
import { ROW_NAMES, SKILLS } from '../content/data';
import { weaponOf } from '../sim/engine';
import type { State, Skill, Target, Row } from '../sim/types';

export function Battlefield({
  state: s,
  pending,
  onAlly,
  onEnemy,
  onTarget,
}: {
  state: State;
  pending: Skill | null;
  onAlly: (id: number) => void;
  onEnemy: (id: number) => void;
  onTarget: (t: Target) => void;
}) {
  return (
    <div className="battlefield" aria-label="敵味方の前後列">
      <div className="field-legend">
        <span>
          味方 → <small>後列は被害 −28%</small>
        </span>
        <span>
          ← 敵 <small>◎ 集中攻撃の対象</small>
        </span>
      </div>
      <div className="horizontal-field">
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
            const rowTarget = pending?.target === (side === 'ally' ? 'allyRow' : 'enemyRow');
            return (
              <section
                key={`${side}-${row}`}
                className={`battle-lane ${side} ${row} ${danger ? 'danger-lane' : ''} ${rowTarget ? 'can-target' : ''}`}
                aria-label={`${side === 'ally' ? '味方' : '敵'}${ROW_NAMES[row]}`}
              >
                <button
                  className="lane-heading"
                  disabled={!rowTarget || s.phase !== 'battle'}
                  onClick={() => onTarget({ kind: 'row', row })}
                >
                  {side === 'ally' ? '味方' : '敵'} {ROW_NAMES[row]}
                  {rowTarget && <small>この列を選ぶ</small>}
                  {danger && <small>⚠ 攻撃予告</small>}
                </button>
                {side === 'ally'
                  ? s.allies
                      .filter((a) => a.row === row)
                      .map((a) => {
                        const w = weaponOf(a),
                          targetable = pending?.target === 'ally';
                        const cast = s.enemies.find(
                          (e) => e.hp > 0 && e.cast?.target === 'single' && e.cast.allyId === a.id,
                        )?.cast;
                        return (
                          <button
                            key={a.id}
                            style={{ gridRow: a.id + 2, '--unit-color': a.color } as CSSProperties}
                            className={`field-unit friend ${a.id === s.selected ? 'selected' : ''} ${targetable ? 'can-target' : ''} ${a.hp <= 0 ? 'fallen' : ''}`}
                            disabled={a.hp <= 0 || s.phase !== 'battle'}
                            aria-label={`${a.name}を${targetable ? '対象にする' : '選択'}`}
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
                              </strong>
                              <small>
                                {a.nextRow
                                  ? `${ROW_NAMES[a.nextRow]}へ移動中`
                                  : planned(a).length
                                    ? `次：${stepName(a, planned(a)[0])}`
                                    : w.archetype}
                              </small>
                              {cast && <em>追尾 {cast.remaining.toFixed(1)}秒</em>}
                            </span>
                            <Impact state={s} target={`a${a.id}`} />
                          </button>
                        );
                      })
                  : s.enemies
                      .filter((e) => e.row === row)
                      .map((e) => {
                        const targetable = pending?.target === 'enemy';
                        return (
                          <button
                            key={e.id}
                            style={{ gridRow: e.id + 2 }}
                            className={`field-unit foe ${s.target === e.id ? 'selected' : ''} ${e.broken ? 'broken' : ''} ${targetable ? 'can-target' : ''} ${e.hp <= 0 ? 'fallen' : ''}`}
                            disabled={e.hp <= 0 || s.phase !== 'battle'}
                            aria-label={`${e.name}を${targetable ? '対象にする' : '狙う'}`}
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
                              <small>
                                {e.hp <= 0
                                  ? '撃破'
                                  : e.broken > 0
                                    ? `BREAK ${e.broken.toFixed(1)}秒`
                                    : e.kind === 'guard' && row === 'front'
                                      ? '後列を防護'
                                      : e.steadfast > 0
                                        ? '踏ん張り'
                                        : '強制移動可'}
                              </small>
                            </span>
                            <Impact state={s} target={`e${e.id}`} />
                          </button>
                        );
                      })}
              </section>
            );
          }),
        )}
      </div>
      <div className="field-hint">
        {pending
          ? `${pending.name}：光っている対象・列を選択`
          : '仲間を選ぶ → 技を選ぶ → 対象を選ぶ'}
        <span>
          {s.timeMode === 'normal'
            ? '通常 ×1.00'
            : s.timeMode === 'slow'
              ? 'スロー ×0.25'
              : '戦術停止 ×0.00'}
        </span>
      </div>
    </div>
  );
}
function Impact({ state, target }: { state: State; target: string }) {
  const event = [...state.events]
    .reverse()
    .find((e) => e.target === target && e.value && state.time - e.time < 0.85);
  return event ? (
    <span key={event.id} className={`floating ${event.type}`}>
      {event.type === 'heal' ? '+' : ''}
      {event.value}
    </span>
  ) : null;
}
