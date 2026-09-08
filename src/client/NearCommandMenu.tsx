import { useId, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { SKILLS, WEAPONS } from '../content/data';
import { skillPreview, unavailable, type BattleAction, type BattlePad } from '../input/battle-pad';
import type { PadBindings, PadFamily } from '../input/gamepad';
import { canExecuteSequence, projectedSlot } from '../sim/plan';
import type { State } from '../sim/types';
import { PadGlyph } from './PadBattleConsole';
import { SkillIcon } from './TargetVisuals';

export type NearCommandMode = 'shelf' | 'orbit';
type NearAction = 'basic' | 'skill' | 'guard' | 'potion' | 'execute';
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

  const actions: { action: NearAction; skillId?: string; label: string; key: string }[] = [
    { action: 'basic', skillId: weapon.skills[0], label: '基本技', key: 'Z' },
    { action: 'skill', skillId: weapon.skills[1], label: '主力技', key: 'X' },
    { action: 'guard', skillId: 'guard', label: '防御', key: 'C' },
    { action: 'potion', skillId: 'potion', label: '救急薬', key: 'V' },
    { action: 'execute', label: '行動開始', key: 'H' },
  ];
  const executeReason =
    s.pendingSelect !== null
      ? '交代が完了してから実行してください。'
      : s.controlMode !== 'manual'
        ? '手動操作中に実行できます。'
        : a.hp <= 0
          ? '戦闘不能です。仲間を選んでください。'
          : !canExecuteSequence(a)
            ? a.draft?.length
              ? '前の一組が実行を開始してから確定してください。'
              : '実行する下書きがありません。'
            : '';

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
          const skill = skillId ? SKILLS[skillId] : undefined;
          const preview = skill ? skillPreview(s, ui, skill.id) : undefined;
          const reason = skill ? unavailable(s, skill.id) : executeReason;
          const isExecute = action === 'execute';
          const accessibleLabel = skill
            ? `${label}：${action === 'potion' ? '' : `${skill.name}、`}${preview?.label}、${skill.cost} ATB${reason ? `。${reason}` : ''}`
            : `行動開始：${a.name}の下書きを一組として確定${reason ? `。${reason}` : ''}`;
          return (
            <button
              key={action}
              className={`near-command-button ${reason ? 'near-command-blocked' : ''}`}
              data-near-action={action}
              data-skill-id={skill?.id}
              aria-label={accessibleLabel}
              disabled={isExecute && !!reason}
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
                <SkillIcon skillId={skill?.id} symbol={isExecute ? 'check' : undefined} />
                <strong>{skill?.name ?? label}</strong>
              </span>
              <small className="near-command-detail">
                {skill ? `${skill.cost} ATB` : '下書きを確定'}
                {reason && <span aria-hidden="true"> · 待機</span>}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
