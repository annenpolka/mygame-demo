import { BattleTimeline } from './BattleTimeline';
import { BattleTimeline as TimelineHistory, type TimelineSelection } from '../lab/timeline';
import { PlaytestNotes } from './PlaytestNotes';
import {
  PlayJournal,
  NOTE_LIMIT,
  NOTE_STORAGE,
  exportNotes,
  ensureNoteCapacity,
  parseNotes,
  prepareNoteReplay,
  prepareNoteComparison,
  emptyPlayView,
  type PlayNote,
  type PlayView,
} from '../lab/playtest';
import { COMBAT_RULES, percent } from '../content/rules';
import { BattleSound, operationFeedback } from './audio/sound';
import { prepareLoadout } from '../ai/composition';
import { BONUS_LABELS, BONUS_MODES } from '../sim/bonuses';
import { AtbTimeline } from './AtbTimeline';
import { Loadout } from './Loadout';
import { BATTLE_TIMING } from '../content/data';
import { WatchPlayer, type WatchPlanning } from '../ai/watch-player';
import type { PolicyId } from '../ai/policies';
import { WatchConsole } from './WatchConsole';
import { PadBattleConsole } from './PadBattleConsole';
import {
  battleInput,
  type BattleAction,
  type BattlePad,
  newBattlePad,
  paletteCursor,
  paletteTargets,
  syncPaletteTargets,
  selectCandidate,
  home,
  openPage,
  confirmChoice,
  choices,
  selectedChoice,
} from '../input/battle-pad';
import { PadSettings } from './PadSettings';
import { useGamepad } from './useGamepad';
import {
  activateFocused,
  navigate,
  cycleFocus,
  focusElement,
  inputScope,
} from '../input/navigation';
import { buttonName, type PadInput } from '../input/gamepad';
import { projectedSlot } from '../sim/plan';
import { ENCOUNTER_SET_IDS, ENCOUNTER_SETS, encounterSet, pressure } from '../content/encounters';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_CONFIG, SKILLS, WEAPONS } from '../content/data';
import type { Command, Config, Target, State } from '../sim/types';
import { Session } from '../lab/session';
import { Battlefield } from './Battlefield';
import { CombatLog } from './CombatLog';

const fmt = (n: number) => n.toFixed(1);
function Key({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [session] = useState(() => new Session());
  const [sound] = useState(() => new BattleSound());
  useEffect(() => sound.attach(), [sound]);
  const [player] = useState(() => new WatchPlayer());
  const [, render] = useState(0);
  const [labOpen, setLabOpen] = useState(false);
  const [loadoutOpen, setLoadoutOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [battleUI, storeBattleUI] = useState(newBattlePad);
  const battleUIRef = useRef(battleUI);
  const setBattleUI = (update: BattlePad | ((previous: BattlePad) => BattlePad)) => {
    const next = typeof update === 'function' ? update(battleUIRef.current) : update;
    battleUIRef.current = next;
    storeBattleUI(next);
  };
  const [notice, setNotice] = useState('');
  const [commandNotice, setCommandNotice] = useState('');
  const [journal] = useState(() => new PlayJournal());
  const [timeline] = useState(() => new TimelineHistory());
  const [timelineOpen, setTimelineOpen] = useState(false);
  const timelineOpenRef = useRef(false);
  const timelinePad = useRef<((action: PadInput) => void) | null>(null);
  const playViewRef = useRef<PlayView>({ battle: battleUI, pending });
  playViewRef.current = { battle: battleUI, pending };
  useLayoutEffect(
    () =>
      session.subscribe(() => {
        if (!timelineOpenRef.current) timeline.observe(session, playViewRef.current);
      }),
    [session, timeline],
  );
  const [notesOpen, setNotesOpen] = useState(false);
  const [resumeGate, setResumeGate] = useState('');
  const notesPause = useRef<boolean | null>(null);
  const restoredView = useRef<{ initial: State; view: PlayView } | null>(null);
  const [notebook, setNotebook] = useState<{ notes: PlayNote[]; error: string; dirty: boolean }>(
    () => {
      try {
        const saved = localStorage.getItem(NOTE_STORAGE);
        return { notes: saved ? parseNotes(saved) : [], error: '', dirty: false };
      } catch (e) {
        return {
          notes: [],
          error: e instanceof Error ? e.message : '保存した印を読めませんでした。',
          dirty: false,
        };
      }
    },
  );
  useEffect(() => {
    if (!notebook.dirty) return;
    try {
      localStorage.setItem(NOTE_STORAGE, exportNotes(notebook.notes));
      setNotebook((n) => ({ ...n, error: '', dirty: false }));
    } catch {
      setNotice(
        '印はこのタブに残っています。ブラウザへ保存できないため、印の一覧からJSON保存してください。',
      );
      setNotebook((n) => ({
        ...n,
        dirty: false,
        error: 'ブラウザへ保存できません。このタブには残っています。印をJSON保存してください。',
      }));
    }
  }, [notebook]);
  useLayoutEffect(() => {
    if (!timelineOpenRef.current) {
      journal.observe(session, { battle: battleUI, pending });
      timeline.observe(session, { battle: battleUI, pending });
    }
  });
  useEffect(() => {
    if (!notesOpen && !timelineOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [notesOpen, timelineOpen]);

  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>({ ...DEFAULT_CONFIG });
  const [compare, setCompare] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const s = session.state,
    watching = s.controlMode === 'ai',
    ally = s.allies[s.selected],
    weapon = WEAPONS[ally.weapons[projectedSlot(ally)]];
  useLayoutEffect(() => {
    setBattleUI((ui) => syncPaletteTargets(session.state, ui));
  });
  const refresh = () => render((x) => x + 1);
  const openTimeline = () => {
    timeline.observe(session, { battle: battleUIRef.current, pending }, true);
    timelineOpenRef.current = true;
    setTimelineOpen(true);
    sound.play('open', true);
  };
  const closeTimeline = () => {
    timelineOpenRef.current = false;
    setTimelineOpen(false);
    sound.play('cancel', true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('.timeline-shortcut:not(:disabled)')?.focus(),
    );
  };
  const resumeTimeline = (selection: TimelineSelection): string | undefined => {
    if (
      selection.branchId === timeline.activeId &&
      selection.index === timeline.active!.points.length - 1
    ) {
      closeTimeline();
      return;
    }
    try {
      const replay = timeline.fork(session, selection);
      if (session.state.controlMode !== 'manual') session.send({ type: 'control', mode: 'manual' });
      restoredView.current = { initial: session.initial, view: replay.view };
      setBattleUI(replay.view.battle);
      setPending(replay.view.pending);
      if (session.state.phase === 'battle') session.send({ type: 'pause', value: true });
      setResumeGate(
        session.state.phase === 'battle'
          ? 'タイムラインの場面に戻りました。元の進行は履歴に残っています。'
          : '',
      );
      setConfig({ ...session.state.config });
      setLabOpen(false);
      timelineOpenRef.current = false;
      setTimelineOpen(false);
      sound.play('confirm', true);
      refresh();
    } catch (e) {
      return e instanceof Error ? e.message : 'この場面から再開できませんでした。';
    }
  };
  const markNow = () => {
    try {
      if (notebook.notes.length >= NOTE_LIMIT)
        throw new Error(`印は${NOTE_LIMIT}件までです。一覧で保存・整理してください。`);
      const note = journal.mark(session, { battle: battleUI, pending });
      ensureNoteCapacity([...notebook.notes, note]);
      setNotebook((n) => ({ notes: [...n.notes, note], error: '', dirty: true }));
      sound.play('confirm', true);
      setNotice(`印 ${notebook.notes.length + 1} を付けました。感想は印の一覧から。`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '印を付けられませんでした。');
    }
  };
  const openNotes = () => {
    notesPause.current = session.state.paused;
    if (session.state.phase === 'battle' && !session.state.paused)
      session.send({ type: 'pause', value: true });
    setNotesOpen(true);
    sound.play('open', true);
    refresh();
  };
  const closeNotes = () => {
    if (notesPause.current === false && session.state.phase === 'battle')
      session.send({ type: 'pause', value: false });
    notesPause.current = null;
    setNotesOpen(false);
    sound.play('cancel', true);
    refresh();
  };
  const resumeNote = (note: PlayNote, point: 'before' | 'marked' | 'entry') => {
    try {
      const replay = prepareNoteReplay(note, point);
      session.replay(JSON.stringify(replay.recording));
      if (session.state.controlMode !== 'manual') session.send({ type: 'control', mode: 'manual' });
      restoredView.current = { initial: session.initial, view: replay.view };
      setBattleUI(replay.view.battle);
      setPending(replay.view.pending);
      journal.branch(session, note, replay.view);
      session.send({ type: 'pause', value: true });
      setResumeGate(
        point === 'before'
          ? '印の少し前に戻りました。'
          : point === 'marked'
            ? '印を付けた瞬間に戻りました。'
            : 'この遭遇の最初に戻りました。',
      );
      notesPause.current = null;
      setNotesOpen(false);
      setLabOpen(false);
      setHelp(false);
      setPadOpen(false);
      setLoadoutOpen(false);
      setConfig({ ...session.state.config });
      sound.play('confirm', true);
      refresh();
    } catch (e) {
      setNotebook((n) => ({
        ...n,
        error: e instanceof Error ? e.message : '再操作を開始できませんでした。',
      }));
    }
  };
  const compareNote = (note: PlayNote) => {
    try {
      const state = prepareNoteComparison(note);
      session.restore(JSON.stringify({ version: state.version, kind: 'snapshot', state }));
      const view = emptyPlayView();
      setBattleUI(view.battle);
      setPending(null);
      journal.observe(session, view);
      journal.sourceId = note.id;
      session.send({ type: 'pause', value: true });
      setResumeGate('現在のルールで遭遇開始から比較します。');
      notesPause.current = null;
      setNotesOpen(false);
      setLabOpen(false);
      setHelp(false);
      setPadOpen(false);
      setLoadoutOpen(false);
      setConfig({ ...session.state.config });
      refresh();
    } catch (e) {
      setNotebook((n) => ({
        ...n,
        error: e instanceof Error ? e.message : '現在のルールで開始できませんでした。',
      }));
    }
  };
  const loadNotes = async (file: File) => {
    try {
      const incoming = parseNotes(await file.text());
      const notes = [
        ...notebook.notes,
        ...incoming.filter((x) => !notebook.notes.some((y) => x.id === y.id)),
      ];
      if (notes.length > NOTE_LIMIT)
        throw new Error(
          `読み込み後の印が${NOTE_LIMIT}件を超えます。保存・整理してから読み込んでください。`,
        );
      ensureNoteCapacity(notes);
      setNotebook({ notes, error: '', dirty: true });
    } catch (e) {
      setNotebook((n) => ({
        ...n,
        error: e instanceof Error ? e.message : '印を読めませんでした。',
      }));
    }
  };

  const send = (...commands: Command[]) => {
    for (const c of commands) {
      if (c.type === 'pause' && !c.value) setResumeGate('');
      if (c.type === 'start' && session.state.controlMode === 'ai')
        session.send(...prepareLoadout(session.state, player.loadout));
      const feedback = operationFeedback(c, session.state);
      const accepted = session.send(c)[0];
      sound.play(accepted ? feedback.cue : 'error', true);
      if (
        [
          'draft',
          'enqueue',
          'executeSequence',
          'cancel',
          'removePlan',
          'cancelFirst',
          'select',
          'move',
          'toggleRow',
          'weapon',
          'toggleWeapon',
          'optima',
          'formation',
          'time',
        ].includes(c.type)
      ) {
        setCommandNotice(accepted ? feedback.label : '今はこの操作を実行できません。');
        setNotice('');
      } else if (!['editPreset', 'editPresetRow', 'editFormation'].includes(c.type)) {
        setNotice(accepted ? feedback.label : '今はこの操作を実行できません。');
      }
    }
    refresh();
  };
  const switchControl = () => {
    sound.play('confirm', true);
    if (watching && s.phase === 'battle')
      session.send(...s.allies.map((a) => ({ type: 'cancel' as const, id: a.id })), {
        type: 'time',
        mode: 'normal',
      });
    if (!watching && s.phase === 'battle') session.send({ type: 'time', mode: 'normal' });
    session.send({ type: 'control', mode: watching ? 'manual' : 'ai' });
    player.paused = false;
    setPending(null);
    setBattleUI(newBattlePad());
    refresh();
    if (!watching)
      requestAnimationFrame(() =>
        focusElement(
          document.querySelector<HTMLElement>(
            s.phase === 'ready' ? '[data-pad-default]' : '.watch-pause',
          ) ?? undefined,
        ),
      );
  };
  const configureAI = (policy: PolicyId, planning: WatchPlanning) => {
    player.configure(policy, planning);
    if (s.phase === 'battle')
      session.send(...s.allies.map((a) => ({ type: 'cancel' as const, id: a.id })), {
        type: 'time',
        mode: 'normal',
      });
    refresh();
  };
  const select = (id: number) => {
    setBattleUI(home);
    setPending(null);
    send({ type: 'select', id });
  };
  const pickOptima = (index: number) => {
    send({ type: 'optima', index });
    setPending(null);
  };
  const useSkill = (id: string) => {
    setPending(pending === id ? null : id);
    setBattleUI(pending === id ? home(battleUI) : openPage(s, battleUI, 'target', id));
  };
  const restart = (newConfig?: Config, announce = true) => {
    setResumeGate('');
    setBattleUI(newBattlePad());
    if (newConfig) session.reset(newConfig);
    else {
      const mode = s.controlMode;
      session.retry();
      if (session.state.controlMode !== mode) session.send({ type: 'control', mode });
    }
    setPending(null);
    setNotice(announce ? '開始条件を復元しました。' : '');
    refresh();
  };

  useEffect(() => {
    let previous = performance.now(),
      frame = 0;
    const loop = (now: number) => {
      if (!timelineOpenRef.current) {
        player.advance(session, (now - previous) / 1000);
        sound.observe(session.state, session.log, session.initial);
      }
      previous = now;
      render((x) => x + 1);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const hidden = () => {
      previous = performance.now();
      if (
        document.hidden &&
        !timelineOpenRef.current &&
        (session.state.phase === 'battle' ||
          (session.state.phase === 'loot' && session.state.controlMode === 'ai'))
      ) {
        session.send({ type: 'pause', value: true });
        render((x) => x + 1);
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [session, player, sound]);
  useEffect(() => {
    const blocked =
      timelineOpen ||
      notesOpen ||
      loadoutOpen ||
      s.paused ||
      help ||
      padOpen ||
      ['victory', 'defeat'].includes(s.phase) ||
      (s.phase === 'loot' && !watching);
    if (!blocked) return;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    const focusables = () =>
      [
        ...(dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select, input, textarea, summary',
        ) ?? []),
      ].filter((el) => el.getClientRects().length > 0);
    focusables()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const els = focusables(),
        first = els[0],
        last = els[els.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [s.paused, s.phase, help, padOpen, loadoutOpen, notesOpen, timelineOpen]);
  useEffect(() => {
    if (pending)
      document
        .querySelector<HTMLElement>('.horizontal-field[role=listbox]')
        ?.focus({ preventScroll: true });
  }, [pending]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (timelineOpen) return;
      const nativeActivation =
        (event.key === 'Enter' || event.key === ' ') &&
        event.target instanceof Element &&
        !!event.target.closest('button,summary');
      if (event.repeat) {
        if (nativeActivation) event.preventDefault();
        return;
      }
      if (nativeActivation) return;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof Element && event.target.closest('input,select,textarea'))
      )
        return;
      if (
        event.key.toLowerCase() === 'y' &&
        !help &&
        !padOpen &&
        !loadoutOpen &&
        !notesOpen &&
        !labOpen
      ) {
        event.preventDefault();
        openTimeline();
        return;
      }
      if (notesOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeNotes();
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          navigate(event.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right');
        }
        return;
      }
      if (event.key.toLowerCase() === 'm' && !help && !padOpen && !loadoutOpen) {
        event.preventDefault();
        if (event.shiftKey || s.paused || s.phase !== 'battle') openNotes();
        else markNow();
        return;
      }
      if (watching && !s.paused && !help && !padOpen && !labOpen && !loadoutOpen) {
        if (event.key === ' ' && ['battle', 'loot'].includes(s.phase)) {
          event.preventDefault();
          player.paused = !player.paused;
          refresh();
          return;
        }
        if (
          ![
            'p',
            'P',
            'Escape',
            'Enter',
            'Tab',
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
          ].includes(event.key)
        )
          return;
      }
      if (
        s.phase === 'battle' &&
        !watching &&
        !s.paused &&
        !help &&
        !padOpen &&
        !labOpen &&
        !loadoutOpen
      ) {
        if (event.key.toLowerCase() === 'h') {
          event.preventDefault();
          applyBattleInput('execute');
          return;
        }
        const keys: Record<string, BattleAction> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
          ',': 'targetAllies',
          '.': 'targetEnemies',
          Enter: 'confirm',
          z: 'confirm',
          x: 'skill',
          c: 'guard',
          v: 'potion',
          b: 'cutQueue',
          p: 'pause',
          Escape: 'back',
          q: 'previous',
          e: 'next',
          ' ': 'slow',
          Backspace: 'back',
          Delete: 'back',
          r: 'toggleRow',
          w: 'weapon',
          j: 'rowBack',
          k: 'rowFront',
          t: 'menu',
          l: 'log',
          u: 'tactics',
          i: 'aux',
        };
        const action = keys[event.key] ?? keys[event.key.toLowerCase()];
        if (action) {
          event.preventDefault();
          applyBattleInput(action);
          return;
        }
      }
      if (
        event.key.toLowerCase() === 'p' &&
        s.phase === 'battle' &&
        !help &&
        !padOpen &&
        !labOpen &&
        !loadoutOpen
      ) {
        event.preventDefault();
        send({ type: 'pause', value: !s.paused });
        return;
      }
      if (['Escape', 'Backspace', 'Delete'].includes(event.key)) {
        event.preventDefault();
        if (loadoutOpen) setLoadoutOpen(false);
        else if (padOpen) setPadOpen(false);
        else if (labOpen) setLabOpen(false);
        else if (help) setHelp(false);
        else if (s.paused) send({ type: 'pause', value: false });
        else if (pending) {
          setPending(null);
          setBattleUI(home(battleUI));
        }
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        navigate(event.key.slice(5).toLowerCase() as 'up' | 'down' | 'left' | 'right');
        return;
      }
      if (s.paused || s.phase !== 'battle' || help || padOpen || labOpen || loadoutOpen) return;
      const key = event.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key))
        event.preventDefault();
      if (/^[1-3]$/.test(key)) select(Number(key) - 1);
      else if (key === 'q' || key === 'e') {
        const alive = s.allies.filter((a) => a.hp > 0).map((a) => a.id),
          index = alive.indexOf(s.pendingSelect ?? s.selected);
        select(alive[(index + (key === 'q' ? alive.length - 1 : 1)) % alive.length]);
      } else if (key === 'z') useSkill(weapon.skills[0]);
      else if (key === 'x') useSkill(weapon.skills[1]);
      else if (key === 'c') useSkill('guard');
      else if (key === 'v') useSkill('potion');
      else if (key === 'w') send({ type: 'toggleWeapon', id: s.selected });
      else if (key === 'r') send({ type: 'toggleRow', id: s.selected });
      else if (key === ' ') send({ type: 'time', mode: s.timeMode === 'slow' ? 'normal' : 'slow' });
      else if (/^[7-9]$/.test(key) && s.config.uiMode !== 'individual')
        send({ type: 'formation', index: Number(key) - 7 });
      else if (['a', 's', 'd', 'g'].includes(key)) pickOptima(['a', 's', 'd', 'g'].indexOf(key));
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const applyBattleResult = (r: ReturnType<typeof battleInput>) => {
    const previousUI = battleUIRef.current;
    if (!r.commands.length) {
      if (r.ui.page !== previousUI.page)
        sound.play(r.ui.page === 'command' ? 'cancel' : 'open', true);
      else if (r.ui.key !== previousUI.key) sound.play('nav', true);
      else if (r.ui.stamp !== previousUI.stamp && r.ui.feedback?.kind === 'candidate')
        sound.play('open', true);
      else if (r.ui.stamp !== previousUI.stamp && r.ui.feedback?.kind === 'selection')
        sound.play('nav', true);
      else if (r.ui.message && r.ui.stamp !== previousUI.stamp) sound.play('error', true);
    }
    setPending(r.ui.page === 'target' ? r.ui.skillId : null);
    setBattleUI({
      ...r.ui,
      logOffset: Math.min(r.ui.logOffset, Math.max(0, session.log.length - 6)),
    });
    if (r.commands.length) send(...r.commands);
  };
  const applyBattleInput = (action: BattleAction) => {
    applyBattleResult(battleInput(session.state, battleUIRef.current, action));
  };
  const handlePad = (action: PadInput) => {
    void sound.unlock();
    if (timelineOpen) {
      timelinePad.current?.(action);
      return;
    }
    if (action === 'mark' && !notesOpen && !padOpen && !help && !loadoutOpen) {
      if (s.phase === 'battle' && !s.paused) markNow();
      else openNotes();
      return;
    }
    if (notesOpen) {
      if (action === 'back' || action === 'pause') closeNotes();
      else if (action === 'confirm') activateFocused();
      else if (['up', 'down', 'left', 'right'].includes(action))
        navigate(action as 'up' | 'down' | 'left' | 'right');
      else if (action === 'previous' || action === 'next') cycleFocus(action === 'next' ? 1 : -1);
      return;
    }
    if (
      s.phase === 'battle' &&
      !watching &&
      !s.paused &&
      !help &&
      !padOpen &&
      !labOpen &&
      !loadoutOpen
    ) {
      applyBattleInput(action);
      return;
    }
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
      sound.play('nav', true);
      navigate(action);
      return;
    }
    if (action === 'confirm') {
      activateFocused();
      return;
    }
    if (action === 'back') {
      sound.play('cancel', true);
      if (loadoutOpen) setLoadoutOpen(false);
      else if (padOpen) setPadOpen(false);
      else if (help) {
        setHelp(false);
        if (s.paused) send({ type: 'pause', value: false });
      } else if (s.paused) send({ type: 'pause', value: false });
      else if (pending) {
        setPending(null);
        requestAnimationFrame(() =>
          focusElement(document.querySelector<HTMLElement>('.action-tile') ?? undefined),
        );
      } else if (labOpen) setLabOpen(false);
      return;
    }
    if (action === 'previous' || action === 'next') {
      if (s.paused || help || padOpen || labOpen || s.phase !== 'battle') {
        cycleFocus(action === 'next' ? 1 : -1);
        return;
      }
      const ids = s.allies.filter((a) => a.hp > 0).map((a) => a.id),
        i = ids.indexOf(s.pendingSelect ?? s.selected);
      select(ids[(i + (action === 'next' ? 1 : ids.length - 1)) % ids.length]);
      return;
    }
    if (action === 'menu') {
      inputScope().querySelector<HTMLButtonElement>('.log-heading button')?.click();
      return;
    }
    if (watching && action !== 'pause') return;
    if (padOpen || help || labOpen || s.phase !== 'battle') return;
    if (action === 'pause') {
      send({ type: 'pause', value: !s.paused });
      return;
    }
    if (s.paused) return;
    if (action === 'skill') useSkill(weapon.skills[1]);

    if (action === 'slow') send({ type: 'time', mode: s.timeMode === 'slow' ? 'normal' : 'slow' });
  };
  const gamepad = useGamepad(
    handlePad,
    () => {
      if (
        !timelineOpenRef.current &&
        (session.state.phase === 'battle' ||
          (session.state.phase === 'loot' && session.state.controlMode === 'ai'))
      ) {
        send({ type: 'pause', value: true });
        setNotice('パッドの接続が切れました。休憩ポーズに入りました。');
      }
    },
    padOpen,
    true,
  );
  const padActive = gamepad.usePadDisplay && s.phase === 'battle' && !watching;
  const shownPending = battleUI.page === 'target' ? battleUI.skillId : null;
  const aim = shownPending ? (selectedChoice(s, battleUI)?.target ?? null) : null;
  const aimTarget = (target: Target) => {
    const choice = choices(s, battleUI).find(
      (c) => c.target && JSON.stringify(c.target) === JSON.stringify(target),
    );
    if (choice && choice.key !== battleUI.key) {
      sound.play('nav', true);
      setBattleUI({ ...battleUI, key: choice.key });
    }
  };
  const backFromTarget = () => {
    sound.play('cancel', true);
    setPending(null);
    setBattleUI(home);
  };
  const chooseTarget = (target: Target) => {
    const choice = choices(s, battleUI).find(
      (c) => c.target && JSON.stringify(c.target) === JSON.stringify(target),
    );
    if (!choice) return;
    const result = confirmChoice(s, battleUI, choice.key);
    applyBattleResult(result);
    if (!padActive && result.commands.length) setPending(null);
  };
  const targetContext = useRef({ initial: session.initial, encounter: s.encounter });
  useLayoutEffect(() => {
    const restored = restoredView.current;
    restoredView.current = null;
    const fresh =
      targetContext.current.initial !== session.initial ||
      targetContext.current.encounter !== s.encounter;
    targetContext.current = { initial: session.initial, encounter: s.encounter };
    if (restored?.initial === session.initial) {
      setBattleUI(syncPaletteTargets(s, restored.view.battle));
      setPending(restored.view.pending);
    } else {
      setBattleUI((ui) => syncPaletteTargets(s, fresh ? newBattlePad() : home(ui)));
      setPending(null);
    }
  }, [s.phase, s.encounter, s.selected, gamepad.usePadDisplay, session.initial]);
  useEffect(() => {
    if (pending && ![...weapon.skills, 'guard', 'potion'].includes(pending)) setPending(null);
  }, [weapon.id, pending]);
  const loadFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text(),
        data = JSON.parse(text);
      if (data.kind === 'snapshot') session.restore(text);
      else session.replay(text);
      setConfig({ ...session.state.config });
      setLabOpen(false);
      setPending(null);
      setNotice(
        data.kind === 'snapshot'
          ? '保存状態を復元しました。'
          : '入力列を再生し、記録の終端状態を復元しました。',
      );
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '読み込みに失敗しました。');
    }
  };
  return (
    <div className={`app ${s.timeMode} ${s.paused ? 'is-paused' : ''}`}>
      <header
        className="topbar"
        inert={
          timelineOpen ||
          notesOpen ||
          loadoutOpen ||
          s.paused ||
          help ||
          padOpen ||
          ['victory', 'defeat'].includes(s.phase) ||
          (s.phase === 'loot' && !watching)
        }
      >
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">◈</span>
          <span>
            境界のオルケストラ<small>ORCHESTRA OF THE VERGE</small>
          </span>
        </a>
        {!gamepad.pad && (
          <div className="chapter">
            <span className="eyebrow">BATTLE STUDY / 01</span>
            <span>{encounterSet(s.config).stages[s.encounter - 1]}</span>
            <i>{s.encounter} / 2</i>
          </div>
        )}
        {gamepad.pad && (
          <div className="pad-hints">
            {gamepad.supported ? (
              <>
                <b>{buttonName(gamepad.bindings.confirm, gamepad.family)}</b> 基本技・決定{' '}
                <b>{buttonName(gamepad.bindings.back, gamepad.family)}</b> 戻る{' '}
                <b>
                  {buttonName(gamepad.bindings.previous, gamepad.family)} /{' '}
                  {buttonName(gamepad.bindings.next, gamepad.family)}
                </b>{' '}
                仲間 <b>{buttonName(gamepad.bindings.execute, gamepad.family)}</b> 行動開始{' '}
                <b>{buttonName(gamepad.bindings.cutQueue, gamepad.family)}</b> 後続取消
              </>
            ) : (
              'パッド設定で、この機器のボタンを割り当ててください。'
            )}
          </div>
        )}

        <nav aria-label="補助操作">
          <button
            aria-label="効果音を切り替え"
            aria-pressed={sound.enabled}
            title={sound.unlocked ? '効果音のON/OFF' : 'クリックかキー入力で音声を有効にします'}
            onClick={() => {
              if (sound.enabled && !sound.unlocked) {
                void sound.unlock().then(() => {
                  sound.play('confirm', true);
                  refresh();
                });
                return;
              }
              sound.setEnabled(!sound.enabled);
              if (sound.enabled) sound.play('confirm', true);
              refresh();
            }}
          >
            {sound.enabled ? (sound.unlocked ? '♪ 音ON' : '♪ 音を開始') : '♪ 音OFF'}
          </button>
          <button className={watching ? 'active' : ''} onClick={switchControl}>
            {watching ? '手動に戻る' : 'AI鑑賞'}
          </button>
          <button
            onClick={() => {
              setPadOpen(true);
              if (s.phase === 'battle') send({ type: 'pause', value: true });
            }}
            aria-label="ゲームパッド設定"
          >
            {gamepad.pad
              ? `🎮 ${gamepad.family === 'playstation' ? 'PS' : gamepad.family === 'switch' ? 'Switch' : 'Xbox'}`
              : '🎮 パッド'}
          </button>
          {s.phase === 'ready' && <button onClick={() => setLoadoutOpen(true)}>編成</button>}
          <button
            className={labOpen ? 'active' : ''}
            onClick={() => setLabOpen(!labOpen && !loadoutOpen)}
          >
            ⚙ 実験室
          </button>
          <button
            onClick={() => {
              setHelp(true);
              if (s.phase === 'battle') send({ type: 'pause', value: true });
            }}
          >
            操作説明
          </button>
          <button
            aria-label="ポーズ"
            disabled={s.phase !== 'battle'}
            onClick={() => send({ type: 'pause', value: !s.paused })}
          >
            Ⅱ <Key>P</Key>
          </button>
        </nav>
      </header>

      <main
        className={`battle-layout pad-layout ${!padActive && !watching ? 'keyboard-layout' : ''} ${watching ? 'watch-layout' : ''}`}
        inert={
          timelineOpen ||
          notesOpen ||
          loadoutOpen ||
          s.paused ||
          help ||
          padOpen ||
          ['victory', 'defeat'].includes(s.phase) ||
          (s.phase === 'loot' && !watching)
        }
      >
        <section className="battle-main" aria-label="戦闘画面">
          <div className="battle-heading">
            <div>
              <span className="eyebrow">
                ENCOUNTER {String(s.encounter).padStart(2, '0')} / 強度{' '}
                {s.config.encounterLevel ?? 1}
              </span>
              <h1>
                {encounterSet(s.config).stages[s.encounter - 1]}
                <span>ASHEN BELFRY</span>
              </h1>
            </div>
            <div className="playtest-shortcuts">
              <button
                aria-label="今のところに印を付ける"
                disabled={s.phase !== 'battle'}
                onClick={markNow}
              >
                <kbd>
                  {gamepad.usePadDisplay ? buttonName(gamepad.bindings.mark, gamepad.family) : 'M'}
                </kbd>
                今のところ
              </button>
              <button
                className="timeline-shortcut"
                aria-label="タイムライン"
                onClick={openTimeline}
              >
                {!gamepad.usePadDisplay && <kbd>Y</kbd>} タイムライン
              </button>
              <button aria-label="印の一覧" onClick={openNotes}>
                印 {notebook.notes.length}
              </button>
            </div>
            <div className="battle-clock">
              <small>BATTLE TIME</small>
              <strong>
                {Math.floor(s.time / 60)
                  .toString()
                  .padStart(2, '0')}
                <em>:</em>
                {(s.time % 60).toFixed(1).padStart(4, '0')}
              </strong>
            </div>
          </div>

          {s.phase === 'ready' && (
            <section className="encounter-picker" aria-label="戦闘セット選択">
              <div className="section-label">
                <b>戦闘セット</b>
                <small>各セット2連戦</small>
              </div>
              <div className="encounter-choices">
                {ENCOUNTER_SET_IDS.map((id) => (
                  <button
                    key={id}
                    aria-pressed={(s.config.encounterSet ?? 'belfry') === id}
                    title={ENCOUNTER_SETS[id].description}
                    onClick={() => {
                      const next = { ...s.config, encounterSet: id, encounter: 1 as const };
                      setConfig(next);
                      restart(next, false);
                    }}
                  >
                    {ENCOUNTER_SETS[id].name}
                  </button>
                ))}
              </div>
              <p>{encounterSet(s.config).description}</p>
              <div className="bonus-picker" aria-label="編成ボーナス設定">
                <b>編成ボーナス</b>
                {BONUS_MODES.map((mode) => (
                  <button
                    key={mode}
                    aria-pressed={s.config.bonusMode === mode && s.config.enemyHpScale === 1}
                    onClick={() => {
                      const next = { ...s.config, bonusMode: mode, enemyHpScale: 1 };
                      setConfig(next);
                      restart(next, false);
                    }}
                  >
                    {BONUS_LABELS[mode]}
                  </button>
                ))}
                <button
                  aria-pressed={s.config.bonusMode === 'strong' && s.config.enemyHpScale === 1.4}
                  title="標準ABSの戦闘時間を揃える比較。敵HPは1.4倍です。"
                  onClick={() => {
                    const next = { ...s.config, bonusMode: 'strong' as const, enemyHpScale: 1.4 };
                    setConfig(next);
                    restart(next, false);
                  }}
                >
                  強め・速度比較
                </button>
                <small>現在出ているロールが、全員へ効果を与えます。</small>
              </div>
              <div className="level-choices" aria-label="戦闘の強度">
                <b>強度</b>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((level) => (
                  <button
                    key={level}
                    aria-label={`強度 ${level}`}
                    aria-pressed={(s.config.encounterLevel ?? 1) === level}
                    onClick={() => {
                      const next = { ...s.config, encounterLevel: level };
                      setConfig(next);
                      restart(next, false);
                    }}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <small>
                強度 {s.config.encounterLevel ?? 1}：敵HP ×
                {pressure(s.config.encounterLevel).hp.toFixed(2)} / 敵ダメージ ×
                {pressure(s.config.encounterLevel).damage.toFixed(2)}
              </small>
            </section>
          )}
          {s.phase === 'ready' && (
            <div className="ready-bar">
              <p>
                <strong>武器と隊列を選んで、出発。</strong>
                <span>
                  {watching
                    ? 'AI方針を選んで2連戦を鑑賞できます。'
                    : '選択中の仲間は手動操作。ほかの仲間は自動で戦います。'}
                </span>
              </p>
              <button data-pad-default className="primary" onClick={() => send({ type: 'start' })}>
                {watching ? 'AI鑑賞を開始' : '戦闘開始'} <span>→</span>
              </button>
            </div>
          )}

          <Battlefield
            state={s}
            pending={shownPending ? SKILLS[shownPending] : null}
            aim={aim}
            targets={s.phase === 'battle' && !watching ? paletteTargets(s, battleUI) : null}
            recovery={battleUI.targetRecovery}
            palette={
              s.phase === 'battle' && !watching && !shownPending ? paletteCursor(s, battleUI) : null
            }
            onCandidate={(side, target) => setBattleUI(selectCandidate(s, battleUI, side, target))}
            onAlly={select}
            onTarget={chooseTarget}
            onAim={aimTarget}
            onBack={backFromTarget}
            confirmLabel={
              padActive ? buttonName(gamepad.bindings.confirm, gamepad.family) : 'Enter'
            }
            navigationLabel={
              padActive
                ? `${gamepad.bindings.navigation === 'dpad' ? '十字キー' : '左スティック'}：駒の位置へ · ${gamepad.bindings.sideAxis < 0 ? '補助で敵／味方' : '右スティック ← 味方 / → 敵'}`
                : undefined
            }
            backLabel={padActive ? buttonName(gamepad.bindings.back, gamepad.family) : 'Esc'}
          />
          {s.phase === 'battle' && (
            <AtbTimeline
              state={s}
              send={send}
              select={select}
              act={applyBattleInput}
              keyboard={!padActive}
              bindings={gamepad.bindings}
              family={gamepad.family}
            />
          )}
        </section>

        {watching ? (
          <WatchConsole
            state={s}
            player={player}
            refresh={refresh}
            configure={configureAI}
            select={select}
          />
        ) : s.phase === 'battle' ? (
          <PadBattleConsole
            state={s}
            keyboard={!padActive}
            ui={battleUI}
            bindings={gamepad.bindings}
            family={gamepad.family}
            log={session.log}
            act={applyBattleInput}
            pick={(key) => applyBattleResult(confirmChoice(s, battleUI, key))}
            remove={(key) =>
              applyBattleResult(
                confirmChoice(s, { ...battleUI, page: 'queue', queueFocus: undefined, key }, key),
              )
            }
            open={(page) => {
              sound.play('open', true);
              setBattleUI(openPage(s, battleUI, page));
            }}
            select={select}
          />
        ) : null}
      </main>

      <div
        className="log-container"
        inert={
          timelineOpen ||
          notesOpen ||
          loadoutOpen ||
          s.paused ||
          help ||
          padOpen ||
          ['victory', 'defeat'].includes(s.phase) ||
          (s.phase === 'loot' && !watching)
        }
      >
        <CombatLog
          entries={session.log}
          onExport={() =>
            download(
              'orchestra-battle-log.json',
              JSON.stringify({ config: s.config, events: session.log }, null, 2),
            )
          }
        />
      </div>

      {labOpen && (
        <aside
          className="lab-drawer"
          aria-label="実験室"
          inert={
            timelineOpen ||
            notesOpen ||
            loadoutOpen ||
            s.paused ||
            help ||
            padOpen ||
            ['victory', 'defeat'].includes(s.phase) ||
            (s.phase === 'loot' && !watching)
          }
        >
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">BATTLE LAB</span>
              <h2>実験室</h2>
            </div>
            <button aria-label="実験室を閉じる" onClick={() => setLabOpen(false)}>
              ×
            </button>
          </div>
          <p className="lab-note">
            開いている間も戦闘は進行します。数値・装備は再開始時か戦闘の合間に変更できます。
          </p>
          <div className="lab-actions">
            <button onClick={() => restart()}>同じ条件でリトライ</button>
            <button
              onClick={() => {
                setSnapshot(session.snapshot());
                setNotice('現在の状態を一時保存しました。');
              }}
            >
              状態を保存
            </button>
            <button
              disabled={!snapshot}
              onClick={() => {
                if (snapshot) {
                  session.restore(snapshot);
                  setPending(null);
                  setNotice('保存時点へ戻りました。');
                  refresh();
                }
              }}
            >
              保存状態へ戻る
            </button>
          </div>
          <div className="lab-section">
            <h3>次の再開始の条件</h3>
            <label>
              操作方式
              <select
                aria-label="操作方式"
                value={config.uiMode === 'linked' ? 'separate' : config.uiMode}
                onChange={(e) =>
                  setConfig({ ...config, uiMode: e.target.value as Config['uiMode'] })
                }
              >
                <option value="separate">分離＋一括隊列</option>
                <option value="individual">分離＋個別隊列のみ</option>
              </select>
            </label>
            <label>
              遭遇
              <select
                aria-label="遭遇"
                value={config.encounter}
                onChange={(e) =>
                  setConfig({ ...config, encounter: Number(e.target.value) as 1 | 2 })
                }
              >
                <option value={1}>第一戦から</option>
                <option value={2}>第二戦だけ試す</option>
              </select>
            </label>
            <label>
              効果音の音量
              <input
                aria-label="効果音の音量"
                type="range"
                min="0"
                max="50"
                step="1"
                value={Math.round(sound.volume * 100)}
                onChange={(e) => {
                  sound.setVolume(Number(e.target.value) / 100);
                  sound.play('nav', true);
                  refresh();
                }}
              />
            </label>
            {(
              [
                ['seed', '乱数seed', 0, 999999, 1],
                ['enemyHpScale', '比較用の敵HP倍率', 0.5, 4, 0.05],
                ['atbMax', '最大ATB・先行入力枠', 2, 8, 1],
                ['atbRate', 'ATB / 秒', 0.2, 3, 0.05],
                ['moveTime', '移動時間 / 秒', 0.1, 2, 0.1],
                ['shiftTime', '武器変更 / 秒', 0.1, 2, 0.05],
                ['enemyPower', '敵の攻撃倍率', 0.2, 3, 0.1],
                ['slowDrain', 'スロー消費 / 秒', 1, 20, 1],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={config[key]}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      [key]: Math.min(max, Math.max(min, Number(e.target.value) || min)),
                    })
                  }
                />
              </label>
            ))}
            <button
              className="primary compact"
              onClick={() => {
                restart(config);
                setLabOpen(false);
              }}
            >
              条件を反映して再開始
            </button>
          </div>
          {(s.phase === 'ready' || s.phase === 'loot') && (
            <>
              <button onClick={() => send({ type: 'labWeapons' })}>検証用に全武器を追加</button>
              <button
                onClick={() => {
                  setLabOpen(false);
                  setLoadoutOpen(true);
                }}
              >
                編成を編集
              </button>
            </>
          )}
          <div className="lab-section">
            <h3>記録と再現</h3>
            <p className="muted">同じルールの入力を待ち時間なしで再生し、終端状態へ戻します。</p>
            <div className="lab-actions">
              <button onClick={() => download('orchestra-state.json', session.snapshot())}>
                状態JSON
              </button>
              <button
                onClick={() =>
                  download('orchestra-replay.json', JSON.stringify(session.recording(), null, 2))
                }
              >
                リプレイJSON
              </button>
              <button onClick={() => upload.current?.click()}>JSONを読み込む</button>
            </div>
            <input
              ref={upload}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <div className="lab-section">
            <h3>今回の記録</h3>
            <dl className="metrics">
              <div>
                <dt>戦闘時間</dt>
                <dd>{fmt(s.time)}秒</dd>
              </div>
              <div>
                <dt>実時間</dt>
                <dd>{fmt(s.realTime)}秒</dd>
              </div>
              <div>
                <dt>与ダメージ</dt>
                <dd>{s.metrics.damage}</dd>
              </div>
              <div>
                <dt>被ダメージ</dt>
                <dd>{s.metrics.taken}</dd>
              </div>
              <div>
                <dt>回復量</dt>
                <dd>{s.metrics.healed}</dd>
              </div>
              <div>
                <dt>集中力消費</dt>
                <dd>{fmt(s.metrics.focusUsed)}</dd>
              </div>
              <div>
                <dt>ブレイク</dt>
                <dd>{s.metrics.breaks}</dd>
              </div>
              <div>
                <dt>コア指示数</dt>
                <dd>{s.metrics.inputs}</dd>
              </div>
            </dl>
          </div>
          <div className="lab-section">
            <h3>入力ログ</h3>
            <div className="full-log">
              {session.inputs
                .slice(-35)
                .reverse()
                .map((e) => (
                  <p key={e.order}>
                    <time>
                      {e.tick} / #{e.order}
                    </time>
                    {JSON.stringify(e.command)}
                  </p>
                ))}
            </div>
          </div>
          <div className="lab-section">
            <h3>イベントログ</h3>
            <div className="full-log">
              {session.log
                .slice()
                .reverse()
                .map((e) => (
                  <p key={e.id}>
                    <time>{fmt(e.time)}s</time>
                    {e.text}
                  </p>
                ))}
            </div>
          </div>
        </aside>
      )}

      {loadoutOpen && s.phase === 'ready' && (
        <div className="modal-backdrop" inert={notesOpen || timelineOpen}>
          <section className="loadout-modal" role="dialog" aria-modal="true" aria-label="編成編集">
            <header>
              <div>
                <span className="eyebrow">PARTY SETUP</span>
                <h2>武器から、戦い方を組む。</h2>
              </div>
              <button onClick={() => setLoadoutOpen(false)}>編成を閉じる</button>
            </header>
            <Loadout state={s} send={send} onCompare={setCompare} />
          </section>
        </div>
      )}

      {s.phase === 'loot' && !watching && (
        <div className="modal-backdrop" inert={notesOpen || timelineOpen}>
          <section className="loot-modal" role="dialog" aria-modal="true" aria-label="戦利品と編成">
            <span className="eyebrow">ENCOUNTER CLEAR</span>
            <h2>新しい武器、新しい戦い方。</h2>
            <p>HPは全回復。武器を入れ替え、次の戦場へ。</p>
            <div className="loot-cards">
              {['hammer', 'starbow', 'banner'].map((id) => {
                const w = WEAPONS[id];
                return (
                  <button
                    key={id}
                    className={compare === id ? 'active' : ''}
                    onClick={() => setCompare(id)}
                  >
                    <span className="loot-glyph">{w.glyph}</span>
                    <span className="eyebrow">ACQUIRED</span>
                    <h3>{w.name}</h3>
                    <p>
                      <b className={`role role-${w.role}`}>{w.role}</b> {w.archetype} /{' '}
                      {w.specialty}
                    </p>
                    <small>{w.trait}</small>
                  </button>
                );
              })}
            </div>
            <Loadout state={s} send={send} onCompare={setCompare} />
            <button className="timeline-shortcut" onClick={openTimeline}>
              タイムラインを開く
            </button>
            <button onClick={openNotes}>印の一覧（{notebook.notes.length}件）</button>
            <CombatLog
              entries={session.log}
              onExport={() =>
                download(
                  'orchestra-battle-log.json',
                  JSON.stringify({ config: s.config, events: session.log }, null, 2),
                )
              }
            />
            <div className="modal-actions">
              <button
                onClick={() =>
                  download('orchestra-replay.json', JSON.stringify(session.recording(), null, 2))
                }
              >
                一戦目のリプレイを保存
              </button>
              <button
                className="primary"
                onClick={() => {
                  setLabOpen(false);
                  send({ type: 'next' });
                }}
              >
                次の戦闘へ →
              </button>
            </div>
          </section>
        </div>
      )}
      {(s.phase === 'victory' || s.phase === 'defeat') && (
        <div className="modal-backdrop" inert={notesOpen || timelineOpen}>
          <section className="result-modal" role="dialog" aria-modal="true" aria-label="戦闘結果">
            <span className="eyebrow">
              {s.phase === 'victory' ? 'DEMO COMPLETE' : 'TRY ANOTHER APPROACH'}
            </span>
            <span className="result-symbol">{s.phase === 'victory' ? '◈' : '◇'}</span>
            <h2>{s.phase === 'victory' ? '境界を、越えた。' : '調べは、まだ続く。'}</h2>
            <p>
              {s.phase === 'victory'
                ? '二つの戦いを突破しました。'
                : 'パーティーが全滅しました。武器と隊列を変えて再挑戦できます。'}
            </p>
            <div className="result-numbers">
              <div>
                <strong>
                  {fmt(s.time)}
                  <small>秒</small>
                </strong>
                <span>戦闘時間</span>
              </div>
              <div>
                <strong>{s.metrics.taken}</strong>
                <span>被ダメージ</span>
              </div>
              <div>
                <strong>{s.metrics.breaks}</strong>
                <span>ブレイク</span>
              </div>
            </div>
            <CombatLog
              entries={session.log}
              initialOpen
              onExport={() =>
                download(
                  'orchestra-battle-log.json',
                  JSON.stringify({ config: s.config, events: session.log }, null, 2),
                )
              }
            />
            <button className="timeline-shortcut" onClick={openTimeline}>
              タイムラインを開く
            </button>
            <button onClick={openNotes}>印の一覧（{notebook.notes.length}件）</button>
            <button onClick={() => restart({ ...s.config, encounter: 1 })}>
              戦闘セットを選び直す
            </button>
            <button className="primary" onClick={() => restart()}>
              同じ条件でもう一度 →
            </button>
            <button
              onClick={() =>
                download('orchestra-replay.json', JSON.stringify(session.recording(), null, 2))
              }
            >
              リプレイを保存
            </button>
          </section>
        </div>
      )}
      {s.paused && !help && !padOpen && !notesOpen && !timelineOpen && (
        <div className="pause-screen" role="dialog" aria-modal="true" aria-label="休憩ポーズ">
          <span className="eyebrow">INTERMISSION</span>
          <h2>{resumeGate || 'ひと休み。'}</h2>
          <p>戦闘と集中力の消費を停止しています。</p>
          <button className="primary" onClick={() => send({ type: 'pause', value: false })}>
            {resumeGate ? 'この場面から操作する' : '戦場へ戻る'} <Key>Esc</Key>
          </button>
          <button className="timeline-shortcut" onClick={openTimeline}>
            タイムラインを開く
          </button>
          <button onClick={openNotes}>印の一覧（{notebook.notes.length}件）</button>
        </div>
      )}
      {help && (
        <div className="modal-backdrop help-backdrop">
          <section className="help-modal" role="dialog" aria-modal="true" aria-label="操作説明">
            <span className="eyebrow">HOW TO PLAY</span>
            <h2>全体を指揮し、一手を差し込む。</h2>
            <p>
              選択中の仲間は、行動開始を押すまで下書きを実行しません。ほかの仲間は装備中の武器で自動行動します。AはHP削りとチェイン維持、Bはチェイン上昇、Dは被害を受け止める防護、Sは回復・強化・弱体。敵のチェインが
              {COMBAT_RULES.breakThreshold}%になると
              {BATTLE_TIMING.breakDuration}
              秒間ブレイクします。ブレイク中も攻撃でチェインを伸ばし、最大
              {COMBAT_RULES.chainMax}%（×{COMBAT_RULES.chainMax / 100}
              ）まで次の攻撃のダメージ倍率を上げられます。終了時に100%へ戻ります。
            </p>
            <div className="help-grid">
              <div>
                <h3>仲間へ指示する</h3>
                <p>
                  <Key>1</Key>
                  <Key>2</Key>
                  <Key>3</Key> または <Key>Q</Key>
                  <Key>E</Key> で交代を先頭に予約。{SKILLS.handoff.cost} ATB・発動
                  {SKILLS.handoff.cast}
                  秒で交代し、開始時に後続の予約を解除します。満杯でも交代を積めます。
                </p>
                <p>
                  <Key>Z</Key> 基本技、<Key>X</Key> 主力技、<Key>C</Key> 防御を下書きに追加。
                  攻撃と支援の対象は同時に保持します。足元の丸が支援対象、角形が攻撃対象、頭上の印が操作キャラ、四隅の枠が選び直す対象です。敵側を選択中でも支援技は表示中の味方へ入ります。候補を変えても、追加済みの行動の対象や仲間AIの狙いは変わりません。対象が不在になった場合は、生存する別の対象へ自動で切り替え、下書き・予約・発動中の技を継続します。
                  <Key>V</Key> は救急薬、<Key>I</Key> は補助、<Key>U</Key> は次のオプティマ。
                </p>
                <p>
                  <Key>H</Key>{' '}
                  で行動開始。下書きの一組を確定し、その列の合計ATBと現在の一手の終了を待ちます。
                  実行中も次の下書きを作れます。確定済みの未実行分と下書きの合計は最大ATBと同じコスト・手数まで。
                  未開始の確定列は一組まで。開始を連打しても複製も停止もしません。
                </p>
                <p>
                  パッドでは×／Aが基本技、□／Xが主力技、△／Yが防御。○／Bは戻る専用。
                  右トリガーで行動開始、左トリガーで後続取消。左スティックで駒の配置に沿って対象を選び、右スティックの左で味方・右で敵へ切り替えます。キーボードは矢印で移動、コンマで味方・ピリオドで敵。十字キーの左で後列へ、右で前列へ移動。上で次のオプティマ、下で武器変更。R3でスロー、View／Share／−で補助を開きます。
                  薬・一括隊列・対象の切替は補助メニュー。十字キーで選択する代替配置も設定できます。
                </p>
              </div>
              <div>
                <h3>編成と位置を変える</h3>
                <p>
                  <Key>A</Key>
                  <Key>S</Key>
                  <Key>D</Key>
                  <Key>G</Key>{' '}
                  で武器構成を切り替え。Jで後列、Kで前列、Rで前後を切り替えてすぐ移動します。Wで武器変更を指示し、実行中の技があれば終了後に切り替えます。移動と武器変更は下書きを使いません。Escは戻る、Bは確定した後続の取消。TまたはIで補助を開きます。実行中の技と下書きは残ります。支払い済みATBは戻りません。
                  <Key>7</Key>
                  <Key>8</Key>
                  <Key>9</Key> で一括隊列。
                </p>
                <p>
                  前列は全職の威力×{COMBAT_RULES.frontDamage}・チェイン上昇×
                  {COMBAT_RULES.frontChain}。後列は被害を{percent(1 - COMBAT_RULES.rearTaken)}
                  %軽減し、近接の威力は×{COMBAT_RULES.rearMeleeDamage}
                  。射撃・魔法は後列でも威力を維持します。
                </p>
                <p>
                  範囲技は選んだ敵・味方が追加時にいる列へ予約します。その列が空になると、対象がいる列へ自動で切り替えます。対象は戦場の印で確認できます。防御は常に自分。武器変更後に使えない未実行の技は解除されます。
                </p>
              </div>
              <div>
                <h3>考える時間を使う</h3>
                <p>
                  <Key>Space</Key> またはR3でスロー。もう一度押すと通常へ。開始時
                  {COMBAT_RULES.focusActivation}、スロー中は毎実秒{s.config.slowDrain}
                  の集中力を消費します。
                </p>
                <p>
                  <Key>P</Key>{' '}
                  は休憩ポーズ。戦場を隠し、すべての時計を止めます。別タブへの移動でも休憩に入ります。交代後は毎回
                  {BATTLE_TIMING.handoffSlow}
                  実秒間の無料スローで状況を確認できます。再発動待ちはありません。
                </p>
                <p>
                  行動の発動・接続・終了硬直中はATB補充が止まります。メニューを開くだけでは時間は止まりません。
                </p>
              </div>
              <div>
                <h3>予告を読む</h3>
                <p>
                  「列固定」は着弾時の列へ攻撃。「個体追尾」は列を移動しても当たります。「移動で中断可」は敵の押し引きでも構えを崩せます。
                </p>
                <p>
                  セナの鉤槍で砲術師を前列へ引き、アルトの円弧斬りでまとめて攻撃する、といった組み合わせを試せます。
                </p>
              </div>
            </div>
            <button
              className="primary"
              onClick={() => {
                setHelp(false);
                if (s.paused) send({ type: 'pause', value: false });
              }}
            >
              閉じる →
            </button>
          </section>
        </div>
      )}
      {padOpen && <PadSettings controls={gamepad} onClose={() => setPadOpen(false)} />}
      {notesOpen && (
        <PlaytestNotes
          notes={notebook.notes}
          error={notebook.error}
          close={closeNotes}
          change={(id, patch) =>
            setNotebook((n) => ({
              ...n,
              notes: n.notes.map((x) => (x.id === id ? { ...x, ...patch } : x)),
              dirty: true,
            }))
          }
          remove={(id) =>
            setNotebook((n) => ({ ...n, notes: n.notes.filter((x) => x.id !== id), dirty: true }))
          }
          resume={resumeNote}
          compare={compareNote}
          save={() => download('orchestra-playtest-notes.json', exportNotes(notebook.notes))}
          load={loadNotes}
        />
      )}
      {timelineOpen && (
        <BattleTimeline
          history={timeline}
          close={closeTimeline}
          resume={resumeTimeline}
          padAction={timelinePad}
        />
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {commandNotice}
      </div>
      {notice && (
        <div className="toast" role="status" aria-label="操作結果">
          {notice}
        </div>
      )}
    </div>
  );
}
