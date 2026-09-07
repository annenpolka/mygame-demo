import { describe, expect, it } from 'vitest';
import { spatialTarget } from '../src/input/field-navigation';
import {
  battleInput,
  confirmChoice,
  newBattlePad,
  openPage,
  paletteCursor,
  selectCandidate,
} from '../src/input/battle-pad';
import { createState, command, copy } from '../src/sim/engine';
import { Session, runReplay } from '../src/lab/session';

function battle() {
  const s = createState({ encounterSet: 'crossfire' });
  command(s, { type: 'start' });
  return s;
}
describe('navigation follows battlefield columns and tracks', () => {
  it('moves vertically in the same column, horizontally to the closest track, and stops at the edge', () => {
    const s = battle();
    expect(spatialTarget(s, 'enemy', 0, 'down')).toBe(0);
    expect(spatialTarget(s, 'enemy', 0, 'right')).toBe(1);
    expect(spatialTarget(s, 'enemy', 1, 'down')).toBe(2);
    expect(spatialTarget(s, 'enemy', 2, 'down')).toBe(2);
    expect(spatialTarget(s, 'enemy', 2, 'up')).toBe(1);
    expect(spatialTarget(s, 'enemy', 2, 'left')).toBe(0);
    expect(spatialTarget(s, 'enemy', 0, 'left')).toBe(0);
    expect(spatialTarget(s, 'ally', 0, 'left')).toBe(1);
    expect(spatialTarget(s, 'ally', 1, 'down')).toBe(2);
    expect(spatialTarget(s, 'ally', 2, 'right')).toBe(0);
    expect(spatialTarget(s, 'ally', 1, 'down', [0])).toBe(0);
  });
  it('uses actual rows after displacement and keeps fallen units in their visible tracks', () => {
    const s = battle();
    s.enemies[0].row = 'back';
    s.enemies[1].hp = 0;
    expect(spatialTarget(s, 'enemy', 0, 'down')).toBe(2);
    expect(spatialTarget(s, 'enemy', 2, 'up')).toBe(0);
    expect(spatialTarget(s, 'enemy', 2, 'left')).toBe(2);
    expect(spatialTarget(s, 'enemy', 1, 'down')).toBe(2);
    expect(spatialTarget(s, 'enemy', 99, 'down')).toBe(0);
  });
  it('keeps side choice separate from moving and remembers both sides without changing drafts', () => {
    const s = battle();
    let ui = selectCandidate(s, newBattlePad(), 'enemy', { kind: 'enemy', id: 2 });
    command(s, battleInput(s, ui, 'confirm').commands[0]);
    const before = copy(s);
    ui = battleInput(s, ui, 'targetAllies').ui;
    expect(paletteCursor(s, ui).target).toEqual({ kind: 'ally', id: 0 });
    ui = battleInput(s, ui, 'left').ui;
    ui = battleInput(s, ui, 'down').ui;
    expect(paletteCursor(s, ui).target).toEqual({ kind: 'ally', id: 2 });
    ui = battleInput(s, ui, 'targetEnemies').ui;
    expect(paletteCursor(s, ui).target).toEqual({ kind: 'enemy', id: 2 });
    ui = battleInput(s, ui, 'targetAllies').ui;
    expect(paletteCursor(s, ui).target).toEqual({ kind: 'ally', id: 2 });
    expect(s).toEqual(before);
    s.allies[2].hp = 0;
    ui = battleInput(s, ui, 'targetEnemies').ui;
    ui = battleInput(s, ui, 'targetAllies').ui;
    expect(paletteCursor(s, ui).target).toEqual({ kind: 'ally', id: 0 });
    expect(ui.invalidTargets?.ally).toBe(false);
  });
  it('uses spatial navigation in target pickers, preserves menu navigation, and ignores side input there', () => {
    const s = battle();
    let ui = openPage(s, newBattlePad(), 'target', 'potion');
    ui = battleInput(s, ui, 'left').ui;
    expect(ui.key).toBe('ally:1');
    ui = battleInput(s, ui, 'down').ui;
    expect(ui.key).toBe('ally:2');
    expect(battleInput(s, ui, 'targetEnemies').ui).toEqual(ui);
    const aux = openPage(s, ui, 'aux');
    expect(battleInput(s, aux, 'down').ui.key).toBe('weapon');
    expect(battleInput(s, aux, 'targetEnemies').ui).toEqual(aux);
    const chosen = confirmChoice(s, aux, 'targetEnemies');
    expect(chosen.ui.page).toBe('command');
    expect(paletteCursor(s, chosen.ui).side).toBe('enemy');
    expect(chosen.commands).toEqual([]);
  });
  it('produces replayable commands while cursor motion stays outside battle state', () => {
    const x = new Session({ encounterSet: 'crossfire' });
    x.send({ type: 'start' });
    let ui = newBattlePad();
    for (const action of ['right', 'down', 'confirm', 'skill', 'execute'] as const) {
      const r = battleInput(x.state, ui, action);
      ui = r.ui;
      x.send(...r.commands);
    }
    for (let i = 0; i < 80; i++) x.advance(0.1);
    expect(runReplay(x.recording())).toEqual(x.state);
  });
});
