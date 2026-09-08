import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOfflineAudio, type TimedSoundCue } from '../src/client/audio/offline';
import { BattleSound, SOUNDS, type SoundCue } from '../src/client/audio/sound';

type Automation = ['set' | 'linear' | 'exponential' | 'target', number, number];
function parameter() {
  return {
    value: 0,
    automation: [] as Automation[],
    setValueAtTime(value: number, time: number) {
      this.automation.push(['set', value, time]);
    },
    linearRampToValueAtTime(value: number, time: number) {
      this.automation.push(['linear', value, time]);
    },
    exponentialRampToValueAtTime(value: number, time: number) {
      this.automation.push(['exponential', value, time]);
    },
    setTargetAtTime(value: number, time: number) {
      this.automation.push(['target', value, time]);
    },
  };
}

const gainNode = () => ({ gain: parameter(), connect: vi.fn(), disconnect: vi.fn() });
const oscillatorNode = () => ({
  type: 'sine',
  frequency: parameter(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  start: vi.fn<(time: number) => void>(),
  stop: vi.fn<(time: number) => void>(),
  onended: null as (() => void) | null,
  ended: false,
});

class TestAudioContext {
  static instances: TestAudioContext[] = [];
  static samples: Float32Array | undefined;
  currentTime = 0;
  state = 'running';
  destination = {};
  voices: ReturnType<typeof oscillatorNode>[] = [];
  gains: ReturnType<typeof gainNode>[] = [];
  constructor(
    readonly channels = 1,
    readonly length = 48000,
    readonly sampleRate = 48000,
  ) {
    TestAudioContext.instances.push(this);
  }
  async resume() {}
  createGain() {
    const gain = gainNode();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = oscillatorNode();
    this.voices.push(oscillator);
    return oscillator;
  }
  moveTo(time: number) {
    this.currentTime = time;
    for (const voice of this.voices) {
      if (!voice.ended && voice.stop.mock.calls[0]?.[0] <= time) {
        voice.ended = true;
        voice.onended?.();
      }
    }
  }
  async startRendering() {
    return { getChannelData: () => TestAudioContext.samples ?? new Float32Array(this.length) };
  }
  graph() {
    return this.voices.map((voice, i) => ({
      wave: voice.type,
      frequency: voice.frequency.automation,
      envelope: this.gains[i + 1].gain.automation,
      start: voice.start.mock.calls,
      stop: voice.stop.mock.calls,
    }));
  }
}

beforeEach(() => {
  TestAudioContext.instances = [];
  TestAudioContext.samples = undefined;
  vi.stubGlobal('OfflineAudioContext', TestAudioContext);
});
afterEach(() => vi.unstubAllGlobals());

describe('offline battle soundtrack', () => {
  it('uses the live waveforms, envelopes, repetition limits and 24-voice limit on video time', async () => {
    const cues: TimedSoundCue[] = [
      ...(Object.keys(SOUNDS) as SoundCue[]).map((cue) => ({ cue, time: 0 })),
      { cue: 'hit', time: 0.02 },
      { cue: 'hurt', time: 0.04 },
      { cue: 'heal', time: 0.05 },
      { cue: 'hit', time: 0.1 },
      { cue: 'victory', time: 1 },
    ];
    const live = new TestAudioContext();
    const sound = new BattleSound(() => live as unknown as AudioContext);
    await sound.unlock();
    for (const { cue, time } of cues) {
      live.moveTo(time);
      sound.play(cue);
    }
    await renderOfflineAudio(cues, 2);
    const offline = TestAudioContext.instances[1];
    expect(offline.graph()).toEqual(live.graph());
    expect(offline.gains[0].gain.value).toBe(sound.volume);
    expect(offline.voices.length).toBeGreaterThan(24);
    expect(offline.voices.filter((voice) => voice.start.mock.calls[0][0] === 1)).toHaveLength(1);
    for (const time of cues.map((cue) => cue.time))
      expect(
        offline.voices.filter(
          (voice) => voice.start.mock.calls[0][0] <= time && voice.stop.mock.calls[0][0] > time,
        ).length,
      ).toBeLessThanOrEqual(24);
  });

  it('sorts event time without changing the caller data and preserves equal-time cue order', async () => {
    const cues: TimedSoundCue[] = [
      { cue: 'hit', time: 1 },
      { cue: 'heal', time: 0.5 },
      { cue: 'guard', time: 0.5 },
    ];
    const original = structuredClone(cues);
    await renderOfflineAudio(cues, 2);
    const graph = TestAudioContext.instances[0].graph();
    expect(cues).toEqual(original);
    expect(graph.map((voice) => voice.frequency[0][1])).toEqual([523, 659, 784, 160, 240, 190]);
    expect(graph.at(-1)?.start).toEqual([[1]]);
  });

  it('writes a 48kHz mono signed 16-bit PCM WAV with an exact sample count and bounded amplitudes', async () => {
    TestAudioContext.samples = Float32Array.from([-1.5, -0.5, 0.5, 1.5]);
    const wav = await renderOfflineAudio([], 4 / 48000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(wav.byteLength).toBe(52);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 16))).toBe('WAVEfmt ');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(96000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      -32768, -16384, 16384, 32767,
    ]);
  });

  it('trims a final chord at the video duration and ignores cues outside the video', async () => {
    const wav = await renderOfflineAudio(
      [
        { cue: 'victory', time: 0.99 },
        { cue: 'hit', time: 1 },
        { cue: 'hurt', time: 2 },
      ],
      1,
    );
    const context = TestAudioContext.instances[0];
    expect(context.length).toBe(48000);
    expect(wav.byteLength).toBe(44 + 96000);
    expect(context.voices).toHaveLength(1);
    expect(context.voices[0].start.mock.calls).toEqual([[0.99]]);
  });

  it('renders the full video duration as silence when volume is zero', async () => {
    const wav = await renderOfflineAudio([{ cue: 'break', time: 0 }], 0.25, 0);
    expect(TestAudioContext.instances[0].voices).toHaveLength(0);
    expect(wav.byteLength).toBe(44 + 24000);
    expect(wav.subarray(44).every((value) => value === 0)).toBe(true);
  });

  it.each([-1, NaN, Infinity])(
    'rejects invalid cue time %s before allocating audio',
    async (time) => {
      await expect(renderOfflineAudio([{ cue: 'hit', time }], 1)).rejects.toThrow();
      expect(TestAudioContext.instances).toHaveLength(0);
    },
  );

  it.each(['unknown', '__proto__'])(
    'rejects the unknown cue %s before allocating audio',
    async (cue) => {
      await expect(renderOfflineAudio([{ cue: cue as SoundCue, time: 0 }], 1)).rejects.toThrow();
      expect(TestAudioContext.instances).toHaveLength(0);
    },
  );

  it.each([0, -1, NaN, Infinity, 100000])('rejects invalid WAV duration %s', async (duration) => {
    await expect(renderOfflineAudio([], duration)).rejects.toThrow();
    expect(TestAudioContext.instances).toHaveLength(0);
  });

  it.each([-1, NaN, Infinity, 1])('rejects invalid volume %s', async (volume) => {
    await expect(renderOfflineAudio([], 1, volume)).rejects.toThrow();
    expect(TestAudioContext.instances).toHaveLength(0);
  });
});
