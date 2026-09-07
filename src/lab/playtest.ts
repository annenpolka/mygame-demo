import { z } from 'zod';
import { BATTLE_TIMING, DT, SKILLS, VERSION, WEAPONS } from '../content/data';
import { COMBAT_RULES } from '../content/rules';
import { BONUS_VALUES } from '../sim/bonuses';
import { command, copy, createState } from '../sim/engine';
import { renameTactics } from '../sim/tactics';
import type { Config, Recording, State } from '../sim/types';
import type { BattlePad } from '../input/battle-pad';
import { newBattlePad } from '../input/battle-pad';
import { Session, runReplay } from './session';
import { parseRecording, parseSnapshot } from './validation';

export const NOTE_LIMIT = 20;
const NOTE_FILE_LIMIT = 15_000_000;
export const REWIND_SECONDS = 3;
export const NOTE_STORAGE = 'orchestra-playtest-v1';
export type PlayView = { battle: BattlePad; pending: string | null };
export interface PlayFrame {
  tick: number;
  inputCount: number;
  state: State;
  view: PlayView;
}
export interface PlayNote {
  id: string;
  created: string;
  comment: string;
  feeling: 'unclassified' | 'good' | 'unclear' | 'waiting' | 'inputs' | 'busy';
  rules: string;
  recording: Recording;
  entry: PlayFrame;
  before: PlayFrame;
  marked: PlayFrame;
  sourceId: string | null;
}
export const FEELINGS: Record<PlayNote['feeling'], string> = {
  unclassified: '未分類',
  good: '気持ちよかった',
  unclear: '何が起きたか迷った',
  waiting: '動かない理由を探した',
  inputs: '入力が多かった',
  busy: 'ずっと忙しかった',
};
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && !Array.isArray(item) && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
/** Description edits are compatible; changes to the rules or numeric definitions are not. */
export function playRules() {
  return canonical({
    version: VERSION,
    timing: BATTLE_TIMING,
    rules: COMBAT_RULES,
    bonuses: BONUS_VALUES,
    skills: Object.values(SKILLS).map(
      ({ id, cost, cast, recovery, power, chain, hold, effect, target }) => ({
        id,
        cost,
        cast,
        recovery,
        power,
        chain,
        hold,
        effect,
        target,
      }),
    ),
    weapons: Object.values(WEAPONS).map(({ id, role, melee, skills, bonus }) => ({
      id,
      role,
      melee,
      skills,
      bonus,
    })),
  });
}
export function sameRules(note: PlayNote) {
  return note.rules === playRules() && note.recording.version === VERSION;
}
const frame = (s: Session, view: PlayView): PlayFrame => ({
  tick: s.state.tick,
  inputCount: s.inputs.length,
  state: copy(s.state),
  view: copy(view),
});
export class PlayJournal {
  private origin?: State;
  private frames: PlayFrame[] = [];
  private entry?: PlayFrame;
  sourceId: string | null = null;
  observe(session: Session, view: PlayView) {
    if (this.origin !== session.initial) {
      this.origin = session.initial;
      this.frames = [];
      this.entry = undefined;
      this.sourceId = null;
    }
    if (session.state.phase !== 'battle') return;
    const last = this.frames.at(-1);
    if (!this.entry || this.entry.state.encounter !== session.state.encounter) {
      this.entry = frame(session, view);
      this.frames = [];
    }
    if (
      !last ||
      session.state.tick - last.tick >= Math.round(0.25 / DT) ||
      last.inputCount !== session.inputs.length ||
      canonical(last.view) !== canonical(view)
    ) {
      this.frames.push(frame(session, view));
      // Keep the frame just before the rewind boundary too.
      while (
        this.frames.length > 2 &&
        this.frames[1].tick < session.state.tick - REWIND_SECONDS / DT
      )
        this.frames.shift();
    }
  }
  mark(session: Session, view: PlayView): PlayNote {
    if (session.state.phase !== 'battle') throw new Error('戦闘中の場面に印を付けられます。');
    this.observe(session, view);
    const marked = frame(session, view),
      entry = this.entry!;
    const target = Math.max(entry.tick, marked.tick - Math.round(REWIND_SECONDS / DT));
    const before = [...this.frames].reverse().find((f) => f.tick <= target) ?? entry;
    return copy({
      id: crypto.randomUUID(),
      created: new Date().toISOString(),
      comment: '',
      feeling: 'unclassified',
      rules: playRules(),
      recording: session.recording(),
      entry,
      before,
      marked,
      sourceId: this.sourceId,
    });
  }
  branch(session: Session, note: PlayNote, view: PlayView) {
    this.origin = session.initial;
    this.entry = copy(note.entry);
    this.frames = [frame(session, view)];
    this.sourceId = note.id;
  }
}
function prefix(note: PlayNote, point: PlayFrame): Recording {
  const full = parseRecording(JSON.stringify(note.recording));
  if (
    point.tick < full.initial.tick ||
    point.tick > full.endTick ||
    point.inputCount > full.inputs.length ||
    point.inputCount < 0
  )
    throw new Error('印の再生位置が不正です。');
  return parseRecording(
    JSON.stringify({
      ...full,
      inputs: full.inputs.slice(0, point.inputCount),
      endTick: point.tick,
    }),
  );
}
/** Validate before touching the current session. Original notes and later inputs remain immutable. */
export function prepareNoteReplay(note: PlayNote, point: 'before' | 'marked' | 'entry' = 'before') {
  if (!sameRules(note)) throw new Error('ルールが異なります。遭遇開始からの比較を使ってください。');
  const recording = prefix(note, note[point]);
  const state = runReplay(recording);
  if (state.phase !== 'battle' || canonical(state) !== canonical(note[point].state))
    throw new Error('記録した状態と再生結果が一致しません。元の場面は変更していません。');
  return { recording, view: copy(note[point].view) };
}
/** Build a fresh encounter from equipment/setup only. Never transplant an old in-flight action. */
export function prepareNoteComparison(note: PlayNote, config: Partial<Config> = {}) {
  const original = note.entry.state;
  const s = createState({ ...original.config, ...config, encounter: original.encounter }, 'manual');
  s.inventory = copy(original.inventory);
  s.potions = original.potions;
  s.selected = original.selected;
  s.allies.forEach((a, i) => {
    a.weapons = copy(original.allies[i].weapons);
    a.slot = original.allies[i].slot;
    a.row = original.allies[i].row;
  });
  s.presets = copy(original.presets);
  s.formations = copy(original.formations);
  // Validate all weapon IDs, config, and composition using current rules before using them.
  const checked = parseSnapshot(JSON.stringify({ version: VERSION, kind: 'snapshot', state: s }));
  renameTactics(checked);
  command(checked, { type: 'start' });
  return checked;
}
const int = z.number().int().nonnegative();
const viewSchema = z.object({
  pending: z.string().max(100).nullable(),
  battle: z.object({
    page: z.enum(['command', 'target', 'move', 'weapon', 'tactics', 'queue', 'log']),
    key: z.string().max(200),
    skillId: z.string().max(100).nullable(),
    tactics: z.enum(['optima', 'formation']),
    remembered: z.record(z.string().max(200), z.string().max(200)),
    message: z.string().max(1000),
    stamp: z.number().finite(),
    logOffset: int.max(30000),
  }),
});
const frameSchema = z.object({
  tick: int.max(216000),
  inputCount: int.max(30000),
  state: z.record(z.string(), z.unknown()),
  view: viewSchema,
});
const noteSchema = z.object({
  id: z.string().min(1).max(100),
  created: z.string().max(100),
  comment: z.string().max(300),
  feeling: z.enum(['unclassified', 'good', 'unclear', 'waiting', 'inputs', 'busy']),
  rules: z.string().max(100000),
  recording: z.object({
    version: z.string().min(1).max(100),
    initial: z.record(z.string(), z.unknown()),
    inputs: z.array(z.unknown()).max(30000),
    endTick: int.max(216000),
  }),
  entry: frameSchema,
  before: frameSchema,
  marked: frameSchema,
  sourceId: z.string().max(100).nullable(),
});
export function exportNotes(notes: readonly PlayNote[]) {
  return JSON.stringify({ kind: 'playtest-notes', version: 1, notes }, null, 2);
}
export function ensureNoteCapacity(notes: readonly PlayNote[]) {
  if (notes.length > NOTE_LIMIT || exportNotes(notes).length > NOTE_FILE_LIMIT - 20_000)
    throw new Error('印の保存容量を超えます。JSON保存してから一覧を整理してください。');
}
export function parseNotes(text: string): PlayNote[] {
  if (text.length > NOTE_FILE_LIMIT) throw new Error('印のファイルは15MB以下にしてください。');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('印のJSONを読み取れませんでした。');
  }
  const result = z
    .object({
      kind: z.literal('playtest-notes'),
      version: z.literal(1),
      notes: z.array(noteSchema).max(NOTE_LIMIT),
    })
    .safeParse(json);
  if (!result.success) throw new Error('印のファイル形式が不正です。');
  const notes = result.data.notes as unknown as PlayNote[];
  ensureNoteCapacity(notes);
  if (new Set(notes.map((n) => n.id)).size !== notes.length)
    throw new Error('印のIDが重複しています。');
  for (const note of notes) {
    // Old versions remain readable as notes, but are never passed to the old simulation.
    for (const f of [note.entry, note.before, note.marked]) {
      const st = f.state;
      if (
        !st ||
        ![1, 2].includes(st.encounter) ||
        typeof st.version !== 'string' ||
        !Number.isFinite(st.realTime) ||
        !Number.isFinite(st.time) ||
        !Array.isArray(st.allies) ||
        st.allies.length !== 3 ||
        !st.allies.every((a) => a && typeof a.name === 'string' && a.name.length <= 100) ||
        !Number.isInteger(st.selected) ||
        st.selected < 0 ||
        st.selected > 2
      )
        throw new Error('印の場面情報が不正です。');
      if (sameRules(note)) {
        parseSnapshot(JSON.stringify({ version: VERSION, kind: 'snapshot', state: st }));
        prefix(note, f);
        if (
          (f.view.pending && !SKILLS[f.view.pending]) ||
          (f.view.battle.skillId && !SKILLS[f.view.battle.skillId]) ||
          (f.view.battle.page === 'target' && !f.view.battle.skillId)
        )
          throw new Error('印の操作画面に不明な技があります。');
      }
    }
    if (
      note.before.tick > note.marked.tick ||
      note.entry.tick > note.before.tick ||
      note.marked.tick !== note.recording.endTick
    )
      throw new Error('印の時刻の順序が不正です。');
  }
  return notes;
}
export const emptyPlayView = (): PlayView => ({ battle: newBattlePad(), pending: null });
