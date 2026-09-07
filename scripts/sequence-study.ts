import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DEFAULT_CONFIG, DT, SKILLS, VERSION } from '../src/content/data';
import { ENCOUNTER_SET_IDS } from '../src/content/encounters';
import { runPolicy } from '../src/ai/runner';
import { runReplay } from '../src/lab/session';
import { advance, command, copy, createState, step } from '../src/sim/engine';
import { planned } from '../src/sim/plan';
import type { Config, State } from '../src/sim/types';

const dir = resolve(process.argv[2] ?? 'artifacts/sequence-v9');
if (existsSync(dir)) throw new Error(`Choose a new results directory: ${dir}`);
mkdirSync(dir, { recursive: true });
const variants = [
  { name: 'continuous', atbMode: 'continuous', chainActions: false, atbRate: 0.55 },
  { name: 'link-only', atbMode: 'continuous', chainActions: true, atbRate: 0.55 },
  { name: 'stop-only', atbMode: 'idle', chainActions: false, atbRate: 0.55 },
  { name: 'both-055', atbMode: 'idle', chainActions: true, atbRate: 0.55 },
  { name: 'both-085', atbMode: 'idle', chainActions: true, atbRate: 0.85 },
  { name: 'both-100', atbMode: 'idle', chainActions: true, atbRate: 1 },
] satisfies (Pick<Config, 'atbMode' | 'chainActions' | 'atbRate'> & { name: string })[];
const slash = (s: State) =>
  command(s, {
    type: 'enqueue',
    id: 0,
    step: { kind: 'skill', skillId: 'slash', target: { kind: 'enemy', id: 0 } },
  });
function isolated(config: Partial<Config> = {}, initialAtb = 4) {
  const s = createState({ bonusMode: 'none', ...config });
  command(s, { type: 'start' });
  s.allies[0].atb = initialAtb;
  s.allies.slice(1).forEach((a) => {
    a.hp = 0;
  });
  s.enemies.forEach((e) => {
    e.nextAttack = 999;
    e.hp = e.maxHp = 100000;
  });
  return s;
}
const micro = variants.flatMap((v) =>
  [1, 4].map((initialAtb) => {
    const s = isolated(v, initialAtb),
      a = s.allies[0];
    for (let i = 0; i < 4; i++) slash(s);
    step(s);
    const first = s.time;
    for (let i = 0; i < 3000 && (a.action || planned(a).length); i++) step(s);
    const finished = s.time,
      remainingAtb = a.atb;
    for (let i = 0; i < 3000 && a.atb < s.config.atbMax; i++) step(s);
    return {
      variant: v.name,
      initialAtb,
      executionSeconds: finished - first,
      cycleSeconds: s.time - first,
      remainingAtb,
      starts: s.events.filter((e) => e.type === 'action').map((e) => e.time - first),
    };
  }),
);
function tactical(enemyHp: number, cut: boolean) {
  const s = isolated(),
    a = s.allies[0];
  s.enemies[0].hp = s.enemies[0].maxHp = enemyHp;
  s.enemies.slice(1).forEach((e) => {
    e.hp = 0;
  });
  a.hp = 600;
  for (let i = 0; i < 4; i++) slash(s);
  while (a.action?.comboIndex !== 2) step(s);
  const decisionAt = s.time,
    atbBefore = a.atb;
  s.enemies[0].cast = {
    name: '判断用の追尾予告',
    target: 'single',
    row: 'front',
    allyId: 0,
    remaining: 2.8,
    total: 2.8,
    power: 800,
    movable: false,
    push: false,
  };
  if (cut) {
    command(s, { type: 'cancel', id: 0 });
    command(s, {
      type: 'enqueue',
      id: 0,
      step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
    });
  }
  advance(s, 3);
  const guard = s.events.find((e) => e.text.includes('防護'));
  return {
    enemyHp,
    cut,
    decisionAt,
    atbBefore,
    atbAfter: a.atb,
    guardAfter: guard ? guard.time - decisionAt : null,
    hp: a.hp,
    enemyRemaining: s.enemies[0].hp,
    damageTaken: s.metrics.taken,
    phase: s.phase,
  };
}
const tactics = [300, 100000].flatMap((hp) => [false, true].map((cut) => tactical(hp, cut)));
if (!(
  tactics[0].damageTaken === 0 &&
  tactics[1].damageTaken > 0 &&
  tactics[2].hp === 0 &&
  tactics[3].hp > 0
))
  throw new Error('Tactical contrast did not hold');
const policies = ['rush', 'balanced', 'tactician'] as const;
const seeds = [1307, 1308];
const rows: Record<string, any>[] = [];
const records: string[] = [];
for (const v of variants)
  for (const initialAtb of [1, 4]) {
    for (const encounterSet of ENCOUNTER_SET_IDS)
      for (const policy of policies)
        for (const seed of seeds) {
          const r = runPolicy({
            ...v,
            initialAtb,
            encounterSet,
            encounterLevel: 1,
            policy,
            seed,
            planning: 'queue',
            maxSeconds: 180,
            verifyReplay: true,
            loadout: 'keep',
          });
          let chainResets = 0;
          let previous: { encounter: number; chains: number[]; hp: number[] } | undefined;
          runReplay(r.recording, undefined, (s) => {
            if (previous?.encounter === s.encounter)
              s.enemies.forEach((e, i) => {
                if (e.hp > 0 && previous!.hp[i] > 0 && e.chain === 100 && previous!.chains[i] > 100)
                  chainResets++;
              });
            previous = {
              encounter: s.encounter,
              chains: s.enemies.map((e) => e.chain),
              hp: s.enemies.map((e) => e.hp),
            };
          });
          let overheal = 0;
          const currentSkill = new Map<string, string>();
          for (const e of r.events) {
            if (e.type === 'action' && e.source) {
              const sk = Object.values(SKILLS).find((sk) => e.text.endsWith(`→ ${sk.name}`));
              if (sk) currentSkill.set(e.source, sk.id);
            }
            if (e.type === 'heal' && e.source && e.value !== undefined) {
              const sk = SKILLS[currentSkill.get(e.source)!];
              if (sk && ['heal', 'potion'].includes(sk.effect)) overheal += sk.power - e.value;
            }
          }
          rows.push({ variant: v.name, ...r.summary, chainResets, overheal });
          records.push(
            JSON.stringify({ variant: v.name, summary: rows.at(-1), recording: r.recording }),
          );
        }
    console.log(`${v.name} initial=${initialAtb}: ${rows.length} replay-verified runs`);
  }
function summarize(rs: typeof rows) {
  const mean = (f: (r: (typeof rows)[number]) => number) =>
    rs.reduce((n, r) => n + f(r), 0) / rs.length;
  return {
    runs: rs.length,
    victories: rs.filter((r) => r.outcome === 'victory').length,
    defeats: rs.filter((r) => r.outcome === 'defeat').length,
    timeouts: rs.filter((r) => r.outcome === 'timeout').length,
    meanBattleSeconds: mean((r) => r.seconds),
    meanDamage: mean((r) => r.metrics.damage),
    meanTaken: mean((r) => r.metrics.taken),
    meanChainResets: mean((r) => r.chainResets),
    meanOverheal: mean((r) => r.overheal),
    waitingFraction: mean(
      (r) =>
        r.actorSeconds.waiting /
        Object.values(r.actorSeconds as Record<string, number>).reduce((a, b) => a + b, 0),
    ),
    replaysVerified: rs.every((r) => r.replayVerified),
  };
}
function sources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(path, e.name)) : [join(path, e.name)],
  );
}
const files = [...sources('src'), 'scripts/sequence-study.ts'];
const sourceHash = createHash('sha256');
for (const file of files.sort()) sourceHash.update(file).update(readFileSync(file));
const report = {
  version: VERSION,
  createdAt: new Date().toISOString(),
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceSha256: sourceHash.digest('hex'),
  reproduction: `npm run sim:sequence -- ${dir}`,
  definition: { defaults: DEFAULT_CONFIG, skills: SKILLS },
  conditions: {
    variants,
    initialAtb: [1, 4],
    initialAtbScope: 'first encounter; second encounter uses the normal one ATB reset',
    policies,
    seeds,
    sets: ENCOUNTER_SET_IDS,
    level: 1,
    planning: 'queue',
    loadout: 'keep',
    bonusMode: DEFAULT_CONFIG.bonusMode,
    decisionInterval: 0.25,
    reactionSeconds: 0.35,
    maxSeconds: 180,
    baseline:
      'continuous mode in the current scheduler; not an execution of historical orchestra-7',
    waitingFraction:
      'all living-actor idle time including deliberate waits; not only insufficient ATB',
    chainResets: 'living enemy chain returns to 100; includes break expiration',
    micro: 'one actor; no bonuses or enemy attacks; time from the first start',
    tactical: 'fixed synthetic telegraph, 800 power, 2.8s after second action begins; no bonuses',
  },
  micro,
  tactics,
  aggregate: variants.flatMap((v) =>
    [1, 4].map((initialAtb) => ({
      variant: v.name,
      initialAtb,
      ...summarize(rows.filter((r) => r.variant === v.name && r.initialAtb === initialAtb)),
    })),
  ),
  byPolicy: variants.flatMap((v) =>
    policies.map((policy) => ({
      variant: v.name,
      policy,
      ...summarize(rows.filter((r) => r.variant === v.name && r.policy === policy)),
    })),
  ),
  bySet: variants.flatMap((v) =>
    ENCOUNTER_SET_IDS.map((encounterSet) => ({
      variant: v.name,
      encounterSet,
      ...summarize(rows.filter((r) => r.variant === v.name && r.encounterSet === encounterSet)),
    })),
  ),
};
writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(dir, 'runs.jsonl.gz'), gzipSync(records.join('\n') + '\n'));
console.log(JSON.stringify(report.aggregate));
console.log(JSON.stringify({ micro, tactics }));
