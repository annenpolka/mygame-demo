import { chooseTarget } from './targeting';
import {
  advanceExecution,
  charging,
  makeAction,
  validExecutionTarget,
  executionTarget,
  refreshSequences,
} from './execution';
import { COMBAT_RULES } from '../content/rules';
import { partyBonus, positionBonus } from './bonuses';
import { renameTactics } from './tactics';
import {
  canAppend,
  canExecuteSequence,
  plannedCost,
  isHandoff,
  planned,
  projectedSlot,
  pendingPotions,
  stepName,
} from './plan';
import { createEnemies, enemyRecipe, pressure } from '../content/encounters';
import {
  DEFAULT_CONFIG,
  DT,
  FORMATIONS,
  PRESETS,
  ROW_NAMES,
  SKILLS,
  VERSION,
  BATTLE_TIMING,
  WEAPONS,
} from '../content/data';
import type {
  Action,
  Ally,
  BattleEvent,
  Command,
  Config,
  Enemy,
  Row,
  Skill,
  State,
  Target,
} from './types';

export const copy = <T>(value: T): T => structuredClone(value);
export const weaponOf = (ally: Ally) => WEAPONS[ally.weapons[ally.slot]];
const opposite = (row: Row): Row => (row === 'front' ? 'back' : 'front');
export function emit(
  s: State,
  type: BattleEvent['type'],
  text: string,
  extra: Partial<BattleEvent> = {},
) {
  s.events.push({ id: ++s.eventSeq, time: s.time, type, text, ...extra });
  if (s.events.length > 160) s.events.shift();
}
function random(s: State) {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function createState(
  config: Partial<Config> = {},
  controlMode: State['controlMode'] = 'manual',
): State {
  const c = { ...DEFAULT_CONFIG, ...config };
  const state: State = {
    version: VERSION,
    controlMode,
    config: c,
    phase: 'ready',
    paused: false,
    tick: 0,
    time: 0,
    realTime: 0,
    focus: 100,
    timeMode: 'normal',
    rng: c.seed >>> 0,
    encounter: c.encounter,
    selected: 0,
    pendingSelect: null,
    handoffSlow: 0,
    allies: [
      { name: 'アルト', initial: 'A', color: '#ddaa63', weapons: ['sword', 'shield'], maxHp: 1300 },
      { name: 'リネ', initial: 'L', color: '#77bdc2', weapons: ['staff', 'bow'], maxHp: 1100 },
      { name: 'セナ', initial: 'S', color: '#bea4dc', weapons: ['bell', 'hook'], maxHp: 1150 },
    ].map((a, id) => ({
      ...a,
      id,
      hp: a.maxHp,
      atb: 1,
      row: id === 0 ? 'front' : 'back',
      weapons: a.weapons as [string, string],
      slot: 0,
      nextSlot: null,
      nextRow: null,
      shift: 0,
      move: 0,
      action: null,
      queued: null,
      shield: 0,
      executionHeld: false,
      draft: [],
      sequences: [],
    })),
    enemies: createEnemies(c, c.encounter),
    presets: copy(PRESETS),
    formations: copy(FORMATIONS),
    activePreset: 0,
    inventory: ['sword', 'shield', 'staff', 'bow', 'bell', 'hook'],
    potions: 3,
    events: [],
    eventSeq: 0,
    metrics: { damage: 0, taken: 0, healed: 0, breaks: 0, inputs: 0, focusUsed: 0 },
  };
  renameTactics(state);
  return state;
}
function reject(s: State, text: string) {
  emit(s, 'system', text);
  return false;
}
function queueRow(a: Ally, row: Row) {
  // A repeated destination is idempotent. Only an opposite command cancels movement.
  if (a.nextRow === row) return;
  a.nextRow = a.row === row ? null : row;
  a.move = 0;
}
function changeWeapon(s: State, a: Ally, slot: 0 | 1) {
  if (slot !== (a.nextSlot ?? a.slot)) {
    a.nextSlot = slot === a.slot ? null : slot;
    a.shift = 0;
  }
  prunePlan(s, a);
}
export function canUse(a: Ally, id: string) {
  return id === 'guard' || id === 'potion' || weaponOf(a).skills.includes(id);
}
export const validTarget = validExecutionTarget;
export function command(s: State, c: Command): boolean {
  if (c.type === 'pause') {
    s.paused = c.value;
    return true;
  }
  if (s.paused) return false;
  if (c.type === 'control') {
    if (c.mode !== 'manual' && c.mode !== 'ai') return false;
    s.controlMode = c.mode;
    for (const a of s.allies) a.plan = a.plan?.filter((p) => !isHandoff(p));
    s.pendingSelect = null;
    s.handoffSlow = 0;
    emit(
      s,
      'system',
      c.mode === 'ai'
        ? 'AI鑑賞：全員の行動をAIに委ねました。'
        : '手動操作：選択中の仲間は指示を待ちます。',
    );
    return true;
  }
  if (c.type === 'start') {
    if (s.phase !== 'ready') return false;
    for (const a of s.allies) a.slot = s.presets[s.activePreset].slots[a.id];
    s.phase = 'battle';
    emit(
      s,
      'system',
      s.controlMode === 'ai'
        ? '戦闘開始。全員をAIが操作します。'
        : '戦闘開始。選択中の仲間は指示を待ち、ほかの仲間は自動行動します。',
    );
    return true;
  }
  if (c.type === 'labWeapons') {
    if (s.phase !== 'ready' && s.phase !== 'loot') return false;
    s.inventory = Object.keys(WEAPONS);
    emit(s, 'system', '検証用に全武器を使用可能にしました。');
    return true;
  }
  if (s.phase === 'ready') {
    if (c.type === 'formation' && s.formations[c.index]) {
      for (const a of s.allies) a.row = s.formations[c.index].rows[a.id];
      return true;
    }
    if (c.type === 'move' && s.allies[c.id]) {
      s.allies[c.id].row = c.row;
      return true;
    }
    if (c.type === 'optima' && s.presets[c.index]) {
      s.activePreset = c.index;
      for (const a of s.allies) a.slot = s.presets[c.index].slots[a.id];
      return true;
    }
  }
  if (['equip', 'editPreset', 'editPresetRow', 'editFormation'].includes(c.type)) {
    if (s.phase !== 'loot' && s.phase !== 'ready')
      return reject(s, '編成は戦闘の合間に変更できます。');
    if (c.type === 'equip') {
      const a = s.allies[c.id];
      if (
        !a ||
        !WEAPONS[c.weaponId] ||
        !s.inventory.includes(c.weaponId) ||
        (c.slot !== 0 && c.slot !== 1)
      )
        return false;
      const used = s.allies.some((other) =>
        other.weapons.some((w, slot) => w === c.weaponId && (other.id !== c.id || slot !== c.slot)),
      );
      if (used) return reject(s, 'その武器はほかの持ち込み枠で使用中です。先に外してください。');
      a.weapons[c.slot] = c.weaponId;
      renameTactics(s);
      return true;
    }
    if (
      c.type === 'editPreset' &&
      s.presets[c.index] &&
      s.allies[c.id] &&
      (c.slot === 0 || c.slot === 1)
    ) {
      s.presets[c.index].slots[c.id] = c.slot;
      renameTactics(s);
      return true;
    }
    if (c.type === 'editPresetRow' && s.presets[c.index] && s.allies[c.id]) {
      s.presets[c.index].rows[c.id] = c.row;
      return true;
    }
    if (c.type === 'editFormation' && s.formations[c.index] && s.allies[c.id]) {
      s.formations[c.index].rows[c.id] = c.row;
      renameTactics(s);
      return true;
    }
    return false;
  }
  if (c.type === 'next') {
    if (s.phase !== 'loot') return false;
    s.encounter = 2;
    s.pendingSelect = null;
    s.handoffSlow = 0;
    s.enemies = createEnemies(s.config, 2);
    s.focus = 100;
    s.timeMode = 'normal';
    s.phase = 'battle';
    for (const a of s.allies) {
      a.hp = a.maxHp;
      a.atb = 1;
      a.executionHeld = false;
      a.shield = 0;
      a.action = null;
      a.queued = null;
      if (a.plan) a.plan = [];
      a.draft = [];
      a.sequences = [];
      a.nextRow = null;
      a.nextSlot = null;
      a.move = 0;
      a.shift = 0;
      a.slot = s.presets[s.activePreset].slots[a.id];
    }
    emit(s, 'system', '第二戦へ。HPと集中力が全回復しました。');
    return true;
  }
  if (s.phase !== 'battle') return false;
  if (c.type === 'enqueue' && isHandoff(c.step)) {
    if (c.id !== s.selected || c.step.kind !== 'skill' || c.step.target.kind !== 'ally')
      return false;
    return command(s, { type: 'select', id: c.step.target.id });
  }
  if (c.type === 'toggleWeapon') {
    const a = s.allies[c.id];
    if (!a || a.hp <= 0) return false;
    return command(s, {
      type: 'weapon',
      id: c.id,
      slot: (a.nextSlot ?? a.slot) === 0 ? 1 : 0,
    });
  }
  if (c.type === 'toggleRow') {
    const a = s.allies[c.id];
    if (!a || a.hp <= 0) return false;
    return command(s, {
      type: 'move',
      id: c.id,
      row: opposite(a.nextRow ?? a.row),
    });
  } else if (c.type === 'cancelFirst') {
    const a = s.allies[c.id],
      first = a && planned(a)[0];
    if (!a || a.hp <= 0 || !first) return false;
    return command(s, { type: 'removePlan', id: c.id, key: first.key });
  }
  s.metrics.inputs++;
  switch (c.type) {
    case 'select': {
      if (!s.allies[c.id] || s.allies[c.id].hp <= 0) return false;
      if (s.controlMode === 'ai') {
        s.selected = c.id;
        return true;
      }
      const a = s.allies[s.selected];
      if (a.action?.skillId === 'handoff') return reject(s, '交代を実行中です。');
      a.plan ??= [];
      a.plan = a.plan.filter((p) => !isHandoff(p));
      s.pendingSelect = c.id === s.selected ? null : c.id;
      if (c.id === s.selected) {
        emit(s, 'system', 'キャラ交代の予約を取消');
        return true;
      }
      a.executionHeld = false;
      s.planSeq ??= 0;
      if (a.queued) {
        a.plan.unshift({ key: ++s.planSeq, kind: 'skill', ...a.queued });
        a.queued = null;
      }
      a.plan.unshift({
        key: ++s.planSeq,
        kind: 'skill',
        skillId: 'handoff',
        target: { kind: 'ally', id: c.id },
      });
      emit(s, 'system', `${s.allies[c.id].name}へ交代予約：1 ATB・先頭優先。開始時に後続を解除`);
      return true;
    }
    case 'time': {
      if (c.mode !== 'normal' && c.mode !== 'slow') return false;
      if (c.mode !== 'normal' && s.timeMode === 'normal') {
        if (s.focus <= COMBAT_RULES.focusActivation)
          return reject(s, '集中力が足りません。通常速度で続行します。');
        s.focus -= COMBAT_RULES.focusActivation;
        s.metrics.focusUsed += COMBAT_RULES.focusActivation;
      }
      s.timeMode = c.mode;
      return true;
    }
    case 'move': {
      const a = s.allies[c.id];
      if (!a || a.hp <= 0 || (c.row !== 'front' && c.row !== 'back')) return false;
      queueRow(a, c.row);
      emit(s, 'system', `${a.name}：${ROW_NAMES[c.row]}へ移動指示`);
      return true;
    }
    case 'weapon': {
      const a = s.allies[c.id];
      if (!a || a.hp <= 0 || (c.slot !== 0 && c.slot !== 1)) return false;
      changeWeapon(s, a, c.slot);
      emit(s, 'system', `${a.name}：${WEAPONS[a.weapons[c.slot]].name}へ武器変更指示`);
      return true;
    }
    case 'formation': {
      const formation = s.formations[c.index];
      if (!formation) return false;
      for (const a of s.allies) if (a.hp > 0) queueRow(a, formation.rows[a.id]);
      emit(s, 'system', `隊列指示：${formation.name}`);
      return true;
    }
    case 'optima': {
      const preset = s.presets[c.index];
      if (!preset) return false;
      s.activePreset = c.index;
      for (const a of s.allies) {
        if (a.hp <= 0) continue;
        changeWeapon(s, a, preset.slots[a.id]);
      }
      emit(s, 'shift', `オプティマ：${preset.name}`);
      return true;
    }
    case 'skill': {
      const a = s.allies[c.id],
        skill = SKILLS[c.skillId];
      if (c.id === s.selected && s.pendingSelect !== null)
        return reject(s, '交代予約を先に取り消してください。');
      if (!a || a.hp <= 0 || !skill || !canUse(a, c.skillId))
        return reject(s, '現在の武器では使えない技です。');
      if (
        a.nextSlot !== null &&
        !['guard', 'potion', ...WEAPONS[a.weapons[a.nextSlot]].skills].includes(c.skillId)
      )
        return reject(s, '武器変更後には使えない技です。');
      if (!validTarget(s, a, skill, c.target)) return reject(s, '対象を選び直してください。');
      if (skill.effect === 'potion' && s.potions < 1) return reject(s, '救急薬を使い切りました。');
      if (skill.cost > s.config.atbMax) return reject(s, '最大ATBを超える技です。');
      if (a.plan) a.plan = [];
      refreshSequences(a);
      a.queued = { skillId: c.skillId, target: copy(c.target) };
      emit(s, 'system', `${a.name}：「${skill.name}」を予約`);
      return true;
    }
    case 'draft':
    case 'enqueue': {
      const a = s.allies[c.id],
        p = c.step;
      if (!a || a.hp <= 0) return false;
      if (!canAppend(a, s.config, p.kind === 'skill' ? (SKILLS[p.skillId]?.cost ?? Infinity) : 0))
        return reject(s, `先行入力は合計${s.config.atbMax} ATB・${s.config.atbMax}手までです。`);
      if (p.kind === 'skill') {
        const sk = SKILLS[p.skillId],
          w = WEAPONS[a.weapons[projectedSlot(c.type === 'draft' ? a : { ...a, draft: [] })]];
        if (!sk || !['guard', 'potion', ...w.skills].includes(p.skillId))
          return reject(s, 'その順序では使えない技です。先に武器変更を積んでください。');
        if (!validTarget(s, a, sk, p.target)) return reject(s, '対象を選び直してください。');
        if (p.skillId === 'potion' && pendingPotions(s.allies) >= s.potions)
          return reject(s, '残りの救急薬はすべて予約されています。');
      } else if (p.kind === 'weapon' && p.slot !== 0 && p.slot !== 1) return false;
      else if (p.kind === 'move' && p.row !== 'front' && p.row !== 'back') return false;
      s.planSeq ??= 0;
      a.plan ??= [];
      if (a.queued) {
        a.plan.unshift({ key: ++s.planSeq, kind: 'skill', ...a.queued });
        a.queued = null;
      }
      const destination = c.type === 'draft' ? (a.draft ??= []) : a.plan;
      destination.push({ ...copy(p), key: ++s.planSeq });
      emit(
        s,
        'system',
        `${a.name}：${c.type === 'draft' ? '下書き' : '確定予約'}${destination.length}手目に「${stepName(a, p)}」を追加`,
        {
          source: `a${a.id}`,
        },
      );
      return true;
    }
    case 'removePlan': {
      const a = s.allies[c.id];
      if (!a) return false;
      if (c.key === 0 && a.queued) {
        emit(s, 'system', `${a.name}：「${SKILLS[a.queued.skillId].name}」の予約を取消`);
        a.queued = null;
        return true;
      }
      const p = planned(a).find((p) => p.key === c.key);
      if (!p) return false;
      a.plan = a.plan?.filter((p) => p.key !== c.key);
      a.draft = a.draft?.filter((p) => p.key !== c.key);
      if (isHandoff(p)) s.pendingSelect = null;
      emit(s, 'system', `${a.name}：「${stepName(a, p)}」の予約を取消`);
      prunePlan(s, a);
      refreshSequences(a);
      return true;
    }
    case 'executeSequence': {
      const a = s.allies[c.id];
      if (!a || !canExecuteSequence(a) || (c.id === s.selected && s.pendingSelect !== null))
        return false;
      const key = (s.planSeq = (s.planSeq ?? 0) + 1);
      a.sequences ??= [];
      a.sequences.push({ key, started: false });
      a.plan ??= [];
      a.plan.push(...a.draft!.map((p) => ({ ...p, sequenceId: key })));
      const cost = plannedCost({ queued: null, plan: a.draft });
      emit(s, 'system', `${a.name}：下書き${a.draft!.length}手を確定（${cost} ATBで開始）`);
      a.draft = [];
      a.executionHeld = false;
      return true;
    }
    case 'hold': {
      const a = s.allies[c.id];
      if (!a || a.hp <= 0) return false;
      a.executionHeld = c.value;
      emit(
        s,
        'system',
        `${a.name}：${c.value ? '実行保留（現在の一手で止める）' : '保留解除・実行再開'}`,
      );
      return true;
    }
    case 'cancel': {
      if (!s.allies[c.id]) return false;
      if (c.id === s.selected && s.allies[c.id].action?.skillId !== 'handoff')
        s.pendingSelect = null;
      const a = s.allies[c.id];
      a.queued = null;
      if (s.allies[c.id].plan) s.allies[c.id].plan = [];
      refreshSequences(a);
      emit(s, 'system', `${a.name}：残りを打ち切り（現在の行動・終了硬直は継続）`);
      return true;
    }
  }
  return false;
}

function beginAction(s: State, a: Ally, skillId: string, target: Target, comboIndex = 1) {
  const skill = SKILLS[skillId];
  if (a.atb + 1e-9 < skill.cost || !validTarget(s, a, skill, target)) return false;
  if (skill.effect === 'potion') {
    if (s.potions <= 0) {
      emit(s, 'system', `${a.name}：救急薬がないため予約を解除`);
      return false;
    }
    s.potions--;
  }
  a.atb = Math.max(0, a.atb - skill.cost);
  const bonus = partyBonus(s.allies, s.config.bonusMode),
    position = positionBonus(a.row, weaponOf(a));
  a.action = {
    ...makeAction(a, skillId, target, comboIndex),
    offense: { damage: bonus.damage * position.damage, chain: bonus.chain * position.chain },
  };
  emit(s, 'action', `${a.name} → ${skill.name}`, {
    source: `a${a.id}`,
    visual: { skillId, actionName: skill.name, comboIndex },
  });
  return true;
}
function chooseAuto(s: State, a: Ally) {
  const skill = SKILLS[weaponOf(a).skills[0]];
  const target = chooseTarget(s, a, skill, s.config.bonusMode);
  if (!target) return;
  if (skill.target.startsWith('enemy') && a.atb < 2) return;
  if (a.atb + 1e-9 < skill.cost) return;
  const count =
    skill.link !== undefined && s.config.chainActions
      ? Math.min(3, Math.floor((a.atb + 1e-9) / skill.cost))
      : 1;
  if (!beginAction(s, a, skill.id, target)) return;
  a.plan ??= [];
  for (let i = 1; i < count && canAppend(a, s.config, skill.cost); i++) {
    s.planSeq = (s.planSeq ?? 0) + 1;
    a.plan.push({
      key: s.planSeq,
      kind: 'skill',
      skillId: skill.id,
      target: copy(target),
      auto: true,
    });
  }
}
function forceEnemy(s: State, e: Enemy, row: Row, source: string) {
  if (e.row === row) return;
  if (e.steadfast > 0 || (e.kind === 'guard' && e.broken <= 0)) {
    emit(
      s,
      'system',
      `${e.name}：${e.steadfast > 0 ? '踏ん張り中' : '重装・ブレイク中のみ移動可能'}`,
      { source, target: `e${e.id}`, visual: { outcome: 'resist' } },
    );
    return;
  }
  const fromRow = e.row;
  e.row = row;
  e.steadfast = BATTLE_TIMING.steadfastDuration;
  if (e.cast?.movable) {
    e.cast = null;
    e.nextAttack = 3 * BATTLE_TIMING.enemyIntervalScale;
    emit(s, 'warning', `${e.name}の構えが崩れた`, {
      source,
      target: `e${e.id}`,
      visual: { outcome: 'interrupt' },
    });
  }
  emit(s, 'move', `${e.name} → ${ROW_NAMES[row]}`, {
    source,
    target: `e${e.id}`,
    visual: { fromRow, toRow: row },
  });
}
function resolve(s: State, a: Ally, action: Action) {
  const skill = SKILLS[action.skillId],
    weapon = WEAPONS[action.weaponId];
  const visual = { skillId: skill.id, actionName: skill.name, comboIndex: action.comboIndex };
  if (skill.effect === 'handoff') {
    s.pendingSelect = null;
    if (
      s.controlMode === 'manual' &&
      action.target.kind === 'ally' &&
      s.allies[action.target.id].hp > 0
    ) {
      s.selected = action.target.id;
      s.allies[s.selected].plan = s.allies[s.selected].plan?.filter((p) => !p.auto);
      s.handoffSlow = BATTLE_TIMING.handoffSlow;
      emit(s, 'system', `${s.allies[s.selected].name}へ交代：引継ぎスロー`);
    } else emit(s, 'system', '交代先が不在のため交代を中止');
    return;
  }
  if (['heal', 'shield', 'guard', 'potion', 'evacuate'].includes(skill.effect)) {
    const targets = s.allies.filter(
      (x) =>
        x.hp > 0 &&
        (action.target.kind === 'row'
          ? x.row === action.target.row
          : action.target.kind === 'ally' && x.id === action.target.id),
    );
    for (const t of targets) {
      if (skill.effect === 'heal' || skill.effect === 'potion') {
        const amount = Math.min(t.maxHp - t.hp, skill.power);
        t.hp += amount;
        s.metrics.healed += amount;
        emit(s, 'heal', `${t.name} +${amount}`, {
          target: `a${t.id}`,
          source: `a${a.id}`,
          value: amount,
          visual,
        });
      } else if (skill.effect === 'evacuate') {
        const fromRow = t.row;
        t.row = opposite(t.row);
        t.nextRow = null;
        t.move = 0;
        // The caster pays its own recovery even when evacuating its own row.
        if (t.action !== action) t.action = null;
        emit(s, 'move', `${t.name}：緊急退避 → ${ROW_NAMES[t.row]}`, {
          source: `a${a.id}`,
          target: `a${t.id}`,
          visual: { ...visual, fromRow, toRow: t.row },
        });
      } else {
        t.shield =
          skill.effect === 'guard' ? BATTLE_TIMING.guardDuration : BATTLE_TIMING.shieldDuration;
        emit(s, 'heal', `${t.name}：防護`, { source: `a${a.id}`, target: `a${t.id}`, visual });
      }
    }
    return;
  }
  const targets = s.enemies.filter(
    (e) =>
      e.hp > 0 &&
      (action.target.kind === 'row'
        ? e.row === action.target.row
        : action.target.kind === 'enemy' && e.id === action.target.id),
  );
  if (!targets.length)
    emit(s, 'system', `${skill.name}：着弾先に敵がいない`, {
      source: `a${a.id}`,
      target: `a${a.id}`,
      visual: { ...visual, outcome: 'miss' },
    });
  for (const e of targets) {
    const protectedRear =
      e.row === 'back' &&
      s.enemies.some((g) => g.hp > 0 && g.kind === 'guard' && g.row === 'front' && !g.broken);
    const bonus =
      weapon.bonus === 'breakDamage' && e.broken > 0 ? COMBAT_RULES.weaponBreakDamage : 1;
    const damage = Math.min(
      e.hp,
      Math.round(
        skill.power *
          action.offense.damage *
          (e.chain / 100) *
          bonus *
          (protectedRear ? 0.6 : 1) *
          (0.94 + random(s) * 0.12),
      ),
    );
    e.hp -= damage;
    s.metrics.damage += damage;
    e.chain = Math.min(COMBAT_RULES.chainMax, e.chain + skill.chain * action.offense.chain);
    e.hold = Math.max(e.hold, skill.hold);
    emit(s, 'damage', `${a.name} → ${e.name} ${damage}`, {
      source: `a${a.id}`,
      target: `e${e.id}`,
      value: damage,
      visual: { ...visual, shielded: protectedRear },
    });
    if (e.hp <= 0) {
      e.cast = null;
      emit(s, 'system', `${e.name}を倒した`, {
        source: `a${a.id}`,
        target: `e${e.id}`,
        visual: { ...visual, outcome: 'defeat' },
      });
      continue;
    }
    if (!e.broken && e.chain >= COMBAT_RULES.breakThreshold) {
      e.broken = BATTLE_TIMING.breakDuration;
      e.cast = null;
      e.nextAttack = 2 * BATTLE_TIMING.enemyIntervalScale;
      s.metrics.breaks++;
      emit(s, 'break', `${e.name} BREAK — ${BATTLE_TIMING.breakDuration}秒間の好機`, {
        target: `e${e.id}`,
        source: `a${a.id}`,
        visual,
      });
    }
    if (skill.effect === 'push' || skill.effect === 'pull')
      forceEnemy(s, e, skill.effect === 'push' ? 'back' : 'front', `a${a.id}`);
  }
}
function prunePlan(s: State, a: Ally) {
  let slot = a.nextSlot ?? a.slot;
  const retained = planned(a).filter((p) => {
    if (p.kind === 'weapon') slot = p.slot;
    if (
      isHandoff(p) ||
      p.kind !== 'skill' ||
      ['guard', 'potion', ...WEAPONS[a.weapons[slot]].skills].includes(p.skillId)
    )
      return true;
    emit(s, 'system', `${a.name}：武器変更のため「${SKILLS[p.skillId].name}」の予約を解除`);
    return false;
  });
  const keys = new Set(retained.map((p) => p.key));
  if (a.queued && !keys.has(0)) a.queued = null;
  a.plan = a.plan?.filter((p) => keys.has(p.key));
  a.draft = a.draft?.filter((p) => keys.has(p.key));
  refreshSequences(a);
}
function tickAlly(s: State, a: Ally, dt: number) {
  if (a.hp <= 0) return;
  a.shield = Math.max(0, a.shield - dt);
  // Repair paid actions and retained inputs without restarting, repaying, or dropping a step.
  const retained = [
    ...(a.action && !a.action.resolved ? [a.action] : []),
    ...(a.queued ? [a.queued] : []),
    ...[...(a.plan ?? []), ...(a.draft ?? [])]
      .filter((p) => p.kind === 'skill')
      .filter((p) => !p.auto),
  ];
  for (const p of retained) {
    const target = executionTarget(s, a, SKILLS[p.skillId], p.target);
    if (target && target !== p.target) p.target = target;
  }
  const targetFor = (p: import('./types').PlannedStep & { kind: 'skill' }) =>
    p.auto
      ? (chooseTarget(s, a, SKILLS[p.skillId], s.config.bonusMode) ??
        (!validTarget(s, a, SKILLS[p.skillId], p.target)
          ? executionTarget(s, a, SKILLS[p.skillId], p.target)
          : null))
      : p.target;
  advanceExecution(a, s.config, dt, {
    valid: (p) => {
      if (p.kind !== 'skill') return true;
      const target = targetFor(p);
      return (
        !!target &&
        (p.skillId === 'handoff' || canUse(a, p.skillId)) &&
        validTarget(s, a, SKILLS[p.skillId], target) &&
        (p.skillId !== 'potion' || s.potions > 0)
      );
    },
    start: (p, comboIndex) => {
      const target = targetFor(p);
      return !!target && beginAction(s, a, p.skillId, target, comboIndex);
    },
    impact: (action) => resolve(s, a, action),
    idle: () => {
      if (s.controlMode === 'ai' || a.id !== s.selected) chooseAuto(s, a);
    },
    moved: () =>
      emit(s, 'move', `${a.name} → ${ROW_NAMES[a.row]}`, {
        target: `a${a.id}`,
        visual: { fromRow: opposite(a.row), toRow: a.row },
      }),
    shifted: () => emit(s, 'shift', `${a.name} → ${weaponOf(a).archetype}`, { target: `a${a.id}` }),
    discarded: (p) => {
      if (isHandoff(p)) s.pendingSelect = null;
      emit(s, 'system', `${a.name}：「${stepName(a, p)}」の予約を解除（対象・武器・残数を確認）`);
    },
    handoff: (removed) => emit(s, 'system', `交代開始：後続${removed}手を解除`),
  });
}
function startEnemyCast(s: State, e: Enemy) {
  const alive = s.allies.filter((a) => a.hp > 0);
  if (!alive.length) return;
  const target = alive[Math.floor(random(s) * alive.length)];
  e.attackCount++;
  const single = e.attackCount % 3 === 0;
  const cannon = e.kind === 'cannon';
  e.cast = {
    name: single
      ? '追尾狙撃'
      : cannon
        ? '後列への砲撃'
        : e.kind === 'guard'
          ? '前列薙ぎ払い'
          : '押し込み斬り',
    target: single || e.kind === 'soldier' ? 'single' : 'row',
    row: cannon ? 'back' : 'front',
    allyId: target.id,
    remaining: cannon ? 2.4 : 2,
    total: cannon ? 2.4 : 2,
    power: single ? 230 : cannon ? 310 : 250,
    movable: !single,
    push: e.kind === 'soldier',
  };
  const recipe = enemyRecipe(s.config, s.encounter, e.id);
  if (recipe.pattern && recipe.pattern !== 'default') {
    const pattern = recipe.pattern;
    e.cast.target = pattern === 'front' || pattern === 'back' ? 'row' : pattern;
    if (pattern === 'front' || pattern === 'back') e.cast.row = pattern;
    e.cast.name =
      pattern === 'single'
        ? '連続追尾斬り'
        : pattern === 'all'
          ? '灰雨の全体砲撃'
          : `${ROW_NAMES[e.cast.row]}への交差砲撃`;
    e.cast.movable = pattern !== 'single';
  }
  e.cast.remaining = e.cast.total = (recipe.cast ?? e.cast.total) * BATTLE_TIMING.enemyWindupScale;
  e.cast.power = (recipe.power ?? e.cast.power) * pressure(s.config.encounterLevel).damage;
  emit(
    s,
    'warning',
    `${e.name}：${e.cast.name}${e.cast.target === 'single' ? ` → ${target.name}` : ''}`,
    { source: `e${e.id}`, visual: { actionName: e.cast.name } },
  );
}
function tickEnemy(s: State, e: Enemy, dt: number) {
  if (e.hp <= 0) return;
  e.steadfast = Math.max(0, e.steadfast - dt);
  if (e.broken > 0) {
    e.broken = Math.max(0, e.broken - dt);
    if (!e.broken) {
      e.chain = 100;
      e.hold = 0;
      emit(s, 'system', `${e.name}：ブレイク終了`);
    }
    return;
  }
  e.hold = Math.max(0, e.hold - dt);
  if (!e.hold) e.chain = Math.max(100, e.chain - BATTLE_TIMING.chainDecay * dt);
  if (e.cast) {
    e.cast.remaining -= dt;
    if (e.cast.remaining > 1e-9) return;
    const cast = e.cast;
    e.cast = null;
    e.nextAttack =
      (enemyRecipe(s.config, s.encounter, e.id).interval ?? (e.kind === 'cannon' ? 4.8 : 3.8)) *
      BATTLE_TIMING.enemyIntervalScale;
    const targets = s.allies.filter(
      (a) =>
        a.hp > 0 &&
        (cast.target === 'all' ||
          (cast.target === 'row' ? a.row === cast.row : a.id === cast.allyId)),
    );
    if (!targets.length)
      emit(s, 'system', `${e.name}：${cast.name}は誰にも当たらなかった`, {
        source: `e${e.id}`,
        target: `e${e.id}`,
        visual: { actionName: cast.name, outcome: 'miss' },
      });
    // A single area hit shares the same instant, even if it downs its defender.
    const taken = partyBonus(s.allies, s.config.bonusMode).taken;
    for (const a of targets) {
      const damage = Math.min(
        a.hp,
        Math.round(
          cast.power *
            taken *
            s.config.enemyPower *
            (a.row === 'back' ? COMBAT_RULES.rearTaken : 1) *
            (a.shield > 0 ? COMBAT_RULES.shieldTaken : 1),
        ),
      );
      a.hp -= damage;
      s.metrics.taken += damage;
      emit(s, 'damage', `${e.name} → ${a.name} ${damage}`, {
        source: `e${e.id}`,
        target: `a${a.id}`,
        value: damage,
        visual: { actionName: cast.name, shielded: a.shield > 0 },
      });
      if (a.hp <= 0) {
        a.action = null;
        a.queued = null;
        if (a.plan) a.plan = [];
        a.draft = [];
        a.sequences = [];
        a.nextRow = null;
        a.nextSlot = null;
        emit(s, 'warning', `${a.name}：戦闘不能`, {
          source: `e${e.id}`,
          target: `a${a.id}`,
          visual: { outcome: 'defeat' },
        });
      } else if (cast.push && a.row === 'front') {
        a.row = 'back';
        a.nextRow = null;
        a.move = 0;
        emit(s, 'move', `${a.name}は後列へ押された`, {
          source: `e${e.id}`,
          target: `a${a.id}`,
          visual: { fromRow: 'front', toRow: 'back' },
        });
      }
    }
  } else {
    e.nextAttack -= dt;
    if (e.nextAttack <= 0) startEnemyCast(s, e);
  }
}
/** One fixed real-time tick. */
export function step(s: State) {
  if (s.paused || s.phase !== 'battle') return;
  s.tick++;
  s.realTime += DT;
  const handoff = s.handoffSlow > 0;
  s.handoffSlow = Math.max(0, s.handoffSlow - DT);
  let speed = s.timeMode === 'slow' ? COMBAT_RULES.slowScale : 1;
  if (s.timeMode === 'slow' && !handoff) {
    const cost = Math.min(s.focus, s.config.slowDrain * DT);
    s.focus = Math.max(0, s.focus - cost);
    s.metrics.focusUsed += cost;
    if (s.focus < 1e-8) {
      s.focus = 0;
      s.timeMode = 'normal';
      speed = 1;
      emit(s, 'system', '集中力を使い切りました。通常速度へ。');
    }
  }
  if (handoff && speed === 1) speed = COMBAT_RULES.slowScale;
  const dt = DT * speed;
  s.time += dt;
  // Integrate the roles present at the beginning of this fixed battle-time interval.
  // Completed shifts affect the next interval; actor iteration cannot bias ATB supply.
  const supply = s.config.atbRate * partyBonus(s.allies, s.config.bonusMode).atb;
  for (const a of s.allies)
    if (charging(a, s.config)) a.atb = Math.min(s.config.atbMax, a.atb + dt * supply);
  for (const a of s.allies) tickAlly(s, a, dt);
  for (const e of s.enemies) tickEnemy(s, e, dt);
  if (!s.allies.some((a) => a.hp > 0)) {
    s.phase = 'defeat';
    emit(s, 'system', '全員が倒れた。再挑戦できます。');
  } else if (!s.enemies.some((e) => e.hp > 0)) {
    s.phase = s.encounter === 1 ? 'loot' : 'victory';
    s.timeMode = 'normal';
    if (s.phase === 'loot') {
      for (const id of ['hammer', 'starbow', 'banner'])
        if (!s.inventory.includes(id)) s.inventory.push(id);
      for (const a of s.allies) {
        a.hp = a.maxHp;
        a.action = null;
        a.queued = null;
        if (a.plan) a.plan = [];
        a.draft = [];
        a.sequences = [];
      }
      emit(s, 'system', '勝利。轟砕の槌・流星の弓・帰還の軍旗を入手。');
    } else emit(s, 'system', '二つの戦いを突破した。');
  }
  if (s.phase !== 'battle') {
    s.pendingSelect = null;
    s.handoffSlow = 0;
    for (const a of s.allies) {
      // A battle may end while a handoff is queued or being performed.
      a.plan = a.plan?.filter((p) => !isHandoff(p));
      if (a.action?.skillId === 'handoff') a.action = null;
    }
  }
  if (s.allies[s.selected]?.hp <= 0) {
    s.pendingSelect = null;
    s.handoffSlow = 0;
    s.selected = s.allies.find((a) => a.hp > 0)?.id ?? 0;
  }
}
export function advance(s: State, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) step(s);
  return s;
}
