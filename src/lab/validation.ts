import { ENCOUNTER_SET_IDS } from '../content/encounters';
import { z } from 'zod';
import { SKILLS, VERSION, WEAPONS } from '../content/data';
import type { Recording, State } from '../sim/types';

const n = z.number().finite().nonnegative();
const id = z.number().int().min(0).max(2);
const slot = z.union([z.literal(0), z.literal(1)]);
const row = z.enum(['front', 'back']);
const weapon = z.string().refine((v) => !!WEAPONS[v], '不明な武器');
const skill = z.string().refine((v) => !!SKILLS[v], '不明な技');
const rows = z.tuple([row, row, row]);
const mode = z.enum(['normal', 'slow', 'stop']);
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enemy'), id }),
  z.object({ kind: z.literal('ally'), id }),
  z.object({ kind: z.literal('row'), row }),
]);
const action = z.object({ skillId: skill, target, remaining: n, total: n, weaponId: weapon });
const planStep = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skill'), skillId: skill, target }),
  z.object({ kind: z.literal('move'), row }),
  z.object({ kind: z.literal('weapon'), slot }),
]);
const plannedStep = z.intersection(planStep, z.object({ key: n.int().positive() }));
const config = z.object({
  encounterSet: z.enum(ENCOUNTER_SET_IDS).optional(),
  encounterLevel: z.number().int().min(1).max(10).optional(),
  seed: z.number().int().min(0).max(4294967295),
  atbRate: z.number().min(0.2).max(3),
  moveTime: z.number().min(0.1).max(2),
  shiftTime: z.number().min(0.1).max(2),
  slowDrain: z.number().min(1).max(20),
  stopDrain: z.number().min(1).max(30),
  enemyPower: z.number().min(0.2).max(3),
  uiMode: z.enum(['separate', 'individual', 'linked']),
  encounter: z.union([z.literal(1), z.literal(2)]),
});
const eventSchema = z.object({
  id: n.int(),
  time: n,
  type: z.enum(['action', 'damage', 'heal', 'move', 'shift', 'break', 'warning', 'system']),
  text: z.string().max(500),
  source: z.string().optional(),
  target: z.string().optional(),
  value: n.optional(),
});
const stateSchema = z
  .object({
    version: z.literal(VERSION),
    planSeq: n.int().max(200000).optional(),
    phase: z.enum(['ready', 'battle', 'loot', 'victory', 'defeat']),
    paused: z.boolean(),
    tick: n.int().max(216000),
    time: n,
    realTime: n,
    focus: n.max(100),
    timeMode: mode,
    rng: n.int().max(4294967295),
    config,
    encounter: z.union([z.literal(1), z.literal(2)]),
    selected: id,
    target: id,
    allies: z
      .array(
        z.object({
          id,
          name: z.string().max(100),
          initial: z.string().max(3),
          color: z.string().regex(/^#[0-9a-f]{6}$/i),
          hp: n,
          maxHp: n.positive(),
          atb: n.max(4),
          row,
          weapons: z.tuple([weapon, weapon]),
          slot,
          nextSlot: slot.nullable(),
          nextRow: row.nullable(),
          shift: n,
          move: n,
          action: action.nullable(),
          queued: z.object({ skillId: skill, target }).nullable(),
          plan: z.array(plannedStep).max(6).optional(),
          shield: n,
        }),
      )
      .length(3),
    enemies: z
      .array(
        z.object({
          id,
          name: z.string().max(100),
          glyph: z.string().max(4),
          kind: z.enum(['guard', 'cannon', 'soldier']),
          hp: n,
          maxHp: n.positive(),
          row,
          chain: z.number().min(100).max(500),
          hold: n,
          broken: n,
          nextAttack: z.number().finite(),
          steadfast: n,
          attackCount: n.int(),
          cast: z
            .object({
              name: z.string().max(100),
              target: z.enum(['row', 'single', 'all']),
              row,
              allyId: id,
              remaining: n,
              total: n.positive(),
              power: n,
              movable: z.boolean(),
              push: z.boolean(),
            })
            .nullable(),
        }),
      )
      .min(1)
      .max(3),
    presets: z
      .array(z.object({ name: z.string().max(100), slots: z.tuple([slot, slot, slot]), rows }))
      .length(4),
    formations: z.array(z.object({ name: z.string().max(100), rows })).length(3),
    activePreset: n.int().max(3),
    inventory: z.array(weapon).max(30),
    potions: n.int().max(3),
    events: z.array(eventSchema).max(160),
    eventSeq: n.int(),
    metrics: z.object({
      damage: n,
      taken: n,
      healed: n,
      breaks: n.int(),
      inputs: n.int(),
      focusUsed: n,
    }),
  })
  .superRefine((s, ctx) => {
    if (
      s.allies.some((a, i) => a.id !== i || a.hp > a.maxHp) ||
      s.enemies.some((e, i) => e.id !== i || e.hp > e.maxHp) ||
      s.target >= s.enemies.length
    )
      ctx.addIssue({ code: 'custom', message: 'キャラまたは敵の状態が不正です。' });
    const keys = s.allies.flatMap((a) => (a.plan ?? []).map((p) => p.key));
    if (
      new Set(keys).size !== keys.length ||
      keys.some((k) => k > (s.planSeq ?? 0)) ||
      s.allies.some(
        (a) => (a.plan?.length ?? 0) + (a.queued ? 1 : 0) > 6 || (!!a.queued && !!a.plan?.length),
      )
    )
      ctx.addIssue({ code: 'custom', message: '予約キューの識別子・件数が不正です。' });
    const equipped = s.allies.flatMap((a) => a.weapons);
    if (new Set(equipped).size !== 6 || equipped.some((w) => !s.inventory.includes(w)))
      ctx.addIssue({
        code: 'custom',
        message: '装備は所持している武器を重複せずに登録してください。',
      });
  });
const cmdSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('labWeapons') }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('pause'), value: z.boolean() }),
  z.object({ type: z.literal('select'), id }),
  z.object({ type: z.literal('target'), id }),
  z.object({ type: z.literal('time'), mode }),
  z.object({ type: z.literal('move'), id, row }),
  z.object({ type: z.literal('formation'), index: id }),
  z.object({ type: z.literal('optima'), index: n.int().max(3) }),
  z.object({ type: z.literal('skill'), id, skillId: skill, target }),
  z.object({ type: z.literal('cancel'), id }),
  z.object({ type: z.literal('enqueue'), id, step: planStep }),
  z.object({ type: z.literal('removePlan'), id, key: n.int() }),
  z.object({ type: z.literal('equip'), id, slot, weaponId: weapon }),
  z.object({ type: z.literal('editPreset'), index: n.int().max(3), id, slot }),
  z.object({ type: z.literal('editPresetRow'), index: n.int().max(3), id, row }),
  z.object({ type: z.literal('editFormation'), index: id, id, row }),
  z.object({ type: z.literal('next') }),
]);
function readJSON(text: string) {
  if (text.length > 5_000_000) throw new Error('ファイルは5MB以下にしてください。');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('JSONを読み取れませんでした。');
  }
}
export function parseSnapshotBundle(text: string) {
  const result = z
    .object({
      version: z.literal(VERSION),
      kind: z.literal('snapshot'),
      state: stateSchema,
      log: z
        .array(eventSchema.extend({ encounter: z.number().int().min(1).max(2) }))
        .max(30000)
        .optional(),
    })
    .safeParse(readJSON(text));
  if (!result.success) throw new Error('状態ファイルの形式・バージョン・値が不正です。');
  const { state, log } = result.data;
  if (
    log?.some(
      (e, i) => e.id > state.eventSeq || e.time > state.time || (i > 0 && e.id <= log[i - 1].id),
    )
  )
    throw new Error('戦闘ログの順序・終端が不正です。');
  return { state, log };
}
export function parseSnapshot(text: string): State {
  return parseSnapshotBundle(text).state;
}
export function parseRecording(text: string): Recording {
  const result = z
    .object({
      version: z.literal(VERSION),
      initial: stateSchema,
      inputs: z.array(z.object({ tick: n.int(), order: n.int(), command: cmdSchema })).max(30000),
      endTick: n.int().max(216000),
    })
    .safeParse(readJSON(text));
  if (!result.success) throw new Error('リプレイの形式・バージョン・値が不正です。');
  const r = result.data;
  if (
    r.endTick < r.initial.tick ||
    r.inputs.some(
      (x, i) =>
        x.order !== i ||
        x.tick < r.initial.tick ||
        x.tick > r.endTick ||
        (i > 0 && x.tick < r.inputs[i - 1].tick),
    )
  )
    throw new Error('リプレイの入力順序が不正です。');
  return r;
}
