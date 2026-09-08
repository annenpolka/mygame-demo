import { useId, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { SKILLS, WEAPONS } from '../content/data';
import { skillPreview, unavailable, type BattleAction, type BattlePad } from '../input/battle-pad';
import type { PadBindings, PadFamily } from '../input/gamepad';
import { projectedSlot } from '../sim/plan';
import type { State } from '../sim/types';
import { PadGlyph } from './PadBattleConsole';
import { SkillIcon } from './TargetVisuals';

export type NearCommandMode = 'shelf' | 'orbit';
type NearAction = 'basic' | 'skill' | 'guard' | 'potion';
type CardBounds = { left: number; top: number; width: number; height: number };

export function NearCommandMenu({
  state: s,
  ui,
  mode,
  field,
  keyboard,
  bindings,
  family,
  act,
}: {
  state: State;
  ui: BattlePad;
  mode: NearCommandMode;
  field: RefObject<HTMLDivElement | null>;
  keyboard: boolean;
  bindings: PadBindings;
  family: PadFamily;
  act: (action: BattleAction) => void;
}) {
  const titleId = useId();
  const [bounds, setBounds] = useState<CardBounds | null>(null);
  const a = s.allies[s.selected];
  const weapon = WEAPONS[a.weapons[projectedSlot(a)]];
  const positions = s.allies.map((ally) => `${ally.id}:${ally.row}`).join('|');

  useLayoutEffect(() => {
    const root = field.current;
    const card = root?.querySelector<HTMLElement>(`.field-unit[data-unit="a${a.id}"]`);
    if (!root || !card) return;
    const measure = () => {
      const frame = root.getBoundingClientRect();
      const actor = card.getBoundingClientRect();
      const next = {
        left: actor.left - frame.left,
        top: actor.top - frame.top,
        width: actor.width,
        height: actor.height,
      };
      setBounds((previous) =>
        previous &&
        Object.keys(next).every(
          (key) => previous[key as keyof CardBounds] === next[key as keyof CardBounds],
        )
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(card);
    return () => observer.disconnect();
  }, [field, a.id, positions, s.encounter, mode]);

  const actions: { action: NearAction; skillId: string; label: string; key: string }[] = [
    { action: 'basic', skillId: weapon.skills[0], label: '基本技', key: 'Z' },
    { action: 'skill', skillId: weapon.skills[1], label: '主力技', key: 'X' },
    { action: 'guard', skillId: 'guard', label: '防御', key: 'C' },
    { action: 'potion', skillId: 'potion', label: '救急薬', key: 'V' },
  ];

  return (
    <section
      className={`near-command-menu near-command-${mode} ${keyboard ? 'near-keyboard' : ''}`}
      role="group"
      aria-labelledby={titleId}
      data-menu-location={mode}
      data-actor-id={a.id}
      style={
        {
          '--near-left': `${bounds?.left ?? 0}px`,
          '--near-top': `${bounds?.top ?? 0}px`,
          '--near-width': `${bounds?.width ?? 0}px`,
          '--near-height': `${bounds?.height ?? 0}px`,
        } as CSSProperties
      }
      data-positioned={!!bounds}
    >
      <h3 className="near-command-title" id={titleId}>
        {a.name}のコマンド
      </h3>
      <div className="near-command-buttons">
        {actions.map(({ action, skillId, label, key }) => {
          const skill = SKILLS[skillId];
          const preview = skillPreview(s, ui, skill.id);
          const reason = unavailable(s, skill.id);
          const accessibleLabel = `${label}：${action === 'potion' ? '' : `${skill.name}、`}${preview.label}、${skill.cost} ATB${reason ? `。${reason}` : ''}`;
          return (
            <button
              key={action}
              className={`near-command-button ${reason ? 'near-command-blocked' : ''}`}
              data-near-action={action}
              data-skill-id={skill.id}
              aria-label={accessibleLabel}
              title={accessibleLabel}
              onClick={() => act(action)}
            >
              <span className="near-command-shortcut" aria-hidden="true">
                {keyboard ? (
                  <kbd>{key}</kbd>
                ) : action === 'potion' ? null : action === 'basic' && ui.page !== 'command' ? (
                  <span className="near-context-key">
                    対象時
                    <PadGlyph action="confirm" bindings={bindings} family={family} />
                  </span>
                ) : (
                  <PadGlyph
                    action={action === 'basic' ? 'confirm' : action}
                    bindings={bindings}
                    family={family}
                  />
                )}
              </span>
              <span className="near-command-name">
                <SkillIcon skillId={skill.id} />
                <strong>{skill.name}</strong>
              </span>
              <small className="near-command-detail">
                {skill.cost} ATB
                {reason && <span aria-hidden="true"> · 待機</span>}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
