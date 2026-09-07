import { advanceExecution, charging, makeAction, validExecutionTarget } from './execution';
import { COMBAT_RULES } from '../content/rules';
import { partyBonus, positionBonus } from './bonuses';
import { renameTactics } from './tactics';
import {
  canAppend,
  isHandoff,
  planned,
  projectedSlot,
  projectedRow,
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
    target: 0,
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
    s.target = 0;
    for (const a of s.allies) {
      a.hp = a.maxHp;
      a.atb = 1;
      a.executionHeld = false;
      a.shield = 0;
      a.action = null;
      a.queued = null;
      if (a.plan) a.plan = [];
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
      type: 'enqueue',
      id: c.id,
      step: { kind: 'weapon', slot: projectedSlot(a) === 0 ? 1 : 0 },
    });
  }
  if (c.type === 'toggleRow') {
    const a = s.allies[c.id];
    if (!a || a.hp <= 0) return false;
    return command(s, {
      type: 'enqueue',
      id: c.id,
      step: { kind: 'move', row: opposite(projectedRow(a)) },
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
    case 'target':
      if (!s.enemies[c.id] || s.enemies[c.id].hp <= 0) return false;
      s.target = c.id;
      return true;
    case 'time': {
      if (c.mode === 'stop') s.handoffSlow = 0;
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
      if (!a || a.hp <= 0) return false;
      queueRow(a, c.row);
      emit(s, 'system', `${a.name}：${ROW_NAMES[c.row]}へ移動指示`);
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
        const slot = preset.slots[a.id];
        if (slot !== (a.nextSlot ?? a.slot)) {
          a.nextSlot = slot === a.slot ? null : slot;
          a.shift = 0;
        }
        const nextWeapon = WEAPONS[a.weapons[slot]];
        if (a.queued && !['guard', 'potion', ...nextWeapon.skills].includes(a.queued.skillId)) {
          emit(
            s,
            'system',
            `${a.name}：武器変更のため「${SKILLS[a.queued.skillId].name}」の予約を解除`,
          );
          a.queued = null;
        }
      }
      for (const a of s.allies) prunePlan(s, a);
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
      a.queued = { skillId: c.skillId, target: copy(c.target) };
      emit(s, 'system', `${a.name}：「${skill.name}」を予約`);
      return true;
    }
    case 'enqueue': {
      const a = s.allies[c.id],
        p = c.step;
      if (!a || a.hp <= 0) return false;
      if (!canAppend(a, s.config, p.kind === 'skill' ? (SKILLS[p.skillId]?.cost ?? Infinity) : 0))
        return reject(s, `先行入力は合計${s.config.atbMax} ATB・${s.config.atbMax}手までです。`);
      if (p.kind === 'skill') {
        const sk = SKILLS[p.skillId],
          w = WEAPONS[a.weapons[projectedSlot(a)]];
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
      a.plan.push({ ...copy(p), key: ++s.planSeq });
      emit(s, 'system', `${a.name}：${a.plan.length}手目に「${stepName(a, p)}」を追加`, {
        source: `a${a.id}`,
      });
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
      const p = a.plan?.find((p) => p.key === c.key);
      if (!p) return false;
      a.plan = a.plan!.filter((p) => p.key !== c.key);
      if (isHandoff(p)) s.pendingSelect = null;
      emit(s, 'system', `${a.name}：「${stepName(a, p)}」の予約を取消`);
      prunePlan(s, a);
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
      emit(s, 'system', `${a.name}：残りを打ち切り（現在の行動・終了硬直は継続）`);
      return true;
    }
  }
  return false;
}

export function defaultTarget(s: State, a: Ally, skill: Skill): Target {
  const enemy =
    s.enemies.find((e) => e.id === s.target && e.hp > 0) ?? s.enemies.find((e) => e.hp > 0);
  const ally =
    s.allies.filter((e) => e.hp > 0).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0] ?? a;
  switch (skill.target) {
    case 'enemy':
      return { kind: 'enemy', id: enemy?.id ?? 0 };
    case 'enemyRow':
      return { kind: 'row', row: enemy?.row ?? 'front' };
    case 'ally':
      return { kind: 'ally', id: ally.id };
    case 'allyRow':
      return { kind: 'row', row: ally.row };
    case 'self':
      return { kind: 'ally', id: a.id };
  }
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
  emit(s, 'action', `${a.name} → ${skill.name}`, { source: `a${a.id}` });
  return true;
}
function chooseAuto(s: State, a: Ally) {
  const skill = SKILLS[weaponOf(a).skills[0]];
  let target = defaultTarget(s, a, skill);
  if (skill.effect === 'heal') {
    const hurt = s.allies
      .filter((x) => x.hp > 0 && x.hp < x.maxHp * 0.83)
      .sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
    if (!hurt) return;
    target = { kind: 'ally', id: hurt.id };
  } else if (skill.effect === 'shield') {
    const vulnerable = s.allies
      .filter((x) => x.hp > 0 && x.shield < 0.5)
      .sort((x, y) => (x.row === 'front' ? -1 : 1) - (y.row === 'front' ? -1 : 1))[0];
    if (!vulnerable) return;
    target = { kind: 'ally', id: vulnerable.id };
  } else if (a.atb < 2) return;
  if (a.atb + 1e-9 < skill.cost) return;
  const count =
    skill.link !== undefined && s.config.chainActions
      ? Math.min(3, Math.floor((a.atb + 1e-9) / skill.cost))
      : 1;
  if (!beginAction(s, a, skill.id, target)) return;
  a.plan ??= [];
  for (let i = 1; i < count; i++) {
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
function forceEnemy(s: State, e: Enemy, row: Row) {
  if (e.row === row) return;
  if (e.steadfast > 0 || (e.kind === 'guard' && e.broken <= 0)) {
    emit(
      s,
      'system',
      `${e.name}：${e.steadfast > 0 ? '踏ん張り中' : '重装・ブレイク中のみ移動可能'}`,
    );
    return;
  }
  e.row = row;
  e.steadfast = BATTLE_TIMING.steadfastDuration;
  if (e.cast?.movable) {
    e.cast = null;
    e.nextAttack = 3 * BATTLE_TIMING.enemyIntervalScale;
    emit(s, 'warning', `${e.name}の構えが崩れた`);
  }
  emit(s, 'move', `${e.name} → ${ROW_NAMES[row]}`, { target: `e${e.id}` });
}
function resolve(s: State, a: Ally, action: Action) {
  const skill = SKILLS[action.skillId],
    weapon = WEAPONS[action.weaponId];
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
        });
      } else if (skill.effect === 'evacuate') {
        t.row = opposite(t.row);
        t.nextRow = null;
        t.move = 0;
        // The caster pays its own recovery even when evacuating its own row.
        if (t.action !== action) t.action = null;
        emit(s, 'move', `${t.name}：緊急退避 → ${ROW_NAMES[t.row]}`, { target: `a${t.id}` });
      } else {
        t.shield =
          skill.effect === 'guard' ? BATTLE_TIMING.guardDuration : BATTLE_TIMING.shieldDuration;
        emit(s, 'heal', `${t.name}：防護`, { target: `a${t.id}` });
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
  if (!targets.length) emit(s, 'system', `${skill.name}：着弾先に敵がいない`);
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
    e.chain = Math.min(500, e.chain + skill.chain * action.offense.chain);
    e.hold = Math.max(e.hold, skill.hold);
    emit(s, 'damage', `${a.name} → ${e.name} ${damage}`, {
      source: `a${a.id}`,
      target: `e${e.id}`,
      value: damage,
    });
    if (e.hp <= 0) {
      e.cast = null;
      emit(s, 'system', `${e.name}を倒した`);
      continue;
    }
    if (!e.broken && e.chain >= COMBAT_RULES.breakThreshold) {
      e.broken = BATTLE_TIMING.breakDuration;
      e.cast = null;
      e.nextAttack = 2 * BATTLE_TIMING.enemyIntervalScale;
      s.metrics.breaks++;
      emit(s, 'break', `${e.name} BREAK — ${BATTLE_TIMING.breakDuration}秒間の好機`, {
        target: `e${e.id}`,
      });
    }
    if (skill.effect === 'push' || skill.effect === 'pull')
      forceEnemy(s, e, skill.effect === 'push' ? 'back' : 'front');
  }
}
function prunePlan(s: State, a: Ally) {
  if (!a.plan) return;
  let slot = a.nextSlot ?? a.slot;
  a.plan = a.plan.filter((p) => {
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
}
function tickAlly(s: State, a: Ally, dt: number) {
  if (a.hp <= 0) return;
  a.shield = Math.max(0, a.shield - dt);
  // Reconsider only AI-owned healing reservations; player targets stay fixed.
  if (a.plan?.some((p) => p.auto && p.kind === 'skill' && p.skillId === 'heal')) {
    a.plan = a.plan.filter(
      (p) =>
        !p.auto ||
        p.kind !== 'skill' ||
        p.skillId !== 'heal' ||
        (p.target.kind === 'ally' &&
          s.allies[p.target.id].hp > 0 &&
          s.allies[p.target.id].hp < s.allies[p.target.id].maxHp * 0.83),
    );
  }
  advanceExecution(a, s.config, dt, {
    valid: (p) =>
      p.kind !== 'skill' ||
      ((p.skillId === 'handoff' || canUse(a, p.skillId)) &&
        validTarget(s, a, SKILLS[p.skillId], p.target) &&
        (p.skillId !== 'potion' || s.potions > 0)),
    start: (p, comboIndex) => beginAction(s, a, p.skillId, p.target, comboIndex),
    impact: (action) => resolve(s, a, action),
    idle: () => {
      if (s.controlMode === 'ai' || a.id !== s.selected) chooseAuto(s, a);
    },
    moved: () => emit(s, 'move', `${a.name} → ${ROW_NAMES[a.row]}`, { target: `a${a.id}` }),
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
    if (!targets.length) emit(s, 'system', `${e.name}：${cast.name}は誰にも当たらなかった`);
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
      });
      if (a.hp <= 0) {
        a.action = null;
        a.queued = null;
        if (a.plan) a.plan = [];
        a.nextRow = null;
        a.nextSlot = null;
        emit(s, 'warning', `${a.name}：戦闘不能`);
      } else if (cast.push && a.row === 'front') {
        a.row = 'back';
        a.nextRow = null;
        a.move = 0;
        emit(s, 'move', `${a.name}は後列へ押された`, { target: `a${a.id}` });
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
  let speed = s.timeMode === 'normal' ? 1 : s.timeMode === 'slow' ? COMBAT_RULES.slowScale : 0;
  if (s.timeMode !== 'normal' && !(handoff && s.timeMode === 'slow')) {
    const rate = s.timeMode === 'slow' ? s.config.slowDrain : s.config.stopDrain;
    const cost = Math.min(s.focus, rate * DT);
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
  if (dt === 0) return;
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
  if (s.enemies[s.target]?.hp <= 0) s.target = s.enemies.find((e) => e.hp > 0)?.id ?? 0;
}
export function advance(s: State, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) step(s);
  return s;
}
