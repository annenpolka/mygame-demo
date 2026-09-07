import type { EncounterSetId } from '../content/encounters';
export type Row = 'front' | 'back';
export type BonusMode = 'none' | 'modest' | 'strong';
export type Role = 'A' | 'B' | 'D' | 'S';
export type Slot = 0 | 1;
export type TimeMode = 'normal' | 'slow' | 'stop';
export type Target = { kind: 'enemy' | 'ally'; id: number } | { kind: 'row'; row: Row };
export type Effect =
  'damage' | 'heal' | 'shield' | 'push' | 'pull' | 'evacuate' | 'guard' | 'potion' | 'handoff';
export interface Skill {
  id: string;
  name: string;
  cost: number;
  cast: number;
  recovery: number;
  /** Recovery between identical skills; absent means this skill cannot link. */
  link?: number;
  power: number;
  chain: number;
  hold: number;
  effect: Effect;
  target: 'enemy' | 'enemyRow' | 'ally' | 'allyRow' | 'self';
  description: string;
}
export interface Weapon {
  id: string;
  name: string;
  archetype: string;
  role: Role;
  specialty: string;
  glyph: string;
  trait: string;
  melee: boolean;
  skills: [string, string];
  bonus?: 'frontChain' | 'breakDamage';
}
export interface Action {
  sequenceId?: number;
  skillId: string;
  target: Target;
  remaining: number;
  total: number;
  /** remaining/total include windup and recovery; impact happens once. */
  resolved: boolean;
  cast: number;
  recovery: number;
  comboIndex: number;
  weaponId: string;
  offense: { damage: number; chain: number };
}
export type PlanStep =
  | { kind: 'skill'; skillId: string; target: Target }
  | { kind: 'move'; row: Row }
  | { kind: 'weapon'; slot: Slot };
export type PlannedStep = PlanStep & { key: number; auto?: boolean; sequenceId?: number };
export interface Sequence {
  key: number;
  started: boolean;
}
export interface Ally {
  id: number;
  name: string;
  initial: string;
  color: string;
  hp: number;
  maxHp: number;
  atb: number;
  row: Row;
  weapons: [string, string];
  slot: Slot;
  nextSlot: Slot | null;
  nextRow: Row | null;
  shift: number;
  move: number;
  action: Action | null;
  queued: { skillId: string; target: Target } | null;
  plan?: PlannedStep[];
  /** Editable input is never read by the execution scheduler. */
  draft?: PlannedStep[];
  /** At most one running group and one group waiting to start. */
  sequences?: Sequence[];
  executionHeld: boolean;
  shield: number;
}
export interface EnemyCast {
  name: string;
  target: 'row' | 'single' | 'all';
  row: Row;
  allyId: number;
  remaining: number;
  total: number;
  power: number;
  movable: boolean;
  push: boolean;
}
export interface Enemy {
  id: number;
  name: string;
  glyph: string;
  kind: 'guard' | 'cannon' | 'soldier';
  hp: number;
  maxHp: number;
  row: Row;
  chain: number;
  hold: number;
  broken: number;
  nextAttack: number;
  cast: EnemyCast | null;
  steadfast: number;
  attackCount: number;
}
export interface Preset {
  name: string;
  slots: [Slot, Slot, Slot];
  rows: [Row, Row, Row];
}
export interface Formation {
  name: string;
  rows: [Row, Row, Row];
}
export interface Config {
  bonusMode: BonusMode;
  enemyHpScale: number;
  atbMax: number;
  encounterSet?: EncounterSetId;
  encounterLevel?: number;
  seed: number;
  atbRate: number;
  atbMode: 'idle' | 'continuous';
  chainActions: boolean;
  moveTime: number;
  shiftTime: number;
  slowDrain: number;
  stopDrain: number;
  enemyPower: number;
  uiMode: 'separate' | 'individual' | 'linked';
  encounter: 1 | 2;
}
export interface BattleEvent {
  id: number;
  time: number;
  type: 'action' | 'damage' | 'heal' | 'move' | 'shift' | 'break' | 'warning' | 'system';
  text: string;
  source?: string;
  target?: string;
  value?: number;
}
export interface Metrics {
  damage: number;
  taken: number;
  healed: number;
  breaks: number;
  inputs: number;
  focusUsed: number;
}
export interface State {
  controlMode: 'manual' | 'ai';
  version: string;
  planSeq?: number;
  phase: 'ready' | 'battle' | 'loot' | 'victory' | 'defeat';
  paused: boolean;
  tick: number;
  time: number;
  realTime: number;
  focus: number;
  timeMode: TimeMode;
  rng: number;
  config: Config;
  encounter: 1 | 2;
  selected: number;
  pendingSelect: number | null;
  handoffSlow: number;
  target: number;
  allies: Ally[];
  enemies: Enemy[];
  presets: Preset[];
  formations: Formation[];
  activePreset: number;
  inventory: string[];
  potions: number;
  events: BattleEvent[];
  eventSeq: number;
  metrics: Metrics;
}
export type Command =
  | { type: 'control'; mode: State['controlMode'] }
  | { type: 'labWeapons' }
  | { type: 'start' }
  | { type: 'pause'; value: boolean }
  | { type: 'select'; id: number }
  | { type: 'target'; id: number }
  | { type: 'time'; mode: TimeMode }
  | { type: 'move'; id: number; row: Row }
  | { type: 'formation'; index: number }
  | { type: 'optima'; index: number }
  | { type: 'skill'; id: number; skillId: string; target: Target }
  | { type: 'cancel'; id: number }
  | { type: 'cancelFirst'; id: number }
  | { type: 'hold'; id: number; value: boolean }
  | { type: 'toggleRow'; id: number }
  | { type: 'toggleWeapon'; id: number }
  | { type: 'enqueue'; id: number; step: PlanStep }
  | { type: 'draft'; id: number; step: PlanStep }
  | { type: 'executeSequence'; id: number }
  | { type: 'removePlan'; id: number; key: number }
  | { type: 'equip'; id: number; slot: Slot; weaponId: string }
  | { type: 'editPreset'; index: number; id: number; slot: Slot }
  | { type: 'editPresetRow'; index: number; id: number; row: Row }
  | { type: 'editFormation'; index: number; id: number; row: Row }
  | { type: 'next' };
export interface InputRecord {
  tick: number;
  order: number;
  command: Command;
}
export interface Recording {
  version: string;
  initial: State;
  inputs: InputRecord[];
  endTick: number;
}
