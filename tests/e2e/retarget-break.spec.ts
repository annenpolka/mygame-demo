import { test, expect, type Page } from '@playwright/test';
import { command, createState } from '../../src/sim/engine';
import { makeAction } from '../../src/sim/execution';
import type { State } from '../../src/sim/types';

async function load(page: Page, s: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'battle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
}
function quiet() {
  const s = createState({ bonusMode: 'none' });
  command(s, { type: 'start' });
  s.allies.forEach((a) => {
    a.atb = 4;
    a.executionHeld = a.id !== 0;
  });
  s.enemies.forEach((e) => (e.nextAttack = 999));
  return s;
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});
test('a lost target moves the field selection and paid attack to the survivor while retaining follow-ups', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = quiet();
  s.enemies[0].hp = 1;
  s.allies[1].action = makeAction(s.allies[1], 'spark', { kind: 'enemy', id: 0 });
  s.allies[1].action.remaining = s.allies[1].action.recovery + 0.2;
  await load(page, s);
  await page.keyboard.press('z');
  await page.keyboard.press('z');
  await page.keyboard.press('h');
  await page.clock.runFor(500);
  await expect(page.locator('[data-unit=e0]')).toBeDisabled();
  await expect(page.locator('[data-unit=e1]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-skill-id=slash]')).toHaveAccessibleName(/灰の砲術師/);
  await expect(page.locator('[data-plan-status=committed]')).toHaveCount(1);
  const hp = Number(
    await page
      .getByRole('meter', { name: '灰の砲術師のHP', exact: true })
      .getAttribute('aria-valuenow'),
  );
  await page.clock.runFor(600);
  const hitHp = Number(
    await page
      .getByRole('meter', { name: '灰の砲術師のHP', exact: true })
      .getAttribute('aria-valuenow'),
  );
  expect(hitHp).toBeLessThan(hp);
  await page.clock.runFor(1100);
  expect(
    Number(
      await page
        .getByRole('meter', { name: '灰の砲術師のHP', exact: true })
        .getAttribute('aria-valuenow'),
    ),
  ).toBeLessThan(hitHp);
  await expect(page.locator('.recipient-portraits')).toHaveCount(0);
  expect(errors).toEqual([]);
});
for (const width of [1366, 390]) {
  test(`post-break hits raise the visible percent and multiplier at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 752 });
    const s = quiet();
    s.enemies[0].broken = 12;
    s.enemies[0].chain = 220;
    await load(page, s);
    const chain = page.getByRole('meter', { name: '鐘楼の衛兵のチェイン', exact: true });
    const duration = page.getByRole('meter', { name: '鐘楼の衛兵のブレイク残り時間', exact: true });
    await expect(chain).toHaveAttribute('aria-valuenow', '220');
    await expect(chain).toHaveAttribute('aria-valuemin', '100');
    await expect(chain).toHaveAttribute('aria-valuemax', '500');
    await page.keyboard.press('z');
    await page.keyboard.press('h');
    await page.clock.runFor(1100);
    expect(Number(await chain.getAttribute('aria-valuenow'))).toBeGreaterThan(220);
    expect(Number(await duration.getAttribute('aria-valuenow'))).toBeLessThan(12);
    await expect(page.locator('[data-unit=e0]')).toContainText('224% · ×2.24');
    await expect(page.locator('.recipient-portraits')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/break-chain-${width}.png`, fullPage: true });
  });
}
