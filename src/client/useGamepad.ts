import { useEffect, useRef, useState } from 'react';
import {
  PadReader,
  PAD_ACTIONS,
  defaultBindings,
  padFamily,
  validBindings,
  type PadAction,
  type PadBindings,
  type PadFamily,
  type PadSnapshot,
} from '../input/gamepad';
const STORAGE = 'orchestra-gamepad-v1';
interface Saved {
  family: PadFamily | 'auto';
  custom: Record<string, PadBindings>;
}
function readSaved(): Saved {
  try {
    const x = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    return {
      family: ['auto', 'xbox', 'playstation', 'switch'].includes(x.family) ? x.family : 'auto',
      custom: Object.fromEntries(
        Object.entries(x.custom ?? {}).filter(([, b]) => validBindings(b)),
      ),
    } as Saved;
  } catch {
    return { family: 'auto', custom: {} };
  }
}
export function useGamepad(
  onAction: (a: PadAction) => void,
  onDisconnect: () => void,
  settingsOpen: boolean,
) {
  const [saved, setSaved] = useState(readSaved),
    [pad, setPad] = useState<PadSnapshot | null>(null),
    [capture, setCapture] = useState<PadAction | null>(null),
    [error, setError] = useState('');
  const callbacks = useRef({ onAction, onDisconnect, settingsOpen, saved, capture });
  callbacks.current = { onAction, onDisconnect, settingsOpen, saved, capture };
  const reader = useRef(new PadReader()).current;
  const previousRaw = useRef<boolean[]>([]);
  const captureReady = useRef(false);
  const rearm = useRef(false);
  const family: PadFamily = saved.family === 'auto' ? padFamily(pad?.id ?? '') : saved.family;
  const bindings = pad
    ? (saved.custom[pad.id] ?? defaultBindings(family))
    : defaultBindings(family);
  const supported = !!pad && (pad.mapping === 'standard' || !!saved.custom[pad.id]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(saved));
    } catch {
      setError('設定を保存できません。このタブの間は有効です。');
    }
  }, [saved]);
  useEffect(() => {
    let frame = 0,
      identity = '',
      hadPad = false;
    const poll = (now: number) => {
      let current: Gamepad | null = null;
      try {
        current = Array.from(navigator.getGamepads?.() ?? []).find((p) => p?.connected) ?? null;
      } catch {
        /* Permission restrictions are shown as an unavailable connection. */
      }
      const nextIdentity = current ? `${current.index}:${current.id}` : '';
      if (nextIdentity !== identity) {
        if (hadPad) callbacks.current.onDisconnect();
        identity = nextIdentity;
        hadPad = !!current;
        setPad(
          current
            ? {
                id: current.id,
                index: current.index,
                mapping: current.mapping,
                connected: true,
                buttons: [],
                axes: [],
              }
            : null,
        );
        reader.reset();
        previousRaw.current = [];
        captureReady.current = false;
      }
      const { saved: settings, capture: capturing, settingsOpen: open } = callbacks.current;
      const f = settings.family === 'auto' ? padFamily(current?.id ?? '') : settings.family;
      const b = current ? (settings.custom[current.id] ?? defaultBindings(f)) : defaultBindings(f);
      const raw = current?.buttons.map((b) => b.pressed || b.value > 0.55) ?? [];
      if (capturing && current && !document.hidden) {
        if (!raw.some(Boolean)) captureReady.current = true;
        const pressed = raw.findIndex((x, i) => x && !previousRaw.current[i]);
        if (captureReady.current && pressed >= 0) {
          const next = { ...b, [capturing]: pressed };
          // Swapping a duplicate mapping avoids firing two commands from one button.
          const other = PAD_ACTIONS.find((a) => a !== capturing && next[a] === pressed);
          if (other) next[other] = b[capturing];
          setSaved((s) => ({ ...s, custom: { ...s.custom, [current!.id]: next } }));
          setCapture(null);
          rearm.current = true;
          captureReady.current = false;
        }
      }
      previousRaw.current = raw;
      if (
        rearm.current &&
        !raw.some(Boolean) &&
        (current?.axes ?? []).every((x) => Math.abs(x) < 0.35)
      )
        rearm.current = false;
      const enabled =
        !document.hidden &&
        !rearm.current &&
        !!current &&
        (current.mapping === 'standard' || !!settings.custom[current.id]) &&
        !capturing;
      for (const action of reader.read(current, b, now, enabled))
        callbacks.current.onAction(action);
      if (!open && capturing) setCapture(null);
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [reader]);
  return {
    pad,
    family,
    bindings,
    supported,
    capture,
    error,
    setCapture: (a: PadAction | null) => {
      captureReady.current = false;
      reader.reset();
      setCapture(a);
    },
    setFamily: (family: Saved['family']) => {
      reader.reset();
      setSaved((s) => ({ ...s, family }));
    },
    chosenFamily: saved.family,
    update: (b: PadBindings) => {
      if (pad) {
        reader.reset();
        setSaved((s) => ({ ...s, custom: { ...s.custom, [pad.id]: b } }));
      }
    },
    reset: () => {
      if (pad) {
        reader.reset();
        setSaved((s) => ({
          ...s,
          custom: Object.fromEntries(Object.entries(s.custom).filter(([id]) => id !== pad.id)),
        }));
      }
    },
  };
}
export type GamepadControls = ReturnType<typeof useGamepad>;
