import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Battlefield } from '../src/client/Battlefield';
import { PadBattleConsole } from '../src/client/PadBattleConsole';
import {
  battleInput,
  newBattlePad,
  paletteCursor,
  paletteTargets,
  selectCandidate,
  syncPaletteTargets,
  type BattlePad,
} from '../src/input/battle-pad';
import { defaultBindings } from '../src/input/gamepad';
import { createState, command } from '../src/sim/engine';
import type { State } from '../src/sim/types';
const noop = () => {};
function battle() {
  const s = createState();
  command(s, { type: 'start' });
  s.allies[0].slot = 1;
  return s;
}
function consoleMarkup(s: State, ui: BattlePad) {
  return renderToStaticMarkup(
    createElement(PadBattleConsole, {
      state: s,
      ui,
      bindings: defaultBindings('xbox'),
      family: 'xbox',
      log: [],
      act: noop,
      pick: noop,
      remove: noop,
      open: noop,
      select: noop,
    }),
  );
}
function skillButton(html: string, skillId: string) {
  return html.match(new RegExp(`<button[^>]*data-skill-id="${skillId}"[^>]*>`))?.[0] ?? '';
}
describe('dual target interface semantics', () => {
  it('exposes two held targets as buttons while keeping the editing cursor separate from DOM focus', () => {
    const s = battle();
    let ui = selectCandidate(s, newBattlePad(), 'ally', { kind: 'ally', id: 1 });
    ui = battleInput(s, ui, 'targetEnemies').ui;
    const html = renderToStaticMarkup(
      createElement(Battlefield, {
        state: s,
        pending: null,
        palette: paletteCursor(s, ui),
        targets: paletteTargets(s, ui),
        onCandidate: noop,
        onAlly: noop,
        onTarget: noop,
        onAim: noop,
        onBack: noop,
      }),
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/data-editing="true"/g)).toHaveLength(1);
    expect(html).toContain('data-unit="a1" data-target="ally"');
    expect(html).toContain('data-unit="e0" data-target="enemy" data-editing="true"');
    expect(html).not.toContain('aria-activedescendant');
    expect(html).not.toContain('role="option"');
    expect(html).not.toContain('outside-target');
    expect(html).toContain('actor-marker');
  });
  it('leaves an invalid skill clickable and identifies only the original recovery skill as a repeat press', () => {
    const s = battle();
    let ui = selectCandidate(s, newBattlePad(), 'ally', { kind: 'ally', id: 1 });
    ui = battleInput(s, ui, 'targetEnemies').ui;
    s.allies[1].hp = 0;
    ui = syncPaletteTargets(s, ui);
    const initial = skillButton(consoleMarkup(s, ui), 'ward');
    expect(initial).toContain('対象が不在');
    expect(initial).not.toContain('disabled');
    ui = battleInput(s, ui, 'confirm').ui;
    const html = consoleMarkup(s, ui);
    expect(skillButton(html, 'ward')).toContain('同じ技をもう一度押すと追加');
    expect(skillButton(html, 'rampart')).toContain('押すと対象候補を確認');
    expect(html).toContain('recipient-portraits');
    expect(html).toContain('role="status"');
    expect(html).toContain('class="sr-only"');
  });
});
