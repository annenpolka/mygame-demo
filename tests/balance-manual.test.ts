import { describe, expect, it } from 'vitest';
import { runManualProbes } from '../scripts/balance/manual-probes';
import { stateHash } from '../src/ai/runner';
import { runReplay } from '../src/lab/session';
import { parseRecording } from '../src/lab/validation';
import { SKILLS } from '../src/content/data';

const study = runManualProbes();

describe('synthetic manual handoff comparison', () => {
  it('uses identical initial states for the three interventions and replays every parsed recording', () => {
    for (const condition of study.conditions.fixtures) {
      const runs = study.runs.filter((r) => r.condition.id === condition.id);
      expect(runs).toHaveLength(3);
      expect(new Set(runs.map((r) => r.initialStateHash)).size).toBe(1);
      for (const run of runs) {
        expect(run.replayVerified).toBe(true);
        expect(stateHash(runReplay(parseRecording(JSON.stringify(run.recording))))).toBe(
          run.finalStateHash,
        );
        expect(run.metrics.rejectedCommands).toBe(0);
      }
    }
  });

  it('charges real handoffs and waits until selection and the assumed input delay before healing', () => {
    for (const run of study.runs) {
      const m = run.metrics;
      if (run.mode === 'no-intervention') {
        expect(run.recording.inputs).toHaveLength(0);
        expect(m.request).toBeNull();
        expect(m.handoffAtbSpent).toBe(0);
        expect(m.greatHealCount).toBe(0);
        expect(m.timeTo60Percent).not.toBeNull();
      } else {
        expect(m.handoffAtbSpent).toBe(1);
        expect(m.greatHealAtbSpent).toBe(2);
        expect(m.requestToSelected!.realSeconds).toBeGreaterThanOrEqual(SKILLS.handoff.cast);
        expect(m.skillInput!.realSeconds - m.selected!.realSeconds).toBeCloseTo(0.35, 8);
        expect(m.effectiveHeal!.realSeconds).toBeGreaterThan(m.skillInput!.realSeconds);
        expect(m.requestToEffectiveHeal!.realSeconds).toBeGreaterThan(
          m.requestToEffectiveHeal!.battleSeconds,
        );
        expect(m.commandCount).toBe(2);
      }
    }
  });

  it('exposes low ATB and paid-action commitment as additional handoff latency', () => {
    const pick = (outgoingAtb: number, outgoingAction: 'idle' | 'sweep') =>
      study.runs.find(
        (r) =>
          r.mode === 'immediate-handoff' &&
          r.condition.outgoingAtb === outgoingAtb &&
          r.condition.outgoingAction === outgoingAction &&
          r.condition.healerAtb === 2,
      )!.metrics;
    const high = pick(4, 'idle');
    expect(pick(0, 'idle').requestToSelected!.realSeconds).toBeGreaterThan(
      high.requestToSelected!.realSeconds,
    );
    expect(pick(4, 'sweep').requestToSelected!.realSeconds).toBeGreaterThan(
      high.requestToSelected!.realSeconds,
    );
    expect(pick(0, 'sweep').requestToSelected!.realSeconds).toBeGreaterThan(
      pick(4, 'sweep').requestToSelected!.realSeconds,
    );
  });
});
