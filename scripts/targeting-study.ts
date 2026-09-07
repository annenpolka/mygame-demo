import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { VERSION } from '../src/content/data';
import { runPolicy } from '../src/ai/runner';

// Same starting equipment and conditions across versions; includes full State replay checks.
const sources = [
  'src/sim/engine.ts',
  'src/sim/targeting.ts',
  'src/content/data.ts',
  'src/ai/policies.ts',
  'src/ai/queue-policy.ts',
  'src/ai/adaptive-policy.ts',
];
const runs = [];
for (const encounterSet of ['belfry', 'bulwark', 'crossfire', 'pursuit', 'attrition'] as const)
  for (const policy of ['autopilot', 'balanced', 'adaptive'] as const)
    for (const seed of [1307, 1308, 1309]) {
      const { summary } = runPolicy({
        policy,
        encounterSet,
        seed,
        planning: 'queue',
        loadout: 'keep',
        verifyReplay: true,
      });
      if (!summary.replayVerified) throw new Error('State replay mismatch');
      runs.push(summary);
    }
const report = {
  version: VERSION,
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  reproduce: 'npx tsx scripts/targeting-study.ts <output.json>',
  sourceHashes: Object.fromEntries(
    sources.map((path) => {
      try {
        return [path, createHash('sha256').update(readFileSync(path)).digest('hex')];
      } catch {
        return [path, null];
      }
    }),
  ),
  runs,
};
writeFileSync(
  process.argv[2] ?? '/tmp/targeting-study.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    version: VERSION,
    runs: runs.length,
    victories: runs.filter((r) => r.outcome === 'victory').length,
    replayVerified: runs.every((r) => r.replayVerified),
  }),
);
