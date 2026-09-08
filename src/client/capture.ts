import { flushSync } from 'react-dom';
import { DT } from '../content/data';
import type { WatchPlayer } from '../ai/watch-player';
import type { Session } from '../lab/session';
import type { BattleSound, SoundCue } from './audio/sound';
import { renderOfflineAudio } from './audio/offline';

export interface CaptureFrame {
  frame: number;
  tick: number;
  time: number;
  phase: string;
  encounter: number;
}

/** Explicit offline export only. The ordinary app never uses this clock. */
export function installCapture(
  session: Session,
  player: WatchPlayer,
  sound: BattleSound,
  refresh: () => void,
) {
  let frame = 0;
  let started = false;
  const cues: { cue: SoundCue; time: number }[] = [];
  const originalPlay = sound.play;
  const originalUnlock = sound.unlock;
  sound.unlocked = true;
  sound.unlock = async () => {};
  sound.play = (cue, input = false) => {
    if (input) sound.lastInputAt = performance.now();
    if (started && sound.enabled) cues.push({ cue, time: frame * DT });
  };
  const status = (): CaptureFrame => ({
    frame,
    tick: session.state.tick,
    time: session.state.time,
    phase: session.state.phase,
    encounter: session.state.encounter,
  });
  const bridge = {
    begin() {
      if (started || session.state.controlMode !== 'ai' || session.state.phase !== 'battle')
        throw new Error('Start a fresh AI battle before recording.');
      if (player.speed !== 1) throw new Error('Offline recording requires AI playback speed 1.');
      started = true;
      sound.observe(session.state, session.log, session.initial);
      return status();
    },
    step() {
      if (!started) throw new Error('Call begin before recording frames.');
      const before = status();
      frame++;
      player.advance(session, DT);
      sound.observe(session.state, session.log, session.initial);
      if (before.phase === 'battle' && session.state.tick !== before.tick + 1)
        throw new Error(`Capture skipped a simulation tick at frame ${frame}.`);
      flushSync(refresh);
      return status();
    },
    result() {
      return {
        recording: session.recording(),
        state: session.state,
        log: session.log,
        cues,
        volume: sound.volume,
        ai: {
          policy: player.policyId,
          planning: player.planning,
          loadout: player.loadout,
          speed: player.speed,
          decisions: player.decisions,
        },
      };
    },
    async audio(duration: number) {
      const wav = await renderOfflineAudio(cues, duration, sound.volume);
      let binary = '';
      for (let offset = 0; offset < wav.length; offset += 32768)
        binary += String.fromCharCode(...wav.subarray(offset, offset + 32768));
      return btoa(binary);
    },
  };
  window.__battleCapture = bridge;
  return () => {
    sound.play = originalPlay;
    sound.unlock = originalUnlock;
    delete window.__battleCapture;
  };
}

declare global {
  interface Window {
    __battleCapture?: CaptureController;
  }
}

interface CaptureController {
  begin(): CaptureFrame;
  step(): CaptureFrame;
  result(): {
    recording: ReturnType<Session['recording']>;
    state: Session['state'];
    log: Session['log'];
    cues: { cue: SoundCue; time: number }[];
    volume: number;
    ai: {
      policy: WatchPlayer['policyId'];
      planning: WatchPlayer['planning'];
      loadout: WatchPlayer['loadout'];
      speed: number;
      decisions: number;
    };
  };
  audio(duration: number): Promise<string>;
}
