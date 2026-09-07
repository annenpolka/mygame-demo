import type { Row, State } from '../sim/types';

export type TargetSide = 'ally' | 'enemy';
export type Direction = 'up' | 'down' | 'left' | 'right';
// Shared with Battlefield: fallen units keep their visible track until the encounter ends.
export const FIELD_COLUMNS: readonly { side: TargetSide; row: Row }[] = [
  { side: 'ally', row: 'back' },
  { side: 'ally', row: 'front' },
  { side: 'enemy', row: 'front' },
  { side: 'enemy', row: 'back' },
];
export function spatialTarget(
  s: Pick<State, 'allies' | 'enemies'>,
  side: TargetSide,
  currentId: number,
  direction: Direction,
  allowedIds?: readonly number[],
) {
  const units = side === 'ally' ? s.allies : s.enemies;
  const points = FIELD_COLUMNS.flatMap((column, x) =>
    column.side === side
      ? units.filter((u) => u.row === column.row).map((u, y) => ({ id: u.id, hp: u.hp, x, y }))
      : [],
  );
  const available = points.filter((p) => p.hp > 0 && (!allowedIds || allowedIds.includes(p.id)));
  const current = points.find((p) => p.id === currentId);
  if (!current) return available[0]?.id ?? currentId;
  const vertical = direction === 'up' || direction === 'down';
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  const next = available
    .filter((p) =>
      vertical ? p.x === current.x && (p.y - current.y) * sign > 0 : (p.x - current.x) * sign > 0,
    )
    .sort((a, b) =>
      vertical
        ? Math.abs(a.y - current.y) - Math.abs(b.y - current.y)
        : Math.abs(a.x - current.x) - Math.abs(b.x - current.x) ||
          Math.abs(a.y - current.y) - Math.abs(b.y - current.y) ||
          a.y - b.y,
    )[0];
  return (
    next?.id ??
    (available.some((p) => p.id === current.id) ? current.id : (available[0]?.id ?? currentId))
  );
}
