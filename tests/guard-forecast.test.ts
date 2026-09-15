import { describe, expect, it } from 'vitest';
import { command, copy, createState, step } from '../src/sim/engine';
import { guardForecast, guardForecastText } from '../src/client/guard-forecast';
import type { State } from '../src/sim/types';

const slash = {
  kind: 'skill' as const,
  skillId: 'slash',
  target: { kind: 'enemy' as const, id: 1 },
};
const guard = {
  kind: 'skill' as const,
  skillId: 'guard',
  target: { kind: 'ally' as const, id: 0 },
};

function fixture(atb: number, hit: number) {
  const s = createState({ bonusMode: 'none' });
  command(s, { type: 'start' });
  for (const a of s.allies) {
    a.executionHeld = a.id !== 0;
    a.atb = a.id === 0 ? atb : 0;
  }
  for (const e of s.enemies) e.nextAttack = 999;
  s.enemies[0].cast = {
    name: '検証の薙ぎ払い',
    target: 'row',
    row: 'front',
    allyId: 0,
    remaining: hit,
    total: hit,
    power: 100,
    movable: false,
    push: false,
  };
  return s;
}
type Prior = 'none' | 'acting' | 'draftSlash' | 'committedSlashes';
type GuardInput = 'none' | 'draft' | 'committed';
function prepare(s: State, prior: Prior, input: GuardInput) {
  if (prior === 'acting') {
    command(s, { type: 'draft', id: 0, step: slash });
    command(s, { type: 'executeSequence', id: 0 });
    step(s);
  } else if (prior === 'draftSlash') command(s, { type: 'draft', id: 0, step: slash });
  else if (prior === 'committedSlashes') {
    command(s, { type: 'draft', id: 0, step: slash });
    command(s, { type: 'draft', id: 0, step: slash });
    command(s, { type: 'executeSequence', id: 0 });
  }
  if (input !== 'none') command(s, { type: 'draft', id: 0, step: guard });
  if (input === 'committed') command(s, { type: 'executeSequence', id: 0 });
}
/** Step until the telegraphed hit and report whether the real engine shielded ally 0. */
function shieldedAtHit(s: State) {
  const from = s.eventSeq;
  for (let i = 0; i < 60 * 10 && s.enemies[0].cast; i++) step(s);
  const hit = s.events.find((e) => e.id > from && e.type === 'damage' && e.target === 'a0');
  expect(hit).toBeDefined();
  return !!hit!.visual?.shielded;
}

describe('guard forecast against a telegraphed hit', () => {
  const cases: [number, number, Prior, GuardInput][] = [];
  for (const atb of [0, 0.4, 0.9, 1, 2.5])
    for (const prior of ['none', 'acting', 'draftSlash', 'committedSlashes'] as Prior[])
      for (const input of ['none', 'draft', 'committed'] as GuardInput[])
        for (let hit = 0.3; hit <= 4.05; hit += 0.1)
          cases.push([atb, +hit.toFixed(2), prior, input]);

  it('matches the engine for the previewed, drafted and committed guard at every boundary', () => {
    let ready = 0,
      late = 0,
      queued = 0;
    for (const [atb, hit, prior, input] of cases) {
      const s = fixture(atb, hit);
      prepare(s, prior, input);
      if (!s.enemies[0].cast) continue;
      const f = guardForecast(s, 0)!;
      // A second start is refused while an earlier group waits, leaving that guard in the draft.
      const drafted = !!s.allies[0].draft?.some((p) => p.kind === 'skill' && p.skillId === 'guard');
      expect(f.source).toBe(input === 'none' ? 'preview' : drafted ? 'draft' : 'committed');
      const actual = copy(s);
      // Apply exactly the input the forecast is conditional on: C adds a guard, H starts drafts.
      if (input === 'none') command(actual, { type: 'draft', id: 0, step: guard });
      if (f.source !== 'committed') command(actual, { type: 'executeSequence', id: 0 });
      expect(
        shieldedAtHit(actual),
        `atb ${atb}, hit ${hit}, ${prior}, ${input}: ${guardForecastText(f)}`,
      ).toBe(f.ready);
      if (f.ready) ready++;
      else late++;
      if (f.blocked === 'queue') {
        queued++;
        // Clearing every unstarted reservation lets a lone guard make it in time.
        const cleared = copy(s),
          a = cleared.allies[0];
        a.queued = null;
        a.plan = [];
        a.draft = [];
        a.sequences = a.sequences?.filter((b) => b.started);
        command(cleared, { type: 'draft', id: 0, step: guard });
        command(cleared, { type: 'executeSequence', id: 0 });
        expect(shieldedAtHit(cleared), `cleared ${atb} ${hit} ${prior}`).toBe(true);
      }
    }
    expect(ready).toBeGreaterThan(100);
    expect(late).toBeGreaterThan(100);
    expect(queued).toBeGreaterThan(20);
  });

  it('describes the source and reason without relying on colour', () => {
    const s = fixture(0, 0.5);
    expect(guardForecastText(guardForecast(s, 0)!)).toBe('防御なら ✗ 間に合わない');
    const blocked = fixture(1, 3);
    prepare(blocked, 'committedSlashes', 'draft');
    expect(guardForecastText(guardForecast(blocked, 0)!)).toBe('開始で防御 ✗ 予約待ち');
    const ready = fixture(2.5, 2);
    expect(guardForecastText(guardForecast(ready, 0)!)).toBe('防御なら ✓ 間に合う');
    ready.allies[0].shield = 6;
    expect(guardForecastText(guardForecast(ready, 0)!)).toBe('防護中 ✓ 軽減');
  });

  it('only reports hits that reach the ally and does not change the battle state', () => {
    const s = fixture(2, 2);
    s.enemies[0].cast!.row = 'back';
    expect(guardForecast(s, 0)).toBeNull();
    s.enemies[0].cast!.row = 'front';
    const before = JSON.stringify(s);
    guardForecast(s, 0);
    expect(JSON.stringify(s)).toBe(before);
  });
});
