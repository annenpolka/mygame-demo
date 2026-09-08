import { SKILLS } from '../../content/data';
import type { BattleEvent, Row, State } from '../../sim/types';

export const MOVEMENT_LANDING_DURATION = 0.4;

export interface MovementCue {
  key: string;
  target: string;
  side: 'ally' | 'enemy';
  phase: 'moving' | 'landing';
  kind: 'move' | 'forced' | 'evacuate';
  fromRow: Row;
  toRow: Row;
  progress: number;
  age: number;
  duration: number;
  remaining: number;
  source?: string;
}

const isRow = (value: unknown): value is Row => value === 'front' || value === 'back';

/** Events currently lack an encounter field. These existing engine log prefixes are
 * the compatibility boundary that keeps a first-battle arrival off reused unit IDs.
 * Keep the start/next command tests in sync if the engine changes these messages. */
function battleBoundary(state: State) {
  let id = -1;
  for (const event of state.events) {
    if (
      event.type === 'system' &&
      event.time <= state.time &&
      (event.text.startsWith('戦闘開始。') || event.text.startsWith('第二戦へ。'))
    )
      id = Math.max(id, event.id);
  }
  return id;
}

/** Pure presentation reconstructed from the current battle clock and actual positions.
 * At most one cue per living unit; pending plans never predict a move that has not begun. */
export function movementCues(state: State): MovementCue[] {
  if (state.phase !== 'battle' || !Number.isFinite(state.time)) return [];
  const cues: MovementCue[] = [];
  const latest = new Map<string, BattleEvent>();
  const boundary = battleBoundary(state);
  for (const event of state.events) {
    if (event.type !== 'move' || !event.target || event.id <= boundary) continue;
    const previous = latest.get(event.target);
    // Select before validating metadata: an obsolete valid event must not reappear
    // behind a newer move whose direction no longer matches the actual position.
    if (
      !previous ||
      event.time > previous.time ||
      (event.time === previous.time && event.id > previous.id)
    )
      latest.set(event.target, event);
  }

  const landing = (target: string, side: MovementCue['side'], row: Row) => {
    const event = latest.get(target);
    if (!event) return;
    const age = state.time - event.time;
    const fromRow = event.visual?.fromRow;
    const toRow = event.visual?.toRow;
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age >= MOVEMENT_LANDING_DURATION ||
      !isRow(fromRow) ||
      !isRow(toRow) ||
      fromRow === toRow ||
      row !== toRow
    )
      return;
    cues.push({
      key: `landing:${event.id}:${target}`,
      target,
      side,
      phase: 'landing',
      kind:
        SKILLS[event.visual?.skillId ?? '']?.effect === 'evacuate'
          ? 'evacuate'
          : event.source && event.source !== target
            ? 'forced'
            : 'move',
      fromRow,
      toRow,
      progress: age / MOVEMENT_LANDING_DURATION,
      age,
      duration: MOVEMENT_LANDING_DURATION,
      remaining: MOVEMENT_LANDING_DURATION - age,
      source: event.source,
    });
  };

  for (const ally of state.allies) {
    if (ally.hp <= 0) continue;
    const target = `a${ally.id}`;
    if (isRow(ally.nextRow) && ally.nextRow !== ally.row) {
      const duration = state.config.moveTime;
      // Current movement always takes priority, including a reverse instruction.
      // Invalid legacy timing should suppress an old landing rather than invent progress.
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(ally.move)) continue;
      const age = Math.max(0, Math.min(duration, ally.move));
      cues.push({
        key: `moving:${target}:${ally.row}:${ally.nextRow}`,
        target,
        side: 'ally',
        phase: 'moving',
        kind: 'move',
        fromRow: ally.row,
        toRow: ally.nextRow,
        progress: age / duration,
        age,
        duration,
        remaining: duration - age,
      });
    } else landing(target, 'ally', ally.row);
  }
  for (const enemy of state.enemies) {
    if (enemy.hp > 0) landing(`e${enemy.id}`, 'enemy', enemy.row);
  }
  return cues;
}
