import { expect, type Page } from '@playwright/test';

/** Combatants retain their size; secondary logs remain reachable by scrolling. */
export async function expectFullSizeFieldAndReachableLog(page: Page) {
  const field = page.locator('.battle-layout .battlefield');
  const sizes = await field.evaluate((node) => {
    const symbol = node.querySelector('.field-symbol')!.getBoundingClientRect();
    return { glyphWidth: symbol.width, glyphHeight: symbol.height };
  });
  expect(sizes.glyphWidth).toBe(64);
  expect(sizes.glyphHeight).toBe(68);
  const log = page.locator('.log-container');
  await log.scrollIntoViewIfNeeded();
  await expect(log).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
