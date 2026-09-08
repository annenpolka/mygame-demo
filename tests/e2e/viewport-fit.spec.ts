import { expect, test, type Page } from '@playwright/test';
import { command, createState } from '../../src/sim/engine';
import type { State } from '../../src/sim/types';

const viewports = [
  { width: 1440, height: 900 },
  { width: 1366, height: 752 },
  { width: 1366, height: 600 },
  { width: 900, height: 600 },
  { width: 390, height: 844 },
];
const modes = ['orbit', 'desk', 'ai'] as const;
type Mode = (typeof modes)[number];

function fixture(mode: Mode) {
  const state = createState({ bonusMode: 'none', encounter: 2 }, mode === 'ai' ? 'ai' : 'manual');
  command(state, { type: 'start' });
  state.allies.forEach((ally) => {
    ally.row = 'front';
    ally.atb = 4;
    ally.executionHeld = true;
  });
  state.enemies.forEach((enemy) => {
    enemy.row = 'front';
    enemy.nextAttack = 999;
    enemy.broken = 9;
    enemy.chain = 260;
  });
  if (mode !== 'ai') {
    for (let i = 0; i < 4; i++)
      command(state, {
        type: 'draft',
        id: 0,
        step: { kind: 'skill', skillId: 'guard', target: { kind: 'ally', id: 0 } },
      });
  }
  return state;
}

async function load(page: Page, state: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'viewport-fit-three-front.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: state.version, state })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});

for (const viewport of viewports) {
  for (const mode of modes) {
    test(`${mode}: battlefield and ATB fit together at ${viewport.width}×${viewport.height} with three allies and enemies in one lane`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      if (mode !== 'ai')
        await page
          .getByRole('button', {
            name: mode === 'orbit' ? '周囲に展開' : '下の操作盤',
            exact: true,
          })
          .click();
      await load(page, fixture(mode));
      await page.clock.runFor(32); // Settle layout and its scheduled scrolling before measuring.
      await expect(page.locator('.battle-lane.ally.front [data-unit]')).toHaveCount(3);
      await expect(page.locator('.battle-lane.enemy.front [data-unit]')).toHaveCount(3);
      if (mode !== 'ai') await expect(page.locator('.atb-reservation')).toHaveCount(4);
      const measured = await page.locator('.battle-stage').evaluate((stage) => {
        const rect = (element: Element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          };
        };
        const field = rect(stage.querySelector('.battlefield')!);
        const atb = rect(stage.querySelector('.atb-timeline')!);
        const units = Array.from(stage.querySelectorAll('.battlefield [data-unit]')).map((unit) => {
          const card = rect(unit);
          const content = Array.from(
            unit.querySelectorAll('.field-unit-info strong, .unit-gauge small, [role="meter"]'),
          );
          const overflow = content.flatMap((element) => {
            const box = rect(element);
            const style = getComputedStyle(element);
            return box.width <= 0 ||
              box.height <= 0 ||
              style.visibility === 'hidden' ||
              Number(style.opacity) === 0 ||
              box.left < card.left - 1 ||
              box.right > card.right + 1 ||
              box.top < card.top - 1 ||
              box.bottom > card.bottom + 1 ||
              element.scrollWidth > element.clientWidth + 1
              ? [element.className]
              : [];
          });
          return {
            id: unit.getAttribute('data-unit'),
            card,
            symbol: rect(unit.querySelector('.field-symbol')!),
            figure: rect(unit.querySelector('.unit-figure')!),
            overflow,
          };
        });
        return {
          field,
          atb,
          units,
          width: innerWidth,
          height: innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      for (const [name, box] of [
        ['battlefield', measured.field],
        ['ATB', measured.atb],
      ] as const) {
        const context = `${mode} ${viewport.width}×${viewport.height} ${name}: ${JSON.stringify(box)}`;
        expect(box.width, context).toBeGreaterThan(0);
        expect(box.height, context).toBeGreaterThan(0);
        expect(box.left, context).toBeGreaterThanOrEqual(-1);
        expect(box.top, context).toBeGreaterThanOrEqual(-1);
        expect(box.right, context).toBeLessThanOrEqual(measured.width + 1);
        expect(box.bottom, context).toBeLessThanOrEqual(measured.height + 1);
      }
      const overlapWidth =
        Math.min(measured.field.right, measured.atb.right) -
        Math.max(measured.field.left, measured.atb.left);
      const overlapHeight =
        Math.min(measured.field.bottom, measured.atb.bottom) -
        Math.max(measured.field.top, measured.atb.top);
      expect(
        overlapWidth > 1 && overlapHeight > 1,
        'Battlefield and ATB must not cover each other',
      ).toBe(false);
      for (const unit of measured.units) {
        expect(
          { width: unit.symbol.width, height: unit.symbol.height },
          `${unit.id} symbol`,
        ).toEqual({ width: 64, height: 68 });
        expect(
          { width: unit.figure.width, height: unit.figure.height },
          `${unit.id} figure`,
        ).toEqual({ width: 64, height: 68 });
        expect(unit.overflow, `${unit.id} name, HP and break readouts`).toEqual([]);
        expect(unit.card.left).toBeGreaterThanOrEqual(measured.field.left - 1);
        expect(unit.card.right).toBeLessThanOrEqual(measured.field.right + 1);
        expect(unit.card.top).toBeGreaterThanOrEqual(measured.field.top - 1);
        expect(unit.card.bottom).toBeLessThanOrEqual(measured.field.bottom + 1);
      }
      expect(measured.horizontalOverflow).toBe(false);
      if (mode !== 'ai') {
        const execute = page
          .locator('.atb-timeline')
          .getByRole('button', { name: 'H 行動開始', exact: true });
        await expect(execute).toBeEnabled();
        await expect(execute).toBeInViewport({ ratio: 1 });
        const size = await execute.boundingBox();
        expect(size!.width).toBeGreaterThanOrEqual(44);
        expect(size!.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: test.info().outputPath(`${mode}-${viewport.width}x${viewport.height}.png`),
      });
    });
  }
}
