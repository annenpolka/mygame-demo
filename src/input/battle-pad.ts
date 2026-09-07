import { partyBonus, bonusText } from '../sim/bonuses';
import { SKILLS, WEAPONS, ROW_NAMES } from '../content/data';
import {
  canAppend,
  canExecuteSequence,
  committed,
  planned,
  projectedSlot,
  projectedRow,
  pendingPotions,
  stepName,
} from '../sim/plan';
import type { Command, State, Target } from '../sim/types';
import type { PadAction } from './gamepad';

export type BattleAction =
  | PadAction
  | 'potion'
  | 'itemMenu'
  | 'optimaMenu'
  | 'formationMenu'
  | 'move'
  | 'weapon'
  | 'toggleRow'
  | 'toggleWeapon'
  | 'log';
export interface QueueFocus {
  key: string;
  actorId: number;
  index: number;
  title: string;
  status: 'selected' | 'removed' | 'gone';
}
export type BattlePage =
  'command' | 'target' | 'move' | 'weapon' | 'tactics' | 'queue' | 'log' | 'aux';
export interface BattlePad {
  page: BattlePage;
  key: string;
  skillId: string | null;
  tactics: 'optima' | 'formation' | 'items';
  queueFocus?: QueueFocus;
  candidates?: Record<string, Target>;
  candidateSide?: 'enemy' | 'ally';
  candidateWeapon?: string;
  remembered: Record<string, string>;
  message: string;
  stamp: number;
  logOffset: number;
}
export interface BattleChoice {
  key: string;
  title: string;
  detail: string;
  command?: Command;
  action?: BattleAction;
  skillId?: string;
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
export const home = (ui: BattlePad): BattlePad => {
  const { queueFocus: _focus, ...rest } = ui;
  return { ...rest, page: 'command', key: '', skillId: null };
};
function focusQueue(s: State, ui: BattlePad, key: string): BattlePad {
  const list = planned(s.allies[s.selected]),
    index = list.findIndex((p) => String(p.key) === key);
  if (index < 0) return ui;
  return {
    ...ui,
    key,
    queueFocus: {
      key,
      actorId: s.selected,
      index,
      title: stepName(s.allies[s.selected], list[index]),
      status: 'selected',
    },
  };
}

export interface PaletteCursor {
  side: 'enemy' | 'ally';
  target: Target;
}
export function paletteCursor(s: State, ui: BattlePad): PaletteCursor {
  const a = s.allies[s.selected],
    weapon = a.weapons[projectedSlot(a)];
  const side =
    ui.candidateWeapon === weapon && ui.candidateSide
      ? ui.candidateSide
      : SKILLS[WEAPONS[weapon].skills[0]].target.startsWith('enemy')
        ? 'enemy'
        : 'ally';
  return {
    side,
    target: ui.candidates?.[`${a.id}:${side}`] ?? {
      kind: side,
      id: side === 'ally' ? a.id : (s.enemies.find((e) => e.hp > 0)?.id ?? 0),
    },
  };
}
export function selectCandidate(
  s: State,
  ui: BattlePad,
  side: 'enemy' | 'ally',
  target: Target,
): BattlePad {
  if (target.kind !== 'row' && target.kind !== side) return ui;
  return {
    ...ui,
    candidateSide: side,
    candidateWeapon: s.allies[s.selected].weapons[projectedSlot(s.allies[s.selected])],
    candidates: { ...ui.candidates, [`${s.selected}:${side}`]: { ...target } },
  };
}
export function skillPreview(
  s: State,
  ui: BattlePad,
  id: string,
): { target: Target | null; label: string } {
  const skill = SKILLS[id],
    cursor = paletteCursor(s, ui);
  if (skill.target === 'self') return { target: { kind: 'ally', id: s.selected }, label: '自分' };
  const side = skill.target.startsWith('enemy') ? 'enemy' : 'ally';
  if (cursor.side !== side)
    return { target: null, label: `${side === 'enemy' ? '敵' : '味方'}の対象候補を選ぶ` };
  const units = side === 'enemy' ? s.enemies : s.allies;
  const selected = cursor.target;
  const unit =
    selected.kind === 'row' ? undefined : units.find((x) => x.id === selected.id && x.hp > 0);
  if (cursor.target.kind !== 'row' && !unit)
    return { target: null, label: '対象が不在・候補を選び直す' };
  if (skill.target.endsWith('Row')) {
    const row = cursor.target.kind === 'row' ? cursor.target.row : unit!.row;
    return {
      target: { kind: 'row', row },
      label: `${side === 'enemy' ? '敵' : '味方'}${ROW_NAMES[row]}・${units.filter((x) => x.hp > 0 && x.row === row).length}体`,
    };
  }
  return unit
    ? { target: { kind: side, id: unit.id }, label: unit.name }
    : { target: null, label: '単体の対象候補を選ぶ' };
}
function addPaletteSkill(s: State, ui: BattlePad, id: string) {
  const preview = skillPreview(s, ui, id),
    reason = unavailable(s, id) || (!preview.target ? preview.label : '');
  return {
    ui: {
      ...home(ui),
      message: reason || `${SKILLS[id].name} → ${preview.label}を下書きに追加`,
      stamp: ui.stamp + 1,
    },
    commands: reason
      ? []
      : [
          {
            type: 'draft',
            id: s.selected,
            step: { kind: 'skill', skillId: id, target: preview.target! },
          } as Command,
        ],
  };
}

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
        command: { type: 'draft', id: a.id, step: { kind: 'skill', skillId: skill.id, target } },
      };
    });
  }
  if (ui.page === 'aux')
    return [
      { key: 'move', title: '前後移動', detail: '移動先を選び、下書きへ追加', action: 'move' },
      { key: 'weapon', title: '武器変更', detail: '変更先を選び、下書きへ追加', action: 'weapon' },
      {
        key: 'potion',
        title: '救急薬',
        detail: `残${Math.max(0, s.potions - pendingPotions(s.allies))}個・味方を選ぶ`,
        skillId: 'potion',
      },
      { key: 'tactics', title: '全体指示', detail: 'オプティマ・一括隊列', action: 'tactics' },
      {
        key: 'slow',
        title: 'スロー',
        detail: '通常速度と切り替え',
        command: { type: 'time', mode: s.timeMode === 'slow' ? 'normal' : 'slow' },
      },
      {
        key: 'stop',
        title: '戦術停止',
        detail: '通常速度と切り替え',
        command: { type: 'time', mode: s.timeMode === 'stop' ? 'normal' : 'stop' },
      },
      { key: 'log', title: '戦闘ログ', detail: '記録を読む', action: 'log' },
    ];
  if (ui.page === 'move')
    return (['back', 'front'] as const).map((row) => ({
      key: row,
      title: `${ROW_NAMES[row]}へ移動`,
      detail: `${s.config.moveTime}秒 · 予約の末尾に追加`,
      command: { type: 'draft', id: a.id, step: { kind: 'move', row } },
    }));
  if (ui.page === 'weapon')
    return a.weapons.map((id, slot) => ({
      key: String(slot),
      title: WEAPONS[id].name,
      detail: `${WEAPONS[id].role} · ${WEAPONS[id].archetype} · ${s.config.shiftTime}秒`,
      command: { type: 'draft', id: a.id, step: { kind: 'weapon', slot: slot as 0 | 1 } },
    }));
  if (ui.page === 'tactics')
    return ui.tactics === 'items'
      ? [
          {
            key: 'potion',
            title: '救急薬',
            detail: `味方一人を回復 · 残${Math.max(0, s.potions - pendingPotions(s.allies))}個 · 対象を選ぶ`,
            skillId: 'potion',
          },
        ]
      : ui.tactics === 'optima'
        ? s.presets.map((p, i) => ({
            key: String(i),
            title: p.name,
            detail:
              p.slots
                .map(
                  (slot, id) => `${s.allies[id].name} ${WEAPONS[s.allies[id].weapons[slot]].role}`,
                )
                .join(' / ') +
              ' · ' +
              bonusText(
                partyBonus(
                  s.allies.map((a, id) => ({ ...a, slot: p.slots[id] })),
                  s.config.bonusMode,
                ),
              ),
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
  return items.find((c) => c.key === ui.key) ?? (ui.page === 'queue' ? undefined : items[0]);
}
export function unavailable(s: State, skillId?: string) {
  if (s.pendingSelect !== null)
    return '交代を予約中です。予約一覧の一件取消、または後続取消で解除できます。';
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
  const next = { ...home(ui), page, skillId, key: '', message: '', stamp: ui.stamp + 1 };
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
  return page === 'queue' ? focusQueue(s, next, next.key) : next;
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
  if (ui.page === 'queue') {
    const focus = ui.queueFocus;
    if (key === ui.key && focus && (focus.actorId !== s.selected || focus.status !== 'selected'))
      return { ui, commands: [] };
    if (!choice)
      return {
        ui: {
          ...ui,
          key,
          queueFocus: {
            key,
            actorId: s.selected,
            index: focus?.index ?? 0,
            title: focus?.title ?? '予約',
            status: 'gone',
          },
          message: 'この予約は実行・取消済みです。方向入力で選び直してください。',
          stamp: ui.stamp + 1,
        },
        commands: [],
      };
  }
  if (!choice)
    return feedback('状態が変わりました。選び直してください。', { ...ui, key: list[0]?.key ?? '' });
  if (choice.action) return battleInput(s, ui, choice.action);
  if (choice.skillId) {
    const reason = unavailable(s, choice.skillId);
    return reason
      ? feedback(reason)
      : { ui: openPage(s, ui, 'target', choice.skillId), commands: [] };
  }
  if (!choice.command) return { ui, commands: [] };
  if (choice.command.type === 'draft') {
    const reason = unavailable(s, ui.skillId ?? undefined);
    if (reason) return feedback(reason);
  }
  let next = { ...ui, key };
  if (ui.page === 'target')
    next.remembered = { ...ui.remembered, [`${s.selected}:${ui.skillId}`]: key };
  else if (ui.page === 'queue') {
    next = focusQueue(s, next, key);
    next.queueFocus = { ...next.queueFocus!, status: 'removed' };
  } else next = home(ui);
  const commands: Command[] = [choice.command];
  if (choice.command.type === 'optima' && s.config.uiMode === 'linked')
    s.presets[choice.command.index].rows.forEach((row, id) =>
      commands.push({ type: 'move', row, id }),
    );
  const message =
    ui.page === 'queue'
      ? '一件取消済み。方向入力で次に取り消す予約を選んでください。'
      : choice.command.type === 'draft'
        ? `${choice.command.step.kind === 'skill' ? SKILLS[choice.command.step.skillId].name : choice.title}を${planned(s.allies[s.selected]).length + 1}手目に追加`
        : `${choice.title}へ切り替えました。`;
  return { ui: { ...next, message, stamp: ui.stamp + 1 }, commands };
}
/** Battle navigation is state based; it never searches unrelated DOM controls. */
export function battleInput(
  s: State,
  ui: BattlePad,
  action: BattleAction,
): { ui: BattlePad; commands: Command[] } {
  const result = (next = ui, commands: Command[] = []) => ({ ui: next, commands });
  if (s.phase !== 'battle' || s.paused) return result();
  if (action === 'back') return result(ui.page === 'command' ? ui : home(ui));
  if (action === 'cutQueue') {
    const hasQueue = committed(s.allies[s.selected]).length > 0;
    return result(
      hasQueue
        ? {
            ...home(ui),
            message: '後続取消：現在の一手と終了硬直は続きます。',
            stamp: ui.stamp + 1,
          }
        : home(ui),
      hasQueue ? [{ type: 'cancel', id: s.selected }] : [],
    );
  }
  if (action === 'toggleRow' || action === 'toggleWeapon') {
    const a = s.allies[s.selected],
      reason = unavailable(s);
    return result(
      { ...home(ui), message: reason, stamp: ui.stamp + 1 },
      reason
        ? []
        : [
            {
              type: 'draft',
              id: a.id,
              step:
                action === 'toggleRow'
                  ? { kind: 'move', row: projectedRow(a) === 'front' ? 'back' : 'front' }
                  : { kind: 'weapon', slot: projectedSlot(a) === 0 ? 1 : 0 },
            },
          ],
    );
  }
  if (action === 'execute') {
    const a = s.allies[s.selected];
    if (!canExecuteSequence(a) || s.pendingSelect !== null) return result();
    return result(
      {
        ...home(ui),
        message: '見えていた下書きの一組を実行確定。必要ATBと現在の一手の終了を待ちます。',
        stamp: ui.stamp + 1,
      },
      [{ type: 'executeSequence', id: a.id }],
    );
  }
  if (action === 'menu') return result(openPage(s, ui, 'aux'));
  if (['aux', 'move', 'weapon', 'tactics'].includes(action))
    return result(openPage(s, ui, action as BattlePage));
  if (action === 'itemMenu' || action === 'optimaMenu' || action === 'formationMenu')
    return result(
      openPage(
        s,
        {
          ...ui,
          tactics:
            action === 'itemMenu' ? 'items' : action === 'optimaMenu' ? 'optima' : 'formation',
        },
        'tactics',
      ),
    );
  if (action === 'guard') return addPaletteSkill(s, ui, 'guard');
  if (action === 'potion') return result(openPage(s, ui, 'target', 'potion'));
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
    if (action === 'confirm' || action === 'skill')
      return addPaletteSkill(s, ui, w.skills[action === 'confirm' ? 0 : 1]);
    if (['up', 'down', 'left', 'right'].includes(action)) {
      const cursor = paletteCursor(s, ui);
      const side =
        action === 'up' || action === 'down'
          ? cursor.side === 'enemy'
            ? 'ally'
            : 'enemy'
          : cursor.side;
      const units = side === 'enemy' ? s.enemies : s.allies;
      const candidates: Target[] = [
        ...units.filter((x) => x.hp > 0).map((x) => ({ kind: side, id: x.id })),
        { kind: 'row', row: 'front' },
        { kind: 'row', row: 'back' },
      ];
      const remembered = ui.candidates?.[`${s.selected}:${side}`];
      const current = candidates.findIndex((t) => targetKey(t) === targetKey(cursor.target));
      const target =
        side !== cursor.side
          ? (remembered ?? candidates[0])
          : candidates[
              (current + (action === 'left' ? candidates.length - 1 : 1)) % candidates.length
            ];
      return result(selectCandidate(s, ui, side, target));
    }
    return result();
  }
  if (ui.page === 'log') {
    if (action === 'up' || action === 'down')
      return result({ ...ui, logOffset: Math.max(0, ui.logOffset + (action === 'up' ? 1 : -1)) });
    if (action === 'confirm') return result({ ...ui, logOffset: 0 });
    return result();
  }
  if (ui.page === 'tactics' && (action === 'left' || action === 'right')) {
    const tabs = ['optima', 'formation', 'items'] as const;
    return result(
      openPage(
        s,
        { ...ui, tactics: tabs[(tabs.indexOf(ui.tactics) + (action === 'right' ? 1 : 2)) % 3] },
        'tactics',
      ),
    );
  }
  if (['up', 'down', 'left', 'right'].includes(action)) {
    const list = choices(s, ui);
    if (!list.length) return result();
    const i = list.findIndex((c) => c.key === ui.key);
    const delta = action === 'up' || action === 'left' ? -1 : 1;
    const nextIndex = i >= 0 ? i + delta : (ui.queueFocus?.index ?? 0) + (delta < 0 ? -1 : 0);
    const key = list[(nextIndex + list.length) % list.length].key;
    const next = { ...ui, key, message: '' };
    return result(ui.page === 'queue' ? focusQueue(s, next, key) : next);
  }
  if (action === 'confirm') return confirmChoice(s, ui);
  return result();
}
