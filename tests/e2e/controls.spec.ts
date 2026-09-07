import { test, expect, type Page } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});
async function virtualPad(page: Page, id: string, mapping = 'standard') {
  await page.evaluate(
    ({ id, mapping }) => {
      const w = window as unknown as {
        testPad: {
          id: string;
          mapping: string;
          index: number;
          connected: boolean;
          buttons: { pressed: boolean; value: number }[];
          axes: number[];
        } | null;
      };
      w.testPad = {
        id,
        mapping,
        index: 0,
        connected: true,
        buttons: Array.from({ length: 24 }, () => ({ pressed: false, value: 0 })),
        axes: [0, 0],
      };
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => (w.testPad ? [w.testPad] : []),
      });
    },
    { id, mapping },
  );
  await page.clock.runFor(32);
}
async function down(page: Page, index: number) {
  await page.evaluate((i) => {
    const p = (window as any).testPad;
    p.buttons[i] = { pressed: true, value: 1 };
  }, index);
  await page.clock.runFor(32);
}
async function release(page: Page) {
  await page.evaluate(() => {
    const p = (window as any).testPad;
    if (p) p.buttons = p.buttons.map(() => ({ pressed: false, value: 0 }));
  });
  await page.clock.runFor(32);
}
async function press(page: Page, index: number) {
  await down(page, index);
  await release(page);
}

test('human adds six actions including movement and future weapon skills, and cancels without reordering', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('f');
  await page.getByRole('button', { name: '円弧斬りを選ぶ', exact: true }).click();
  await page.getByRole('button', { name: '敵前列に円弧斬りを積む', exact: true }).click();
  await page.getByRole('button', { name: '防御を選ぶ', exact: true }).click();
  await page.getByRole('button', { name: 'アルトに防御を積む', exact: true }).click();
  await page.getByRole('button', { name: '救急薬を選ぶ', exact: true }).click();
  await page.getByRole('button', { name: 'リネに救急薬を積む', exact: true }).click();
  await page.getByRole('tab', { name: '移動', exact: true }).click();
  await page.getByRole('button', { name: '← 後列へ 0.6秒 · 末尾に積む', exact: true }).click();
  await page.getByRole('tab', { name: '武器変更', exact: true }).click();
  await page.getByRole('button', { name: /誓いの盾槍.*武器変更を末尾に積む/ }).click();
  await page.getByRole('tab', { name: '技', exact: true }).click();
  await page.getByRole('button', { name: '護りの誓いを選ぶ', exact: true }).click();
  await page.getByRole('button', { name: 'セナに護りの誓いを積む', exact: true }).click();
  await expect(page.locator('.plan-list li')).toHaveCount(6);
  expect(
    await page.locator('.plan-list').evaluate((el) => el.scrollHeight <= el.clientHeight),
  ).toBe(true);
  await expect(page.getByRole('button', { name: '護りの誓いを選ぶ', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/plans-desktop.png', fullPage: true });
  const logBox = await page.locator('.log-container').boundingBox();
  expect(logBox!.y + logBox!.height).toBeLessThanOrEqual(900);
  await page.getByRole('button', { name: '2手目の防御を取消', exact: true }).click();
  await expect(page.locator('.plan-list li')).toHaveCount(5);
  await expect(page.locator('.plan-list li').nth(1)).toContainText('救急薬');
  expect(await page.getByRole('button', { name: /並べ替え|前へ移す|後ろへ移す/ }).count()).toBe(0);
  await page.keyboard.press('2');
  await expect(page.locator('.plan-list li')).toHaveCount(0);
  await page.keyboard.press('1');
  await expect(page.locator('.plan-list li')).toHaveCount(5);
  await page.getByRole('button', { name: 'すべて取消', exact: true }).click();
  await expect(page.locator('.plan-list li')).toHaveCount(0);
});

for (const [id, label, confirm, cancel] of [
  ['Xbox Wireless Controller', 'Xbox', 0, 1],
  ['DualSense Wireless Controller (054c)', 'PS', 0, 1],
  ['Nintendo Switch Pro Controller (057e)', 'Switch', 1, 0],
] as const) {
  test(`${label} standard controller starts, stacks, cancels, changes actor, and pauses without mouse`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await virtualPad(page, id);
    await expect(page.getByRole('button', { name: 'ゲームパッド設定', exact: true })).toContainText(
      label,
    );
    await press(page, confirm);
    await expect(page.getByRole('button', { name: '戦闘開始 →', exact: true })).toBeFocused();
    await press(page, confirm);
    await expect(page.getByRole('button', { name: '戦闘開始 →', exact: true })).toHaveCount(0);
    await press(page, 3); // Tactical stop freezes simulation, allowing queue assertions.
    await press(page, confirm);
    await press(page, confirm);
    await expect(page.locator('.target-picker')).toBeVisible();
    await down(page, confirm);
    await page.clock.runFor(600);
    await expect(page.locator('.plan-list li')).toHaveCount(1);
    await release(page);
    await press(page, confirm);
    await press(page, confirm);
    await expect(page.locator('.plan-list li')).toHaveCount(2);
    const log = await page.locator('.log-container').boundingBox();
    expect(log!.y + log!.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: `test-results/pad-${label}-desktop.png`, fullPage: true });
    await press(page, confirm);
    await expect(page.locator('.target-picker')).toBeVisible();
    await press(page, cancel);
    await expect(page.locator('.target-picker')).toHaveCount(0);
    // Spatial navigation reaches the cancellation button without moving a queue entry.
    for (let i = 0; i < 3; i++) {
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (focused?.includes('を取消')) break;
      await press(page, 15);
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(
      /手目の斬撃を取消/,
    );
    await press(page, confirm);
    await expect(page.locator('.plan-list li')).toHaveCount(1);
    await press(page, 5);
    await expect(page.locator('.console-choices > .console-label')).toContainText('リネ');
    await press(page, 4);
    await expect(page.locator('.plan-list li')).toHaveCount(1);
    await press(page, 9);
    await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
    const time = await page.locator('.battle-clock strong').innerText();
    await page.clock.runFor(500);
    await expect(page.locator('.battle-clock strong')).toHaveText(time);
    await press(page, cancel);
    await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
    await page.evaluate(() => {
      (window as any).testPad = null;
    });
    await page.clock.runFor(32);
    await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
  });
}

test('custom raw controller binding is captured without firing, and persists after reload', async ({
  page,
}) => {
  await virtualPad(page, 'Custom USB Gamepad', '');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ゲームパッド設定' });
  await dialog.getByRole('button', { name: '決定・積む A', exact: true }).click();
  await release(page);
  await down(page, 20);
  await page.clock.runFor(200);
  await expect(
    dialog.getByRole('button', { name: '決定・積む ボタン 20', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('一度離して、ボタンを押す', { exact: true })).toHaveCount(0);
  await release(page);
  await dialog.getByRole('button', { name: '設定を閉じる ×', exact: true }).click();
  await page.reload();
  await virtualPad(page, 'Custom USB Gamepad', '');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '決定・積む ボタン 20', exact: true }),
  ).toBeVisible();
});

test('mobile queue and gamepad settings stay inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('f');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '防御を選ぶ', exact: true }).click();
    await page.getByRole('button', { name: 'アルトに防御を積む', exact: true }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/plans-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const settings = page.getByRole('dialog', { name: 'ゲームパッド設定' });
  await expect(settings).toBeVisible();
  expect(
    await settings
      .getByRole('button', { name: '設定を閉じる ×', exact: true })
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  const time = await page.locator('.battle-clock strong').innerText();
  await page.clock.runFor(500);
  await expect(page.locator('.battle-clock strong')).toHaveText(time);
  await page.screenshot({ path: 'test-results/pad-settings-mobile.png' });
  await settings.getByRole('button', { name: '設定を閉じる ×', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
});
