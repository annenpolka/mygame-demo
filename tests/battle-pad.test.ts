import { DT, SKILLS } from '../src/content/data';
import { describe, it, expect } from 'vitest';
import {
  battleInput,
  paletteCursor,
  selectCandidate,
  skillPreview,
  newBattlePad,
  choices,
  confirmChoice,
  openPage,
  type BattlePage,
} from '../src/input/battle-pad';
import { createState, command, step, advance, copy } from '../src/sim/engine';
import { effectCues } from '../src/client/effects/events';
import { planned } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
const session = () => {
  const x = new Session();
  x.send({ type: 'start' }, { type: 'time', mode: 'stop' });
  return x;
};
describe('target palette and explicit sequences', () => {
  it.each([
    'command',
    'target',
    'queue',
    'tactics',
    'move',
    'weapon',
    'log',
    'aux',
  ] as BattlePage[])(
    'back from %s is harmless and cutoff keeps drafts while preserving the active action',
    (page) => {
      const x = session();
      for (let i = 0; i < 3; i++) x.send(...battleInput(x.state, newBattlePad(), 'guard').commands);
      x.send({ type: 'executeSequence', id: 0 }, { type: 'time', mode: 'normal' });
      for (let i = 0; i < 30; i++) x.advance(0.1);
      x.send(...battleInput(x.state, newBattlePad(), 'guard').commands);
      const before = copy(x.state),
        picker = openPage(x.state, newBattlePad(), page, page === 'target' ? 'potion' : null);
      let ui = picker;
      for (let i = 0; i < 10; i++) {
        const r = battleInput(x.state, ui, 'back');
        ui = r.ui;
        expect(r.commands).toEqual([]);
      }
      expect(x.state).toEqual(before);
      expect(ui.page).toBe('command');
      const cut = battleInput(x.state, picker, 'cutQueue');
      expect(cut.commands).toEqual([{ type: 'cancel', id: 0 }]);
      x.send(...cut.commands);
      expect(x.state.allies[0].draft).toEqual(before.allies[0].draft);
      expect(x.state.allies[0].action).toEqual(before.allies[0].action);
      expect(x.state.allies[0].atb).toBe(before.allies[0].atb);
      for (let i = 0; i < 10; i++)
        expect(battleInput(x.state, cut.ui, 'cutQueue').commands).toEqual([]);
      expect(runReplay(x.recording())).toEqual(x.state);
    },
  );
  it('adds mixed skills directly to the same candidate without changing the AI focus or earlier targets', () => {
    const x = session();
    let ui = selectCandidate(x.state, newBattlePad(), 'enemy', { kind: 'enemy', id: 1 });
    for (const action of ['confirm', 'confirm', 'skill'] as const) {
      const r = battleInput(x.state, ui, action);
      ui = r.ui;
      x.send(...r.commands);
    }
    expect(ui.page).toBe('command');
    expect(x.state.allies[0].draft).toMatchObject([
      { skillId: 'slash', target: { kind: 'enemy', id: 1 } },
      { skillId: 'slash', target: { kind: 'enemy', id: 1 } },
      { skillId: 'sweep', target: { kind: 'row', row: 'back' } },
    ]);
    ui = selectCandidate(x.state, ui, 'enemy', { kind: 'enemy', id: 0 });
    expect(x.state.target).toBe(0);
    expect(x.state.allies[0].draft![0]).toMatchObject({ target: { kind: 'enemy', id: 1 } });
    expect(x.state.allies[0].action).toBeNull();
    const r = battleInput(x.state, ui, 'execute');
    x.send(...r.commands);
    expect(x.state.allies[0].draft).toEqual([]);
    expect(battleInput(x.state, r.ui, 'execute').commands).toEqual([]);
    expect(runReplay(x.recording())).toEqual(x.state);
  });
  it('remembers enemy and ally candidates independently across projected weapons and shows row scope', () => {
    const x = session();
    let ui = selectCandidate(x.state, newBattlePad(), 'enemy', { kind: 'enemy', id: 1 });
    expect(skillPreview(x.state, ui, 'sweep')).toEqual({
      target: { kind: 'row', row: 'back' },
      label: '敵後列・1体',
    });
    x.send(...battleInput(x.state, ui, 'toggleWeapon').commands);
    expect(paletteCursor(x.state, ui).side).toBe('ally');
    ui = selectCandidate(x.state, ui, 'ally', { kind: 'ally', id: 2 });
    x.send(...battleInput(x.state, ui, 'confirm').commands);
    expect(x.state.allies[0].draft![1]).toMatchObject({
      skillId: 'ward',
      target: { kind: 'ally', id: 2 },
    });
    x.send(...battleInput(x.state, ui, 'toggleWeapon').commands);
    expect(paletteCursor(x.state, ui)).toEqual({ side: 'enemy', target: { kind: 'enemy', id: 1 } });
    ui = selectCandidate(x.state, ui, 'enemy', { kind: 'row', row: 'back' });
    expect(skillPreview(x.state, ui, 'slash').target).toBeNull();
    expect(skillPreview(x.state, ui, 'sweep').target).toEqual({ kind: 'row', row: 'back' });
    ui = selectCandidate(x.state, ui, 'ally', { kind: 'ally', id: 1 });
    expect(battleInput(x.state, ui, 'skill').commands).toEqual([]);
    expect(battleInput(x.state, ui, 'guard').commands[0]).toMatchObject({
      type: 'draft',
      step: { skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
  });
  it('does not replace an unavailable candidate and allows an empty row for a row skill', () => {
    const x = session();
    x.state.enemies[1].hp = 0;
    let ui = selectCandidate(x.state, newBattlePad(), 'enemy', { kind: 'enemy', id: 1 });
    expect(battleInput(x.state, ui, 'confirm').commands).toEqual([]);
    ui = selectCandidate(x.state, ui, 'enemy', { kind: 'row', row: 'back' });
    expect(skillPreview(x.state, ui, 'sweep').label).toBe('敵後列・0体');
    expect(battleInput(x.state, ui, 'skill').commands).toHaveLength(1);
  });
  it('requires another explicit queue selection after deletion and does not substitute an executed reservation', () => {
    const x = session();
    for (let i = 0; i < 3; i++) x.send(...battleInput(x.state, newBattlePad(), 'guard').commands);
    let ui = battleInput(x.state, openPage(x.state, newBattlePad(), 'queue'), 'up').ui;
    const r = battleInput(x.state, ui, 'confirm');
    x.send(...r.commands);
    ui = r.ui;
    expect(ui.queueFocus).toMatchObject({ key: '2', status: 'removed', index: 1 });
    for (let i = 0; i < 10; i++) expect(battleInput(x.state, ui, 'confirm').commands).toEqual([]);
    ui = battleInput(x.state, ui, 'up').ui;
    x.send({ type: 'executeSequence', id: 0 }, { type: 'time', mode: 'normal' });
    for (let i = 0; i < 15; i++) x.advance(0.1);
    const stale = battleInput(x.state, ui, 'confirm');
    expect(stale.commands).toEqual([]);
    expect(stale.ui.queueFocus?.status).toBe('gone');
    expect(battleInput(x.state, stale.ui, 'confirm').commands).toEqual([]);
    const next = battleInput(x.state, stale.ui, 'down');
    expect(battleInput(x.state, next.ui, 'confirm').commands).toEqual([
      { type: 'removePlan', id: 0, key: 3 },
    ]);
  });
  it('execute from the auxiliary menu commits only the visible draft, never the highlighted potion', () => {
    const x = session();
    let menu = openPage(x.state, newBattlePad(), 'aux');
    menu = { ...menu, key: 'potion' };
    expect(battleInput(x.state, menu, 'execute').commands).toEqual([]);
    x.send(...battleInput(x.state, newBattlePad(), 'guard').commands);
    x.send(...battleInput(x.state, menu, 'execute').commands);
    expect(planned(x.state.allies[0])).toMatchObject([{ skillId: 'guard' }]);
    expect(x.state.potions).toBe(3);
    const target = confirmChoice(x.state, menu, 'potion');
    expect(target.ui).toMatchObject({ page: 'target', skillId: 'potion' });
    expect(target.commands).toEqual([]);
    expect(battleInput(x.state, target.ui, 'confirm').commands[0]).toMatchObject({
      type: 'draft',
      step: { skillId: 'potion' },
    });
  });
  it('makes guard independent of back and keeps draft preparation through handoff', () => {
    const x = session();
    const target = openPage(x.state, newBattlePad(), 'target', 'potion');
    x.send(...battleInput(x.state, target, 'guard').commands);
    const r = battleInput(x.state, target, 'next');
    x.send(...r.commands);
    expect(x.state.pendingSelect).toBe(1);
    expect(planned(x.state.allies[0])).toHaveLength(2);
    expect(x.state.allies[0].draft).toMatchObject([{ skillId: 'guard' }]);
    expect(battleInput(x.state, target, 'back').commands).toEqual([]);
    expect(battleInput(x.state, target, 'execute').commands).toEqual([]);
  });
  it('keeps time controls global within menus and exposes tools in individual mode', () => {
    const x = session();
    x.state.config.uiMode = 'individual';
    const menu = openPage(x.state, newBattlePad(), 'aux');
    x.send(...battleInput(x.state, menu, 'slow').commands);
    expect(x.state.timeMode).toBe('slow');
    expect(choices(x.state, menu).some((c) => c.skillId === 'potion')).toBe(true);
    expect(choices(x.state, { ...menu, page: 'tactics', tactics: 'formation' })).toEqual([]);
    x.send({ type: 'pause', value: true });
    expect(battleInput(x.state, menu, 'guard').commands).toEqual([]);
  });
});
describe('battle effects follow resolved simulation outcomes', () => {
  it('shows damage and break from the actual target, expires in battle time, and does not mutate state', () => {
    const s = createState();
    command(s, { type: 'start' });
    s.allies[0].atb = 4;
    s.enemies[0].chain = 199;
    s.enemies[0].hold = 2;
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
    });
    advance(s, SKILLS.slash.cast + 2 * DT);
    const before = copy(s),
      cues = effectCues(s),
      damage = s.events.find((e) => e.type === 'damage')!;
    expect(cues).toContainEqual(
      expect.objectContaining({ type: 'slash', target: 'e0', value: damage.value }),
    );
    expect(cues.some((c) => c.type === 'break')).toBe(true);
    expect(s).toEqual(before);
    command(s, { type: 'time', mode: 'stop' });
    advance(s, 0.5);
    expect(effectCues(s).find((c) => c.id === damage.id)?.progress).toBe(
      cues.find((c) => c.id === damage.id)?.progress,
    );
    command(s, { type: 'time', mode: 'normal' });
    advance(s, 1.4);
    expect(effectCues(s).some((c) => c.id === damage.id)).toBe(false);
  });
  it('distinguishes healing, shields, forced movement and weapon effects without fake hits', () => {
    const s = createState();
    command(s, { type: 'start' });
    s.allies.forEach((a) => (a.atb = 4));
    s.allies[1].hp = 600;
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
    command(s, {
      type: 'enqueue',
      id: 2,
      step: { kind: 'skill', skillId: 'heal', target: { kind: 'ally', id: 1 } },
    });
    advance(s, 0.5);
    expect(effectCues(s).some((c) => c.type === 'shield' && c.target === 'a0')).toBe(true);
    advance(s, SKILLS.heal.cast + 2 * DT - 0.5);
    expect(
      effectCues(s).some((c) => c.type === 'heal' && c.target === 'a1' && c.value === 190),
    ).toBe(true);
    s.selected = 2;
    command(s, { type: 'optima', index: 1 });
    advance(s, SKILLS.heal.recovery + s.config.shiftTime + 2 * DT);
    expect(effectCues(s).some((c) => c.type === 'shift')).toBe(true);
    command(s, {
      type: 'enqueue',
      id: 2,
      step: { kind: 'skill', skillId: 'pull', target: { kind: 'enemy', id: 1 } },
    });
    for (let i = 0; i < 600 && s.enemies[1].row !== 'front'; i++) step(s);
    expect(s.enemies[1].row).toBe('front');
    expect(effectCues(s).some((c) => c.type === 'move' && c.target === 'e1')).toBe(true);
  });
});
