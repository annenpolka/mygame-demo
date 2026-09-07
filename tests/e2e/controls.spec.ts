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

async function stick(page: Page, x: number, y: number) {
  await page.evaluate(({ x, y }) => ((window as any).testPad.axes = [x, y]), { x, y });
  await page.clock.runFor(32);
  await page.evaluate(() => ((window as any).testPad.axes = [0, 0]));
  await page.clock.runFor(32);
}
const live = (page: Page) => page.locator('.pad-plan-list li[data-plan-key]');
const drafts = (page: Page) => page.locator('.pad-plan-list li[data-plan-status=draft]');
const confirmed = (page: Page) => page.locator('.pad-plan-list li[data-plan-status=committed]');
async function start(page: Page) {
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
}

test('keyboard drafts never auto-execute, execute is one-way, and cutoff retains a prepared guard', async ({
  page,
}) => {
  await start(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('z');
  await page.clock.runFor(3500);
  await expect(drafts(page)).toHaveCount(3);
  await expect(page.locator('[data-unit=a0]')).toContainText('行動開始待ち');
  await expect(page.getByRole('meter', { name: '操作キャラのATB', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '4',
  );
  for (let i = 0; i < 10; i++) await page.keyboard.press('h');
  await expect(drafts(page)).toHaveCount(0);
  await page.clock.runFor(1200);
  await expect(page.locator('.atb-action-now')).toContainText('連続2手目');
  await page.keyboard.press('c');
  const atb = await page
    .getByRole('meter', { name: '操作キャラのATB', exact: true })
    .getAttribute('aria-valuenow');
  await page.keyboard.press('b');
  await expect(confirmed(page)).toHaveCount(0);
  await expect(drafts(page)).toHaveCount(1);
  await expect(drafts(page)).toContainText('防御');
  for (let i = 0; i < 10; i++) await page.keyboard.press('b');
  await expect(drafts(page)).toHaveCount(1);
  await page.keyboard.press('h');
  await page.clock.runFor(900);
  await expect(page.locator('.atb-action-now')).toContainText('終了硬直');
  await expect(page.getByRole('meter', { name: '操作キャラのATB', exact: true })).toHaveAttribute(
    'aria-valuenow',
    atb!,
  );
  await page.clock.runFor(1100);
  await expect(page.locator('.atb-action-now')).toContainText('防御');
});

test('a confirmed group waits for its full cost, allows one next group and shares capacity with draft', async ({
  page,
}) => {
  await start(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('z');
  await page.keyboard.press('h');
  await page.clock.runFor(1500);
  await expect(confirmed(page)).toHaveCount(3);
  await expect(page.locator('.atb-action-now')).toContainText('3 ATB待ち');
  await page.clock.runFor(800);
  await expect(confirmed(page)).toHaveCount(2);
  await page.keyboard.press('c');
  await page.keyboard.press('c');
  await expect(live(page)).toHaveCount(4);
  await expect(page.getByRole('button', { name: '防御を下書き', exact: true })).toBeDisabled();
  await page.keyboard.press('h');
  await expect(confirmed(page)).toHaveCount(4);
  await expect(drafts(page)).toHaveCount(0);
  await page.clock.runFor(1100);
  await page.keyboard.press('c');
  await expect(page.getByRole('button', { name: 'H 行動開始', exact: true })).toBeDisabled();
  for (let i = 0; i < 4; i++) await page.keyboard.press('h');
  await expect(drafts(page)).toHaveCount(1);
});

test('back spam never alters drafts or confirmed plans; C stays guard and P stays pause', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('f');
  await page.keyboard.press('z');
  await page.keyboard.press('h');
  await page.keyboard.press('v');
  await page.keyboard.press('c');
  for (const key of ['Escape', 'Backspace', 'Delete'])
    for (let i = 0; i < 10; i++) await page.keyboard.press(key);
  await expect(confirmed(page)).toHaveCount(1);
  await expect(drafts(page)).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
  await page.keyboard.press('v');
  await page.keyboard.press('b');
  await expect(page.getByRole('listbox', { name: '戦場で対象を選ぶ' })).toHaveCount(0);
  await expect(confirmed(page)).toHaveCount(0);
  await expect(drafts(page)).toHaveCount(1);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
});

test('unit targets support mixed skills and wrap without entering a row selection', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('f');
  const field = page.getByRole('listbox', { name: '行動の対象候補' });
  await field.getByRole('option', { name: '灰の砲術師を対象候補にする', exact: true }).click();
  await expect(page.getByRole('button', { name: '主力技：円弧斬り', exact: true })).toContainText(
    '敵後列・1体',
  );
  await page.keyboard.press('z');
  await page.keyboard.press('z');
  await page.keyboard.press('x');
  await expect(drafts(page)).toHaveCount(3);
  await expect(drafts(page).first()).toContainText('灰の砲術師');
  await expect(drafts(page).last()).toContainText('後列');
  await field.getByRole('option', { name: '鐘楼の衛兵を対象候補にする', exact: true }).click();
  await expect(drafts(page).first()).toContainText('灰の砲術師');
  await expect(
    page.getByRole('button', { name: '仲間の集中攻撃対象にする', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('b'); // Draft-only cutoff is inert.
  await expect(drafts(page)).toHaveCount(3);
  await page.keyboard.press('h');
  await page.keyboard.press('b');
  await expect(field.getByRole('option', { name: /敵.*列を対象候補にする/ })).toHaveCount(0);
  for (const name of ['灰の砲術師', '鐘楼の衛兵', '灰の砲術師', '鐘楼の衛兵']) {
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: '基本技：斬撃', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '基本技：斬撃', exact: true })).toContainText(
      name,
    );
  }
  await page.keyboard.press('z');
  await page.keyboard.press('x');
  await expect(drafts(page).first()).toContainText('鐘楼の衛兵');
  await expect(drafts(page).last()).toContainText('前列');
});

test('healing candidates and queued weapon skills stay distinct from the manual actor', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('3');
  await page.clock.runFor(1500);
  await page.keyboard.press('f');
  const field = page.getByRole('listbox', { name: '行動の対象候補' });
  await field.getByRole('option', { name: 'アルトを対象候補にする', exact: true }).click();
  await page.keyboard.press('z');
  await field.getByRole('option', { name: 'リネを対象候補にする', exact: true }).click();
  await page.keyboard.press('z');
  await expect(drafts(page).first()).toContainText('アルト');
  await expect(drafts(page).last()).toContainText('リネ');
  await expect(page.locator('.pad-page-heading')).toContainText('セナ');
  await page.keyboard.press('w');
  await expect(page.getByRole('button', { name: '基本技：砕突', exact: true })).toBeVisible();
  await expect(
    field.getByRole('option', { name: '鐘楼の衛兵を対象候補にする', selected: true }),
  ).toBeVisible();
});

test('mouse double click and confirm spam delete only one explicitly chosen draft', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('f');
  for (let i = 0; i < 4; i++) await page.keyboard.press('c');
  await page.getByRole('button', { name: '2手目の防御を取消', exact: true }).dblclick();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Enter');
  await expect(drafts(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: '防御：取消済み', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(drafts(page)).toHaveCount(2);
});

for (const [id, label, confirm, back] of [
  ['Xbox Wireless Controller', 'Xbox', 0, 1],
  ['DualSense Wireless Controller (054c)', 'PS', 0, 1],
  ['Nintendo Switch Pro Controller (057e)', 'Switch', 1, 0],
] as const) {
  test(`${label} builds via face buttons, starts and cuts via triggers, and reaches auxiliary commands`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 752 });
    await virtualPad(page, id);
    await start(page);
    await press(page, 15); // D-pad right stops time; holding it must not toggle again.
    await stick(page, 1, 0);
    await down(page, confirm);
    await page.clock.runFor(500);
    await release(page);
    await expect(drafts(page)).toHaveCount(1);
    await press(page, confirm);
    await press(page, 2);
    await expect(drafts(page)).toHaveCount(3);
    await expect(drafts(page).first()).toContainText('灰の砲術師');
    for (let i = 0; i < 10; i++) await press(page, back);
    await expect(drafts(page)).toHaveCount(3);
    await press(page, 7);
    await press(page, 7);
    await expect(confirmed(page)).toHaveCount(3);
    await press(page, 6);
    await press(page, 6);
    await expect(live(page)).toHaveCount(0);
    await press(page, 13); // Auxiliary menu.
    await stick(page, 0, 1);
    await stick(page, 0, 1); // Highlight potion.
    await press(page, 7); // No draft, so the highlighted potion is not added.
    await expect(live(page)).toHaveCount(0);
    await press(page, confirm);
    await stick(page, 0, 1);
    await press(page, confirm);
    await expect(drafts(page)).toContainText('救急薬');
    await expect(drafts(page)).toContainText('リネ');
    await press(page, back);
    await press(page, 13);
    await page.getByRole('option', { name: /武器変更.*変更先/ }).click();
    await stick(page, 0, 1);
    await press(page, confirm);
    await expect(
      page.getByRole('button', { name: '基本技：護りの誓い', exact: true }),
    ).toBeVisible();
    await press(page, confirm);
    await expect(drafts(page).last()).toContainText('護りの誓い');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const bottom = await page
      .locator('.log-container')
      .evaluate((el) => el.getBoundingClientRect().bottom + scrollY);
    expect(bottom).toBeLessThanOrEqual(752);
    await page.screenshot({ path: `test-results/sequence-palette-${label}.png`, fullPage: true });
    await press(page, 9);
    await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
    await press(page, back);
    await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
  });
}

test('digital navigation preset reaches time and auxiliary commands without analog axes or chords', async ({
  page,
}) => {
  await virtualPad(page, 'Xbox Wireless Controller');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await page.getByLabel('パッドの選択方式', { exact: true }).selectOption('dpad');
  await page.getByRole('button', { name: '設定を閉じる ×', exact: true }).click();
  await page.clock.runFor(32);
  await start(page);
  await press(page, 15); // Navigate to rear enemy, not tactical stop.
  await expect(page.locator('.field-hint')).toContainText('通常');
  await press(page, 0);
  await expect(drafts(page)).toContainText('灰の砲術師');
  await press(page, 8);
  for (let i = 0; i < 4; i++) await press(page, 13);
  await press(page, 0);
  await expect(page.locator('.field-hint')).toContainText('スロー');
  await press(page, 7);
  await press(page, 6);
  await expect(live(page)).toHaveCount(0);
  await page.reload();
  await virtualPad(page, 'Xbox Wireless Controller');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await expect(page.getByLabel('パッドの選択方式', { exact: true })).toHaveValue('dpad');
});

test('v4 custom physical slots and axes migrate to the palette and remain editable', async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.removeItem('orchestra-gamepad-v5');
    localStorage.setItem(
      'orchestra-gamepad-v4',
      JSON.stringify({
        family: 'playstation',
        custom: {
          'Custom USB': {
            confirm: 20,
            back: 1,
            skill: 3,
            cutQueue: 2,
            previous: 4,
            next: 5,
            slow: 6,
            stop: 7,
            pause: 9,
            log: 8,
            up: 12,
            down: 13,
            left: 14,
            right: 15,
            queue: 11,
            mark: 10,
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
  await virtualPad(page, 'Custom USB', '');
  await start(page);
  await press(page, 15);
  await press(page, 20);
  await expect(drafts(page)).toHaveCount(1);
  await press(page, 7);
  await expect(confirmed(page)).toHaveCount(1);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orchestra-gamepad-v5')!),
  );
  expect(saved.custom['Custom USB']).toMatchObject({
    confirm: 20,
    back: 1,
    skill: 2,
    guard: 3,
    cutQueue: 6,
    execute: 7,
    axisX: 2,
    axisY: 3,
    invertX: true,
  });
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await page.getByRole('button', { name: '基本技・決定・積む ボタン 20', exact: true }).click();
  await release(page);
  await press(page, 21);
  await expect(
    page.getByRole('button', { name: '基本技・決定・積む ボタン 21', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '上へ 未割当', exact: true }).click();
  await release(page);
  await press(page, 7);
  await expect(page.getByRole('dialog', { name: 'ゲームパッド設定' })).toContainText(
    'いずれかが未割当になります',
  );
  const retained = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orchestra-gamepad-v5')!),
  );
  expect(retained.custom['Custom USB']).toMatchObject({ execute: 7, up: -1, confirm: 21 });
});

for (const [width, height] of [
  [1366, 752],
  [1440, 900],
  [390, 844],
])
  test(`palette, four drafts and auxiliary menu fit ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    await page.keyboard.press('f');
    for (let i = 0; i < 4; i++) await page.keyboard.press('c');
    await expect(drafts(page)).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/palette-${width}.png`, fullPage: true });
    if (width > 800)
      expect(
        await page
          .locator('.log-container')
          .evaluate((el) => el.getBoundingClientRect().bottom + scrollY),
      ).toBeLessThanOrEqual(height);
    await page.keyboard.press('i');
    await expect(page.getByRole('listbox', { name: '補助メニュー' })).toBeVisible();
    await page.getByRole('option', { name: /戦闘ログ.*記録/ }).click();
    await expect(page.getByRole('log', { name: 'パッドの戦闘ログ' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
