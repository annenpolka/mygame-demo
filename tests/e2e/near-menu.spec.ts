import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { command, createState } from '../../src/sim/engine';
import type { State } from '../../src/sim/types';

const modes = [
  ['shelf', '足元にまとめる'],
  ['orbit', '周囲に展開'],
] as const;
const drafts = (page: Page) => page.locator('.pad-plan-list [data-plan-status=draft]');

function fixture() {
  const state = createState({ bonusMode: 'none', encounterSet: 'crossfire' });
  command(state, { type: 'start' });
  state.allies.forEach((ally) => {
    ally.row = 'front';
    ally.atb = 4;
    ally.executionHeld = ally.id !== 0;
  });
  state.enemies.forEach((enemy) => (enemy.nextAttack = 999));
  return state;
}

async function load(page: Page, state: State = fixture()) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'near-menu-crossfire-three-front.json',
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

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});

test('layout comparisons preserve the complete battle state and reset to the selected orbit default on reload', async ({
  page,
}) => {
  await load(page);
  const layouts = page.getByRole('group', { name: 'メニュー位置', exact: true });
  await expect(layouts.getByRole('button', { name: '周囲に展開', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const before = await snapshot(page);
  for (const [mode, label] of [['desk', '下の操作盤'], ...modes] as const) {
    const choice = layouts.getByRole('button', { name: label, exact: true });
    await choice.click();
    await expect(choice).toBeFocused();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-near-action]')).toHaveCount(mode === 'desk' ? 0 : 4);
    if (mode !== 'desk')
      await expect(page.locator(`[data-menu-location=${mode}] [data-near-action]`)).toHaveCount(4);
    expect(await snapshot(page)).toEqual(before);
  }
  await layouts.getByRole('button', { name: '足元にまとめる', exact: true }).click();
  await page.reload();
  await expect(layouts.getByRole('button', { name: '周囲に展開', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await expect(page.locator('[data-menu-location=orbit] [data-near-action]')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /^基本技：斬撃/ })).toHaveCount(1);
});

for (const viewport of [
  { width: 390, height: 844, actor: 1 },
  { width: 1366, height: 600, actor: 2 },
]) {
  test(`${viewport.width}×${viewport.height} handoff keeps the focused near command visible and region cycling returns to it`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await load(page);
    const menu = page.locator('[data-menu-location=orbit]');
    const basic = page.locator('[data-near-action=basic]');
    await basic.focus();
    const node = await basic.elementHandle();
    await page.keyboard.press(String(viewport.actor + 1));
    await page.clock.runFor(1500);
    await expect(menu).toHaveAttribute('data-actor-id', String(viewport.actor));
    await expect(basic).toBeFocused();
    await expect(basic).toBeInViewport();
    expect(await node!.evaluate((element) => element === document.activeElement)).toBe(true);
    const layouts = page.getByRole('group', { name: 'メニュー位置', exact: true });
    for (const [, label] of modes) {
      const choice = layouts.getByRole('button', { name: label, exact: true });
      await choice.click();
      await expect(choice).toBeFocused();
      await expect(choice).toBeInViewport();
    }
    await basic.focus();
    await page.keyboard.press('i');
    await page.clock.runFor(32); // Allow the layout-aligned scroll animation frame.
    await expect(page.locator('.pad-auxiliary')).toBeInViewport();
    await page.keyboard.press('i');
    await page.clock.runFor(32);
    await expect(page.locator('.pad-plan')).toBeInViewport();
    await page.keyboard.press('i');
    await page.clock.runFor(32);
    await expect(basic).toBeInViewport();
    await expect(basic).toBeFocused();
    await expect(drafts(page)).toHaveCount(0);
  });
}

for (const [mode, label] of modes) {
  test(`${mode}: native focus does not issue a command, Enter adds once and the separate ATB control commits`, async ({
    page,
  }) => {
    await load(page);
    await page
      .getByRole('group', { name: 'メニュー位置' })
      .getByRole('button', { name: label, exact: true })
      .click();
    const menu = page.locator(`[data-menu-location=${mode}]`);
    await expect(menu.getByRole('button')).toHaveCount(4);
    await expect(menu.getByRole('button', { name: /行動開始|確定/ })).toHaveCount(0);
    await expect(page.locator('[data-near-action=execute]')).toHaveCount(0);
    const execute = page
      .getByRole('region', { name: 'アルトのATBと行動予約', exact: true })
      .getByRole('button', { name: 'H 行動開始', exact: true });
    await expect(execute).toBeDisabled();
    const basic = page.locator('[data-near-action=basic]');
    await expect(page.getByRole('button', { name: /^基本技：斬撃/ })).toHaveCount(1);
    await basic.focus();
    const node = await basic.elementHandle();
    await page.keyboard.press('Tab');
    await expect(basic).not.toBeFocused();
    await expect(drafts(page)).toHaveCount(0);
    await page.keyboard.press('Shift+Tab');
    await expect(basic).toBeFocused();
    await expect(drafts(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(drafts(page)).toHaveCount(1);
    await expect(drafts(page)).toContainText('斬撃');
    await expect(basic).toBeFocused();
    expect(await node!.evaluate((element) => element === document.activeElement)).toBe(true);
    await page.getByRole('button', { name: /^リネを支援対象にする/ }).click();
    await page.locator('[data-near-action=potion]').click();
    await expect(drafts(page)).toHaveCount(2);
    await expect(drafts(page).last().getByRole('button')).toHaveAccessibleName(/救急薬、リネ/);
    await expect(execute).toBeEnabled();
    await execute.focus();
    await expect(drafts(page)).toHaveCount(2);
    await page.keyboard.press('Enter');
    await expect(drafts(page)).toHaveCount(0);
    await expect(page.locator('.pad-plan-list [data-plan-status=committed]')).toHaveCount(2);
  });

  test(`${mode}: the menu follows committed handoff and row movement without replacing its focused control`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await load(page);
    await page
      .getByRole('group', { name: 'メニュー位置' })
      .getByRole('button', { name: label, exact: true })
      .click();
    const menu = page.locator(`[data-menu-location=${mode}]`);
    const basic = page.locator('[data-near-action=basic]');
    await basic.focus();
    const node = await basic.elementHandle();
    await page.keyboard.press('2');
    await expect(menu).toHaveAttribute('data-actor-id', '0');
    await expect(basic).toHaveAccessibleName(/^基本技：斬撃/);
    await page.clock.runFor(1500);
    await expect(menu).toHaveAttribute('data-actor-id', '1');
    await expect(basic).toHaveAccessibleName(/^基本技：砕光/);
    await expect(basic).toBeFocused();
    expect(await node!.evaluate((element) => element === document.activeElement)).toBe(true);
    await page.keyboard.press('w');
    await expect(basic).toHaveAccessibleName(/^基本技：射撃/);
    await page.clock.runFor(1100);
    const before = await basic.boundingBox();
    await page.keyboard.press('j');
    await page.clock.runFor(1100);
    await expect(page.locator('.battle-lane.ally.back [data-unit=a1]')).toBeVisible();
    const after = await basic.boundingBox();
    expect(after!.x).toBeLessThan(before!.x - 100);
    await expect(basic).toBeFocused();
    expect(await node!.evaluate((element) => element === document.activeElement)).toBe(true);
    await expect(drafts(page)).toHaveCount(0);
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 600 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    test(`${mode}: three-front crossfire layout keeps controls clear at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await load(page);
      await page
        .getByRole('group', { name: 'メニュー位置' })
        .getByRole('button', { name: label, exact: true })
        .click();
      const menu = page.locator(`[data-menu-location=${mode}]`);
      await expect(menu).toHaveAttribute('data-actor-id', '0');
      const readLayout = () =>
        menu.evaluate((node) => {
          const field = node.closest('.battle-stage')!.getBoundingClientRect();
          const unitBottom = Math.max(
            ...Array.from(node.closest('.battle-stage')!.querySelectorAll('[data-unit]')).map(
              (unit) => unit.getBoundingClientRect().bottom,
            ),
          );
          const controls = Array.from(node.querySelectorAll('[data-near-action]')).map(
            (element) => {
              const rect = element.getBoundingClientRect();
              return {
                action: element.getAttribute('data-near-action'),
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                right: rect.right,
                bottom: rect.bottom,
              };
            },
          );
          const bodies = Array.from(
            node
              .closest('.battle-stage')!
              .querySelectorAll('[data-unit] .field-symbol, [data-unit] .field-unit-info'),
          ).map((element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
          });
          const overlaps = controls.flatMap((control) =>
            bodies
              .filter(
                (body) =>
                  control.x < body.right &&
                  control.right > body.x &&
                  control.y < body.bottom &&
                  control.bottom > body.y,
              )
              .map(() => control.action),
          );
          return {
            field: { x: field.x, y: field.y, right: field.right, bottom: field.bottom },
            unitBottom,
            controls,
            overlaps,
          };
        });
      const assertLayout = async () => {
        const layout = await readLayout();
        expect(layout.controls.map((control) => control.action)).toEqual([
          'basic',
          'skill',
          'guard',
          'potion',
        ]);
        expect(layout.overlaps).toEqual([]);
        for (const button of layout.controls) {
          expect(button.width).toBeGreaterThanOrEqual(44);
          expect(button.height).toBeGreaterThanOrEqual(44);
          expect(button.x).toBeGreaterThanOrEqual(layout.field.x);
          expect(button.right).toBeLessThanOrEqual(layout.field.right + 1);
          expect(button.y).toBeGreaterThanOrEqual(layout.field.y);
          expect(button.bottom).toBeLessThanOrEqual(layout.field.bottom + 1);
        }
        if (viewport.width <= 1100) {
          expect(layout.controls[0].y).toBeGreaterThanOrEqual(layout.unitBottom);
          expect(new Set(layout.controls.map((control) => Math.round(control.x))).size).toBe(2);
        }
      };
      await assertLayout();
      await expect(page.locator('.battle-lane.ally.front [data-unit]')).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `test-results/near-menu/${mode}-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
      if (viewport.width === 1440) {
        const clip = await page.locator('.battlefield [data-unit=a0]').evaluate((node) => {
          const card = node.getBoundingClientRect();
          return {
            x: card.x + scrollX - 8,
            y: card.y + scrollY - 8,
            width: card.width + 16,
            height: card.height + 16,
          };
        });
        await page.screenshot({
          path: `test-results/near-menu/${mode}-detail.png`,
          clip,
          fullPage: true,
        });
      }
      const bottomActor = fixture();
      bottomActor.selected = 2;
      bottomActor.allies.forEach((ally) => (ally.executionHeld = ally.id !== 2));
      await load(page, bottomActor);
      await expect(menu).toHaveAttribute('data-actor-id', '2');
      await assertLayout();
    });
  }
}
