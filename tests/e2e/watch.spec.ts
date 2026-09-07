import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.setViewportSize({ width: 1440, height: 900 });
});
test('candidate cursor remains on the battlefield and keeps selection separate from draft actions', async ({
  page,
}) => {
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(2500);
  const field = page.getByRole('group', { name: '行動の対象候補' });
  await expect(field.locator('[data-unit]')).toHaveCount(5);
  await expect(field.locator('[data-unit][data-target]')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(field.locator('[data-unit=e1][data-target=enemy][data-editing=true]')).toBeVisible();
  await expect(page.locator('[data-unit=e1] .target-edit-corners')).toBeVisible();
  await expect(page.locator('[data-unit=a0] .target-floor')).toBeVisible();
  await expect(page.locator('.field-aim-path')).toHaveCount(0);
  await page.keyboard.press('x');
  await page.keyboard.press('z');
  await page.keyboard.press('v');
  await page.getByRole('option', { name: 'リネに救急薬を積む', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await expect(page.locator('.pad-plan-list li')).toHaveCount(4);
  await expect(page.locator('[data-unit=a0]')).toContainText('行動開始待ち');
});
test('AI viewing offers all policies, visible decisions, pause, speed, and manual handoff', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'AI鑑賞', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'AI方針', exact: true }).locator('option'),
  ).toHaveCount(8);
  await page.getByRole('combobox', { name: 'AI再生速度', exact: true }).selectOption('4');
  await page.getByRole('button', { name: 'AI鑑賞を開始 →', exact: true }).click();
  await page.clock.runFor(800);
  await page.getByRole('button', { name: 'Ⅱ 鑑賞を一時停止', exact: true }).click();
  const time = await page.locator('.battle-clock strong').innerText();
  await page.clock.runFor(500);
  await expect(page.locator('.battle-clock strong')).toHaveText(time);
  await expect(page.getByRole('log', { name: 'AIの判断', exact: true })).toContainText('s');
  await page.screenshot({ path: 'test-results/ai-viewing.png', fullPage: true });
  await page.getByRole('combobox', { name: 'AI方針', exact: true }).selectOption('focus');
  await page.getByRole('combobox', { name: 'AI予約方式', exact: true }).selectOption('next');
  await page.keyboard.press('z');
  await expect(page.getByRole('listbox', { name: '戦場で対象を選ぶ' })).toHaveCount(0);
  await page.getByRole('button', { name: '▶ 鑑賞を再開', exact: true }).click();
  await page.clock.runFor(200);
  await expect(page.locator('.battle-clock strong')).not.toHaveText(time);
  await page.getByRole('button', { name: '手動に戻る', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AI鑑賞', exact: true })).toHaveCount(0);
  await expect(page.locator('.pad-plan-list li')).toHaveCount(0);
  await page.clock.runFor(4500);
  await expect(page.locator('[data-unit=a0]')).toContainText('指示待ち');
  expect(errors).toEqual([]);
});
test('AI viewing automatically equips rewards and completes both battles', async ({ page }) => {
  await page.getByRole('button', { name: 'AI鑑賞', exact: true }).click();
  await page.getByRole('combobox', { name: 'AI再生速度', exact: true }).selectOption('4');
  await page.getByRole('button', { name: 'AI鑑賞を開始 →', exact: true }).click();
  for (
    let i = 0;
    i < 25 && (await page.getByRole('dialog', { name: '戦闘結果' }).count()) === 0;
    i++
  )
    await page.clock.runFor(1000);
  await expect(page.getByRole('dialog', { name: '戦闘結果' })).toContainText('境界を、越えた。');
  await expect(page.getByRole('heading', { level: 1, includeHidden: true })).toContainText(
    '夜渡りの包囲陣',
  );
});

test('mobile battlefield targeting and AI viewing stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('v');
  const field = page.getByRole('listbox', { name: '戦場で対象を選ぶ', exact: true });
  await expect(field.getByRole('option')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/field-target-mobile.png', fullPage: true });
  await field.getByRole('option', { name: 'リネに救急薬を積む', exact: true }).click();
  await page.getByRole('button', { name: 'AI鑑賞', exact: true }).click();
  await page.clock.runFor(1000);
  await page.getByRole('button', { name: 'Ⅱ 鑑賞を一時停止', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.field-time-symbol')).toHaveAttribute('title', '通常 ×1.00');
  await page.screenshot({ path: 'test-results/ai-viewing-mobile.png', fullPage: true });
});
