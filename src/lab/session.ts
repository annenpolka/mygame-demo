import { DT, VERSION } from '../content/data';
import { command, copy, createState, step } from '../sim/engine';
import type { BattleEvent, Command, Config, InputRecord, Recording, State } from '../sim/types';
import { parseRecording, parseSnapshotBundle } from './validation';

export type LogEntry = BattleEvent & { encounter: number };

export class Session {
  state: State;
  initial: State;
  inputs: InputRecord[] = [];
  gestures = 0;
  log: LogEntry[] = [];
  private lastEvent = 0;
  private encounterStart: State | null = null;
  private accumulator = 0;
  constructor(config: Partial<Config> = {}, controlMode: State['controlMode'] = 'manual') {
    this.state = createState(config, controlMode);
    this.initial = copy(this.state);
  }
  private capture = (state: State = this.state) => {
    for (const event of state.events) {
      if (event.id <= this.lastEvent) continue;
      this.log.push({ ...event, encounter: state.encounter });
      this.lastEvent = event.id;
    }
  };
  private resetLog() {
    this.log = [];
    this.lastEvent = 0;
    this.capture();
  }
  send(...commands: Command[]) {
    this.gestures++;
    const accepted: boolean[] = [];
    for (const c of commands) {
      if (c.type === 'start' && this.state.phase === 'ready')
        this.encounterStart = copy(this.state);
      this.inputs.push({ tick: this.state.tick, order: this.inputs.length, command: copy(c) });
      accepted.push(command(this.state, c));
      this.capture();
      if (c.type === 'next' && this.state.phase === 'battle') {
        this.encounterStart = copy(this.state);
        this.encounterStart.phase = 'ready';
        this.encounterStart.config.encounter = this.state.encounter;
        this.encounterStart.tick = 0;
        this.encounterStart.time = 0;
        this.encounterStart.realTime = 0;
        this.encounterStart.events = [];
        this.encounterStart.eventSeq = 0;
        this.encounterStart.metrics = {
          damage: 0,
          taken: 0,
          healed: 0,
          breaks: 0,
          inputs: 0,
          focusUsed: 0,
        };
      }
    }
    return accepted;
  }
  advance(elapsed: number, beforeStep?: () => void) {
    if (this.state.paused || this.state.phase !== 'battle') {
      this.accumulator = 0;
      return;
    }
    this.accumulator += Math.min(elapsed, 0.1);
    while (this.accumulator >= DT) {
      if (this.state.phase !== 'battle' || this.state.paused) {
        this.accumulator = 0;
        break;
      }
      beforeStep?.();
      step(this.state);
      this.capture();
      this.accumulator -= DT;
    }
  }
  reset(config: Partial<Config> = this.state.config) {
    this.state = createState(config, this.state.controlMode);
    this.initial = copy(this.state);
    this.inputs = [];
    this.gestures = 0;
    this.accumulator = 0;
    this.encounterStart = null;
    this.resetLog();
  }
  retry() {
    this.state = copy(this.encounterStart ?? this.initial);
    this.initial = copy(this.state);
    this.inputs = [];
    this.gestures = 0;
    this.accumulator = 0;
    this.resetLog();
  }
  snapshot() {
    return JSON.stringify(
      { version: VERSION, kind: 'snapshot', state: this.state, log: this.log },
      null,
      2,
    );
  }
  restore(text: string) {
    const { state, log } = parseSnapshotBundle(text);
    this.state = state;
    this.initial = copy(state);
    this.inputs = [];
    this.gestures = 0;
    this.accumulator = 0;
    this.encounterStart = null;
    this.resetLog();
    if (log) this.log = log;
  }
  recording(): Recording {
    return {
      version: VERSION,
      initial: copy(this.initial),
      inputs: copy(this.inputs),
      endTick: this.state.tick,
    };
  }
  replay(text: string) {
    const data = parseRecording(text);
    this.log = [];
    this.lastEvent = 0;
    this.state = runReplay(data, undefined, this.capture);
    this.initial = copy(data.initial);
    this.inputs = copy(data.inputs);
    this.gestures = data.inputs.length;
    this.accumulator = 0;
    this.encounterStart = null;
  }
}

/** Replays use real-time ticks and stable input order, including multiple inputs in one tick. */
export function runReplay(
  data: Recording,
  configOverride?: Partial<Config>,
  onState?: (s: State) => void,
) {
  const state = copy(data.initial);
  onState?.(state);
  if (configOverride) state.config = { ...state.config, ...configOverride };
  let cursor = 0;
  while (state.tick <= data.endTick) {
    while (cursor < data.inputs.length && data.inputs[cursor].tick === state.tick) {
      command(state, data.inputs[cursor++].command);
      onState?.(state);
    }
    if (state.tick === data.endTick) break;
    const before = state.tick;
    step(state);
    onState?.(state);
    if (state.tick === before) {
      if (configOverride) break; // A changed rule set may end the battle earlier.
      throw new Error('リプレイの時計が進みません。入力列と終端tickを確認してください。');
    }
  }
  return state;
}
