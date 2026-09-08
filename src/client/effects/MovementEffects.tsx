import { ROW_NAMES } from '../../content/data';
import type { State, Row } from '../../sim/types';
import { along, arc, clamp, columnX, type Anchor, type Layout, type Point } from './geometry';
import { movementCues, type MovementCue } from './movement';

/** A destination guide, not a relocated hitbox. Actual row membership stays in State. */
function rowGuide(s: State, layout: Layout, cue: MovementCue, row: Row, anchor: Anchor): Point {
  const units = cue.side === 'ally' ? s.allies : s.enemies;
  const unit = units.find((u) => `${cue.target[0]}${u.id}` === cue.target)!;
  const index = units.filter((u) => {
    const destination =
      cue.phase === 'moving' && u.hp > 0 && 'nextRow' in u ? (u.nextRow ?? u.row) : u.row;
    return destination === row && u.id < unit.id;
  }).length;
  const lane = layout.lanes?.[`${cue.side}-${row}`];
  const currentLane = layout.lanes?.[`${cue.side}-${unit.row}`];
  const track = lane?.tracks[index];
  return {
    x:
      lane && currentLane
        ? lane.left + clamp(anchor.x - currentLane.left, 32, lane.width - 32)
        : columnX(layout, cue.side, row),
    y: track
      ? track.top + clamp(anchor.y - anchor.top, 34, Math.max(34, track.height - 34))
      : anchor.y,
  };
}

export function MovementEffects({
  state: s,
  layout,
  reduced,
}: {
  state: State;
  layout: Layout;
  reduced: boolean;
}) {
  return (
    <svg
      className="battle-effects fx-movement-layer"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      data-motion={reduced ? 'reduced' : 'full'}
    >
      {movementCues(s).map((cue) => {
        const anchor = layout.points[cue.target];
        if (!anchor) return null;
        const moving = cue.phase === 'moving';
        const from = moving ? anchor : rowGuide(s, layout, cue, cue.fromRow, anchor);
        const to = moving ? rowGuide(s, layout, cue, cue.toRow, anchor) : anchor;
        const t = clamp(cue.progress);
        const token = along(from, to, t);
        const direction = Math.sign(to.x - from.x) || 1;
        const units = cue.side === 'ally' ? s.allies : s.enemies;
        const unit = units.find((u) => `${cue.target[0]}${u.id}` === cue.target)!;
        const color = cue.kind === 'forced' ? '#ffb699' : '#d4afff';
        return (
          <g
            key={cue.key}
            className="fx-movement"
            data-source={cue.target}
            data-from-row={cue.fromRow}
            data-to-row={cue.toRow}
            data-phase={cue.phase}
            data-kind={cue.kind}
            data-progress={t.toFixed(6)}
            color={color}
            opacity={moving || reduced ? 1 : 1 - t}
          >
            <path className="fx-move-route" d={arc(from, to)} />
            {moving && (
              <path
                className="fx-move-progress"
                d={arc(from, to)}
                pathLength="100"
                strokeDasharray={`${t * 100} 100`}
              />
            )}
            <g className="fx-move-destination" transform={`translate(${to.x} ${to.y})`}>
              <ellipse cx="0" cy="26" rx="24" ry="6" />
              <path d={`M${-direction * 9} 19l${direction * 9} 7 ${-direction * 9} 7`} />
            </g>
            {moving ? (
              <>
                <circle
                  className="fx-move-clock"
                  cx={from.x}
                  cy={from.y}
                  r="29"
                  pathLength="100"
                  strokeDasharray={`${t * 100} 100`}
                  transform={`rotate(-90 ${from.x} ${from.y})`}
                />
                {!reduced && (
                  <g className="fx-move-token" transform={`translate(${token.x} ${token.y})`}>
                    {[0.08, 0.16].map((delay) => {
                      const trail = along(from, to, Math.max(0, t - delay));
                      return (
                        <ellipse
                          key={delay}
                          cx={trail.x - token.x}
                          cy={trail.y - token.y + 5}
                          rx="7"
                          ry="3"
                          opacity={t > delay ? 0.35 : 0}
                        />
                      );
                    })}
                    <circle r="12" />
                    <text y="4">{unit.name.slice(0, 1)}</text>
                  </g>
                )}
                <text className="fx-move-caption" x={from.x} y={from.y + 32}>
                  {ROW_NAMES[cue.toRow]}へ {cue.remaining.toFixed(1)}s
                </text>
              </>
            ) : (
              <ellipse
                className="fx-move-landing"
                cx={to.x}
                cy={to.y + 26}
                rx={reduced ? 26 : 20 + t * 15}
                ry={reduced ? 7 : 5 + t * 5}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
