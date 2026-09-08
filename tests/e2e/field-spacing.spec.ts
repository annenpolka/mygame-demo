import { expect, test, type Page } from '@playwright/test';
import { command, createState } from '../../src/sim/engine';
import type { State } from '../../src/sim/types';

async function load(page: Page, state: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'field-spacing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: state.version, state })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
}

function fixture(front: number, encounter: 1 | 2 = 1) {
  const state = createState({ bonusMode: 'none', encounter });
  command(state, { type: 'start' });
  state.allies.forEach((ally, index) => {
    ally.row = index < front ? 'front' : 'back';
    ally.executionHeld = index !== state.selected;
  });
  state.enemies.forEach((enemy) => (enemy.nextAttack = 999));
  return state;
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.getByRole('button', { name: '下の操作盤', exact: true }).click();
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 600 },
  { width: 900, height: 600 },
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  test(`one, two and three units retain their full size at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const dimensions: unknown[] = [];
    for (const population of [1, 2, 3]) {
      await load(page, fixture(population));
      await expect(page.locator('.battle-lane.ally.front [data-unit]')).toHaveCount(population);
      const measured = await page.locator('.battle-layout .battlefield').evaluate((field) => {
        const actor = field.querySelector('[data-unit="a0"]')!;
        const symbol = actor.querySelector('.field-symbol')!.getBoundingClientRect();
        const figure = actor.querySelector('.unit-figure')!.getBoundingClientRect();
        const name = actor.querySelector('.field-unit-info strong')!;
        const gauge = actor.querySelector('.unit-gauge small')!;
        return {
          symbol: { width: symbol.width, height: symbol.height },
          figure: { width: figure.width, height: figure.height },
          nameSize: getComputedStyle(name).fontSize,
          gaugeSize: getComputedStyle(gauge).fontSize,
          detailVisible:
            getComputedStyle(actor.querySelector('.field-unit-info > small')!).display !== 'none',
        };
      });
      expect(measured.symbol).toEqual({ width: 64, height: 68 });
      expect(measured.figure).toEqual({ width: 64, height: 68 });
      expect(measured.detailVisible).toBe(true);
      dimensions.push(measured);
    }
    expect(dimensions[1]).toEqual(dimensions[0]);
    expect(dimensions[2]).toEqual(dimensions[0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const viewport of [
  { width: 1366, height: 600 },
  { width: 900, height: 600 },
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  test(`three stacked allies and enemies keep names, HP and break gauges within their cards at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const state = fixture(3, 2);
    state.enemies.forEach((enemy) => {
      enemy.row = 'front';
      enemy.broken = 9;
      enemy.chain = 260;
    });
    await load(page, state);
    const units = page.locator('.battle-layout [data-unit]');
    await expect(units).toHaveCount(6);
    const overflow = await units.evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const card = node.getBoundingClientRect();
        const field = node.closest('.horizontal-field')!.getBoundingClientRect();
        const content = Array.from(
          node.querySelectorAll(
            '.field-unit-info strong, .unit-gauge small, [role="meter"], .unit-figure',
          ),
        );
        return content.flatMap((item) => {
          const box = item.getBoundingClientRect();
          return box.top < card.top - 1 ||
            box.bottom > card.bottom + 1 ||
            box.left < card.left - 1 ||
            box.right > card.right + 1 ||
            item.scrollWidth > item.clientWidth + 1 ||
            card.bottom > field.bottom + 1
            ? [`${node.getAttribute('data-unit')}: ${item.className}`]
            : [];
        });
      }),
    );
    expect(overflow).toEqual([]);
    const lastAlly = page.locator('.battle-layout [data-unit="a2"]');
    await lastAlly.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(lastAlly).toBeFocused();
    const focusSpace = await lastAlly.evaluate((node) => {
      const card = node.getBoundingClientRect();
      const field = node.closest('.horizontal-field')!.getBoundingClientRect();
      return {
        outline: getComputedStyle(node).outlineStyle,
        requiredInset:
          parseFloat(getComputedStyle(node).outlineWidth) +
          parseFloat(getComputedStyle(node).outlineOffset),
        inset: Math.min(
          card.left - field.left,
          field.right - card.right,
          card.top - field.top,
          field.bottom - card.bottom,
        ),
      };
    });
    expect(focusSpace.outline).not.toBe('none');
    expect(focusSpace.inset).toBeGreaterThanOrEqual(focusSpace.requiredInset);
    await page.screenshot({
      path: test.info().outputPath('three-full-size-tracks.png'),
      fullPage: true,
    });
  });
}
