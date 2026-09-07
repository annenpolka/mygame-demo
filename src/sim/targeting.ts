import { SKILLS, WEAPONS } from '../content/data';
import { COMBAT_RULES } from '../content/rules';
import { partyBonus, positionBonus } from './bonuses';
import type { Action, Ally, BonusMode, Enemy, PlannedStep, Skill, Target } from './types';

type Actor = Pick<Ally, 'id' | 'hp' | 'maxHp' | 'row' | 'shield' | 'slot'> & {
  weapons: readonly string[];
  action: Readonly<Action> | null;
  queued: Readonly<Ally['queued']>;
  plan?: readonly PlannedStep[];
};
type Foe = Readonly<
  Pick<
    Enemy,
    'id' | 'hp' | 'maxHp' | 'row' | 'kind' | 'chain' | 'hold' | 'broken' | 'steadfast' | 'cast'
  >
>;
export interface TargetingView {
  allies: readonly Actor[];
  enemies: readonly Foe[];
}
const role = (a: Actor) => WEAPONS[a.weapons[a.slot]].role;
const offensive = (id: string) => SKILLS[id].target.startsWith('enemy');
function intent(a: Actor) {
  if (a.action && offensive(a.action.skillId)) return a.action.target;
  if (a.queued && offensive(a.queued.skillId)) return a.queued.target;
  return a.plan?.find((p) => p.kind === 'skill' && offensive(p.skillId));
}
function aimsAt(a: Actor, e: Foe) {
  const next = intent(a);
  const target = next && 'target' in next ? next.target : next;
  return target?.kind === 'enemy'
    ? target.id === e.id
    : target?.kind === 'row' && target.row === e.row;
}
/** Deterministic choices use visible state only. Never mutate an action, plan, or cursor. */
export function chooseTarget(
  v: TargetingView,
  a: Actor,
  skill: Skill,
  mode: BonusMode,
): Target | null {
  if (skill.target === 'self') return { kind: 'ally', id: a.id };
  const live = v.allies.filter((x) => x.hp > 0),
    foes = v.enemies.filter((e) => e.hp > 0);
  const weapon = WEAPONS[a.weapons[a.slot]],
    bonus = partyBonus(live, mode),
    position = positionBonus(a.row, weapon);
  const incoming = (x: Actor) =>
    foes.reduce((sum, e) => {
      const c = e.cast;
      return (
        sum +
        (c &&
        c.remaining >= skill.cast &&
        (c.target === 'all' || (c.target === 'single' ? c.allyId === x.id : c.row === x.row))
          ? c.power / (1 + c.remaining)
          : 0)
      );
    }, 0);
  if (skill.target.startsWith('ally')) {
    const candidates = live.filter((x) =>
      skill.effect === 'shield'
        ? x.shield < 0.5
        : skill.effect === 'heal'
          ? x.hp < x.maxHp * 0.83
          : true,
    );
    const need = (x: Actor) => {
      const healing = live.reduce((sum, other) => {
        const action = other.id === a.id ? null : other.action;
        return (
          sum +
          (action &&
          !action.resolved &&
          SKILLS[action.skillId].effect === 'heal' &&
          action.target.kind === 'ally' &&
          action.target.id === x.id
            ? SKILLS[action.skillId].power
            : 0)
        );
      }, 0);
      return skill.effect === 'shield'
        ? incoming(x) * 10 + (1 - x.hp / x.maxHp) * 100 + (x.row === 'front' ? 20 : 0)
        : (Math.max(0, x.maxHp - x.hp - healing) / x.maxHp) * 100 + incoming(x) / x.maxHp;
    };
    const best = [...candidates].sort((x, y) => need(y) - need(x) || x.id - y.id)[0];
    if (!best) return null;
    if (skill.target === 'allyRow') {
      const rows = ['front', 'back'] as const;
      const row = [...rows].sort(
        (x, y) =>
          candidates.filter((a) => a.row === y).reduce((n, a) => n + need(a) + 1, 0) -
          candidates.filter((a) => a.row === x).reduce((n, a) => n + need(a) + 1, 0),
      )[0];
      return { kind: 'row', row };
    }
    return { kind: 'ally', id: best.id };
  }
  if (!foes.length) return null;
  const protectedRear = foes.some((e) => e.kind === 'guard' && e.row === 'front' && !e.broken);
  const score = (e: Foe) => {
    const damage =
      ((skill.power * bonus.damage * position.damage * e.chain) / 100) *
      (weapon.bonus === 'breakDamage' && e.broken > 0 ? COMBAT_RULES.weaponBreakDamage : 1) *
      (protectedRear && e.row === 'back' ? 0.6 : 1);
    const finish = e.hp <= damage * 0.94 ? 100000 : 0;
    const allyAim = (r: 'A' | 'B') =>
      live.some((x) => x.id !== a.id && role(x) === r && aimsAt(x, e));
    const movable = !e.steadfast && (e.kind !== 'guard' || e.broken > 0);
    const displaced =
      movable &&
      ((skill.effect === 'pull' && e.row === 'back') ||
        (skill.effect === 'push' && e.row === 'front'));
    const interrupt = displaced && e.cast?.movable && e.cast.remaining > skill.cast ? 200000 : 0;
    const utility = displaced ? 15000 : 0;
    // A cashes in breaks and maintains the chain B is building. B opens the next break.
    const priority =
      role(a) === 'A'
        ? (e.broken > skill.cast ? 40000 : 0) +
          (!e.broken && e.chain > 100 && e.hold <= skill.cast && allyAim('B') ? 12000 : 0) +
          (allyAim('B') ? 2000 : 0)
        : !e.broken
          ? 30000 +
            (e.chain + skill.chain * bonus.chain * position.chain >= COMBAT_RULES.breakThreshold
              ? 20000
              : 0) +
            (e.chain - 100) * 100 +
            (allyAim('A') ? 2000 : 0)
          : 0;
    return (
      interrupt +
      finish +
      utility +
      priority +
      damage +
      (e.cast ? 200 : 0) +
      (e.kind === 'guard' && e.row === 'front' && !e.broken ? 100 : 0) -
      e.hp / e.maxHp
    );
  };
  if (skill.target === 'enemyRow') {
    const rows = ['front', 'back'] as const;
    const row = [...rows].sort(
      (x, y) =>
        foes.filter((e) => e.row === y).reduce((n, e) => n + score(e), 0) -
        foes.filter((e) => e.row === x).reduce((n, e) => n + score(e), 0),
    )[0];
    return { kind: 'row', row };
  }
  const enemy = [...foes].sort((x, y) => score(y) - score(x) || x.id - y.id)[0];
  return { kind: 'enemy', id: enemy.id };
}
