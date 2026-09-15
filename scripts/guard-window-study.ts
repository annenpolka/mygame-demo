// Replays AI battles and asks, at each telegraphed hit on an ally, whether a guard input would land
// in time: as the queue stands (C → H), only after clearing unstarted reservations, or not at all.
import { runPolicy } from '../src/ai/runner';
import { runReplay } from '../src/lab/session';
import { ENCOUNTER_SET_IDS } from '../src/content/encounters';
import { VERSION } from '../src/content/data';
import { guardForecast, hitsAlly } from '../src/client/guard-forecast';
import type { State } from '../src/sim/types';

const REACTION_TICKS = 60; // One real second at normal speed.
type Outcome = 'ready' | 'queue' | 'atb' | 'full' | 'resolved';
const tally = {
  telegraph: {} as Record<Outcome, number>,
  afterReaction: {} as Record<Outcome, number>,
};
const add = (bucket: Record<Outcome, number>, o: Outcome) => (bucket[o] = (bucket[o] ?? 0) + 1);
// guardForecast reports the soonest hit on an ally; look at the hit being reacted to.
const outcome = (s: State, allyId: number): Outcome => {
  const f = guardForecast(s, allyId);
  if (!f) return 'resolved';
  return f.ready ? 'ready' : (f.blocked ?? 'atb');
};
let hits = 0,
  stacked = 0;
for (const set of ENCOUNTER_SET_IDS)
  for (const level of [1, 3])
    for (const seed of [1, 2, 3]) {
      const run = runPolicy({
        policy: 'rush',
        planning: 'queue',
        encounterSet: set,
        encounterLevel: level,
        seed,
        verifyReplay: false,
      });
      const seen = new Set<string>();
      const waiting: { tick: number; ally: number }[] = [];
      runReplay(run.recording, undefined, (s) => {
        if (s.phase !== 'battle') return;
        for (const e of s.enemies) {
          if (e.hp <= 0 || !e.cast) continue;
          const key = `${s.encounter}-${e.id}-${e.attackCount}`;
          if (seen.has(key)) continue;
          seen.add(key);
          for (const a of s.allies)
            if (hitsAlly(e.cast, a)) {
              hits++;
              if (s.enemies.some((o) => o !== e && o.hp > 0 && o.cast && hitsAlly(o.cast, a)))
                stacked++;
              add(tally.telegraph, outcome(s, a.id));
              waiting.push({ tick: s.tick, ally: a.id });
            }
        }
        for (let i = waiting.length - 1; i >= 0; i--)
          if (s.tick - waiting[i].tick >= REACTION_TICKS) {
            add(tally.afterReaction, outcome(s, waiting[i].ally));
            waiting.splice(i, 1);
          }
      });
    }
console.log(
  JSON.stringify(
    {
      version: VERSION,
      policy: 'rush/queue',
      sets: ENCOUNTER_SET_IDS,
      levels: [1, 3],
      seeds: [1, 2, 3],
      hits,
      stackedOnSameAlly: stacked,
      ...tally,
    },
    null,
    2,
  ),
);
