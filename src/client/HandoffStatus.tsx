import type { State } from '../sim/types';
export function HandoffStatus({ state: s, cancel }: { state: State; cancel: () => void }) {
  if (s.controlMode !== 'manual' || s.phase !== 'battle') return null;
  const a = s.allies[s.selected];
  const remaining =
    a.action?.remaining ??
    Math.max(
      a.nextRow !== null ? s.config.moveTime - a.move : 0,
      a.nextSlot !== null ? s.config.shiftTime - a.shift : 0,
    );
  if (s.pendingSelect !== null)
    return (
      <div className="handoff-status" role="status">
        <strong>
          {a.name} → {s.allies[s.pendingSelect].name}
        </strong>
        <span>
          {a.action?.skillId === 'handoff'
            ? `交代中 · あと${remaining.toFixed(1)}秒`
            : `先頭優先・1 ATB${a.atb < 1 ? '充填待ち' : ''} · 開始時に後続を解除`}
        </span>
        <button disabled={a.action?.skillId === 'handoff'} onClick={cancel}>
          交代予約を取消
        </button>
      </div>
    );
  if (s.handoffSlow > 0)
    return (
      <div className="handoff-status" role="status">
        <strong>{a.name}に交代</strong>
        <span>引継ぎスロー ×0.25 · あと{s.handoffSlow.toFixed(1)}秒 · 集中力消費なし</span>
      </div>
    );
  return null;
}
