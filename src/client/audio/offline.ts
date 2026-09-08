import { SOUNDS, type SoundCue } from './sound';

export type TimedSoundCue = { cue: SoundCue; time: number };

const SAMPLE_RATE = 48000;
type Note = {
  hz: number;
  end?: number;
  at: number;
  duration: number;
  wave?: OscillatorType;
};

/** Render the existing battle tones on the video's clock, independent of wall-clock speed. */
export async function renderOfflineAudio(
  cues: TimedSoundCue[],
  duration: number,
  volume = 0.18,
): Promise<Uint8Array> {
  const length = Math.round(duration * SAMPLE_RATE);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length * 2 > 0xffffffff - 36
  )
    throw new RangeError('音声の長さはPCM WAVに収まる正の秒数にしてください。');
  if (!Number.isFinite(volume) || volume < 0 || volume > 0.5)
    throw new RangeError('音量は0から0.5の有限値にしてください。');
  if (!Array.isArray(cues)) throw new TypeError('効果音は時刻付きの配列にしてください。');
  for (const event of cues) {
    if (
      !event ||
      !Object.hasOwn(SOUNDS, event.cue) ||
      !Number.isFinite(event.time) ||
      event.time < 0
    )
      throw new TypeError('効果音には既知のcueと、0以上の有限な動画時刻が必要です。');
  }

  const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const master = context.createGain();
  master.gain.value = volume;
  master.connect(context.destination);
  const last = new Map<SoundCue, number>();
  let activeUntil: number[] = [];
  for (const { cue, time } of [...cues].sort((a, b) => a.time - b.time)) {
    if (time >= duration || volume === 0) continue;
    const interval = cue === 'hit' || cue === 'hurt' ? 0.09 : 0.035;
    if (time - (last.get(cue) ?? -Infinity) < interval) continue;
    last.set(cue, time);
    // OfflineAudioContext does not run onended callbacks until rendering starts.
    // Count future notes as active, as BattleSound.play does when scheduling a chord.
    activeUntil = activeUntil.filter((end) => end > time);
    for (const note of SOUNDS[cue] as Note[]) {
      if (activeUntil.length >= 24) break;
      const at = time + note.at;
      if (at >= duration) continue;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = note.wave ?? 'sine';
      oscillator.frequency.setValueAtTime(note.hz, at);
      if (note.end) oscillator.frequency.exponentialRampToValueAtTime(note.end, at + note.duration);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.17, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(at);
      oscillator.stop(at + note.duration + 0.01);
      activeUntil.push(at + note.duration + 0.01);
    }
  }

  const rendered = await context.startRendering();
  const samples = rendered.getChannelData(0);
  const wav = new Uint8Array(44 + length * 2);
  const view = new DataView(wav.buffer);
  const label = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  label(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return wav;
}
