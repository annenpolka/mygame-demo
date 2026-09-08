import { expect, type Page } from '@playwright/test';

/** Battle height is content driven: short windows scroll instead of shrinking combatants. */
export async function expectFullSizeFieldAndReachableLog(page: Page) {
  const field = page.locator('.battle-layout .battlefield');
  const sizes = await field.evaluate((node) => {
    const stage = node.querySelector('.horizontal-field')!.getBoundingClientRect();
    const symbol = node.querySelector('.field-symbol')!.getBoundingClientRect();
    return { fieldHeight: stage.height, glyphWidth: symbol.width, glyphHeight: symbol.height };
  });
  expect(sizes.fieldHeight).toBeGreaterThanOrEqual(450);
  expect(sizes.glyphWidth).toBe(64);
  expect(sizes.glyphHeight).toBe(68);
  const log = page.locator('.log-container');
  await log.scrollIntoViewIfNeeded();
  await expect(log).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
