import { SKILLS, WEAPONS, ROW_NAMES } from '../content/data';
import { canAppend, planned, projectedSlot, projectedRow, pendingPotions } from '../sim/plan';
import type { Command, State, Target } from '../sim/types';
import type { PadAction } from './gamepad';

export type BattlePage = 'command' | 'target' | 'move' | 'weapon' | 'tactics' | 'queue' | 'log';
export interface BattlePad {
  page: BattlePage;
  key: string;
  skillId: string | null;
  tactics: 'optima' | 'formation';
  remembered: Record<string, string>;
  message: string;
  stamp: number;
  logOffset: number;
}
export interface BattleChoice {
  key: string;
  title: string;
  detail: string;
  command: Command;
  target?: Target;
}
export const newBattlePad = (): BattlePad => ({
  page: 'command',
  key: '',
  skillId: null,
  tactics: 'optima',
  remembered: {},
  message: '',
  stamp: 0,
  logOffset: 0,
});
export const home = (ui: BattlePad): BattlePad => ({
  ...ui,
  page: 'command',
  key: '',
  skillId: null,
});
const targetKey = (t: Target) => (t.kind === 'row' ? `row:${t.row}` : `${t.kind}:${t.id}`);
export function choices(s: State, ui: BattlePad): BattleChoice[] {
  const a = s.allies[s.selected];
  if (ui.page === 'target' && ui.skillId) {
    const skill = SKILLS[ui.skillId];
    if (!skill) return [];
    const targets: Target[] =
      skill.target === 'enemy'
        ? s.enemies.filter((e) => e.hp > 0).map((e) => ({ kind: 'enemy', id: e.id }))
        : ['ally', 'self'].includes(skill.target)
          ? s.allies
              .filter((x) => x.hp > 0 && (skill.target !== 'self' || x.id === a.id))
              .map((x) => ({ kind: 'ally', id: x.id }))
          : [
              { kind: 'row', row: 'front' },
              { kind: 'row', row: 'back' },
            ];
    return targets.map((target) => {
      const actor =
        target.kind === 'row' ? null : (target.kind === 'enemy' ? s.enemies : s.allies)[target.id];
      const group = skill.target === 'enemyRow' ? s.enemies : s.allies;
      return {
        key: targetKey(target),
        target,
        title:
          actor?.name ??
          `${skill.target === 'enemyRow' ? '敵' : '味方'}${target.kind === 'row' ? ROW_NAMES[target.row] : ''}`,
        detail: actor
          ? `HP ${Math.ceil(actor.hp)} / ${actor.maxHp} · ${ROW_NAMES[actor.row]}`
          : group
              .filter((x) => x.hp > 0 && target.kind === 'row' && x.row === target.row)
              .map((x) => x.name)
              .join('・') || '現在は誰もいません',
        command: { type: 'enqueue', id: a.id, step: { kind: 'skill', skillId: skill.id, target } },
      };
    });
  }
  if (ui.page === 'move')
    return (['back', 'front'] as const).map((row) => ({
      key: row,
      title: `${ROW_NAMES[row]}へ移動`,
      detail: `${s.config.moveTime}秒 · 予約の末尾に追加`,
      command: { type: 'enqueue', id: a.id, step: { kind: 'move', row } },
    }));
  if (ui.page === 'weapon')
    return a.weapons.map((id, slot) => ({
      key: String(slot),
      title: WEAPONS[id].name,
      detail: `${WEAPONS[id].role} · ${WEAPONS[id].archetype} · ${s.config.shiftTime}秒`,
      command: { type: 'enqueue', id: a.id, step: { kind: 'weapon', slot: slot as 0 | 1 } },
    }));
  if (ui.page === 'tactics')
    return ui.tactics === 'optima'
      ? s.presets.map((p, i) => ({
          key: String(i),
          title: p.name,
          detail: p.slots
            .map((slot, id) => `${s.allies[id].name} ${WEAPONS[s.allies[id].weapons[slot]].role}`)
            .join(' / '),
          command: { type: 'optima', index: i },
        }))
      : s.config.uiMode === 'individual'
        ? []
        : s.formations.map((f, i) => ({
            key: String(i),
            title: f.name,
            detail: f.rows.map((row, id) => `${s.allies[id].name} ${ROW_NAMES[row]}`).join(' / '),
            command: { type: 'formation', index: i },
          }));
  if (ui.page === 'queue')
    return planned(a).map((p) => ({
      key: String(p.key),
      title: '',
      detail: '',
      command: { type: 'removePlan', id: a.id, key: p.key },
    }));
  return [];
}
export function selectedChoice(s: State, ui: BattlePad) {
  const items = choices(s, ui);
  return items.find((c) => c.key === ui.key) ?? items[0];
}
export function unavailable(s: State, skillId?: string) {
  if (s.pendingSelect !== null) return '交代を予約中です。先頭取消で予約を戻せます。';
  const a = s.allies[s.selected];
  if (a.hp <= 0) return '戦闘不能です。肩ボタンで仲間を選んでください。';
  if (!canAppend(a, s.config, skillId ? (SKILLS[skillId]?.cost ?? Infinity) : 0))
    return `先行入力は合計${s.config.atbMax} ATB・${s.config.atbMax}手までです。不要な予約を取り消せます。`;
  if (skillId === 'potion' && pendingPotions(s.allies) >= s.potions)
    return '未予約の救急薬がありません。';
  if (
    skillId &&
    !['guard', 'potion', ...WEAPONS[a.weapons[projectedSlot(a)]].skills].includes(skillId)
  )
    return '武器が変わりました。技を選び直してください。';
  return '';
}
export function openPage(
  s: State,
  ui: BattlePad,
  page: BattlePage,
  skillId: string | null = null,
): BattlePad {
  const next = { ...ui, page, skillId, key: '', message: '', stamp: ui.stamp + 1 };
  const list = choices(s, next);
  next.key =
    (page === 'queue'
      ? list.at(-1)?.key
      : page === 'target'
        ? (ui.remembered[`${s.selected}:${skillId}`] ??
          (SKILLS[skillId!].target === 'enemy' ? `enemy:${s.target}` : undefined))
        : page === 'weapon'
          ? String(projectedSlot(s.allies[s.selected]))
          : page === 'tactics' && ui.tactics === 'optima'
            ? String(s.activePreset)
            : undefined) ??
    list[0]?.key ??
    '';
  if (!list.some((c) => c.key === next.key)) next.key = list[0]?.key ?? '';
  return next;
}
export function confirmChoice(
  s: State,
  ui: BattlePad,
  key = ui.key,
): { ui: BattlePad; commands: Command[] } {
  const list = choices(s, ui),
    choice = list.find((c) => c.key === key);
  const feedback = (message: string, next = ui) => ({
    ui: { ...next, message, stamp: ui.stamp + 1 },
    commands: [] as Command[],
  });
  if (!choice)
    return feedback('状態が変わりました。選び直してください。', { ...ui, key: list[0]?.key ?? '' });
  if (choice.command.type === 'enqueue') {
    const reason = unavailable(s, ui.skillId ?? undefined);
    if (reason) return feedback(reason);
  }
  let next = { ...ui, key };
  if (ui.page === 'target')
    next.remembered = { ...ui.remembered, [`${s.selected}:${ui.skillId}`]: key };
  else if (ui.page === 'queue')
    next.key =
      list[Math.min(list.findIndex((c) => c.key === key) + 1, list.length - 1)]?.key === key
        ? (list.at(-2)?.key ?? '')
        : list[list.findIndex((c) => c.key === key) + 1].key;
  else next = home(ui);
  const commands: Command[] = [choice.command];
  if (choice.command.type === 'optima' && s.config.uiMode === 'linked')
    s.presets[choice.command.index].rows.forEach((row, id) =>
      commands.push({ type: 'move', row, id }),
    );
  const message =
    ui.page === 'queue'
      ? '予約を取り消しました。'
      : choice.command.type === 'enqueue'
        ? `${choice.command.step.kind === 'skill' ? SKILLS[choice.command.step.skillId].name : choice.title}を${planned(s.allies[s.selected]).length + 1}手目に追加`
        : `${choice.title}へ切り替えました。`;
  return { ui: { ...next, message, stamp: ui.stamp + 1 }, commands };
}
/** Battle navigation is state based; it never searches unrelated DOM controls. */
export function battleInput(
  s: State,
  ui: BattlePad,
  action: PadAction,
): { ui: BattlePad; commands: Command[] } {
  const result = (next = ui, commands: Command[] = []) => ({ ui: next, commands });
  if (s.phase !== 'battle' || s.paused) return result();
  if (action === 'previous' || action === 'next') {
    const ids = s.allies.filter((a) => a.hp > 0).map((a) => a.id),
      i = ids.indexOf(s.pendingSelect ?? s.selected);
    return ids.length
      ? result(home(ui), [
          { type: 'select', id: ids[(i + (action === 'next' ? 1 : ids.length - 1)) % ids.length] },
        ])
      : result();
  }
  if (action === 'queue') return result(ui.page === 'queue' ? home(ui) : openPage(s, ui, 'queue'));
  if (action === 'pause') return result(ui, [{ type: 'pause', value: true }]);
  if (action === 'slow' || action === 'stop')
    return result(ui, [{ type: 'time', mode: s.timeMode === action ? 'normal' : action }]);
  if (action === 'log')
    return result(ui.page === 'log' ? home(ui) : { ...openPage(s, ui, 'log'), logOffset: 0 });
  if (ui.page === 'command') {
    const w = WEAPONS[s.allies[s.selected].weapons[projectedSlot(s.allies[s.selected])]];
    if (action === 'left') {
      const reason = unavailable(s);
      const row = projectedRow(s.allies[s.selected]) === 'front' ? 'back' : 'front';
      return result(
        { ...ui, message: reason || `${ROW_NAMES[row]}への移動を末尾に追加`, stamp: ui.stamp + 1 },
        reason ? [] : [{ type: 'toggleRow', id: s.selected }],
      );
    }
    if (action === 'cancel') {
      const first = planned(s.allies[s.selected])[0];
      return result(
        {
          ...ui,
          message: first ? '先頭の予約を取り消しました。' : '取り消す予約はありません。',
          stamp: ui.stamp + 1,
        },
        first ? [{ type: 'cancelFirst', id: s.selected }] : [],
      );
    }
    if (action === 'right') {
      const reason = unavailable(s),
        a = s.allies[s.selected],
        w = WEAPONS[a.weapons[projectedSlot(a) === 0 ? 1 : 0]];
      return result(
        {
          ...ui,
          message: reason || `${w.archetype}〈${w.role}〉への変更を末尾に追加`,
          stamp: ui.stamp + 1,
        },
        reason ? [] : [{ type: 'toggleWeapon', id: s.selected }],
      );
    }
    const pages = { up: 'tactics' } as const;
    if (action in pages) return result(openPage(s, ui, pages[action as keyof typeof pages]));
    const id =
      action === 'confirm'
        ? w.skills[0]
        : action === 'skill'
          ? w.skills[1]
          : action === 'item'
            ? 'potion'
            : action === 'down'
              ? 'guard'
              : null;
    if (!id) return result();
    const reason = unavailable(s, id);
    if (reason) return result({ ...ui, message: reason, stamp: ui.stamp + 1 });
    if (id === 'guard')
      return result(
        {
          ...ui,
          message: `防御を${planned(s.allies[s.selected]).length + 1}手目に追加`,
          stamp: ui.stamp + 1,
        },
        [
          {
            type: 'enqueue',
            id: s.selected,
            step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: s.selected } },
          },
        ],
      );
    return result(openPage(s, ui, 'target', id));
  }
  if (action === 'cancel') return result(home(ui));
  if (ui.page === 'log') {
    if (action === 'up' || action === 'down')
      return result({ ...ui, logOffset: Math.max(0, ui.logOffset + (action === 'up' ? 1 : -1)) });
    if (action === 'confirm') return result({ ...ui, logOffset: 0 });
    return result();
  }
  if (ui.page === 'queue' && action === 'item')
    return result(
      { ...ui, key: '', message: '未実行の予約をすべて取り消しました。', stamp: ui.stamp + 1 },
      [{ type: 'cancel', id: s.selected }],
    );
  if (ui.page === 'tactics' && (action === 'left' || action === 'right'))
    return result(
      openPage(s, { ...ui, tactics: ui.tactics === 'optima' ? 'formation' : 'optima' }, 'tactics'),
    );
  if (['up', 'down', 'left', 'right'].includes(action)) {
    const list = choices(s, ui),
      i = Math.max(
        0,
        list.findIndex((c) => c.key === ui.key),
      );
    const delta = action === 'up' || action === 'left' ? -1 : 1;
    return result({
      ...ui,
      key: list[(i + delta + list.length) % list.length]?.key ?? '',
      message: '',
    });
  }
  if (action === 'confirm') return confirmChoice(s, ui);
  return result();
}
