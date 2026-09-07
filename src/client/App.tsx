import { ActionConsole } from './ActionConsole';
import { PadSettings } from './PadSettings';
import { useGamepad } from './useGamepad';
import {
  activateFocused,
  navigate,
  cycleFocus,
  focusElement,
  inputScope,
} from '../input/navigation';
import { buttonName, type PadAction } from '../input/gamepad';
import { projectedSlot } from '../sim/plan';
import { ENCOUNTER_SET_IDS, ENCOUNTER_SETS, encounterSet, pressure } from '../content/encounters';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, ROLE_NAMES, ROW_NAMES, SKILLS, WEAPONS } from '../content/data';
import type { Command, Config, Enemy, Row, State, Target } from '../sim/types';
import { Session } from '../lab/session';
import { Battlefield } from './Battlefield';
import { CombatLog } from './CombatLog';

const rowList: Row[] = ['front', 'back'];
const fmt = (n: number) => n.toFixed(1);
function Key({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}
function Meter({
  value,
  max,
  type = '',
  label,
}: {
  value: number;
  max: number;
  type?: string;
  label?: string;
}) {
  return (
    <div
      className={`meter ${type}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
    >
      <i style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }} />
    </div>
  );
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [session] = useState(() => new Session());
  const [, render] = useState(0);
  const [labOpen, setLabOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>({ ...DEFAULT_CONFIG });
  const [compare, setCompare] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const s = session.state,
    ally = s.allies[s.selected],
    weapon = WEAPONS[ally.weapons[projectedSlot(ally)]];
  const refresh = () => render((x) => x + 1);
  const send = (...commands: Command[]) => {
    session.send(...commands);
    refresh();
  };
  const select = (id: number) => {
    setPending(null);
    send({ type: 'select', id });
  };
  const pickOptima = (index: number) => {
    const cmds: Command[] = [{ type: 'optima', index }];
    if (s.config.uiMode === 'linked')
      s.presets[index].rows.forEach((row, id) => cmds.push({ type: 'move', id, row }));
    send(...cmds);
    setPending(null);
  };
  const useSkill = (id: string, target?: Target) => {
    if (!target) {
      setPending(pending === id ? null : id);
      return;
    }
    send({
      type: 'enqueue',
      id: ally.id,
      step: { kind: 'skill', skillId: id, target },
    });
    setPending(null);
    requestAnimationFrame(() =>
      focusElement(
        document.querySelector<HTMLElement>(`.action-tile[data-skill="${id}"]`) ?? undefined,
      ),
    );
  };
  const restart = (newConfig?: Config, announce = true) => {
    if (newConfig) session.reset(newConfig);
    else session.retry();
    setPending(null);
    setNotice(announce ? '開始条件を復元しました。' : '');
    refresh();
  };

  useEffect(() => {
    let previous = performance.now(),
      frame = 0;
    const loop = (now: number) => {
      session.advance((now - previous) / 1000);
      previous = now;
      render((x) => x + 1);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const hidden = () => {
      previous = performance.now();
      if (document.hidden && session.state.phase === 'battle') {
        session.send({ type: 'pause', value: true });
        render((x) => x + 1);
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [session]);
  useEffect(() => {
    const blocked = s.paused || help || padOpen || ['loot', 'victory', 'defeat'].includes(s.phase);
    if (!blocked) return;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    const focusables = () =>
      [
        ...(dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select, input, summary',
        ) ?? []),
      ].filter((el) => el.getClientRects().length > 0);
    focusables()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const els = focusables(),
        first = els[0],
        last = els[els.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [s.paused, s.phase, help, padOpen]);
  useEffect(() => {
    if (pending) document.querySelector<HTMLButtonElement>('.target-choices button')?.focus();
  }, [pending]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof Element && event.target.closest('input,select,textarea'))
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (padOpen) {
          setPadOpen(false);
          return;
        }
        if (pending) {
          setPending(null);
          return;
        }
        setHelp(false);
        setPending(null);
        if (s.phase === 'battle') send({ type: 'pause', value: !s.paused });
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        navigate(event.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right');
        return;
      }
      if (s.paused || s.phase !== 'battle' || help || padOpen) return;
      const key = event.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key))
        event.preventDefault();
      if (/^[1-3]$/.test(key)) select(Number(key) - 1);
      else if (key === 'q' || key === 'e') {
        const alive = s.allies.filter((a) => a.hp > 0).map((a) => a.id),
          index = alive.indexOf(s.selected);
        select(alive[(index + (key === 'q' ? alive.length - 1 : 1)) % alive.length]);
      } else if (key === 'z') useSkill(weapon.skills[0]);
      else if (key === 'x') useSkill(weapon.skills[1]);
      else if (key === 'c') useSkill('guard');
      else if (key === 'v') useSkill('potion');
      else if (key === ' ') send({ type: 'time', mode: s.timeMode === 'slow' ? 'normal' : 'slow' });
      else if (key === 'f') send({ type: 'time', mode: s.timeMode === 'stop' ? 'normal' : 'stop' });
      else if (/^[7-9]$/.test(key) && s.config.uiMode !== 'individual')
        send({ type: 'formation', index: Number(key) - 7 });
      else if (['a', 's', 'd', 'g'].includes(key)) pickOptima(['a', 's', 'd', 'g'].indexOf(key));
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const handlePad = (action: PadAction) => {
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
      navigate(action);
      return;
    }
    if (action === 'confirm') {
      activateFocused();
      return;
    }
    if (action === 'cancel') {
      if (padOpen) setPadOpen(false);
      else if (help) {
        setHelp(false);
        if (s.paused) send({ type: 'pause', value: false });
      } else if (s.paused) send({ type: 'pause', value: false });
      else if (pending) {
        setPending(null);
        requestAnimationFrame(() =>
          focusElement(document.querySelector<HTMLElement>('.action-tile') ?? undefined),
        );
      } else if (labOpen) setLabOpen(false);
      return;
    }
    if (action === 'previous' || action === 'next') {
      if (s.paused || help || padOpen || labOpen || s.phase !== 'battle') {
        cycleFocus(action === 'next' ? 1 : -1);
        return;
      }
      const ids = s.allies.filter((a) => a.hp > 0).map((a) => a.id),
        i = ids.indexOf(s.selected);
      select(ids[(i + (action === 'next' ? 1 : ids.length - 1)) % ids.length]);
      return;
    }
    if (action === 'log') {
      inputScope().querySelector<HTMLButtonElement>('.log-heading button')?.click();
      return;
    }
    if (padOpen || help || labOpen || s.phase !== 'battle') return;
    if (action === 'pause') {
      send({ type: 'pause', value: !s.paused });
      return;
    }
    if (s.paused) return;
    if (action === 'slow') send({ type: 'time', mode: s.timeMode === 'slow' ? 'normal' : 'slow' });
    if (action === 'stop') send({ type: 'time', mode: s.timeMode === 'stop' ? 'normal' : 'stop' });
  };
  const gamepad = useGamepad(
    handlePad,
    () => {
      if (session.state.phase === 'battle') {
        send({ type: 'pause', value: true });
        setNotice('パッドの接続が切れました。休憩ポーズに入りました。');
      }
    },
    padOpen,
  );
  useEffect(() => {
    if (pending && ![...weapon.skills, 'guard', 'potion'].includes(pending)) setPending(null);
  }, [weapon.id, pending]);
  const loadFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text(),
        data = JSON.parse(text);
      if (data.kind === 'snapshot') session.restore(text);
      else session.replay(text);
      setConfig({ ...session.state.config });
      setLabOpen(false);
      setPending(null);
      setNotice(
        data.kind === 'snapshot'
          ? '保存状態を復元しました。'
          : '入力列を再生し、記録の終端状態を復元しました。',
      );
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '読み込みに失敗しました。');
    }
  };
  return (
    <div className={`app ${s.timeMode} ${s.paused ? 'is-paused' : ''}`}>
      <header
        className="topbar"
        inert={s.paused || help || padOpen || ['loot', 'victory', 'defeat'].includes(s.phase)}
      >
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">◈</span>
          <span>
            境界のオルケストラ<small>ORCHESTRA OF THE VERGE</small>
          </span>
        </a>
        {!gamepad.pad && (
          <div className="chapter">
            <span className="eyebrow">BATTLE STUDY / 01</span>
            <span>{encounterSet(s.config).stages[s.encounter - 1]}</span>
            <i>{s.encounter} / 2</i>
          </div>
        )}
        {gamepad.pad && (
          <div className="pad-hints">
            {gamepad.supported ? (
              <>
                <b>{buttonName(gamepad.bindings.confirm, gamepad.family)}</b> 決定・積む{' '}
                <b>{buttonName(gamepad.bindings.cancel, gamepad.family)}</b> 戻る{' '}
                <b>
                  {buttonName(gamepad.bindings.previous, gamepad.family)} /{' '}
                  {buttonName(gamepad.bindings.next, gamepad.family)}
                </b>{' '}
                仲間 <b>{buttonName(gamepad.bindings.slow, gamepad.family)}</b> スロー{' '}
                <b>{buttonName(gamepad.bindings.stop, gamepad.family)}</b> 停止
              </>
            ) : (
              'パッド設定で、この機器のボタンを割り当ててください。'
            )}
          </div>
        )}

        <nav aria-label="補助操作">
          <button
            onClick={() => {
              setPadOpen(true);
              if (s.phase === 'battle') send({ type: 'pause', value: true });
            }}
            aria-label="ゲームパッド設定"
          >
            {gamepad.pad
              ? `🎮 ${gamepad.family === 'playstation' ? 'PS' : gamepad.family === 'switch' ? 'Switch' : 'Xbox'}`
              : '🎮 パッド'}
          </button>
          <button className={labOpen ? 'active' : ''} onClick={() => setLabOpen(!labOpen)}>
            ⚙ 実験室
          </button>
          <button
            onClick={() => {
              setHelp(true);
              if (s.phase === 'battle') send({ type: 'pause', value: true });
            }}
          >
            操作説明
          </button>
          <button
            aria-label="ポーズ"
            disabled={s.phase !== 'battle'}
            onClick={() => send({ type: 'pause', value: !s.paused })}
          >
            Ⅱ <Key>Esc</Key>
          </button>
        </nav>
      </header>

      <main
        className="battle-layout"
        inert={s.paused || help || padOpen || ['loot', 'victory', 'defeat'].includes(s.phase)}
      >
        <section className="battle-main" aria-label="戦闘画面">
          <div className="battle-heading">
            <div>
              <span className="eyebrow">
                ENCOUNTER {String(s.encounter).padStart(2, '0')} / 強度{' '}
                {s.config.encounterLevel ?? 1}
              </span>
              <h1>
                {encounterSet(s.config).stages[s.encounter - 1]}
                <span>ASHEN BELFRY</span>
              </h1>
            </div>
            <div className="battle-clock">
              <small>BATTLE TIME</small>
              <strong>
                {Math.floor(s.time / 60)
                  .toString()
                  .padStart(2, '0')}
                <em>:</em>
                {(s.time % 60).toFixed(1).padStart(4, '0')}
              </strong>
            </div>
          </div>

          {s.phase === 'ready' && (
            <section className="encounter-picker" aria-label="戦闘セット選択">
              <div className="section-label">
                <b>戦闘セット</b>
                <small>各セット2連戦</small>
              </div>
              <div className="encounter-choices">
                {ENCOUNTER_SET_IDS.map((id) => (
                  <button
                    key={id}
                    aria-pressed={(s.config.encounterSet ?? 'belfry') === id}
                    title={ENCOUNTER_SETS[id].description}
                    onClick={() => {
                      const next = { ...s.config, encounterSet: id, encounter: 1 as const };
                      setConfig(next);
                      restart(next, false);
                    }}
                  >
                    {ENCOUNTER_SETS[id].name}
                  </button>
                ))}
              </div>
              <p>{encounterSet(s.config).description}</p>
              <div className="level-choices" aria-label="戦闘の強度">
                <b>強度</b>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((level) => (
                  <button
                    key={level}
                    aria-label={`強度 ${level}`}
                    aria-pressed={(s.config.encounterLevel ?? 1) === level}
                    onClick={() => {
                      const next = { ...s.config, encounterLevel: level };
                      setConfig(next);
                      restart(next, false);
                    }}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <small>
                強度 {s.config.encounterLevel ?? 1}：敵HP ×
                {pressure(s.config.encounterLevel).hp.toFixed(2)} / 敵ダメージ ×
                {pressure(s.config.encounterLevel).damage.toFixed(2)}
              </small>
            </section>
          )}
          {s.phase === 'ready' && (
            <div className="ready-bar">
              <p>
                <strong>武器と隊列を選んで、出発。</strong>
                <span>仲間は自動で戦います。いつでも技を予約できます。</span>
              </p>
              <button data-pad-default className="primary" onClick={() => send({ type: 'start' })}>
                戦闘開始 <span>→</span>
              </button>
            </div>
          )}

          <section className="enemy-strip" aria-label="敵の状態">
            {s.enemies.map((e) => (
              <EnemyCard
                key={e.id}
                enemy={e}
                selected={s.target === e.id}
                onClick={() =>
                  pending && SKILLS[pending].target === 'enemy'
                    ? useSkill(pending, { kind: 'enemy', id: e.id })
                    : pending && SKILLS[pending].target === 'enemyRow'
                      ? useSkill(pending, { kind: 'row', row: e.row })
                      : send({ type: 'target', id: e.id })
                }
              />
            ))}
          </section>

          <Battlefield
            state={s}
            pending={pending ? SKILLS[pending] : null}
            onAlly={select}
            onEnemy={(id) => send({ type: 'target', id })}
            onTarget={(target) => {
              if (pending) useSkill(pending, target);
            }}
          />
        </section>

        <aside className="command-sidebar">
          <section className="focus-panel">
            <div className="section-label">
              <span>FOCUS</span>
              <b>集中力</b>
              <strong>
                {Math.ceil(s.focus)}
                <small> / 100</small>
              </strong>
            </div>
            <Meter value={s.focus} max={100} type="focus" label="集中力" />
            <div className="time-buttons">
              {(['normal', 'slow', 'stop'] as const).map((mode, i) => (
                <button
                  key={mode}
                  className={s.timeMode === mode ? 'active' : ''}
                  disabled={
                    s.phase !== 'battle' ||
                    (mode !== 'normal' && s.focus <= 4 && s.timeMode === 'normal')
                  }
                  onClick={() => send({ type: 'time', mode })}
                >
                  <span>{['通常', 'スロー', '停止'][i]}</span>
                  <small>{['×1.00', '×0.25', '×0.00'][i]}</small>
                </button>
              ))}
            </div>
            <div className="focus-note">
              <span>
                {s.timeMode === 'normal'
                  ? '開始時 −4 / 戦闘ごとに全回復'
                  : `あと ${fmt(s.focus / (s.timeMode === 'slow' ? s.config.slowDrain : s.config.stopDrain))} 秒 · 実時間で消費`}
              </span>
              <Key>{s.timeMode === 'stop' ? 'F' : 'Space'}</Key>
            </div>
          </section>

          <div className="lower-controls">
            <section className="optima-panel">
              <div className="section-label">
                <span>01 / OPTIMA</span>
                <b>戦い方を替える</b>
                <small>
                  {s.config.uiMode === 'linked' ? '武器＋隊列を同時指示' : '武器だけを切り替え'}
                </small>
              </div>
              <div className="optima-buttons">
                {s.presets.map((p, i) => (
                  <button
                    key={i}
                    disabled={!['ready', 'battle'].includes(s.phase)}
                    className={`optima ${s.activePreset === i && p.slots.every((slot, id) => slot === (s.allies[id].nextSlot ?? s.allies[id].slot)) ? 'active' : ''}`}
                    onClick={() => pickOptima(i)}
                  >
                    <span>
                      <Key>{['A', 'S', 'D', 'G'][i]}</Key>
                      {p.name}
                    </span>
                    <div>
                      {p.slots.map((slot, id) => (
                        <b
                          key={id}
                          className={`role role-${WEAPONS[s.allies[id].weapons[slot]].role}`}
                        >
                          {WEAPONS[s.allies[id].weapons[slot]].role}
                        </b>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section className="formation-panel">
              <div className="section-label">
                <span>02 / FORMATION</span>
                <b>立ち位置を替える</b>
              </div>
              {s.config.uiMode === 'individual' ? (
                <p className="muted">個別操作モード：行動の「移動」から予約</p>
              ) : (
                <div className="formation-buttons">
                  {s.formations.map((f, i) => (
                    <button
                      disabled={!['ready', 'battle'].includes(s.phase)}
                      key={i}
                      onClick={() => send({ type: 'formation', index: i })}
                    >
                      <FormationGlyph rows={f.rows} />
                      <span>{f.name}</span>
                      <Key>{i + 7}</Key>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </aside>
        <ActionConsole
          state={s}
          pending={pending}
          onChoose={useSkill}
          onTarget={(target) => {
            if (pending) useSkill(pending, target);
          }}
          onBack={() => setPending(null)}
          onSelect={select}
          send={send}
        />
      </main>

      <div
        className="log-container"
        inert={s.paused || help || padOpen || ['loot', 'victory', 'defeat'].includes(s.phase)}
      >
        <CombatLog
          entries={session.log}
          onExport={() =>
            download(
              'orchestra-battle-log.json',
              JSON.stringify({ config: s.config, events: session.log }, null, 2),
            )
          }
        />
      </div>

      {labOpen && (
        <aside
          className="lab-drawer"
          aria-label="実験室"
          inert={s.paused || help || padOpen || ['loot', 'victory', 'defeat'].includes(s.phase)}
        >
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">BATTLE LAB</span>
              <h2>実験室</h2>
            </div>
            <button aria-label="実験室を閉じる" onClick={() => setLabOpen(false)}>
              ×
            </button>
          </div>
          <p className="lab-note">
            開いている間も戦闘は進行します。数値・装備は再開始時か戦闘の合間に変更できます。
          </p>
          <div className="lab-actions">
            <button onClick={() => restart()}>同じ条件でリトライ</button>
            <button
              onClick={() => {
                setSnapshot(session.snapshot());
                setNotice('現在の状態を一時保存しました。');
              }}
            >
              状態を保存
            </button>
            <button
              disabled={!snapshot}
              onClick={() => {
                if (snapshot) {
                  session.restore(snapshot);
                  setPending(null);
                  setNotice('保存時点へ戻りました。');
                  refresh();
                }
              }}
            >
              保存状態へ戻る
            </button>
          </div>
          <div className="lab-section">
            <h3>次の再開始の条件</h3>
            <label>
              操作方式
              <select
                aria-label="操作方式"
                value={config.uiMode}
                onChange={(e) =>
                  setConfig({ ...config, uiMode: e.target.value as Config['uiMode'] })
                }
              >
                <option value="separate">分離＋一括隊列</option>
                <option value="individual">分離＋個別隊列のみ</option>
                <option value="linked">オプティマと隊列を一体化</option>
              </select>
            </label>
            <label>
              遭遇
              <select
                aria-label="遭遇"
                value={config.encounter}
                onChange={(e) =>
                  setConfig({ ...config, encounter: Number(e.target.value) as 1 | 2 })
                }
              >
                <option value={1}>第一戦から</option>
                <option value={2}>第二戦だけ試す</option>
              </select>
            </label>
            {(
              [
                ['seed', '乱数seed', 0, 999999, 1],
                ['atbRate', 'ATB / 秒', 0.2, 3, 0.05],
                ['moveTime', '移動時間 / 秒', 0.1, 2, 0.1],
                ['shiftTime', '武器変更 / 秒', 0.1, 2, 0.05],
                ['enemyPower', '敵の攻撃倍率', 0.2, 3, 0.1],
                ['slowDrain', 'スロー消費 / 秒', 1, 20, 1],
                ['stopDrain', '停止消費 / 秒', 1, 30, 1],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={config[key]}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      [key]: Math.min(max, Math.max(min, Number(e.target.value) || min)),
                    })
                  }
                />
              </label>
            ))}
            <button
              className="primary compact"
              onClick={() => {
                restart(config);
                setLabOpen(false);
              }}
            >
              条件を反映して再開始
            </button>
          </div>
          {(s.phase === 'ready' || s.phase === 'loot') && (
            <>
              <button onClick={() => send({ type: 'labWeapons' })}>検証用に全武器を追加</button>
              <Loadout state={s} send={send} onCompare={setCompare} />
            </>
          )}
          <div className="lab-section">
            <h3>記録と再現</h3>
            <p className="muted">同じルールの入力を待ち時間なしで再生し、終端状態へ戻します。</p>
            <div className="lab-actions">
              <button onClick={() => download('orchestra-state.json', session.snapshot())}>
                状態JSON
              </button>
              <button
                onClick={() =>
                  download('orchestra-replay.json', JSON.stringify(session.recording(), null, 2))
                }
              >
                リプレイJSON
              </button>
              <button onClick={() => upload.current?.click()}>JSONを読み込む</button>
            </div>
            <input
              ref={upload}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="lab-section">
            <h3>今回の記録</h3>
            <dl className="metrics">
              <div>
                <dt>戦闘時間</dt>
                <dd>{fmt(s.time)}秒</dd>
              </div>
              <div>
                <dt>実時間</dt>
                <dd>{fmt(s.realTime)}秒</dd>
              </div>
              <div>
                <dt>与ダメージ</dt>
                <dd>{s.metrics.damage}</dd>
              </div>
              <div>
                <dt>被ダメージ</dt>
                <dd>{s.metrics.taken}</dd>
              </div>
              <div>
                <dt>回復量</dt>
                <dd>{s.metrics.healed}</dd>
              </div>
              <div>
                <dt>集中力消費</dt>
                <dd>{fmt(s.metrics.focusUsed)}</dd>
              </div>
              <div>
                <dt>ブレイク</dt>
                <dd>{s.metrics.breaks}</dd>
              </div>
              <div>
                <dt>コア指示数</dt>
                <dd>{s.metrics.inputs}</dd>
              </div>
            </dl>
          </div>
          <div className="lab-section">
            <h3>入力ログ</h3>
            <div className="full-log">
              {session.inputs
                .slice(-35)
                .reverse()
                .map((e) => (
                  <p key={e.order}>
                    <time>
                      {e.tick} / #{e.order}
                    </time>
                    {JSON.stringify(e.command)}
                  </p>
                ))}
            </div>
          </div>
          <div className="lab-section">
            <h3>イベントログ</h3>
            <div className="full-log">
              {session.log
                .slice()
                .reverse()
                .map((e) => (
                  <p key={e.id}>
                    <time>{fmt(e.time)}s</time>
                    {e.text}
                  </p>
                ))}
            </div>
          </div>
        </aside>
      )}

      {s.phase === 'loot' && (
        <div className="modal-backdrop">
          <section className="loot-modal" role="dialog" aria-modal="true" aria-label="戦利品と編成">
            <span className="eyebrow">ENCOUNTER CLEAR</span>
            <h2>新しい武器、新しい戦い方。</h2>
            <p>HPは全回復。武器を入れ替え、次の戦場へ。</p>
            <div className="loot-cards">
              {['hammer', 'starbow', 'banner'].map((id) => {
                const w = WEAPONS[id];
                return (
                  <button
                    key={id}
                    className={compare === id ? 'active' : ''}
                    onClick={() => setCompare(id)}
                  >
                    <span className="loot-glyph">{w.glyph}</span>
                    <span className="eyebrow">ACQUIRED</span>
                    <h3>{w.name}</h3>
                    <p>
                      <b className={`role role-${w.role}`}>{w.role}</b> {w.archetype} /{' '}
                      {w.specialty}
                    </p>
                    <small>{w.trait}</small>
                  </button>
                );
              })}
            </div>
            <Loadout state={s} send={send} onCompare={setCompare} />
            <CombatLog
              entries={session.log}
              onExport={() =>
                download(
                  'orchestra-battle-log.json',
                  JSON.stringify({ config: s.config, events: session.log }, null, 2),
                )
              }
            />
            <div className="modal-actions">
              <button
                onClick={() =>
                  download('orchestra-replay.json', JSON.stringify(session.recording(), null, 2))
                }
              >
                一戦目のリプレイを保存
              </button>
              <button
                className="primary"
                onClick={() => {
                  setLabOpen(false);
                  send({ type: 'next' });
                }}
              >
                次の戦闘へ →
              </button>
            </div>
          </section>
        </div>
      )}
      {(s.phase === 'victory' || s.phase === 'defeat') && (
        <div className="modal-backdrop">
          <section className="result-modal" role="dialog" aria-modal="true" aria-label="戦闘結果">
            <span className="eyebrow">
              {s.phase === 'victory' ? 'DEMO COMPLETE' : 'TRY ANOTHER APPROACH'}
            </span>
            <span className="result-symbol">{s.phase === 'victory' ? '◈' : '◇'}</span>
            <h2>{s.phase === 'victory' ? '境界を、越えた。' : '調べは、まだ続く。'}</h2>
            <p>
              {s.phase === 'victory'
                ? '二つの戦いを突破しました。'
                : 'パーティーが全滅しました。武器と隊列を変えて再挑戦できます。'}
            </p>
            <div className="result-numbers">
              <div>
                <strong>
                  {fmt(s.time)}
                  <small>秒</small>
                </strong>
                <span>戦闘時間</span>
              </div>
              <div>
                <strong>{s.metrics.taken}</strong>
                <span>被ダメージ</span>
              </div>
              <div>
                <strong>{s.metrics.breaks}</strong>
                <span>ブレイク</span>
              </div>
            </div>
            <CombatLog
              entries={session.log}
              initialOpen
              onExport={() =>
                download(
                  'orchestra-battle-log.json',
                  JSON.stringify({ config: s.config, events: session.log }, null, 2),
                )
              }
            />
            <button onClick={() => restart({ ...s.config, encounter: 1 })}>
              戦闘セットを選び直す
            </button>
            <button className="primary" onClick={() => restart()}>
              同じ条件でもう一度 →
            </button>
            <button
              onClick={() =>
                download('orchestra-replay.json', JSON.stringify(session.recording(), null, 2))
              }
            >
              リプレイを保存
            </button>
          </section>
        </div>
      )}
      {s.paused && !help && !padOpen && (
        <div className="pause-screen" role="dialog" aria-modal="true" aria-label="休憩ポーズ">
          <span className="eyebrow">INTERMISSION</span>
          <h2>ひと休み。</h2>
          <p>戦闘と集中力の消費を停止しています。</p>
          <button className="primary" onClick={() => send({ type: 'pause', value: false })}>
            戦場へ戻る <Key>Esc</Key>
          </button>
        </div>
      )}
      {help && (
        <div className="modal-backdrop help-backdrop">
          <section className="help-modal" role="dialog" aria-modal="true" aria-label="操作説明">
            <span className="eyebrow">HOW TO PLAY</span>
            <h2>全体を指揮し、一手を差し込む。</h2>
            <p>
              予約が空なら、装備中の武器で自動行動します。AはHP削りとチェイン維持、Bはチェイン上昇、Sは回復や防護。敵のチェインが200%になると8秒間ブレイクします。
            </p>
            <div className="help-grid">
              <div>
                <h3>仲間へ指示する</h3>
                <p>
                  <Key>1</Key>
                  <Key>2</Key>
                  <Key>3</Key> または <Key>Q</Key>
                  <Key>E</Key> で操作キャラを選択。切り替えても行動や予約は残ります。
                </p>
                <p>
                  <Key>Z</Key> 基本技を選ぶ。<Key>X</Key>{' '}
                  主力技を選び、対象をクリックして末尾へ追加。<Key>C</Key> 防御。<Key>V</Key>{' '}
                  救急薬。一人6手まで積めます。
                </p>
              </div>
              <div>
                <h3>編成と位置を変える</h3>
                <p>
                  <Key>A</Key>
                  <Key>S</Key>
                  <Key>D</Key>
                  <Key>G</Key>{' '}
                  で武器構成を切り替え。個別の移動・武器変更は行動タブから順番に積めます。
                  <Key>7</Key>
                  <Key>8</Key>
                  <Key>9</Key> で一括隊列。
                </p>
                <p>前列は近接威力・崩し効率が上がり、後列は被害を28%軽減。全員後列でも戦えます。</p>
              </div>
              <div>
                <h3>考える時間を使う</h3>
                <p>
                  <Key>Space</Key> でスロー、<Key>F</Key>{' '}
                  で戦術停止。もう一度押すと通常へ。開始時4、スローは毎秒4、停止は毎秒12の集中力を消費します。
                </p>
                <p>
                  <Key>Esc</Key>{' '}
                  は休憩ポーズ。戦場を隠し、すべての時計を止めます。別タブへの移動でも休憩に入ります。
                </p>
              </div>
              <div>
                <h3>予告を読む</h3>
                <p>
                  「列固定」は着弾時の列へ攻撃。「個体追尾」は列を移動しても当たります。「移動で中断可」は敵の押し引きでも構えを崩せます。
                </p>
                <p>
                  セナの鉤槍で砲術師を前列へ引き、アルトの円弧斬りでまとめて攻撃する、といった組み合わせを試せます。
                </p>
              </div>
            </div>
            <button
              className="primary"
              onClick={() => {
                setHelp(false);
                if (s.paused) send({ type: 'pause', value: false });
              }}
            >
              閉じる →
            </button>
          </section>
        </div>
      )}
      {padOpen && <PadSettings controls={gamepad} onClose={() => setPadOpen(false)} />}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

function EnemyCard({
  enemy: e,
  selected,
  onClick,
}: {
  enemy: Enemy;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`enemy-card ${selected ? 'active' : ''} ${e.hp <= 0 ? 'fallen' : ''}`}
      onClick={onClick}
      disabled={e.hp <= 0}
      aria-label={`${e.name}の情報`}
    >
      <div className="enemy-title">
        <span className="enemy-number">0{e.id + 1}</span>
        <strong>{e.name}</strong>
        <small>{ROW_NAMES[e.row]}</small>
        {selected && <span className="target-mark">◎</span>}
      </div>
      <div className="hp-label">
        <span>HP</span>
        <span>
          {Math.ceil(e.hp)} <i>/ {e.maxHp}</i>
        </span>
      </div>
      <Meter value={e.hp} max={e.maxHp} type="enemy-hp" label={`${e.name}のHP`} />
      <div className={`chain-label ${e.broken ? 'is-broken' : ''}`}>
        <span>{e.broken ? `BREAK ${fmt(e.broken)}s` : 'CHAIN'}</span>
        <strong>
          {e.chain.toFixed(0)}
          <small>%</small>
        </strong>
        <span>{e.broken ? 'DAMAGE UP' : '/ 200%'}</span>
      </div>
      <Meter
        value={e.broken || e.chain - 100}
        max={e.broken ? 8 : 100}
        type={e.broken ? 'break' : 'chain'}
        label={`${e.name}のチェイン`}
      />
      <div className="enemy-status">
        {e.broken
          ? '構えを中断・ダメージ倍率上昇'
          : e.hold > 0
            ? `チェイン維持 あと${fmt(e.hold)}秒`
            : '攻撃でチェインをつなぐ'}
      </div>
      {e.cast ? (
        <div className="telegraph">
          <div>
            <b>{e.cast.name}</b>
            <strong>{fmt(e.cast.remaining)}s</strong>
          </div>
          <Meter value={e.cast.total - e.cast.remaining} max={e.cast.total} type="danger" />
          <small>
            {e.cast.target === 'row'
              ? `列固定：${ROW_NAMES[e.cast.row]}`
              : e.cast.target === 'all'
                ? '全員：列移動では回避不可'
                : `個体追尾：${['アルト', 'リネ', 'セナ'][e.cast.allyId]}`}
            {e.cast.movable &&
              (e.kind === 'guard' && !e.broken
                ? ' / 重装：移動不可'
                : e.steadfast > 0
                  ? ' / 踏ん張り中'
                  : ' / 移動で中断可')}
          </small>
        </div>
      ) : (
        <div className="no-telegraph">
          {e.hp <= 0
            ? 'DEFEATED'
            : e.kind === 'guard'
              ? '重装：ブレイク中に移動可能'
              : '強制移動の後、2秒間は踏ん張る'}
        </div>
      )}
    </button>
  );
}
function FormationGlyph({ rows }: { rows: Row[] }) {
  return (
    <svg viewBox="0 0 48 30" width="36" height="24" aria-hidden="true">
      <path d="M15 2V28M34 2V28" stroke="currentColor" opacity=".2" />
      {rows.map((row, i) => (
        <circle key={i} cx={row === 'front' ? 34 : 15} cy={5 + i * 10} r="3" fill="currentColor" />
      ))}
    </svg>
  );
}
function Loadout({
  state: s,
  send,
  onCompare,
}: {
  state: State;
  send: (...commands: Command[]) => void;
  onCompare: (id: string) => void;
}) {
  const [comparison, setComparison] = useState('');
  return (
    <div className="loadout lab-section">
      <h3>
        持ち込み武器 <small>一人2本・武器個体の重複なし</small>
      </h3>
      <div className="equipment-grid">
        {s.allies.map((a) => (
          <div key={a.id} className="equipment-character">
            <strong>{a.name}</strong>
            {a.weapons.map((id, slot) => (
              <label key={slot}>
                <span>枠 {slot + 1}</span>
                <select
                  aria-label={`${a.name}の武器枠${slot + 1}`}
                  value={id}
                  onChange={(e) => {
                    const before = WEAPONS[id],
                      after = WEAPONS[e.target.value];
                    const affected = s.presets
                      .filter((p) => p.slots[a.id] === slot)
                      .map((p) => p.name)
                      .join('・');
                    setComparison(
                      `${a.name}：${before.archetype}〈${before.role}・${before.specialty}〉→ ${after.archetype}〈${after.role}・${after.specialty}〉。失う技：${SKILLS[before.skills[1]].name}。得る技：${SKILLS[after.skills[1]].name}。反映先：${affected || '未登録'}。`,
                    );
                    onCompare(after.id);
                    send({ type: 'equip', id: a.id, slot: slot as 0 | 1, weaponId: after.id });
                  }}
                >
                  {s.inventory.map((w) => (
                    <option
                      key={w}
                      value={w}
                      disabled={s.allies.some((other) =>
                        other.weapons.some((x, i) => x === w && (other.id !== a.id || i !== slot)),
                      )}
                    >
                      {WEAPONS[w].name} / {WEAPONS[w].role} {WEAPONS[w].specialty}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ))}
      </div>
      {comparison && (
        <p className="comparison" role="status">
          {comparison}
        </p>
      )}
      <details open={s.phase === 'loot'}>
        <summary>オプティマ・一括隊列を編集</summary>
        <div className="preset-editor">
          {s.presets.map((p, i) => (
            <div key={i}>
              <strong>{p.name}</strong>
              {s.allies.map((a) => (
                <label key={a.id}>
                  {a.name}
                  <select
                    aria-label={`${p.name}の${a.name}`}
                    value={p.slots[a.id]}
                    onChange={(e) =>
                      send({
                        type: 'editPreset',
                        index: i,
                        id: a.id,
                        slot: Number(e.target.value) as 0 | 1,
                      })
                    }
                  >
                    {a.weapons.map((w, slot) => (
                      <option key={slot} value={slot}>
                        {WEAPONS[w].archetype}〈{WEAPONS[w].role}〉
                      </option>
                    ))}
                  </select>
                  {s.config.uiMode === 'linked' && (
                    <select
                      aria-label={`${p.name}の${a.name}の列`}
                      value={p.rows[a.id]}
                      onChange={(e) =>
                        send({
                          type: 'editPresetRow',
                          index: i,
                          id: a.id,
                          row: e.target.value as Row,
                        })
                      }
                    >
                      {rowList.map((row) => (
                        <option key={row} value={row}>
                          {ROW_NAMES[row]}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="formation-editor">
          {s.formations.map((f, i) => (
            <div key={i}>
              <strong>{f.name}</strong>
              {s.allies.map((a) => (
                <label key={a.id}>
                  {a.name}
                  <select
                    value={f.rows[a.id]}
                    aria-label={`${f.name}の${a.name}の列`}
                    onChange={(e) =>
                      send({
                        type: 'editFormation',
                        index: i,
                        id: a.id,
                        row: e.target.value as Row,
                      })
                    }
                  >
                    {rowList.map((row) => (
                      <option key={row} value={row}>
                        {ROW_NAMES[row]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
