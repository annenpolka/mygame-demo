import { describe, expect, it, vi } from 'vitest';
import { BattleSound, SOUNDS, operationFeedback, type SoundCue } from '../src/client/audio/sound';
import { createState, command } from '../src/sim/engine';
function context() {
  const parameter = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const oscillators: any[] = [];
  const ctx = {
    currentTime: 0,
    state: 'suspended',
    destination: {},
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    createGain: () => ({ gain: parameter(), connect: vi.fn(), disconnect: vi.fn() }),
    createOscillator: () => {
      const o = {
        type: 'sine',
        frequency: parameter(),
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
      };
      oscillators.push(o);
      return o;
    },
  };
  return { ctx, oscillators, sound: new BattleSound(() => ctx as unknown as AudioContext) };
}
describe('operation-specific audio feedback', () => {
  it('gives distinct tones to the major player operations and uses the projected destination role', () => {
    const cues: SoundCue[] = [
      'queue',
      'cancel',
      'move',
      'weapon',
      'optima',
      'actor',
      'guard',
      'item',
      'time',
      'pause',
      'error',
    ];
    expect(new Set(cues.map((c) => JSON.stringify(SOUNDS[c]))).size).toBe(cues.length);
    const s = createState();
    command(s, { type: 'start' });
    expect(operationFeedback({ type: 'toggleWeapon', id: 0 }, s)).toMatchObject({
      cue: 'weapon',
      label: expect.stringContaining('D'),
    });
    command(s, { type: 'toggleWeapon', id: 0 });
    expect(operationFeedback({ type: 'toggleWeapon', id: 0 }, s).label).toContain('A');
    expect(operationFeedback({ type: 'cancelFirst', id: 0 }, s).cue).toBe('cancel');
  });
  it('requires an unlocked context, stops active notes on mute, and bounds rapid repeated hits', async () => {
    const { sound, ctx, oscillators } = context();
    sound.play('queue');
    expect(oscillators).toHaveLength(0);
    await sound.unlock();
    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(sound.unlocked).toBe(true);
    sound.play('queue');
    expect(oscillators).toHaveLength(2);
    for (let i = 0; i < 100; i++) sound.play('hit');
    expect(oscillators).toHaveLength(3);
    sound.setEnabled(false);
    expect(oscillators.every((o) => o.stop.mock.calls.length === 2)).toBe(true);
    sound.play('weapon');
    expect(oscillators).toHaveLength(3);
    sound.setVolume(0);
    expect(sound.volume).toBe(0);
  });
  it('does not replay historical combat sounds on snapshot restore or duplicate a rendered event', async () => {
    const { sound, oscillators, ctx } = context();
    await sound.unlock();
    const s = createState(),
      initial = {},
      damage = {
        id: 1,
        time: 1,
        type: 'damage' as const,
        text: 'hit',
        source: 'a0',
        target: 'e0',
        value: 10,
      };
    sound.observe(s, [], initial);
    sound.observe(s, [damage], initial);
    expect(oscillators).toHaveLength(1);
    ctx.currentTime = 1;
    sound.observe(s, [damage], initial);
    expect(oscillators).toHaveLength(1);
    sound.observe(s, [damage, { ...damage, id: 2 }], {});
    expect(oscillators).toHaveLength(1);
  });
  it('degrades without throwing when audio creation is unavailable', async () => {
    const sound = new BattleSound(() => {
      throw new Error('no audio');
    });
    await sound.unlock();
    expect(sound.unlocked).toBe(false);
    expect(() => sound.play('confirm')).not.toThrow();
  });
});
