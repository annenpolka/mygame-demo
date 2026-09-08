import { paletteCursor, paletteTargets } from '../input/battle-pad';
import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { BattleTimeline as History, type TimelineSelection } from '../lab/timeline';
import { Battlefield } from './Battlefield';
import { DT, SKILLS } from '../content/data';
import type { PadInput } from '../input/gamepad';
const noop = () => {};
const phaseName = {
  ready: '開始前',
  battle: '戦闘中',
  loot: '戦利品',
  victory: '勝利',
  defeat: '敗北',
};
export function BattleTimeline({
  history,
  close,
  resume,
  padAction,
}: {
  history: History;
  close: () => void;
  resume: (selection: TimelineSelection) => string | undefined;
  padAction: MutableRefObject<((action: PadInput) => void) | null>;
}) {
  const [selection, setSelection] = useState<TimelineSelection>(() => ({
    branchId: history.activeId,
    index: history.active!.points.length - 1,
  }));
  const [resumeError, setResumeError] = useState('');
  const start = () => setResumeError(resume(selection) ?? '');
  const branch = history.branches.find((b) => b.id === selection.branchId)!;
  const point = branch.points[selection.index];
  const end = branch.points.length - 1;
  const preview = useMemo(() => {
    try {
      return { ...history.preview(selection), error: '' };
    } catch (e) {
      return {
        state: null,
        view: null,
        error: e instanceof Error ? e.message : '場面を再現できませんでした。',
      };
    }
  }, [history, selection]);
  const move = (index: number) =>
    setSelection({ ...selection, index: Math.max(0, Math.min(end, index)) });
  const jump = (seconds: number) => {
    const tick = point.tick + Math.round(seconds / DT);
    const index =
      seconds < 0
        ? (branch.points
            .map((p, i) => ({ p, i }))
            .reverse()
            .find(({ p, i }) => i < selection.index && p.tick <= tick)?.i ?? 0)
        : branch.points.findIndex((p, i) => i > selection.index && p.tick >= tick);
    move(index < 0 ? end : index);
  };
  useEffect(() => {
    padAction.current = (action) => {
      if (action === 'back' || action === 'pause') close();
      else if (action === 'left') move(selection.index - 1);
      else if (action === 'right') move(selection.index + 1);
      else if (action === 'previous') jump(-5);
      else if (action === 'next') jump(5);
      else if (action === 'confirm' || action === 'execute') {
        if (preview.state) start();
      } else if (action === 'up' || action === 'down') {
        const at = history.branches.findIndex((b) => b.id === branch.id);
        const next =
          history.branches[
            Math.max(0, Math.min(history.branches.length - 1, at + (action === 'up' ? -1 : 1)))
          ];
        setSelection({ branchId: next.id, index: next.points.length - 1 });
      }
    };
    return () => {
      padAction.current = null;
    };
  });
  const events = branch.points.map((p, index) => ({ ...p, index })).filter((p) => p.label);
  const actor = preview.state?.allies[preview.state.selected];
  return (
    <div className="timeline-backdrop">
      <section
        className="battle-history"
        role="dialog"
        aria-modal="true"
        aria-label="戦闘タイムライン"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          } else if (
            !(e.target instanceof Element && e.target.closest('input,select')) &&
            (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
          ) {
            e.preventDefault();
            move(selection.index + (e.key === 'ArrowLeft' ? -1 : 1));
          }
        }}
      >
        <header>
          <div>
            <span className="eyebrow">BATTLE TIMELINE</span>
            <h2>戦闘を、たどる。</h2>
          </div>
          <button onClick={close}>今の戦闘へ戻る Esc</button>
        </header>
        <p className="timeline-intro">
          閲覧中は戦闘が止まります。場面を選んで再開すると新しく分岐し、元の進行も残ります。
        </p>
        <div className="timeline-toolbar">
          <label>
            履歴
            <select
              aria-label="タイムラインの履歴"
              value={branch.id}
              onChange={(e) => {
                const next = history.branches.find((b) => b.id === Number(e.target.value))!;
                setSelection({ branchId: next.id, index: next.points.length - 1 });
              }}
            >
              {history.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.id === history.activeId ? ' · 現在' : ''}
                  {b.parentId
                    ? `（${history.branches.find((p) => p.id === b.parentId)?.name}から）`
                    : ''}
                </option>
              ))}
            </select>
          </label>
          <output aria-label="選んだ時点" aria-live="polite">
            第{point.encounter}戦 · {point.time.toFixed(2)}秒{' '}
            <span>
              {phaseName[point.phase]} · 入力{point.inputCount}
            </span>
          </output>
        </div>
        <div className="timeline-scrubber">
          <input
            type="range"
            aria-label="タイムラインの位置"
            min={0}
            max={end}
            step={1}
            value={selection.index}
            aria-valuetext={`第${point.encounter}戦 ${point.time.toFixed(2)}秒、入力${point.inputCount}`}
            onChange={(e) => move(Number(e.target.value))}
          />
          <div className="timeline-actions">
            <button disabled={selection.index === 0} onClick={() => move(0)}>
              最初
            </button>
            <button disabled={selection.index === 0} onClick={() => jump(-5)}>
              5秒前
            </button>
            <button
              aria-label="ひとつ前の時点"
              disabled={selection.index === 0}
              onClick={() => move(selection.index - 1)}
            >
              ←
            </button>
            <button
              aria-label="ひとつ後の時点"
              disabled={selection.index === end}
              onClick={() => move(selection.index + 1)}
            >
              →
            </button>
            <button disabled={selection.index === end} onClick={() => jump(5)}>
              5秒後
            </button>
            <button disabled={selection.index === end} onClick={() => move(end)}>
              最新
            </button>
          </div>
        </div>
        <div className="timeline-body">
          {(preview.error || resumeError) && <p role="alert">{preview.error || resumeError}</p>}
          {preview.state && (
            <>
              <div className="timeline-preview battle-layout" inert aria-label="過去の戦場">
                <Battlefield
                  state={preview.state}
                  pending={preview.view?.pending ? SKILLS[preview.view.pending] : null}
                  palette={preview.view ? paletteCursor(preview.state, preview.view.battle) : null}
                  targets={preview.view ? paletteTargets(preview.state, preview.view.battle) : null}
                  onCandidate={noop}
                  onAlly={noop}
                  onTarget={noop}
                  onAim={noop}
                  onBack={noop}
                />
              </div>
              <div className="timeline-state" aria-label="過去の状態">
                <strong>
                  {actor!.name} · HP {Math.ceil(actor!.hp)} / {actor!.maxHp} · ATB{' '}
                  {actor!.atb.toFixed(2)}
                </strong>
                <span>
                  {actor!.action
                    ? `${SKILLS[actor!.action.skillId].name} ${actor!.action.resolved ? '硬直' : '発動中'}`
                    : '行動待ち'}{' '}
                  · 下書き {actor!.draft?.length ?? 0}手 · 予約{' '}
                  {(actor!.plan?.length ?? 0) + (actor!.queued ? 1 : 0)}手
                </span>
              </div>
            </>
          )}
          <details className="timeline-events" open>
            <summary>出来事から選ぶ · {events.length}件</summary>
            <div role="list" aria-label="タイムラインの出来事">
              {events.map((event) => (
                <div role="listitem" key={event.index}>
                  <button
                    aria-current={selection.index === event.index ? 'step' : undefined}
                    onClick={() => move(event.index)}
                  >
                    <time>
                      第{event.encounter}戦 {event.time.toFixed(1)}秒
                    </time>
                    <span>{event.label}</span>
                  </button>
                </div>
              ))}
              {!events.length && <p>戦闘を進めると行動や出来事が記録されます。</p>}
            </div>
          </details>
        </div>
        <footer>
          <span>
            このタブのプレイ履歴 · 自動記録
            <br />
            パッド：左右で移動、LB/RBで5秒、上下で履歴、決定で再開
          </span>
          <button className="primary" disabled={!preview.state} onClick={start}>
            ここから再開
          </button>
        </footer>
      </section>
    </div>
  );
}
