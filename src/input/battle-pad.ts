import { spatialTarget, type Direction } from './field-navigation';
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
  | 'inputConflict'
  | 'auxPanel'
  | 'basic'
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
export type BattlePanel = 'aux' | 'move' | 'weapon' | 'tactics' | 'log';
export type UnitTarget = Exclude<Target, { kind: 'row' }>;
export interface BattlePad {
  page: BattlePage;
  panel?: BattlePanel;
  key: string;
  skillId: string | null;
  tactics: 'optima' | 'formation' | 'items';
  queueFocus?: QueueFocus;
  candidates?: Record<string, UnitTarget>;
  candidateSide?: 'enemy' | 'ally';
  candidateWeapon?: string;
  invalidTargets?: Partial<Record<'enemy' | 'ally', boolean>>;
  targetRecovery?: {
    skillId: string;
    side: 'ally' | 'enemy';
    target: UnitTarget;
    previousSide: 'ally' | 'enemy';
  };
  feedback?: {
    kind: 'added' | 'candidate' | 'blocked' | 'selection';
    skillId?: string;
    target?: Target;
  };
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
export function visiblePanel(ui: BattlePad): BattlePanel {
  return (
    ui.panel ??
    ((['aux', 'move', 'weapon', 'tactics', 'log'] as BattlePage[]).includes(ui.page)
      ? (ui.page as BattlePanel)
      : 'aux')
  );
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
  const { queueFocus: _focus, targetRecovery: _recovery, feedback: _feedback, ...rest } = ui;
  return { ...rest, page: 'command', key: '', skillId: null };
};
/** An issued command does not dismiss the tools or move their navigation cursor. */
const afterDirectCommand = (ui: BattlePad): BattlePad =>
  ui.page === 'target' ? home(ui) : { ...ui, targetRecovery: undefined, feedback: undefined };
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
  target: UnitTarget;
}
/** The party keeps one destination for each side independently of the editing cursor. */
const matchingCandidate = (target: UnitTarget | undefined, side: 'ally' | 'enemy') =>
  target?.kind === side && Number.isInteger(target.id) && target.id >= 0 ? target : undefined;
export function paletteTargets(s: State, ui: BattlePad): Record<'ally' | 'enemy', UnitTarget> {
  const held = (side: 'ally' | 'enemy'): UnitTarget => {
    const units = side === 'ally' ? s.allies : s.enemies;
    const stored =
      matchingCandidate(ui.candidates?.[side], side) ??
      matchingCandidate(ui.candidates?.[`${s.selected}:${side}`], side);
    if (stored && livingTarget(s, stored)) return stored;
    const first = [...units].filter((u) => u.hp > 0).sort((a, b) => a.id - b.id)[0];
    if (!first && stored) return stored;
    return {
      kind: side,
      id:
        !stored && side === 'ally' && s.allies[s.selected].hp > 0
          ? s.selected
          : (first?.id ?? stored?.id ?? 0),
    };
  };
  return { ally: held('ally'), enemy: held('enemy') };
}
const livingTarget = (s: State, target: UnitTarget) =>
  (target.kind === 'ally' ? s.allies : s.enemies).some((u) => u.id === target.id && u.hp > 0);
/** Repair missing destinations at state and input boundaries, preserving the editing side. */
export function syncPaletteTargets(s: State, ui: BattlePad): BattlePad {
  const targets = paletteTargets(s, ui);
  const invalid = {
    ally: !livingTarget(s, targets.ally),
    enemy: !livingTarget(s, targets.enemy),
  };
  if (
    ui.candidates?.ally === targets.ally &&
    ui.candidates?.enemy === targets.enemy &&
    ui.candidateSide &&
    !ui.targetRecovery &&
    invalid.ally === ui.invalidTargets?.ally &&
    invalid.enemy === ui.invalidTargets?.enemy
  )
    return ui;
  return {
    ...ui,
    candidates: targets,
    candidateSide: ui.candidateSide ?? 'enemy',
    invalidTargets: invalid,
    targetRecovery: undefined,
  };
}
export function paletteCursor(s: State, ui: BattlePad): PaletteCursor {
  const side = ui.candidateSide ?? 'enemy';
  return {
    side,
    target:
      ui.targetRecovery?.side === side && ui.targetRecovery.target.kind === side
        ? ui.targetRecovery.target
        : paletteTargets(s, ui)[side],
  };
}
export function selectCandidate(
  s: State,
  ui: BattlePad,
  side: 'enemy' | 'ally',
  target: Target,
): BattlePad {
  if (target.kind === 'row' || target.kind !== side || !livingTarget(s, target)) return ui;
  const next = syncPaletteTargets(s, ui);
  return {
    ...next,
    targetRecovery: undefined,
    candidateSide: side,
    candidates: { ...next.candidates, [side]: { ...target } },
    invalidTargets: { ...next.invalidTargets, [side]: false },
    feedback: { kind: 'selection', target },
    message: '',
    stamp: ui.stamp + 1,
  };
}
function targetPreview(
  s: State,
  id: string,
  selected: UnitTarget,
): { target: Target; label: string } | null {
  const skill = SKILLS[id],
    side = selected.kind,
    units = side === 'enemy' ? s.enemies : s.allies,
    unit = units.find((x) => x.id === selected.id && x.hp > 0);
  if (!unit) return null;
  if (skill.target.endsWith('Row'))
    return {
      target: { kind: 'row', row: unit.row },
      label: `${side === 'enemy' ? '敵' : '味方'}${ROW_NAMES[unit.row]}・${units.filter((x) => x.hp > 0 && x.row === unit.row).length}体`,
    };
  return { target: { kind: side, id: unit.id }, label: unit.name };
}
export function skillPreview(
  s: State,
  ui: BattlePad,
  id: string,
): { target: Target | null; label: string; candidateTarget?: Target } {
  const skill = SKILLS[id];
  if (skill.target === 'self') return { target: { kind: 'ally', id: s.selected }, label: '自分' };
  const side = skill.target.startsWith('enemy') ? 'enemy' : 'ally',
    selected = paletteTargets(s, ui)[side];
  const valid = !ui.invalidTargets?.[side] && targetPreview(s, id, selected);
  if (valid) return valid;
  const recovery =
    ui.targetRecovery?.side === side &&
    ui.targetRecovery.target.kind === side &&
    targetPreview(s, id, ui.targetRecovery.target);
  return recovery
    ? { target: null, label: `候補：${recovery.label}`, candidateTarget: recovery.target }
    : { target: null, label: '対象が不在・候補を選び直す' };
}
function addPaletteSkill(
  s: State,
  ui: BattlePad,
  id: string,
): { ui: BattlePad; commands: Command[] } {
  const reason = unavailable(s, id);
  if (reason)
    return {
      ui: {
        ...afterDirectCommand(ui),
        message: reason,
        feedback: { kind: 'blocked', skillId: id },
        stamp: ui.stamp + 1,
      },
      commands: [],
    };
  const next = syncPaletteTargets(s, ui);
  const preview = skillPreview(s, next, id);
  if (!preview.target) {
    const side = SKILLS[id].target.startsWith('enemy') ? 'enemy' : 'ally';
    return {
      ui: {
        ...afterDirectCommand(next),
        message: `対象にできる${side === 'ally' ? '仲間' : '敵'}がいません。`,
        feedback: { kind: 'blocked', skillId: id },
        stamp: ui.stamp + 1,
      },
      commands: [],
    };
  }
  return {
    ui: {
      ...afterDirectCommand(next),
      message: `${SKILLS[id].name} → ${preview.label}を下書きに追加`,
      feedback: { kind: 'added', skillId: id, target: preview.target },
      stamp: ui.stamp + 1,
    },
    commands: [
      {
        type: 'draft',
        id: s.selected,
        step: { kind: 'skill', skillId: id, target: preview.target },
      },
    ],
  };
}

const targetKey = (t: Target) => (t.kind === 'row' ? `row:${t.row}` : `${t.kind}:${t.id}`);
export function choices(s: State, ui: BattlePad): BattleChoice[] {
  const a = s.allies[s.selected];
  if (ui.page === 'target' && ui.skillId) {
    const skill = SKILLS[ui.skillId];
    if (!skill) return [];
    const side = skill.target.startsWith('enemy') ? 'enemy' : 'ally';
    const units = side === 'enemy' ? s.enemies : s.allies;
    return units
      .filter((x) => x.hp > 0 && (skill.target !== 'self' || x.id === a.id))
      .map((actor) => {
        const target: UnitTarget = { kind: side, id: actor.id };
        return {
          key: targetKey(target),
          target,
          title: actor.name,
          detail:
            `HP ${Math.ceil(actor.hp)} / ${actor.maxHp} · ${ROW_NAMES[actor.row]}` +
            (skill.target.endsWith('Row')
              ? `・${units.filter((x) => x.hp > 0 && x.row === actor.row).length}体へ`
              : ''),
          command: {
            type: 'draft',
            id: a.id,
            step: {
              kind: 'skill',
              skillId: skill.id,
              target: skill.target.endsWith('Row') ? { kind: 'row', row: actor.row } : target,
            },
          },
        };
      });
  }

  if (ui.page === 'aux')
    return [
      { key: 'move', title: '前後移動', detail: '移動先を選び、すぐ移動', action: 'move' },
      { key: 'weapon', title: '武器変更', detail: 'もう一方の武器へ切り替え', action: 'weapon' },
      {
        key: 'potion',
        title: '救急薬',
        detail: `残${Math.max(0, s.potions - pendingPotions(s.allies))}個・支援対象へ追加`,
        skillId: 'potion',
      },
      { key: 'tactics', title: '全体指示', detail: 'オプティマ・一括隊列', action: 'optimaMenu' },
      {
        key: 'slow',
        title: 'スロー',
        detail: '通常速度と切り替え',
        command: { type: 'time', mode: s.timeMode === 'slow' ? 'normal' : 'slow' },
      },
      { key: 'log', title: '戦闘ログ', detail: '記録を読む', action: 'log' },
      {
        key: 'targetAllies',
        title: '味方を対象にする',
        detail: '戦場で支援対象を選ぶ',
        action: 'targetAllies',
      },
      {
        key: 'targetEnemies',
        title: '敵を対象にする',
        detail: '戦場で攻撃対象を選ぶ',
        action: 'targetEnemies',
      },
    ];
  if (ui.page === 'move')
    return (['back', 'front'] as const).map((row) => ({
      key: row,
      title: `${ROW_NAMES[row]}へ移動`,
      detail: `${s.config.moveTime}秒 · すぐ移動`,
      command: { type: 'move', id: a.id, row },
    }));
  if (ui.page === 'weapon')
    return a.weapons.map((id, slot) => ({
      key: String(slot),
      title: WEAPONS[id].name,
      detail: `${WEAPONS[id].role} · ${WEAPONS[id].archetype} · ${s.config.shiftTime}秒`,
      command: { type: 'weapon', id: a.id, slot: slot as 0 | 1 },
    }));
  if (ui.page === 'tactics')
    return ui.tactics === 'items'
      ? [
          {
            key: 'potion',
            title: '救急薬',
            detail: `支援対象へ追加 · 残${Math.max(0, s.potions - pendingPotions(s.allies))}個`,
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
function directUnavailable(s: State) {
  return s.pendingSelect !== null
    ? '交代が完了してから操作してください。'
    : s.allies[s.selected].hp <= 0
      ? '戦闘不能です。仲間を選んでください。'
      : '';
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
  const panel = (['aux', 'move', 'weapon', 'tactics', 'log'] as BattlePage[]).includes(page)
    ? (page as BattlePanel)
    : visiblePanel(ui);
  const next = { ...home(ui), page, panel, skillId, key: '', message: '', stamp: ui.stamp + 1 };
  const list = choices(s, next);
  next.key =
    (page === 'queue'
      ? list.at(-1)?.key
      : page === 'target'
        ? ui.remembered[`${s.selected}:${skillId}`]
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
    if (choice.skillId === 'potion') return addPaletteSkill(s, ui, 'potion');
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
  if (choice.command.type === 'move' || choice.command.type === 'weapon') {
    const reason = directUnavailable(s);
    if (reason) return feedback(reason);
  }
  let next = { ...ui, key };
  if (ui.page === 'target') {
    if (choice.target && choice.target.kind !== 'row')
      next = { ...selectCandidate(s, next, choice.target.kind, choice.target), key };
    next.remembered = { ...ui.remembered, [`${s.selected}:${ui.skillId}`]: key };
    if (choice.command.type === 'draft' && choice.command.step.kind === 'skill')
      next.feedback = {
        kind: 'added',
        skillId: choice.command.step.skillId,
        target: choice.command.step.target,
      };
  } else if (ui.page === 'queue') {
    next = focusQueue(s, next, key);
    next.queueFocus = { ...next.queueFocus!, status: 'removed' };
  }
  const commands: Command[] = [choice.command];
  const message =
    ui.page === 'queue'
      ? '一件取消済み。方向入力で次に取り消す予約を選んでください。'
      : choice.command.type === 'draft'
        ? `${choice.command.step.kind === 'skill' ? SKILLS[choice.command.step.skillId].name : choice.title}を${planned(s.allies[s.selected]).length + 1}手目に追加`
        : `${choice.title}へ切り替えました。`;
  return { ui: { ...next, message, stamp: ui.stamp + 1 }, commands };
}
/** Cancel an explicit row without moving the surrounding control surface. */
export function removeQueueItem(s: State, ui: BattlePad, key: string) {
  const queueUI: BattlePad = {
    ...ui,
    page: 'queue',
    key,
    queueFocus: ui.queueFocus?.key === key ? ui.queueFocus : undefined,
  };
  const result = confirmChoice(s, queueUI, key);
  return {
    ...result,
    ui:
      ui.page === 'queue'
        ? result.ui
        : { ...result.ui, page: ui.page, key: ui.key, panel: ui.panel, skillId: ui.skillId },
  };
}
/** Battle navigation is state based; it never searches unrelated DOM controls. */
export function battleInput(
  s: State,
  ui: BattlePad,
  action: BattleAction,
): { ui: BattlePad; commands: Command[] } {
  const result = (next = ui, commands: Command[] = []) => ({ ui: next, commands });
  if (s.phase !== 'battle' || s.paused) return result();
  ui = syncPaletteTargets(s, ui);
  if (action === 'back')
    return result(
      ui.targetRecovery
        ? {
            ...home(ui),
            candidateSide: ui.targetRecovery.previousSide,
            feedback: undefined,
            message: '',
            stamp: ui.stamp + 1,
          }
        : ui.page === 'command'
          ? ui
          : home(ui),
    );
  if (action === 'inputConflict')
    return result({
      ...afterDirectCommand(ui),
      feedback: { kind: 'blocked' },
      message: '操作先や選択内容が変わりました。技をもう一度押してください。',
      stamp: ui.stamp + 1,
    });
  if (action === 'cutQueue') {
    const hasQueue = committed(s.allies[s.selected]).length > 0;
    return result(
      hasQueue
        ? {
            ...afterDirectCommand(ui),
            message: '後続取消：現在の一手と終了硬直は続きます。',
            stamp: ui.stamp + 1,
          }
        : afterDirectCommand(ui),
      hasQueue ? [{ type: 'cancel', id: s.selected }] : [],
    );
  }
  if (
    action === 'toggleRow' ||
    action === 'rowBack' ||
    action === 'rowFront' ||
    action === 'toggleWeapon' ||
    action === 'weapon'
  ) {
    const a = s.allies[s.selected],
      reason = directUnavailable(s);
    const weapon = action === 'toggleWeapon' || action === 'weapon';
    const row =
      action === 'rowBack'
        ? 'back'
        : action === 'rowFront'
          ? 'front'
          : projectedRow(a) === 'front'
            ? 'back'
            : 'front';
    return result(
      {
        ...afterDirectCommand(ui),
        message:
          reason || (weapon ? '武器変更を指示しました。' : `${ROW_NAMES[row]}へ移動します。`),
        feedback: reason ? { kind: 'blocked' } : undefined,
        stamp: ui.stamp + 1,
      },
      reason
        ? []
        : [
            weapon
              ? { type: 'weapon', id: a.id, slot: projectedSlot(a) === 0 ? 1 : 0 }
              : { type: 'move', id: a.id, row },
          ],
    );
  }
  if (action === 'tactics') {
    if (!s.presets.length)
      return result({
        ...afterDirectCommand(ui),
        message: 'オプティマがありません。',
        feedback: { kind: 'blocked' },
        stamp: ui.stamp + 1,
      });
    const index = (s.activePreset + 1) % s.presets.length;
    return result(
      {
        ...afterDirectCommand(ui),
        message: `${s.presets[index].name}へ切り替えます。`,
        feedback: undefined,
        stamp: ui.stamp + 1,
      },
      [{ type: 'optima', index }],
    );
  }
  if (action === 'execute') {
    const a = s.allies[s.selected];
    if (!canExecuteSequence(a) || s.pendingSelect !== null)
      return result({
        ...(ui.targetRecovery ? home(ui) : ui),
        message:
          s.pendingSelect !== null
            ? '交代が完了してから実行してください。'
            : a.draft?.length
              ? '前の一組が実行を開始してから確定してください。'
              : '実行する下書きがありません。',
        feedback: { kind: 'blocked' },
        stamp: ui.stamp + 1,
      });
    return result(
      {
        ...afterDirectCommand(ui),
        message: '見えていた下書きの一組を実行確定。必要ATBと現在の一手の終了を待ちます。',
        stamp: ui.stamp + 1,
      },
      [{ type: 'executeSequence', id: a.id }],
    );
  }
  if (action === 'menu' || action === 'aux')
    return result(
      openPage(
        s,
        ui,
        ui.page === 'command' ? visiblePanel(ui) : ui.page === 'queue' ? 'command' : 'queue',
      ),
    );
  if (action === 'auxPanel') return result(openPage(s, ui, 'aux'));
  if (action === 'move') return result(openPage(s, ui, 'move'));
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
  if (action === 'potion') return addPaletteSkill(s, ui, 'potion');
  if (action === 'basic' || action === 'skill') {
    const w = WEAPONS[s.allies[s.selected].weapons[projectedSlot(s.allies[s.selected])]];
    return addPaletteSkill(s, ui, w.skills[action === 'basic' ? 0 : 1]);
  }
  if (action === 'targetAllies' || action === 'targetEnemies') {
    const side = action === 'targetAllies' ? 'ally' : 'enemy';
    return result({ ...home(ui), candidateSide: side, feedback: undefined, message: '' });
  }
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
  if (action === 'slow')
    return result(ui, [{ type: 'time', mode: s.timeMode === 'slow' ? 'normal' : 'slow' }]);
  if (action === 'log') return result({ ...openPage(s, ui, 'log'), logOffset: 0 });
  if (ui.page === 'command') {
    const w = WEAPONS[s.allies[s.selected].weapons[projectedSlot(s.allies[s.selected])]];
    if (action === 'confirm') return addPaletteSkill(s, ui, w.skills[0]);
    if (['up', 'down', 'left', 'right'].includes(action)) {
      const cursor = paletteCursor(s, ui);
      const id = spatialTarget(s, cursor.side, cursor.target.id, action as Direction);
      return result(selectCandidate(s, ui, cursor.side, { kind: cursor.side, id }));
    }

    return result();
  }
  if (ui.page === 'target' && ['up', 'down', 'left', 'right'].includes(action)) {
    const list = choices(s, ui),
      current = selectedChoice(s, ui)?.target;
    if (!current || current.kind === 'row') return result();
    const ids = list.flatMap((c) => (c.target && c.target.kind !== 'row' ? [c.target.id] : []));
    const id = spatialTarget(s, current.kind, current.id, action as Direction, ids);
    return result({ ...ui, key: `${current.kind}:${id}`, message: '' });
  }
  if (ui.page !== 'target' && ui.page !== 'queue' && (action === 'left' || action === 'right')) {
    const tabs = [
      { page: 'aux' },
      { page: 'tactics', tactics: 'optima' },
      { page: 'tactics', tactics: 'formation' },
      { page: 'log' },
    ] as const;
    const current = tabs.findIndex(
      (tab) => tab.page === ui.page && (!('tactics' in tab) || tab.tactics === ui.tactics),
    );
    const next =
      tabs[
        ((current < 0 ? 0 : current) + (action === 'right' ? 1 : tabs.length - 1)) % tabs.length
      ];
    return result(
      openPage(s, { ...ui, ...('tactics' in next ? { tactics: next.tactics } : {}) }, next.page),
    );
  }
  if (ui.page === 'log') {
    if (action === 'up' || action === 'down')
      return result({ ...ui, logOffset: Math.max(0, ui.logOffset + (action === 'up' ? 1 : -1)) });
    if (action === 'confirm') return result({ ...ui, logOffset: 0 });
    return result();
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
