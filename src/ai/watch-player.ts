import { prepareLoadout, type LoadoutMode } from './composition';
import { DT, SKILLS, WEAPONS, ROW_NAMES } from '../content/data';
import { observe } from './observation';
import { createPolicy, type PolicyId } from './policies';
import { createQueuePolicy } from './queue-policy';
import type { Command, State } from '../sim/types';
import type { Session } from '../lab/session';
export type WatchPlanning = 'legacy' | 'next' | 'queue';
export interface WatchDecision {
  id: number;
  time: number;
  reason: string;
  actions: string[];
}

function describe(s: State, c: Command): string {
  if (c.type === 'enqueue')
    return `${s.allies[c.id].name}：${c.step.kind === 'skill' ? SKILLS[c.step.skillId].name : c.step.kind === 'move' ? `${ROW_NAMES[c.step.row]}へ` : WEAPONS[s.allies[c.id].weapons[c.step.slot]].name}`;
  if (c.type === 'equip') return `${s.allies[c.id].name}：${WEAPONS[c.weaponId].name}を装備`;
  if (c.type === 'editPreset') return `オプティマ${c.index + 1}を更新`;
  if (c.type === 'skill') return `${s.allies[c.id].name}：${SKILLS[c.skillId].name}`;
  if (c.type === 'optima') return s.presets[c.index].name;
  if (c.type === 'formation') return s.formations[c.index].name;
  if (c.type === 'move') return `${s.allies[c.id].name}：${ROW_NAMES[c.row]}へ`;
  if (c.type === 'removePlan' || c.type === 'cancel') return `${s.allies[c.id].name}：予約取消`;
  if (c.type === 'time')
    return c.mode === 'normal' ? '通常速度' : c.mode === 'slow' ? 'スロー' : '戦術停止';
  return '';
}
export function nextEncounterCommands(s: State, mode: LoadoutMode = 'legacy'): Command[] {
  return [...prepareLoadout(s, mode), { type: 'next' }];
}
/** Browser-safe live playback of the same policies, through recorded simulation commands. */
export class WatchPlayer {
  policyId: PolicyId = 'adaptive';
  loadout: LoadoutMode = 'adaptive';
  planning: WatchPlanning = 'queue';
  speed: 1 | 2 | 4 = 1;
  paused = false;
  history: WatchDecision[] = [];
  decisions = 0;
  private policy = this.makePolicy();
  private initial?: State;
  private mode?: State['controlMode'];
  private lastTick = -1;
  private nextDecision = 0;
  private encounter = 0;
  private lootWait = 0;
  private makePolicy() {
    return this.planning === 'legacy'
      ? createPolicy(this.policyId)
      : createQueuePolicy(this.policyId, 0.35, 'none', this.planning === 'next' ? 1 : 3);
  }
  configure(policyId = this.policyId, planning = this.planning) {
    if (policyId !== this.policyId)
      this.loadout = policyId === 'adaptive' || policyId === 'assault' ? policyId : 'legacy';
    this.policyId = policyId;
    this.planning = planning;
    this.policy = this.makePolicy();
    this.nextDecision = 0;
    this.history = [];
    this.decisions = 0;
    this.lootWait = 0;
  }
  advance(session: Session, elapsed: number) {
    const s = session.state;
    if (session.initial !== this.initial || s.tick < this.lastTick || this.mode !== s.controlMode) {
      this.configure();
      this.paused = false;
      this.initial = session.initial;
      this.mode = s.controlMode;
    }
    this.lastTick = s.tick;
    if (s.paused || (s.controlMode === 'ai' && this.paused)) return;
    const dt = Math.max(0, Math.min(0.1, elapsed));
    if (s.controlMode === 'ai' && s.phase === 'loot') {
      this.lootWait += dt * this.speed;
      if (this.lootWait >= 1.2) {
        session.send(...nextEncounterCommands(s, this.loadout));
        this.lootWait = 0;
        this.nextDecision = s.tick;
      }
      return;
    }
    for (let i = 0; i < (s.controlMode === 'ai' ? this.speed : 1); i++) {
      session.advance(dt, () => {
        if (s.controlMode !== 'ai') return;
        if (s.encounter !== this.encounter) {
          this.encounter = s.encounter;
          this.nextDecision = s.tick;
        }
        if (s.tick < this.nextDecision) return;
        const d = this.policy.decide(observe(s));
        this.decisions++;
        if (d.commands.length || d.reason !== this.history[0]?.reason) {
          this.history.unshift({
            id: this.decisions,
            time: s.time,
            reason: d.reason,
            actions: [...new Set(d.commands.map((c) => describe(s, c)).filter(Boolean))],
          });
          this.history = this.history.slice(0, 8);
        }
        if (d.commands.length) session.send(...d.commands);
        this.nextDecision = s.tick + Math.round(0.25 / DT);
      });
    }
    this.lastTick = s.tick;
  }
}
