import { test, expect } from '@playwright/test';
import { createState, command } from '../../src/sim/engine';
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});
test('graphical equipment and formation editing updates roles, names and positions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 752 });
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.getByRole('button', { name: '検証用に全武器を追加', exact: true }).click();
  await page.getByRole('button', { name: '編成を編集', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編成編集', exact: true });
  await dialog.getByRole('button', { name: 'アルトの武器枠2を編集', exact: true }).click();
  await expect(dialog.locator('.weapon-slot.chosen')).toContainText('D｜防護');
  await page.screenshot({ path: 'test-results/formation-weapons.png' });
  await dialog.getByRole('button', { name: '轟砕の槌をアルトの枠2に装備', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('守護騎士 D｜防護 → 破砕士 B');
  await dialog.getByRole('tab', { name: 'オプティマ', exact: true }).click();
  await dialog.getByRole('button', { name: 'オプティマ2を編集', exact: true }).click();
  await dialog.getByRole('button', { name: 'オプティマ2のアルトを枠2に変更', exact: true }).click();
  await expect(dialog.locator('.board-heading')).toContainText('総崩し');
  await expect(dialog.locator('.formation-actor')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/formation-optima.png' });
  await dialog.getByRole('tab', { name: '一括隊列', exact: true }).click();
  await dialog.getByRole('button', { name: '隊列1のアルトを前列へ', exact: true }).click();
  await expect(dialog.locator('.board-heading')).toContainText('前衛1・後衛2');
  await expect(dialog.locator('.formation-actor').first()).toHaveCSS('grid-column-start', '2');
  await page.screenshot({ path: 'test-results/formation-rows.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
test('graphical editor is usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '編成', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編成編集', exact: true });
  await dialog.getByRole('tab', { name: '一括隊列', exact: true }).click();
  await dialog.getByRole('button', { name: '隊列1のアルトを前列へ', exact: true }).click();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/formation-mobile.png' });
});
test('full-width formation shows HP, chain, break duration and enemy cast without a separate status strip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 752 });
  const s = createState();
  command(s, { type: 'start' });
  s.enemies[0].broken = 12;
  s.enemies[0].chain = 220;
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'break.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
  await expect(page.locator('.enemy-strip')).toHaveCount(0);
  const meter = page.getByRole('meter', {
    name: '鐘楼の衛兵のチェイン',
    exact: true,
    includeHidden: true,
  });
  await expect(meter).toHaveAttribute('aria-valuenow', '12');
  await expect(page.locator('[data-unit=e0]')).toContainText('BREAK 12.0s');
  const field = await page.locator('.battlefield').boundingBox();
  expect(field!.width).toBeGreaterThan(950);
  await page.clock.runFor(400);
  expect(Number(await meter.getAttribute('aria-valuenow'))).toBeLessThan(12);
  await page.keyboard.press('p');
  const held = await meter.getAttribute('aria-valuenow');
  await page.clock.runFor(300);
  await expect(meter).toHaveAttribute('aria-valuenow', held!);
  await page.screenshot({ path: 'test-results/formation-break.png', fullPage: true });
});

test('fixed formation height maps multi-cost drafts while movement and weapons execute outside the draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 752 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  const height = () =>
    page.locator('.horizontal-field').evaluate((el) => el.getBoundingClientRect().height);
  const before = await height();
  await page.keyboard.press('7');
  await page.clock.runFor(1100);
  expect(await height()).toBe(before);
  await page.keyboard.press('x');
  expect(await height()).toBe(before);
  await page.keyboard.press('Escape');
  const band = page.getByRole('region', { name: 'アルトのATBと行動予約' });
  await expect(band.locator('.atb-cell')).toHaveCount(4);
  await expect(band.locator('.atb-reservation')).toHaveCSS('grid-column-end', 'span 2');
  await expect(band.locator('.atb-free-steps > span')).toHaveCount(0);
  const bandBox = await band.boundingBox();
  const fieldBox = await page.locator('.battlefield').boundingBox();
  expect(bandBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height);
  await page.screenshot({ path: 'test-results/atb-keyboard.png', fullPage: true });
  await page.getByRole('button', { name: /^1手目の円弧斬り、.*下書きを取消$/ }).click();
  await expect(band.locator('.atb-reservation')).toHaveCount(0);
  await page.keyboard.press('r');
  await page.clock.runFor(1100);
  await expect(page.locator('.battle-lane.ally.front [data-unit=a0]')).toBeVisible();
  await page.keyboard.press('w');
  await page.clock.runFor(800);
  await expect(page.locator('.pad-page-heading')).toContainText('誓いの盾槍');
  await expect(band.locator('.atb-free-steps > span')).toHaveCount(0);
  await expect(band.locator('.atb-reservation')).toHaveCount(0);
  expect(await height()).toBe(before);
  await page.keyboard.press('2');
  await expect(band.locator('.atb-reservation')).toContainText('キャラ交代');
});
