import { expect, test } from '@playwright/test';

test('offline capture advances exactly one battle tick per frame and ignores browser elapsed time', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?capture=1');
  await page.getByRole('button', { name: 'AI鑑賞', exact: true }).click();
  await page.getByRole('button', { name: 'AI鑑賞を開始 →', exact: true }).click();
  await page.clock.runFor(1000);
  const initial = await page.evaluate(() => window.__battleCapture!.begin());
  expect(initial.tick).toBe(0);
  for (let frame = 1; frame <= 120; frame++) {
    const state = await page.evaluate(() => window.__battleCapture!.step());
    expect(state.frame).toBe(frame);
    expect(state.tick).toBe(frame);
  }
  const before = await page.evaluate(() => window.__battleCapture!.result().state);
  await page.clock.runFor(2000);
  const after = await page.evaluate(() => window.__battleCapture!.result().state);
  expect(after).toEqual(before);
  expect(after.time).toBeCloseTo(2, 8);
  await expect(page.locator('.battle-clock strong')).toContainText('02.0');
  expect(await page.locator('.battle-particles').count()).toBeGreaterThan(0);
});
