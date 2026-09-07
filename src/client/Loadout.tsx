import { useState, type CSSProperties } from 'react';
import { SKILLS, WEAPONS } from '../content/data';
import type { Command, Row, Slot, State, Weapon } from '../sim/types';
export const weaponFunction = (w: Weapon) =>
  w.id === 'shield'
    ? '防護'
    : w.id === 'bell'
      ? '回復'
      : w.id === 'banner'
        ? '防護・退避'
        : w.specialty;
export function FormationDiagram({
  state: s,
  rows,
  slots,
}: {
  state: State;
  rows: Row[];
  slots?: Slot[];
}) {
  return (
    <svg className="formation-diagram" viewBox="0 0 120 70" aria-label="前後列の配置図" role="img">
      <text x="28" y="10">
        後列
      </text>
      <text x="85" y="10">
        前列
      </text>
      <path d="M60 16V70" stroke="currentColor" opacity=".2" />
      {s.allies.map((a) => {
        const w = WEAPONS[a.weapons[slots?.[a.id] ?? a.slot]],
          x = rows[a.id] === 'front' ? 94 : 36,
          y = 24 + a.id * 18;
        return (
          <g key={a.id}>
            <circle cx={x} cy={y} r="7" fill={a.color} />
            <text x={x} y={y + 3} className="diagram-role">
              {w.role}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
export function Loadout({
  state: s,
  send,
  onCompare,
}: {
  state: State;
  send: (...c: Command[]) => void;
  onCompare: (id: string) => void;
}) {
  const [tab, setTab] = useState<'weapons' | 'presets' | 'formations'>('weapons');
  const [actor, setActor] = useState(0),
    [slot, setSlot] = useState<Slot>(0),
    [index, setIndex] = useState(0),
    [formation, setFormation] = useState(0);
  const [notice, setNotice] = useState('');
  const a = s.allies[actor],
    equipped = WEAPONS[a.weapons[slot]],
    preset = s.presets[index],
    f = s.formations[formation];
  const rows = tab === 'formations' ? f.rows : preset.rows;
  const linked = s.config.uiMode === 'linked';
  return (
    <div className="loadout-visual">
      <div className="loadout-tabs" role="tablist" aria-label="編成の編集対象">
        {(
          [
            ['weapons', '持ち込み武器'],
            ['presets', 'オプティマ'],
            ['formations', '一括隊列'],
          ] as const
        ).map(([id, name]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>
      <p className="role-key">
        A 削る <span>B 崩す</span>
        <span className="role-D">D 受け止める</span>
        <span>S 状態を整える</span> · 3人 / 一人2武器
      </p>
      {tab === 'weapons' ? (
        <section role="tabpanel" aria-label="持ち込み武器">
          <div className="loadout-party">
            {s.allies.map((ally) => (
              <article key={ally.id} style={{ '--actor-color': ally.color } as CSSProperties}>
                <h3>
                  <span>{ally.initial}</span>
                  {ally.name}
                </h3>
                {ally.weapons.map((id, i) => {
                  const w = WEAPONS[id];
                  return (
                    <button
                      key={i}
                      className={`weapon-slot ${actor === ally.id && slot === i ? 'chosen' : ''}`}
                      aria-pressed={actor === ally.id && slot === i}
                      aria-label={`${ally.name}の武器枠${i + 1}を編集`}
                      onClick={() => {
                        setActor(ally.id);
                        setSlot(i as Slot);
                      }}
                    >
                      <span className="weapon-glyph">{w.glyph}</span>
                      <span>
                        <small>
                          枠{i + 1} · {w.archetype}
                        </small>
                        <strong>{w.name}</strong>
                        <small className={`role-${w.role}`}>
                          {w.role}｜{weaponFunction(w)}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </article>
            ))}
          </div>
          <div className="weapon-pool-heading">
            <h3>
              {a.name} · 枠{slot + 1}の武器を選ぶ
            </h3>
            <span>
              現在：{equipped.archetype} {equipped.role}｜{weaponFunction(equipped)}
            </span>
          </div>
          <div className="weapon-pool">
            {s.inventory.map((id) => {
              const w = WEAPONS[id],
                owner = s.allies.find((x) =>
                  x.weapons.some((wid, i) => wid === id && (x.id !== actor || i !== slot)),
                ),
                chosen = a.weapons[slot] === id;
              return (
                <button
                  key={id}
                  className={`weapon-choice ${chosen ? 'chosen' : ''}`}
                  aria-label={`${w.name}を${a.name}の枠${slot + 1}に装備`}
                  aria-pressed={chosen}
                  disabled={!!owner}
                  onClick={() => {
                    send({ type: 'equip', id: actor, slot, weaponId: id });
                    onCompare(id);
                    setNotice(
                      `${a.name}：${equipped.archetype} ${equipped.role}｜${weaponFunction(equipped)} → ${w.archetype} ${w.role}｜${weaponFunction(w)}。主力技：${SKILLS[equipped.skills[1]].name} → ${SKILLS[w.skills[1]].name}。登録済みオプティマにも反映。`,
                    );
                  }}
                >
                  <span className="weapon-glyph">{w.glyph}</span>
                  <strong>{w.name}</strong>
                  <span>
                    {w.archetype} <b className={`role role-${w.role}`}>{w.role}</b>
                  </span>
                  <small>{weaponFunction(w)}</small>
                  <small>{w.skills.map((id) => SKILLS[id].name).join(' / ')}</small>
                  <em>
                    {owner
                      ? `${owner.name}が持ち込み中`
                      : chosen
                        ? '装備中'
                        : `${equipped.role} → ${w.role} · 選んで交換`}
                  </em>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <section role="tabpanel" aria-label={tab === 'presets' ? 'オプティマ' : '一括隊列'}>
          <div className="tactic-cards">
            {(tab === 'presets' ? s.presets : s.formations).map((p, i) => (
              <button
                key={i}
                aria-pressed={(tab === 'presets' ? index : formation) === i}
                aria-label={`${tab === 'presets' ? 'オプティマ' : '隊列'}${i + 1}を編集`}
                onClick={() => (tab === 'presets' ? setIndex(i) : setFormation(i))}
              >
                <span>
                  <small>
                    {tab === 'presets' ? 'OPTIMA' : 'FORMATION'} 0{i + 1}
                  </small>
                  <strong>{p.name}</strong>
                  {tab === 'presets' && (
                    <span className="tactic-roles">
                      {s.presets[i].slots.map((slot, id) => {
                        const w = WEAPONS[s.allies[id].weapons[slot]];
                        return (
                          <b key={id} className={`role role-${w.role}`}>
                            {w.role}
                          </b>
                        );
                      })}
                    </span>
                  )}
                </span>
                <FormationDiagram
                  state={s}
                  rows={p.rows}
                  slots={tab === 'presets' ? s.presets[i].slots : undefined}
                />
              </button>
            ))}
          </div>
          <div className="board-heading">
            <h3>{tab === 'presets' ? preset.name : f.name}</h3>
            <span>名前は{tab === 'presets' ? '役割の組み合わせ' : '前後列の配置'}から自動更新</span>
          </div>
          {tab === 'presets' && !linked && (
            <p className="loadout-note">
              このモードのオプティマは武器構成を切り替えます。前後列は「一括隊列」で編集できます。
            </p>
          )}
          <div className={`formation-board ${tab === 'presets' && !linked ? 'roles-only' : ''}`}>
            {(tab === 'formations' || linked) && (
              <>
                <span className="board-label back">← 後列 · 被害軽減</span>
                <span className="board-label front">前列 · 近接威力 →</span>
              </>
            )}
            {s.allies.map((ally) => {
              const activeSlot = tab === 'presets' ? preset.slots[ally.id] : ally.slot,
                w = WEAPONS[ally.weapons[activeSlot]],
                row = rows[ally.id];
              return (
                <article
                  key={ally.id}
                  className="formation-actor"
                  style={
                    {
                      gridRow: ally.id + 2,
                      gridColumn: tab === 'presets' && !linked ? 1 : row === 'back' ? 1 : 2,
                      '--actor-color': ally.color,
                    } as CSSProperties
                  }
                >
                  <div className="formation-actor-title">
                    <span className="weapon-glyph">{w.glyph}</span>
                    <strong>{ally.name}</strong>
                    <b className={`role role-${w.role}`}>{w.role}</b>
                    <small>
                      {w.archetype}｜{weaponFunction(w)}
                    </small>
                  </div>
                  {tab === 'presets' && (
                    <div className="preset-weapons">
                      {ally.weapons.map((id, slot) => {
                        const item = WEAPONS[id];
                        return (
                          <button
                            key={slot}
                            aria-pressed={activeSlot === slot}
                            aria-label={`オプティマ${index + 1}の${ally.name}を枠${slot + 1}に変更`}
                            onClick={() =>
                              send({ type: 'editPreset', index, id: ally.id, slot: slot as Slot })
                            }
                          >
                            {item.glyph} {item.archetype}{' '}
                            <b className={`role-${item.role}`}>
                              {item.role}｜{weaponFunction(item)}
                            </b>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {(tab === 'formations' || linked) && (
                    <button
                      className="change-row"
                      aria-label={`${tab === 'presets' ? 'オプティマ' : '隊列'}${(tab === 'presets' ? index : formation) + 1}の${ally.name}を${row === 'front' ? '後列' : '前列'}へ`}
                      onClick={() =>
                        send(
                          tab === 'presets'
                            ? {
                                type: 'editPresetRow',
                                index,
                                id: ally.id,
                                row: row === 'front' ? 'back' : 'front',
                              }
                            : {
                                type: 'editFormation',
                                index: formation,
                                id: ally.id,
                                row: row === 'front' ? 'back' : 'front',
                              },
                        )
                      }
                    >
                      {row === 'front' ? '← 後列へ' : '前列へ →'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
      {notice && (
        <p className="loadout-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
