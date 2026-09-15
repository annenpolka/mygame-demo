import { expect, test, type Page } from '@playwright/test';
import { command, createState } from '../../src/sim/engine';
import type { State } from '../../src/sim/types';

/** Three allies share the front lane; only the telegraphed row attack on it can resolve. */
function fixture(hit: number) {
  const state = createState({ bonusMode: 'none', encounterSet: 'crossfire' });
  command(state, { type: 'start' });
  state.allies.forEach((ally) => {
    ally.row = 'front';
    ally.atb = 0;
    ally.executionHeld = ally.id !== 0;
  });
  state.enemies.forEach((enemy) => (enemy.nextAttack = 999));
  state.enemies[0].cast = {
    name: '前列薙ぎ払い',
    target: 'row',
    row: 'front',
    allyId: 0,
    remaining: hit,
    total: hit,
    power: 250,
    movable: false,
    push: false,
  };
  return state;
}

async function load(page: Page, state: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'guard-forecast.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: state.version, state })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
}

const forecast = (page: Page) => page.locator('[data-unit=a0] .unit-guard-forecast');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});

test('the controlled ally shows whether a guard beats the hit while reservations change', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await load(page, fixture(3.2));
  await expect(forecast(page)).toHaveText('防御なら ✓ 間に合う');
  await expect(forecast(page)).toHaveAttribute('data-guard', 'ready');
  // Only the manually controlled ally receives a forecast; AI allies choose their own reactions.
  await expect(page.locator('.unit-guard-forecast')).toHaveCount(1);

  // Two committed attacks need 2 ATB first, so a guard added now would wait behind them.
  await page.keyboard.press('z');
  await page.keyboard.press('z');
  await page.keyboard.press('h');
  await expect(forecast(page)).toHaveText('防御なら ✗ 予約待ち');
  await expect(forecast(page)).toHaveAttribute('data-guard', 'late');
  await page.keyboard.press('c');
  await expect(forecast(page)).toHaveText('開始で防御 ✗ 予約待ち');
  // Cutting the unstarted attacks keeps the drafted guard; starting it now lands in time.
  await page.keyboard.press('b');
  await expect(forecast(page)).toHaveText('開始で防御 ✓ 間に合う');
  await page.keyboard.press('h');
  await expect(forecast(page)).toHaveText('防御 ✓ 間に合う');
  await expect(forecast(page)).toHaveAttribute('data-source', 'committed');

  await page.clock.runFor(2000);
  await expect(forecast(page)).toHaveText('防護中 ✓ 軽減');
  await page.clock.runFor(1600);
  // The real hit is halved: 250 power on the front row becomes 125 damage.
  await expect(page.getByRole('meter', { name: 'アルトのHP', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '1175',
  );
  await expect(page.locator('.unit-guard-forecast')).toHaveCount(0);
});

test('a hit too close for the stance says so before input', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await load(page, fixture(0.8));
  await expect(forecast(page)).toHaveText('防御なら ✗ 間に合わない');
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 752 },
  { width: 1366, height: 600 },
  { width: 1024, height: 768 },
  { width: 900, height: 600 },
  { width: 390, height: 844 },
])
  for (const layout of ['周囲に展開', '足元にまとめる', '下の操作盤'])
    test(`the forecast stays whole with ${layout} at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: layout, exact: true }).click();
      await load(page, fixture(3.2));
      await page.keyboard.press('z');
      await page.keyboard.press('z');
      await page.keyboard.press('h');
      await page.keyboard.press('c');
      await page.clock.runFor(32);
      await expect(forecast(page)).toHaveText('開始で防御 ✗ 予約待ち');
      const measured = await forecast(page).evaluate((label) => {
        const box = label.getBoundingClientRect();
        const hits = (r: DOMRect) =>
          box.left < r.right && r.left < box.right && box.top < r.bottom && r.top < box.bottom;
        const lane = label.closest('.battle-lane')!.getBoundingClientRect();
        const others = [
          ...document.querySelectorAll('.near-command-button'),
          ...document.querySelectorAll('[data-unit]:not([data-unit=a0])'),
        ];
        return {
          // Visible overflow is not clipping; any scrolling or hidden ancestor must contain it.
          clipped: (() => {
            for (let node = label.parentElement; node; node = node.parentElement) {
              const style = getComputedStyle(node);
              if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
              const r = node.getBoundingClientRect();
              if (
                box.left < r.left ||
                box.right > r.right ||
                box.top < r.top ||
                box.bottom > r.bottom
              )
                return true;
            }
            return false;
          })(),
          insideLane: box.left >= lane.left && box.right <= lane.right,
          overlaps: others.some((node) => hits(node.getBoundingClientRect())),
          fontSize: parseFloat(getComputedStyle(label).fontSize),
        };
      });
      await page.locator('.battlefield').screenshot({
        path: `test-results/guard-forecast/${layout}-${viewport.width}x${viewport.height}.png`,
      });
      expect(measured).toEqual({ clipped: false, insideLane: true, overlaps: false, fontSize: 11 });
    });
