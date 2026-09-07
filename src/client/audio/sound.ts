import { SKILLS, WEAPONS } from '../../content/data';
import { projectedSlot, projectedRow, stepName } from '../../sim/plan';
import type { BattleEvent, Command, State } from '../../sim/types';

type Note = { hz: number; end?: number; at: number; duration: number; wave?: OscillatorType };
const notes = (frequencies: number[], duration = 0.06, wave: OscillatorType = 'sine'): Note[] =>
  frequencies.map((hz, i) => ({ hz, at: i * duration * 0.8, duration, wave }));
export const SOUNDS = {
  nav: notes([540], 0.025),
  open: notes([420, 630], 0.05),
  confirm: notes([660, 990], 0.065),
  cancel: notes([460, 270], 0.045),
  queue: notes([750, 1000], 0.04, 'triangle'),
  move: [{ hz: 240, end: 440, at: 0, duration: 0.09, wave: 'triangle' }],
  weapon: notes([320, 640, 960], 0.055, 'triangle'),
  optima: notes([440, 554, 660], 0.08, 'triangle'),
  actor: notes([523, 784], 0.085),
  guard: notes([160, 240], 0.06, 'triangle'),
  item: notes([660, 880, 1320], 0.055),
  time: [{ hz: 650, end: 230, at: 0, duration: 0.14 }],
  pause: notes([440, 440], 0.06),
  error: notes([170, 145], 0.06, 'square'),
  hit: [{ hz: 190, end: 75, at: 0, duration: 0.055, wave: 'triangle' }],
  hurt: [{ hz: 100, end: 45, at: 0, duration: 0.09, wave: 'sawtooth' }],
  heal: notes([523, 659, 784], 0.07),
  warning: notes([350, 350], 0.07, 'triangle'),
  break: notes([392, 587, 784, 1175], 0.09, 'triangle'),
  victory: notes([523, 659, 784, 1046], 0.13, 'triangle'),
  defeat: notes([330, 294, 220, 165], 0.14, 'triangle'),
} satisfies Record<string, Note[]>;
export type SoundCue = keyof typeof SOUNDS;
export function operationFeedback(c: Command, s: State): { cue: SoundCue; label: string } {
  switch (c.type) {
    case 'toggleWeapon': {
      const a = s.allies[c.id],
        w = WEAPONS[a.weapons[projectedSlot(a) === 0 ? 1 : 0]];
      return { cue: 'weapon', label: `武器変更を予約：${w.archetype} ${w.role}` };
    }
    case 'toggleRow':
      return {
        cue: 'move',
        label: `${projectedRow(s.allies[c.id]) === 'front' ? '後列' : '前列'}への移動を予約`,
      };
    case 'move':
      return {
        cue: 'move',
        label: `${s.allies[c.id].name}を${c.row === 'front' ? '前列' : '後列'}へ`,
      };
    case 'formation':
      return { cue: 'move', label: `隊列：${s.formations[c.index]?.name}` };
    case 'optima':
      return { cue: 'optima', label: `オプティマ：${s.presets[c.index]?.name}` };
    case 'select':
      return {
        cue: 'actor',
        label:
          s.controlMode === 'ai'
            ? `${s.allies[c.id]?.name}を観測`
            : `${s.allies[c.id]?.name}への交代を予約`,
      };
    case 'enqueue': {
      const p = c.step,
        skill = p.kind === 'skill' ? SKILLS[p.skillId] : undefined;
      return {
        cue:
          p.kind === 'weapon'
            ? 'weapon'
            : p.kind === 'move'
              ? 'move'
              : skill?.effect === 'guard'
                ? 'guard'
                : skill?.effect === 'potion'
                  ? 'item'
                  : 'queue',
        label: `${stepName(s.allies[c.id], p)}を予約`,
      };
    }
    case 'skill':
      return {
        cue: c.skillId === 'guard' ? 'guard' : c.skillId === 'potion' ? 'item' : 'queue',
        label: `${SKILLS[c.skillId].name}を予約`,
      };
    case 'hold':
      return { cue: 'pause', label: c.value ? '実行保留' : '保留解除・実行再開' };
    case 'cancel':
      return { cue: 'cancel', label: '未実行の予約をすべて取消' };
    case 'cancelFirst':
      return { cue: 'cancel', label: '先頭の予約を取消' };
    case 'removePlan':
      return { cue: 'cancel', label: '選んだ予約を取消' };
    case 'target':
      return { cue: 'nav', label: `集中攻撃：${s.enemies[c.id]?.name}` };
    case 'time':
      return {
        cue: 'time',
        label: c.mode === 'normal' ? '通常速度へ' : c.mode === 'slow' ? 'スローへ' : '戦術停止',
      };
    case 'pause':
      return { cue: 'pause', label: c.value ? '休憩ポーズ' : '戦闘を再開' };
    case 'equip':
      return { cue: 'weapon', label: `${s.allies[c.id].name}に${WEAPONS[c.weaponId].name}を装備` };
    case 'editPreset':
    case 'editPresetRow':
      return { cue: 'optima', label: 'オプティマを更新' };
    case 'editFormation':
      return { cue: 'move', label: '一括隊列を更新' };
    case 'control':
      return { cue: 'confirm', label: c.mode === 'ai' ? 'AIに操作を任せる' : '手動操作へ' };
    case 'labWeapons':
      return { cue: 'item', label: '検証用の武器を追加' };
    case 'start':
      return { cue: 'confirm', label: '戦闘開始' };
    case 'next':
      return { cue: 'confirm', label: '次の戦闘へ' };
  }
}

/** Short synthesized tones; no downloaded assets or pending audio queue. */
export class BattleSound {
  enabled = true;
  volume = 0.18;
  unlocked = false;
  lastInputAt = -Infinity;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private active = new Set<OscillatorNode>();
  private last = new Map<SoundCue, number>();
  private initial?: object;
  private eventId = 0;
  private phase: State['phase'] = 'ready';
  constructor(private factory = () => new AudioContext()) {
    if (typeof window === 'undefined') return;
    try {
      const saved = JSON.parse(localStorage.getItem('orchestra-audio-v1') ?? 'null');
      if (typeof saved?.enabled === 'boolean') this.enabled = saved.enabled;
      if (Number.isFinite(saved?.volume)) this.volume = Math.min(0.5, Math.max(0, saved.volume));
    } catch {
      /* Defaults also work in private storage and headless tests. */
    }
  }
  private save() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        'orchestra-audio-v1',
        JSON.stringify({ enabled: this.enabled, volume: this.volume }),
      );
    } catch {}
  }
  async unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = this.factory();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
      this.unlocked = this.context.state === 'running';
    } catch {
      this.unlocked = false;
    }
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    if (!value)
      for (const oscillator of this.active) {
        try {
          oscillator.stop();
        } catch {}
      }
    this.save();
    if (value) void this.unlock();
  }
  setVolume(value: number) {
    this.volume = Number.isFinite(value) ? Math.min(0.5, Math.max(0, value)) : this.volume;
    this.master?.gain.setTargetAtTime(this.volume, this.context!.currentTime, 0.02);
    this.save();
  }
  play(cue: SoundCue, input = false) {
    if (input) this.lastInputAt = performance.now();
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running' || !this.master || this.volume === 0)
      return;
    const now = ctx.currentTime;
    // Bound repetitions and polyphony, especially under 4x AI playback.
    if (now - (this.last.get(cue) ?? -Infinity) < (cue === 'hit' || cue === 'hurt' ? 0.09 : 0.035))
      return;
    this.last.set(cue, now);
    for (const note of SOUNDS[cue] as Note[]) {
      if (this.active.size >= 24) break;
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain(),
        at = now + note.at;
      oscillator.type = note.wave ?? 'sine';
      oscillator.frequency.setValueAtTime(note.hz, at);
      if (note.end) oscillator.frequency.exponentialRampToValueAtTime(note.end, at + note.duration);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.17, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      this.active.add(oscillator);
      oscillator.onended = () => {
        this.active.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + note.duration + 0.01);
    }
  }
  observe(state: State, log: readonly BattleEvent[], initial: object) {
    const latest = log.at(-1)?.id ?? 0;
    if (this.initial !== initial || latest < this.eventId) {
      this.initial = initial;
      this.eventId = latest;
      this.phase = state.phase;
      return;
    }
    if (state.paused) return;
    const fresh = log.filter((e) => e.id > this.eventId).slice(-12);
    this.eventId = latest;
    for (const e of fresh) {
      if (e.type === 'damage') this.play(e.target?.startsWith('a') ? 'hurt' : 'hit');
      else if (e.type === 'heal') this.play(e.value ? 'heal' : 'guard');
      else if (e.type === 'break') this.play('break');
      else if (e.type === 'warning') this.play('warning');
    }
    if (state.phase !== this.phase && ['loot', 'victory', 'defeat'].includes(state.phase))
      this.play(state.phase === 'defeat' ? 'defeat' : 'victory');
    this.phase = state.phase;
  }
  attach() {
    const unlock = () => void this.unlock();
    const click = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (button && !button.disabled && performance.now() - this.lastInputAt > 30)
        this.play('open', true);
    };
    const key = (event: KeyboardEvent) => {
      unlock();
      if (event.repeat) return;
      if (['Tab', 'Escape'].includes(event.key))
        queueMicrotask(() => {
          if (performance.now() - this.lastInputAt > 30)
            this.play(event.key === 'Tab' ? 'nav' : 'cancel', true);
        });
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('click', click);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('click', click);
    };
  }
}
