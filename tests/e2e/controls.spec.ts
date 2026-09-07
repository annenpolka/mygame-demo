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
  await expect(page.getByRole('button', { name: '防御を選ぶ', exact: true })).toContainText(
    '1 ATB',
  );
  await page.getByRole('button', { name: '円弧斬りを選ぶ', exact: true }).click();
  await page.getByRole('option', { name: '敵前列に円弧斬りを積む', exact: true }).click();
  await page.getByRole('button', { name: '防御を選ぶ', exact: true }).click();
  await page.getByRole('option', { name: 'アルトに防御を積む', exact: true }).click();
  await page.getByRole('button', { name: '救急薬を選ぶ', exact: true }).click();
  await page.getByRole('option', { name: 'リネに救急薬を積む', exact: true }).click();
  await page.getByRole('tab', { name: '移動', exact: true }).click();
  await page.getByRole('button', { name: '← 後列へ 0.6秒 · 末尾に積む', exact: true }).click();
  await page.getByRole('tab', { name: '武器変更', exact: true }).click();
  await page.getByRole('button', { name: /誓いの盾槍.*武器変更を末尾に積む/ }).click();
  await page.getByRole('tab', { name: '技', exact: true }).click();
  await page.getByRole('button', { name: '護りの誓いを選ぶ', exact: true }).click();
  await page.getByRole('option', { name: 'セナに護りの誓いを積む', exact: true }).click();
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
    await press(page, 7);
    await expect(page.getByRole('region', { name: 'パッド用戦闘コマンド' })).toBeVisible();
    await expect(page.getByRole('button', { name: '防御を積む：防御', exact: true })).toContainText(
      '1 ATB',
    );
    await page.screenshot({ path: `test-results/native-${label}-root.png`, fullPage: true });
    await press(page, 3); // Main skill opens the target picker directly.
    await expect(page.getByRole('listbox', { name: '戦場で対象を選ぶ' })).toBeVisible();
    await press(page, 15); // Choose the rear row.
    await down(page, confirm);
    await page.clock.runFor(600);
    await expect(page.locator('.pad-plan-list li')).toHaveCount(1);
    await release(page);
    await press(page, confirm); // The same target remains selected.
    await expect(page.locator('.pad-plan-list li')).toHaveCount(2);
    await expect(page.locator('.pad-plan-list li').first()).toContainText('後列');
    await page.screenshot({ path: `test-results/native-${label}-target.png`, fullPage: true });
    await press(page, cancel);
    await press(page, 13); // Queue starts at the last reservation.
    await press(page, confirm);
    await expect(page.locator('.pad-plan-list li')).toHaveCount(1);
    await page.screenshot({ path: `test-results/native-${label}-queue.png`, fullPage: true });
    await press(page, cancel);
    await press(page, 5);
    await expect(page.locator('.pad-page-heading')).toContainText('リネ');
    await press(page, cancel); // Guard is a direct command at home.
    await expect(page.locator('.pad-plan-list li')).toHaveCount(1);
    await expect(page.locator('.pad-plan-list')).toContainText('防御');
    await press(page, 4);
    await expect(page.locator('.pad-plan-list li')).toHaveCount(1);
    await press(page, 15); // Weapon change picker.
    await press(page, 13);
    await press(page, confirm);
    await expect(
      page.getByRole('button', { name: '基本技：護りの誓い', exact: true }),
    ).toBeVisible();
    await press(page, confirm);
    await press(page, confirm);
    await expect(page.locator('.pad-plan-list li')).toHaveCount(3);
    await expect(page.locator('.pad-plan-list li').last()).toContainText('護りの誓い');
    await press(page, cancel);
    await press(page, 8);
    await expect(page.getByRole('log', { name: 'パッドの戦闘ログ' })).toBeVisible();
    await press(page, cancel);
    const log = await page.locator('.log-container').boundingBox();
    expect(log!.y + log!.height).toBeLessThanOrEqual(900);
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
  await dialog.getByRole('button', { name: '基本技・決定・積む A', exact: true }).click();
  await release(page);
  await down(page, 20);
  await page.clock.runFor(200);
  await expect(
    dialog.getByRole('button', { name: '基本技・決定・積む ボタン 20', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('一度離して、ボタンを押す', { exact: true })).toHaveCount(0);
  await release(page);
  await dialog.getByRole('button', { name: '設定を閉じる ×', exact: true }).click();
  await page.reload();
  await virtualPad(page, 'Custom USB Gamepad', '');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '基本技・決定・積む ボタン 20', exact: true }),
  ).toBeVisible();
});

test('mobile queue and gamepad settings stay inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('f');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '防御を選ぶ', exact: true }).click();
    await page.getByRole('option', { name: 'アルトに防御を積む', exact: true }).click();
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

test('native pad layout handles six queued actions and picker navigation at mobile width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await virtualPad(page, 'DualSense Wireless Controller (054c)');
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await press(page, 7);
  for (let i = 0; i < 6; i++) await press(page, 1);
  await expect(page.locator('.pad-plan-list li')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/native-mobile.png', fullPage: true });
  await press(page, 13);
  await expect(page.locator('.pad-plan-list .selected')).toBeInViewport({ ratio: 1 });
  await press(page, 2);
  await expect(page.locator('.pad-plan-list li')).toHaveCount(0);
  await press(page, 1);
  await expect(page.getByRole('button', { name: '基本技：斬撃', exact: true })).toBeInViewport({
    ratio: 1,
  });
});

test('effects visualize resolved damage and shields; tactical stop freezes their progress', async ({
  page,
}) => {
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('c');
  await page.getByRole('option', { name: 'アルトに防御を積む', exact: true }).click();
  await page.clock.runFor(250);
  await expect(page.locator('[data-effect=shield]')).toHaveCount(1);
  await expect(page.locator('[data-status=shield]')).toHaveCount(1);
  await page.keyboard.press('z');
  await page.getByRole('option', { name: '鐘楼の衛兵に斬撃を積む', exact: true }).click();
  await page.clock.runFor(1550);
  const fx = page.locator('[data-effect=slash]').first();
  await expect(fx).toBeVisible();
  const value = Number(await fx.getAttribute('data-value'));
  expect(value).toBeGreaterThan(0);
  await page.keyboard.press('f');
  const before = await page.locator('.battle-effects').innerHTML();
  await page.clock.runFor(500);
  expect(await page.locator('.battle-effects').innerHTML()).toBe(before);
  await page.screenshot({ path: 'test-results/combat-effects.png', fullPage: true });
  await page.keyboard.press('f');
  await page.clock.runFor(900);
  expect(await fx.count()).toBeLessThanOrEqual(1);
});

test('native tactics selects team commands and supports reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await virtualPad(page, 'Xbox Wireless Controller');
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await press(page, 7);
  await expect(page.locator('.battle-effects')).toHaveAttribute('data-effects', 'reduced');
  await press(page, 12);
  const list = page.getByRole('listbox', { name: '全員へ指示', exact: true });
  await expect(list.getByRole('option')).toHaveCount(4);
  await press(page, 13);
  const preset = await list.locator('[aria-selected=true] strong').innerText();
  await press(page, 0);
  await expect(page.locator('.pad-feedback')).toContainText(preset);
  await press(page, 12);
  await press(page, 15);
  await expect(list.getByRole('option')).toHaveCount(3);
  await press(page, 13);
  const formation = await list.locator('[aria-selected=true] strong').innerText();
  await press(page, 0);
  await expect(page.locator('.pad-feedback')).toContainText(formation);
  await press(page, 1);
  await expect(page.locator('.pad-plan-list li')).toHaveCount(1);
  await page.getByRole('button', { name: '1手目の防御を取消', exact: true }).click();
  await expect(page.locator('.pad-plan-list li')).toHaveCount(0);
});

test('previous saved custom bindings migrate to direct commands without losing confirm or axes', async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.removeItem('orchestra-gamepad-v2');
    localStorage.setItem(
      'orchestra-gamepad-v1',
      JSON.stringify({
        family: 'playstation',
        custom: {
          'Legacy Custom Pad': {
            confirm: 20,
            cancel: 1,
            previous: 4,
            next: 5,
            slow: 2,
            stop: 3,
            pause: 9,
            log: 8,
            up: 12,
            down: 13,
            left: 14,
            right: 15,
            axisX: 2,
            axisY: 3,
            invertX: true,
            invertY: false,
          },
        },
      }),
    );
  });
  await page.reload();
  await virtualPad(page, 'Legacy Custom Pad', '');
  await press(page, 20);
  await press(page, 20);
  await expect(page.getByRole('region', { name: 'パッド用戦闘コマンド' })).toBeVisible();
  await press(page, 7);
  await press(page, 3);
  await expect(page.getByRole('listbox', { name: '戦場で対象を選ぶ' })).toBeVisible();
  await press(page, 20);
  await expect(page.locator('.pad-plan-list li')).toHaveCount(1);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orchestra-gamepad-v2')!),
  );
  expect(saved.family).toBe('playstation');
  expect(saved.custom['Legacy Custom Pad']).toMatchObject({
    confirm: 20,
    skill: 3,
    item: 2,
    slow: 6,
    stop: 7,
    axisX: 2,
    axisY: 3,
    invertX: true,
  });
});

test('short desktop separates command buttons and shows the battlefield, six plans, and log together', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 752 });
  await virtualPad(page, 'DualSense Wireless Controller (054c)');
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await press(page, 7);
  const boxes = await page.locator('.direct-command').evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }),
  );
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(
        true,
      );
    }
  }
  await page.screenshot({ path: 'test-results/native-compact-root.png', fullPage: true });
  for (let i = 0; i < 6; i++) await press(page, 1);
  await expect(page.locator('.pad-plan-list li')).toHaveCount(6);
  const logBottom = await page
    .locator('.log-container')
    .evaluate((el) => el.getBoundingClientRect().bottom + scrollY);
  expect(logBottom).toBeLessThanOrEqual(752);
  await page.screenshot({ path: 'test-results/native-compact-six.png', fullPage: true });
});
