import { expect, it } from 'vitest';
import { DT, SKILLS } from '../src/content/data';
import { Session, runReplay } from '../src/lab/session';
import { copy } from '../src/sim/engine';
import {
  PlayJournal,
  emptyPlayView,
  parseNotes,
  exportNotes,
  prepareNoteReplay,
  prepareNoteComparison,
  sameRules,
} from '../src/lab/playtest';
import {
  openPage,
  battleInput,
  selectCandidate,
  paletteCursor,
  syncPaletteTargets,
} from '../src/input/battle-pad';
import { WatchPlayer } from '../src/ai/watch-player';
function fixture() {
  const session = new Session(),
    journal = new PlayJournal(),
    view = emptyPlayView();
  session.send({ type: 'start' });
  journal.observe(session, view);
  return { session, journal, view };
}
it('restores a cancelled queue focus without arming another reservation', () => {
  const { session, journal, view } = fixture();
  session.send({ type: 'time', mode: 'slow' });
  for (let i = 0; i < 3; i++)
    session.send(...battleInput(session.state, view.battle, 'guard').commands);
  const removed = battleInput(
    session.state,
    openPage(session.state, { ...view.battle, panel: 'log', logOffset: 3 }, 'queue'),
    'confirm',
  );
  session.send(...removed.commands);
  view.battle = removed.ui;
  const note = parseNotes(exportNotes([journal.mark(session, view)]))[0];
  const restored = prepareNoteReplay(note, 'marked');
  const state = runReplay(restored.recording);
  expect(state).toEqual(session.state);
  expect(restored.view.battle.queueFocus).toEqual(removed.ui.queueFocus);
  expect(restored.view.battle.panel).toBe('log');
  expect(restored.view.battle.logOffset).toBe(3);
  expect(battleInput(state, restored.view.battle, 'confirm').commands).toEqual([]);
});
it('marks without commands or time changes and replays the earlier state with UI, then branches without original future inputs', () => {
  const { session, journal, view } = fixture();
  for (let i = 0; i < 300; i++) {
    if (i === 60) view.battle = openPage(session.state, view.battle, 'target', 'sweep');
    session.advance(DT);
    journal.observe(session, view);
  }
  const initial = copy(session.state),
    inputs = copy(session.inputs);
  const note = journal.mark(session, view);
  expect(session.state).toEqual(initial);
  expect(session.inputs).toEqual(inputs);
  expect(note.marked.state.realTime - note.before.state.realTime).toBeGreaterThanOrEqual(3 - 1e-8);
  expect(note.marked.state.realTime - note.before.state.realTime).toBeLessThanOrEqual(3.26);
  expect(note.before.view.battle.page).toBe('target');
  const saved = exportNotes([note]);
  const replay = prepareNoteReplay(parseNotes(saved)[0]);
  expect(runReplay(replay.recording)).toEqual(note.before.state);
  session.replay(JSON.stringify(replay.recording));
  journal.branch(session, note, replay.view);
  session.send({
    type: 'enqueue',
    id: 0,
    step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
  });
  const branch = journal.mark(session, replay.view);
  expect(branch.sourceId).toBe(note.id);
  expect(exportNotes([note])).toBe(saved);
  expect(runReplay(session.recording())).toEqual(session.state);
  expect(runReplay(prepareNoteReplay(branch, 'marked').recording)).toEqual(branch.marked.state);
});
it('preserves the exact input prefix when several commands share the same tick', () => {
  const { session, journal, view } = fixture();
  session.send(
    { type: 'time', mode: 'slow' },
    {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    },
  );
  const note = journal.mark(session, view);
  expect(note.entry.tick).toBe(note.marked.tick);
  expect(note.entry.inputCount).toBe(1);
  expect(note.marked.inputCount).toBe(3);
  expect(runReplay(prepareNoteReplay(note, 'entry').recording)).toEqual(note.entry.state);
  expect(runReplay(prepareNoteReplay(note, 'marked').recording)).toEqual(note.marked.state);
  session.send({ type: 'cancelFirst', id: 0 });
  expect(runReplay(prepareNoteReplay(note, 'marked').recording)).toEqual(note.marked.state);
});
it('retains handoff cost, following reservations and the pending selection through replay', () => {
  const { session, journal, view } = fixture();
  session.send({
    type: 'enqueue',
    id: 0,
    step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
  });
  session.advance(0.1);
  session.send(
    { type: 'toggleRow', id: 0 },
    { type: 'toggleWeapon', id: 0 },
    { type: 'select', id: 2 },
  );
  view.battle = openPage(session.state, view.battle, 'queue');
  const note = journal.mark(session, view);
  expect(note.marked.state.pendingSelect).toBe(2);
  const replay = prepareNoteReplay(note, 'marked');
  const restored = runReplay(replay.recording);
  expect(restored).toEqual(session.state);
  expect(replay.view.battle.page).toBe('queue');
  expect(restored.allies[0].plan?.map((x) => x.kind)).toEqual(['skill']);
  expect(restored.allies[0].nextRow).toBe('back');
  expect(restored.allies[0].nextSlot).toBe(1);
});
it('clamps rewind to the current encounter, retains notes through reset, and does not require a manual session', () => {
  const session = new Session({ enemyHpScale: 0.5, atbRate: 3 }, 'ai'),
    journal = new PlayJournal(),
    player = new WatchPlayer(),
    view = emptyPlayView();
  player.configure('autopilot');
  session.send({ type: 'start' });
  for (let i = 0; i < 6000 && session.state.encounter === 1; i++) {
    player.advance(session, DT);
    journal.observe(session, view);
  }
  expect(session.state.encounter).toBe(2);
  for (let i = 0; i < 30; i++) {
    player.advance(session, DT);
    journal.observe(session, view);
  }
  const note = journal.mark(session, view);
  expect(note.before.state.encounter).toBe(2);
  expect(runReplay(prepareNoteReplay(note).recording)).toEqual(note.before.state);
  session.reset();
  journal.observe(session, view);
  expect(runReplay(prepareNoteReplay(note, 'marked').recording)).toEqual(note.marked.state);
});
it('separates incompatible-rule notes from fresh encounter comparisons, preserving only setup', () => {
  const { session, journal, view } = fixture();
  session.send({
    type: 'enqueue',
    id: 0,
    step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
  });
  session.advance(0.1);
  const note = journal.mark(session, view);
  note.rules = 'older rules';
  note.recording.version = 'orchestra-11';
  note.marked.view.battle.candidates = { '0:enemy': { kind: 'row', row: 'back' } } as never;
  expect(sameRules(note)).toBe(false);
  expect(parseNotes(exportNotes([note]))).toEqual([note]);
  expect(() => prepareNoteReplay(note)).toThrow('ルールが異なります');
  const fresh = prepareNoteComparison(note, { bonusMode: 'none' });
  expect(fresh.config.bonusMode).toBe('none');
  expect(fresh.phase).toBe('battle');
  expect(fresh.allies.map((a) => a.weapons)).toEqual(note.entry.state.allies.map((a) => a.weapons));
  expect(fresh.allies.every((a) => a.action === null && a.hp === a.maxHp && a.atb === 1)).toBe(
    true,
  );
  expect(fresh.time).toBe(0);
  expect(fresh.selected).toBe(note.entry.state.selected);
});
it('rejects malformed UI, cursor order, duplicate IDs and edited replay state before resuming', () => {
  const { session, journal, view } = fixture(),
    note = journal.mark(session, view);
  expect(() => parseNotes(exportNotes([note, note]))).toThrow('重複');
  const bad = copy(note);
  bad.marked.state.allies[0].hp--;
  expect(() => prepareNoteReplay(bad, 'marked')).toThrow('一致しません');
  const invalidView = copy(note);
  invalidView.marked.view.battle.skillId = 'missing';
  expect(() => parseNotes(exportNotes([invalidView]))).toThrow('不明な技');
  const rowCursor = copy(note);
  rowCursor.marked.view.battle.candidates = { '0:enemy': { kind: 'row', row: 'back' } } as never;
  expect(() => parseNotes(exportNotes([rowCursor]))).toThrow('個体');
  const badCursor = copy(note);
  badCursor.before.inputCount = 900;
  expect(() => parseNotes(exportNotes([badCursor]))).toThrow();
  const badVersion = JSON.parse(exportNotes([note]));
  badVersion.notes[0].recording.version = {};
  expect(() => parseNotes(JSON.stringify(badVersion))).toThrow('形式');
});

it('treats link duration as a numeric rule change while description edits stay compatible', () => {
  const { session, journal, view } = fixture();
  const note = journal.mark(session, view);
  const link = SKILLS.slash.link,
    description = SKILLS.slash.description;
  try {
    SKILLS.slash.description = '説明の追記';
    expect(sameRules(note)).toBe(true);
    SKILLS.slash.link = 0.3;
    expect(sameRules(note)).toBe(false);
    expect(() => prepareNoteReplay(note)).toThrow('ルールが異なります');
  } finally {
    SKILLS.slash.link = link;
    SKILLS.slash.description = description;
  }
});

it('restores candidate memory, an active committed group and a separate next draft through a playtest mark', () => {
  const { session, journal, view } = fixture();
  view.battle = selectCandidate(session.state, view.battle, 'enemy', { kind: 'enemy', id: 1 });
  session.send(...battleInput(session.state, view.battle, 'confirm').commands);
  session.send(...battleInput(session.state, view.battle, 'execute').commands);
  session.advance(0.1);
  view.battle = selectCandidate(session.state, view.battle, 'enemy', { kind: 'enemy', id: 0 });
  session.send(...battleInput(session.state, view.battle, 'guard').commands);
  const note = parseNotes(exportNotes([journal.mark(session, view)]))[0];
  const restored = prepareNoteReplay(note, 'marked');
  const state = runReplay(restored.recording);
  expect(state).toEqual(session.state);
  expect(state.allies[0].action).toMatchObject({ target: { kind: 'enemy', id: 1 } });
  expect(state.allies[0].draft).toMatchObject([{ skillId: 'guard' }]);
  expect(paletteCursor(state, restored.view.battle)).toEqual({
    side: 'enemy',
    target: { kind: 'enemy', id: 0 },
  });
  expect(state.allies[0].sequences).toEqual(session.state.allies[0].sequences);
});

it('round-trips repaired shared targets and their single submitted action', () => {
  const { session, journal, view } = fixture();
  view.battle = syncPaletteTargets(session.state, view.battle);
  view.battle = { ...view.battle, invalidTargets: { enemy: true } };
  const added = battleInput(session.state, view.battle, 'confirm');
  view.battle = added.ui;
  session.send(...added.commands);
  expect(view.battle.targetRecovery).toBeUndefined();
  const note = parseNotes(exportNotes([journal.mark(session, view)]))[0];
  const restored = prepareNoteReplay(note, 'marked');
  expect(restored.view.battle).toEqual(view.battle);
  expect(runReplay(restored.recording)).toEqual(session.state);
  expect(session.state.allies[0].draft ?? []).toHaveLength(1);
  const confirmed = battleInput(session.state, restored.view.battle, 'confirm');
  expect(confirmed.commands).toMatchObject([
    { type: 'draft', step: { target: { kind: 'enemy', id: 0 } } },
  ]);
});
it('rejects same-rule notes with cross-side candidates or a mismatched recovery target', () => {
  const { session, journal, view } = fixture();
  view.battle = syncPaletteTargets(session.state, view.battle);
  const note = journal.mark(session, view);
  const wrongCandidate = copy(note);
  wrongCandidate.marked.view.battle.candidates!.ally = { kind: 'enemy', id: 0 };
  expect(() => parseNotes(exportNotes([wrongCandidate]))).toThrow('側が一致');
  const wrongRecovery = copy(note);
  wrongRecovery.marked.view.battle.targetRecovery = {
    skillId: 'ward',
    side: 'ally',
    target: { kind: 'enemy', id: 0 },
    previousSide: 'enemy',
  };
  expect(() => parseNotes(exportNotes([wrongRecovery]))).toThrow('再選択候補');
  wrongRecovery.marked.view.battle.targetRecovery = {
    skillId: 'slash',
    side: 'ally',
    target: { kind: 'ally', id: 0 },
    previousSide: 'enemy',
  };
  expect(() => parseNotes(exportNotes([wrongRecovery]))).toThrow('再選択候補');
});
