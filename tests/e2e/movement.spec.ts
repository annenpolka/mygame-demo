import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { command, createState } from '../../src/sim/engine';
import type { Row, State } from '../../src/sim/types';

function fixture(mode: State['controlMode'] = 'manual') {
  const state = createState({ bonusMode: 'none', encounterSet: 'crossfire' }, mode);
  command(state, { type: 'start' });
  state.allies.forEach((ally) => {
    ally.row = 'front';
    ally.atb = 4;
    ally.executionHeld = true;
  });
  state.enemies.forEach((enemy) => (enemy.nextAttack = 999));
  return state;
}

async function load(page: Page, state: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'movement.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: state.version, state })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
}

async function snapshot(page: Page) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '状態JSON', exact: true }).click();
  const download = await waiting;
  const state = JSON.parse(await readFile((await download.path())!, 'utf8')).state as State;
  await page.getByRole('button', { name: '実験室を閉じる', exact: true }).click();
  return state;
}

const movement = (page: Page, source = 'a0') => page.locator(`.fx-movement[data-source=${source}]`);

async function geometry(cue: Locator) {
  return cue.evaluate((element) => {
    const path = element.querySelector<SVGPathElement>('.fx-move-route')!;
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(path.getTotalLength());
    const position = (selector: string) => {
      const node = element.querySelector<SVGGElement>(selector);
      const matrix = node?.transform.baseVal.consolidate()?.matrix;
      return matrix ? { x: matrix.e, y: matrix.f } : null;
    };
    return {
      progress: Number(element.getAttribute('data-progress')),
      phase: element.getAttribute('data-phase'),
      route: path.getAttribute('d'),
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      token: position('.fx-move-token'),
      destination: position('.fx-move-destination'),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});

for (const from of ['front', 'back'] as const) {
  const to: Row = from === 'front' ? 'back' : 'front';
  test(`${from} to ${to} shows a directed route while the current hit area stays in its lane`, async ({
    page,
  }) => {
    const state = fixture();
    state.allies[0].row = from;
    await load(page, state);
    await page.clock.runFor(32);
    const current = page.locator(`.battle-lane.ally.${from} [data-unit=a0]`);
    const before = await current.boundingBox();
    await page.keyboard.press(to === 'back' ? 'j' : 'k');
    const cue = movement(page);
    await expect(cue).toHaveAttribute('data-from-row', from);
    await expect(cue).toHaveAttribute('data-to-row', to);
    await expect(cue).toHaveAttribute('data-phase', 'moving');
    await expect(cue).toHaveAttribute('data-kind', 'move');
    await page.clock.runFor(180);
    const first = await geometry(cue);
    await page.clock.runFor(180);
    const next = await geometry(cue);
    const direction = to === 'front' ? 1 : -1;
    expect((next.end.x - next.start.x) * direction).toBeGreaterThan(0);
    expect((next.token!.x - first.token!.x) * direction).toBeGreaterThan(0);
    expect(next.progress).toBeGreaterThan(first.progress);
    expect(next.destination!.x).toBeCloseTo(next.end.x, 2);
    expect(next.destination!.y).toBeCloseTo(next.end.y, 2);
    expect(await current.boundingBox()).toEqual(before);
    await page.screenshot({ path: test.info().outputPath(`${from}-to-${to}.png`) });
    await page.clock.runFor(600);
    await expect(page.locator(`.battle-lane.ally.${to} [data-unit=a0]`)).toBeVisible();
    await expect(cue).toHaveAttribute('data-phase', 'landing');
    await expect(cue.locator('.fx-move-token')).toHaveCount(0);
  });
}

test('movement freezes with pause, follows slow time, and reconstructs the same route from a saved state', async ({
  page,
}) => {
  const state = fixture();
  state.config.moveTime = 2;
  command(state, { type: 'move', id: 0, row: 'back' });
  state.allies[0].move = 0.2;
  await load(page, state);
  const cue = movement(page);
  await expect(cue).toHaveAttribute('data-phase', 'moving');
  await page.keyboard.press('p');
  const paused = await geometry(cue);
  await page.clock.runFor(500);
  expect(await geometry(cue)).toEqual(paused);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  await expect(page.locator('.field-time-symbol')).toHaveAttribute('title', 'スロー ×0.25');
  const before = (await snapshot(page)).allies[0].move;
  await page.clock.runFor(500);
  const saved = await snapshot(page);
  expect(saved.allies[0].move - before).toBeCloseTo(0.125, 2);
  const rendered = await geometry(cue);
  expect(rendered.progress).toBeCloseTo(saved.allies[0].move / saved.config.moveTime, 3);
  await page.clock.runFor(300);
  expect((await geometry(cue)).progress).toBeGreaterThan(rendered.progress);
  await load(page, saved);
  expect(await geometry(cue)).toEqual(rendered);
});

test('cancelling an unfinished move removes its route and a real push renders only the committed destination', async ({
  page,
}) => {
  const state = fixture();
  await load(page, state);
  await page.keyboard.press('j');
  await page.clock.runFor(220);
  await expect(movement(page)).toHaveAttribute('data-phase', 'moving');
  await page.keyboard.press('k');
  await expect(movement(page)).toHaveCount(0);
  await expect(page.locator('.battle-lane.ally.front [data-unit=a0]')).toBeVisible();
  state.enemies[0].cast = {
    name: '押し戻す打撃',
    target: 'single',
    row: 'front',
    allyId: 0,
    remaining: 0.1,
    total: 1,
    power: 50,
    movable: true,
    push: true,
  };
  command(state, { type: 'move', id: 0, row: 'back' });
  await load(page, state);
  await page.clock.runFor(180);
  await expect(page.locator('.battle-lane.ally.back [data-unit=a0]')).toBeVisible();
  await expect(movement(page)).toHaveCount(1);
  await expect(movement(page)).toHaveAttribute('data-kind', 'forced');
  await expect(movement(page)).toHaveAttribute('data-phase', 'landing');
  await expect(movement(page)).toHaveAttribute('data-from-row', 'front');
  await expect(movement(page)).toHaveAttribute('data-to-row', 'back');
  expect((await snapshot(page)).allies[0].nextRow).toBeNull();
});

test('reduced motion keeps the mobile route and destination without a moving token or overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = fixture();
  command(state, { type: 'move', id: 0, row: 'back' });
  await load(page, state);
  const cue = movement(page);
  await expect(cue.locator('.fx-move-route')).toBeVisible();
  await expect(cue.locator('.fx-move-destination')).toBeVisible();
  await expect(cue.locator('.fx-move-token')).toHaveCount(0);
  const first = await geometry(cue);
  await page.clock.runFor(400);
  const next = await geometry(cue);
  expect(next.progress).toBeGreaterThan(first.progress);
  expect(next.route).toBe(first.route);
  expect(next.destination).toEqual(first.destination);
  await expect(page.locator('[data-unit=a0] .emblem-body')).toHaveCSS('transform', 'none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('movement-mobile-reduced.png') });
});

test('three simultaneous moves preserve near-command focus and the battlefield and ATB viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 600 });
  const state = fixture();
  await load(page, state);
  await page.clock.runFor(32);
  const basic = page.locator('[data-near-action=basic]');
  await basic.focus();
  const original = await basic.elementHandle();
  await page.keyboard.press('7'); // The first formation sends all three actors to the back.
  await expect(page.locator('.fx-movement[data-phase=moving]')).toHaveCount(3);
  await page.clock.runFor(300);
  const destinations = await Promise.all(
    [0, 1, 2].map(async (id) => (await geometry(movement(page, `a${id}`))).destination!.y),
  );
  for (let index = 1; index < destinations.length; index++)
    expect(destinations[index] - destinations[index - 1]).toBeGreaterThanOrEqual(64);
  await expect(basic).toBeFocused();
  expect(await basic.evaluate((node, prior) => node === prior, original)).toBe(true);
  await expect(basic).toBeInViewport({ ratio: 1 });
  for (const selector of ['.battlefield', '.atb-timeline'])
    await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
  for (const id of [0, 1, 2]) {
    const box = await page.locator(`[data-unit=a${id}] .field-symbol`).boundingBox();
    expect({ width: box!.width, height: box!.height }).toEqual({ width: 64, height: 68 });
  }
  await page.screenshot({ path: test.info().outputPath('movement-three-short.png') });
  await page.clock.runFor(700);
  await expect(page.locator('.battle-lane.ally.back [data-unit]')).toHaveCount(3);
  await expect(basic).toBeFocused();
  expect(await basic.evaluate((node, prior) => node === prior, original)).toBe(true);
  await expect(basic).toBeInViewport({ ratio: 1 });
  for (const selector of ['.battlefield', '.atb-timeline'])
    await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
});

test('offline capture advances movement by one battle tick and wall time cannot move the token', async ({
  page,
}) => {
  await page.goto('/?capture=1');
  const state = fixture('ai');
  state.config.moveTime = 2;
  command(state, { type: 'move', id: 0, row: 'back' });
  state.allies[0].move = 0.2;
  await load(page, state);
  const initial = await page.evaluate(() => window.__battleCapture!.begin());
  const cue = movement(page);
  const first = await geometry(cue);
  const step = await page.evaluate(() => window.__battleCapture!.step());
  expect(step.tick).toBe(initial.tick + 1);
  const captured = await page.evaluate(() => window.__battleCapture!.result().state);
  const next = await geometry(cue);
  expect(next.progress).toBeCloseTo(captured.allies[0].move / captured.config.moveTime, 3);
  expect(next.progress).toBeGreaterThan(first.progress);
  expect(next.token!.x).toBeLessThan(first.token!.x);
  await page.clock.runFor(1000);
  expect(await geometry(cue)).toEqual(next);
  expect(await page.evaluate(() => window.__battleCapture!.result().state)).toEqual(captured);
});
