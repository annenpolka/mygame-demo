import { chromium, expect } from '@playwright/test';
import { writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cpus, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createState, command } from '../src/sim/engine';

// Real wall-clock rendering benchmark, with deterministic high-HP stress input.
// Build/serve production first: npm run build; npm run preview -- --port 4173
const url = process.env.EFFECTS_URL ?? 'http://127.0.0.1:4173';
const output = process.argv[2] ?? '/tmp/effects-bench.json';
const sourceHead =
  process.env.EFFECTS_SOURCE_REF ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDir = process.env.EFFECTS_SOURCE_DIR ?? process.cwd();
const sourceHash = createHash('sha256');
for (const name of (readdirSync(join(sourceDir, 'src'), { recursive: true }) as string[])
  .filter((n) => /\.(ts|tsx|css)$/.test(n))
  .sort()) {
  sourceHash.update(name);
  sourceHash.update(readFileSync(join(sourceDir, 'src', name)));
}
const sourceSha256 = sourceHash.digest('hex');
const stress = process.env.EFFECTS_STRESS === '1';
const dpr = process.env.EFFECTS_DPR === '2' ? 2 : 1;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const results = [];
  for (let run = 0; run < 3; run++) {
    const page = await browser.newPage({
      viewport: { width: 1366, height: 900 },
      deviceScaleFactor: dpr,
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    const html = await (await fetch(url)).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
    const bundleHashes = await Promise.all(
      assets.map(async (path) => ({
        path,
        sha256: createHash('sha256')
          .update(Buffer.from(await (await fetch(new URL(path, url))).arrayBuffer()))
          .digest('hex'),
      })),
    );
    const s = createState(
      { encounterSet: 'crossfire', atbRate: 3, atbMax: 8, enemyPower: 0.2 },
      'ai',
    );
    command(s, { type: 'start' });
    if (process.env.EFFECTS_VERSION) s.version = process.env.EFFECTS_VERSION;
    for (const a of s.allies) {
      a.maxHp = a.hp = 50000;
      a.atb = 8;
    }
    for (const e of s.enemies) {
      e.maxHp = e.hp = 50000;
      e.nextAttack = 0.2;
    }
    if (stress) {
      s.controlMode = 'manual';
      s.timeMode = 'stop';
      s.config.stopDrain = 1;
      s.time = s.realTime = 1;
      s.tick = 60;
      s.allies.forEach((a) => (a.executionHeld = true));
      // Synthetic sustained upper-bound draw: 24 break bursts held at age .2s.
      // Not a simulated gameplay result or a benchmark of battle AI.
      s.events = Array.from({ length: 24 }, (_, i) => ({
        id: i + 1,
        time: 0.8,
        type: 'break' as const,
        text: '描画負荷試験',
        target: `${i % 2 ? 'a' : 'e'}${i % 3}`,
      }));
      s.eventSeq = 24;
    }
    await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'render-stress.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
    });
    await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
    await page.waitForTimeout(3000);
    if (stress) await expect(page.locator('.fx-cue')).toHaveCount(24);
    const result = await page.evaluate(async () => {
      // tsx keeps function names with this helper inside serialized callbacks.
      (window as any).__name = (fn: unknown) => fn;
      const times: number[] = [],
        tasks: number[] = [],
        paint: number[] = [];
      let maxNodes = 0,
        maxCues = 0,
        maxParticles = 0,
        frames = 0;
      const observer = new PerformanceObserver((list) =>
        tasks.push(...list.getEntries().map((e) => e.duration)),
      );
      observer.observe({ entryTypes: ['longtask'] });
      await new Promise<void>((resolve) => {
        let last = performance.now(),
          start = last;
        const frame = (now: number) => {
          times.push(now - last);
          last = now;
          frames++;
          if (frames % 15 === 0) {
            maxNodes = Math.max(maxNodes, document.querySelectorAll('.battle-effects *').length);
            maxCues = Math.max(maxCues, document.querySelectorAll('.fx-cue').length);
            const canvas = document.querySelector<HTMLCanvasElement>('.battle-particles');
            if (canvas) {
              maxParticles = Math.max(maxParticles, Number(canvas.dataset.particles ?? 0));
              if (canvas.dataset.paintMs) paint.push(Number(canvas.dataset.paintMs));
            }
          }
          if (now - start < 10000) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      observer.disconnect();
      times.shift();
      times.sort((a, b) => a - b);
      paint.sort((a, b) => a - b);
      const percentile = (p: number) =>
        Number(times[Math.floor((times.length - 1) * p)].toFixed(2));
      return {
        frames: times.length,
        medianMs: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        over25msPercent: Number(
          ((100 * times.filter((t) => t > 25).length) / times.length).toFixed(2),
        ),
        longTasks: tasks.length,
        maxLongTaskMs: Math.max(0, ...tasks),
        maxEffectNodes: maxNodes,
        maxCues,
        maxParticles,
        canvasPaintP95Ms: paint.length ? paint[Math.floor((paint.length - 1) * 0.95)] : null,
      };
    });
    results.push({
      run: run + 1,
      ...result,
      battleClockEnd: await page.locator('.battle-clock strong').innerText(),
      bundleHashes,
      errors,
    });
    await page.close();
  }
  const report = {
    schema: 2,
    capturedAt: new Date().toISOString(),
    sourceHead,
    sourceSha256,
    workload: stress
      ? 'synthetic frozen 24 break bursts (768 particles), battle time held, render every real frame'
      : 'live AI crossfire',
    testedVersion: process.env.EFFECTS_VERSION ?? createState().version,
    browser: browser.version(),
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    osRelease: release(),
    url,
    conditions: `Production React; headless Chrome default GPU; 1366x900 DPR${dpr}; crossfire, ${stress ? 'manual, tactical stop, focus drain1/s, 24 synthetic break events held at age .2s' : 'AI, ATB 3/s max8, enemyPower .2'}; all HP 50000; warmup 3s, sample 10s x3; real rAF, no fake clock; sound off; particles/paint sampled every15 frames`,
    results,
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
