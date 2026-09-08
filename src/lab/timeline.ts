import { DT, VERSION } from '../content/data';
import { copy } from '../sim/engine';
import type { InputRecord, Recording, State } from '../sim/types';
import { emptyPlayView, playRules, type PlayView } from './playtest';
import { runReplay, Session, type LogEntry } from './session';

const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && !Array.isArray(item) && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const INTERVAL_TICKS = Math.round(0.25 / DT);
const CHECKPOINT_TICKS = Math.round(4 / DT);
export interface TimelinePoint {
  tick: number;
  inputCount: number;
  encounter: number;
  time: number;
  phase: State['phase'];
  view: PlayView;
  label: string;
}
interface Checkpoint {
  index: number;
  state: State;
}
export interface TimelineBranch {
  id: number;
  name: string;
  parentId: number | null;
  forkIndex: number | null;
  initial: State;
  inputs: InputRecord[];
  points: TimelinePoint[];
  checkpoints: Checkpoint[];
  log: LogEntry[];
  rules: string;
}
export interface TimelineSelection {
  branchId: number;
  index: number;
}

/** Automatic, in-memory history independent of snapshots and manually marked notes.
 * Points keep input counts as well as ticks so several inputs at one stop time stay distinct.
 * Immutable checkpoints bound preview replay work; original futures survive a fork.
 */
export class BattleTimeline {
  branches: TimelineBranch[] = [];
  activeId = 0;
  private origin?: State;
  private restoring = false;
  private nextId = 0;
  private lastView = '';
  get active() {
    return this.branches.find((b) => b.id === this.activeId);
  }
  observe(session: Session, view: PlayView = emptyPlayView(), force = false) {
    if (this.restoring) return;
    if (this.origin !== session.initial) {
      this.origin = session.initial;
      const id = ++this.nextId;
      this.activeId = id;
      this.branches.push({
        id,
        name: `プレイ ${id}`,
        parentId: null,
        forkIndex: null,
        initial: copy(session.initial),
        inputs: [],
        points: [],
        checkpoints: [],
        log: [],
        rules: playRules(),
      });
      this.lastView = '';
    }
    const branch = this.active!;
    const last = branch.points.at(-1);
    const viewKey = JSON.stringify(view);
    if (
      last &&
      last.tick === session.state.tick &&
      last.inputCount === session.inputs.length &&
      this.lastView === viewKey
    )
      return;
    const changedInputs = !last || last.inputCount !== session.inputs.length;
    const changedPhase =
      !last || last.phase !== session.state.phase || last.encounter !== session.state.encounter;
    if (
      !force &&
      last &&
      !changedInputs &&
      !changedPhase &&
      viewKey === this.lastView &&
      session.state.tick - last.tick < INTERVAL_TICKS
    )
      return;
    branch.inputs.push(...copy(session.inputs.slice(branch.inputs.length)));
    const events = session.log.slice(branch.log.length);
    branch.log.push(...copy(events));
    const important = [...events]
      .reverse()
      .find(
        (e) =>
          ['break', 'warning', 'move', 'shift'].includes(e.type) || e.visual?.outcome === 'defeat',
      );
    const point: TimelinePoint = {
      tick: session.state.tick,
      inputCount: session.inputs.length,
      encounter: session.state.encounter,
      time: session.state.time,
      phase: session.state.phase,
      view: copy(view),
      label: important?.text ?? (changedInputs || changedPhase ? (events.at(-1)?.text ?? '') : ''),
    };
    branch.points.push(point);
    const checkpoint = branch.checkpoints.at(-1);
    if (!checkpoint || changedPhase || point.tick - checkpoint.state.tick >= CHECKPOINT_TICKS) {
      branch.checkpoints.push({ index: branch.points.length - 1, state: copy(session.state) });
    }
    this.lastView = viewKey;
  }
  private selected(selection: TimelineSelection) {
    const branch = this.branches.find((b) => b.id === selection.branchId);
    if (!branch || !Number.isInteger(selection.index) || !branch.points[selection.index])
      throw new Error('タイムラインの位置が見つかりません。');
    if (branch.rules !== playRules() || branch.initial.version !== VERSION)
      throw new Error('記録時とルールが異なるため、この履歴からは再開できません。');
    return { branch, point: branch.points[selection.index] };
  }
  recording(selection: TimelineSelection): Recording {
    const { branch, point } = this.selected(selection);
    return {
      version: VERSION,
      initial: copy(branch.initial),
      inputs: copy(branch.inputs.slice(0, point.inputCount)),
      endTick: point.tick,
    };
  }
  preview(selection: TimelineSelection) {
    const { branch, point } = this.selected(selection);
    const checkpoint = [...branch.checkpoints].reverse().find((c) => c.index <= selection.index)!;
    const startCount = branch.points[checkpoint.index].inputCount;
    const state = runReplay({
      version: VERSION,
      initial: checkpoint.state,
      inputs: branch.inputs
        .slice(startCount, point.inputCount)
        .map((input, order) => ({ ...input, order })),
      endTick: point.tick,
    });
    return { state, view: copy(point.view) };
  }
  fork(session: Session, selection: TimelineSelection) {
    const { branch, point } = this.selected(selection);
    const preview = this.preview(selection);
    const recording = this.recording(selection);
    // Prove the cached reconstruction against the complete input prefix before mutating the live session.
    if (canonical(runReplay(recording)) !== canonical(preview.state))
      throw new Error('入力再生と履歴が一致しません。現在の戦闘を維持します。');
    this.restoring = true;
    try {
      session.replay(JSON.stringify(recording));
    } finally {
      this.restoring = false;
    }
    const id = ++this.nextId;
    const log = copy(branch.log.filter((e) => e.id <= session.state.eventSeq));
    session.log = copy(log);
    this.branches.push({
      id,
      name: `分岐 ${id}`,
      parentId: branch.id,
      forkIndex: selection.index,
      initial: copy(branch.initial),
      inputs: copy(recording.inputs),
      points: branch.points.slice(0, selection.index + 1),
      checkpoints: branch.checkpoints.filter((c) => c.index <= selection.index),
      log,
      rules: branch.rules,
    });
    this.activeId = id;
    this.origin = session.initial;
    this.lastView = JSON.stringify(point.view);
    return preview;
  }
}
