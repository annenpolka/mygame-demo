import { describe, it, expect } from 'vitest';
import {
  battleInput,
  newBattlePad,
  choices,
  confirmChoice,
  openPage,
} from '../src/input/battle-pad';
import { defaultBindings, migrateBindings } from '../src/input/gamepad';
import { createState, command, step, advance, copy } from '../src/sim/engine';
import { effectCues } from '../src/client/effects/events';
import { planned } from '../src/sim/plan';
import { Session, runReplay } from '../src/lab/session';
import type { PadAction } from '../src/input/gamepad';
const session = () => {
  const x = new Session();
  x.send({ type: 'start' }, { type: 'time', mode: 'stop' });
  return x;
};
describe('direct controller battle commands', () => {
  it('opens a skill directly and keeps its target selected for repeated stacking', () => {
    const x = session();
    let ui = newBattlePad();
    const press = (a: PadAction) => {
      const r = battleInput(x.state, ui, a);
      ui = r.ui;
      if (r.commands.length) x.send(...r.commands);
    };
    press('skill');
    expect(ui.page).toBe('target');
    expect(planned(x.state.allies[0])).toHaveLength(0);
    press('right');
    for (let i = 0; i < 6; i++) press('confirm');
    expect(planned(x.state.allies[0])).toHaveLength(6);
    expect(ui.page).toBe('target');
    expect(
      planned(x.state.allies[0]).every(
        (p) => p.kind === 'skill' && p.target.kind === 'row' && p.target.row === 'back',
      ),
    ).toBe(true);
    press('confirm');
    expect(planned(x.state.allies[0])).toHaveLength(6);
    expect(ui.message).toContain('6手');
    press('cancel');
    expect(ui.page).toBe('command');
    press('down');
    press('confirm');
    press('cancel');
    press('skill');
    expect(ui.key).toBe('row:back');
    expect(runReplay(x.recording())).toEqual(x.state);
  });
  it('guard takes one press at home and back does not add guard inside a picker', () => {
    const x = session();
    let r = battleInput(x.state, newBattlePad(), 'cancel');
    x.send(...r.commands);
    expect(planned(x.state.allies[0])).toMatchObject([{ kind: 'skill', skillId: 'guard' }]);
    r = battleInput(x.state, openPage(x.state, r.ui, 'target', 'sweep'), 'cancel');
    expect(r.commands).toEqual([]);
    expect(r.ui.page).toBe('command');
  });
  it('cancels a stable reservation key and never shifts a different command when execution advances', () => {
    const x = session();
    for (let i = 0; i < 3; i++)
      x.send({
        type: 'enqueue',
        id: 0,
        step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
      });
    let ui = openPage(x.state, newBattlePad(), 'queue');
    expect(ui.key).toBe('3');
    ui = battleInput(x.state, ui, 'up').ui;
    const r = battleInput(x.state, ui, 'confirm');
    x.send(...r.commands);
    expect(planned(x.state.allies[0]).map((p) => p.key)).toEqual([1, 3]);
    ui = { ...r.ui, key: '1' };
    x.send({ type: 'time', mode: 'normal' });
    x.advance(1 / 60);
    const stale = battleInput(x.state, ui, 'confirm');
    expect(stale.commands).toEqual([]);
    expect(planned(x.state.allies[0])[0].key).toBe(3);
    expect(x.state.allies[0].action?.skillId).toBe('guard');
  });
  it('projects queued weapon changes into the direct skill buttons and follows FIFO', () => {
    const x = session();
    let ui = openPage(x.state, newBattlePad(), 'weapon');
    const r = confirmChoice(x.state, ui, '1');
    x.send(...r.commands);
    ui = r.ui;
    const skill = battleInput(x.state, ui, 'confirm');
    expect(skill.ui.skillId).toBe('ward');
    const added = battleInput(x.state, skill.ui, 'confirm');
    x.send(...added.commands);
    expect(planned(x.state.allies[0]).map((p) => p.kind)).toEqual(['weapon', 'skill']);
    x.send({ type: 'time', mode: 'normal' });
    for (let i = 0; i < 10; i++) x.advance(0.1);
    expect(x.state.allies[0].slot).toBe(1);
    expect(x.state.allies[0].shield).toBeGreaterThan(0);
  });
  it("switches actors without committing drafts or losing another actor's queue", () => {
    const x = session();
    x.send(...battleInput(x.state, newBattlePad(), 'cancel').commands);
    const draft = openPage(x.state, newBattlePad(), 'target', 'sweep');
    const r = battleInput(x.state, draft, 'next');
    x.send(...r.commands);
    expect(r.ui.page).toBe('command');
    expect(x.state.selected).toBe(1);
    expect(planned(x.state.allies[0])).toHaveLength(1);
  });
  it('uses triggers in submenus, honors pause, and dispatches linked tactics without reordering', () => {
    const x = session();
    const ui = openPage(x.state, newBattlePad(), 'queue');
    const slow = battleInput(x.state, ui, 'slow');
    x.send(...slow.commands);
    expect(x.state.timeMode).toBe('slow');
    expect(slow.ui.page).toBe('queue');
    x.state.config.uiMode = 'linked';
    const tactic = confirmChoice(x.state, openPage(x.state, ui, 'tactics'), '1');
    expect(tactic.commands.map((c) => c.type)).toEqual(['optima', 'move', 'move', 'move']);
    x.send({ type: 'pause', value: true });
    expect(battleInput(x.state, newBattlePad(), 'cancel').commands).toEqual([]);
    x.state.config.uiMode = 'individual';
    expect(choices(x.state, { ...ui, page: 'tactics', tactics: 'formation' })).toEqual([]);
  });
  it('preserves the old custom button layout while assigning distinct trigger controls', () => {
    const old: any = { ...defaultBindings('xbox'), confirm: 20, slow: 2, stop: 3 };
    delete old.skill;
    delete old.item;
    const b = migrateBindings(old)!;
    expect(b.confirm).toBe(20);
    expect(b.skill).toBe(3);
    expect(b.item).toBe(2);
    expect(b.slow).toBe(6);
    expect(b.stop).toBe(7);
    expect(migrateBindings({ ...old, axisX: 999 })).toBeNull();
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
    advance(s, 0.45);
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
    expect(
      effectCues(s).some((c) => c.type === 'heal' && c.target === 'a1' && c.value === 190),
    ).toBe(true);
    command(s, { type: 'optima', index: 1 });
    advance(s, 1);
    expect(effectCues(s).some((c) => c.type === 'shift')).toBe(true);
    command(s, {
      type: 'enqueue',
      id: 2,
      step: { kind: 'skill', skillId: 'pull', target: { kind: 'enemy', id: 1 } },
    });
    advance(s, 1);
    expect(s.enemies[1].row).toBe('front');
    expect(effectCues(s).some((c) => c.type === 'move' && c.target === 'e1')).toBe(true);
  });
});
