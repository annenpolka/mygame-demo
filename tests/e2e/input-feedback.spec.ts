import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
});

test('native target activation selects without drafting, and native skill activation adds once', async ({
  page,
}) => {
  const target = page.getByRole('button', { name: /^灰の砲術師を攻撃対象にする/ });
  await target.focus();
  await page.keyboard.press('Enter');
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(0);
  const skill = page.getByRole('button', { name: /^基本技：斬撃/ });
  await skill.focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter'); // Repeated keydown from a held physical key.
  await page.keyboard.up('Enter');
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(1);
  await expect(
    page.locator('[data-plan-status=draft]').getByRole('button', { name: /灰の砲術師/ }),
  ).toBeVisible();
  await expect(page.locator('[data-unit=e1]')).toHaveAttribute('data-editing', 'true');
  await expect(page.locator('.toast')).toHaveCount(0);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`${reducedMotion}: input leaves a visible receipt without combat impact`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    const hp = await page
      .getByRole('meter', { name: '鐘楼の衛兵のHP', exact: true })
      .getAttribute('aria-valuenow');
    await page.keyboard.press('z');
    await expect(page.locator('[data-plan-status=draft].new-draft')).toHaveCount(1);
    await expect(page.locator('[data-plan-status=draft] .plan-skill-token')).toBeVisible();
    await expect(page.locator('.feedback-added')).toBeVisible();
    if (reducedMotion === 'reduce') {
      await expect(page.locator('.input-flight')).toBeHidden();
      expect(
        await page.locator('.input-flight').evaluate((node) => node.getAnimations().length),
      ).toBe(0);
    } else {
      expect(
        await page.locator('.input-flight').evaluate((node) => node.getAnimations().length),
      ).toBe(1);
    }
    await expect(page.getByRole('meter', { name: '鐘楼の衛兵のHP', exact: true })).toHaveAttribute(
      'aria-valuenow',
      hp!,
    );
    await expect(page.locator('.fx-cue')).toHaveCount(0);
    await page.clock.runFor(600);
    await expect(page.locator('[data-plan-status=draft] .plan-skill-token')).toBeVisible();
  });
}

for (const width of [1366, 390]) {
  test(`the persistent desk adds, executes and removes in place without Back at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 752 });
    await page.getByRole('button', { name: '下の操作盤', exact: true }).click();
    const console = page.locator('.pad-console');
    const panel = page.locator('.pad-auxiliary');
    const target = page.getByRole('button', { name: /^リネを支援対象にする/ });
    const drafts = page.locator('[data-plan-status=draft]');
    const committed = page.locator('[data-plan-status=committed]');
    await expect(console.getByRole('button', { name: /戻る/ })).toHaveCount(0);
    await expect(panel.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
    await expect(console.getByRole('button', { name: /^基本技：斬撃/ })).toBeVisible();

    await target.focus();
    await expect(drafts).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect(drafts).toHaveCount(0);
    await expect(
      console.getByRole('button', { name: '救急薬：リネ、0 ATB', exact: true }),
    ).toBeVisible();
    await page
      .locator('.pad-panel-tabs')
      .getByRole('button', { name: 'ログ', exact: true })
      .click();
    await expect(panel).toHaveAttribute('data-panel', 'log');
    const basic = console.getByRole('button', { name: /^基本技：斬撃/ });
    await basic.focus();
    await expect(drafts).toHaveCount(0); // Focus must not submit a command or change the panel.
    await expect(panel).toHaveAttribute('data-panel', 'log');
    await page.keyboard.press('z');
    await page.keyboard.press('x');
    await page.keyboard.press('v');
    await expect(drafts).toHaveCount(3);
    await expect(drafts.last().getByRole('button')).toHaveAccessibleName(/救急薬、リネ/);
    await expect(panel).toHaveAttribute('data-panel', 'log');
    await expect(page.getByRole('listbox', { name: '戦場で対象を選ぶ' })).toHaveCount(0);
    await page.keyboard.press('h');
    await expect(drafts).toHaveCount(0);
    await expect(committed).toHaveCount(3);
    await expect(panel).toHaveAttribute('data-panel', 'log');

    const remove = committed.nth(1).getByRole('button');
    const node = await remove.elementHandle();
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(committed).toHaveCount(2);
    await expect(panel).toHaveAttribute('data-panel', 'log');
    const receipt = console.getByRole('button', { name: '円弧斬り：取消済み', exact: true });
    await expect(receipt).toHaveAttribute('aria-disabled', 'true');
    await expect(receipt).toBeFocused();
    await expect(receipt).toBeInViewport();
    expect(
      await node!.evaluate((button) => button.isConnected && button === document.activeElement),
    ).toBe(true);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
    await expect(committed).toHaveCount(2);
    await expect(panel).toHaveAttribute('data-panel', 'log');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: test.info().outputPath(`backless-desk-${width}.png`),
      fullPage: true,
    });
  });
}

test('pause keeps a keyboard exit and returns focus to its visible invoker', async ({ page }) => {
  const pause = page.locator('.pad-console').getByRole('button', { name: /休憩/ });
  await pause.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '休憩ポーズ', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.clock.runFor(32); // Allow the scheduled focus restoration after the dialog unmounts.
  await expect(pause).toBeFocused();
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(0);
});

test('help closes with Escape and restores its keyboard invoker', async ({ page }) => {
  const help = page.getByRole('button', { name: '操作説明', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '操作説明', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.clock.runFor(32);
  await expect(help).toBeFocused();
});

test('native log controls remain usable while target navigation stays selected', async ({
  page,
}) => {
  await page.clock.runFor(8000);
  await page.locator('.pad-panel-tabs').getByRole('button', { name: 'ログ', exact: true }).click();
  await page.getByRole('button', { name: '対象を選ぶ', exact: true }).click();
  const log = page.getByRole('log', { name: 'パッドの戦闘ログ', exact: true });
  const latest = (await log.textContent()) ?? '';
  const navigation = page.getByRole('group', { name: 'ログの表示位置', exact: true });
  const older = navigation.getByRole('button', { name: '古い記録', exact: true });
  await older.focus();
  await expect(log).toHaveText(latest);
  await page.keyboard.press('Enter');
  await expect(log).not.toHaveText(latest);
  await expect(older).toBeFocused();
  await expect(page.getByRole('button', { name: '対象を選ぶ', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('button', { name: '新しい記録', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(log).toHaveText(latest);
  await expect(log).toHaveAttribute('aria-live', 'off');
  const target = page.locator('[data-unit][data-editing=true]');
  const targetId = await target.getAttribute('data-unit');
  await log.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(log).toBeFocused();
  await expect(target).toHaveAttribute('data-unit', targetId!);
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(0);

  await older.focus();
  let olderSteps = 0;
  while ((await older.getAttribute('aria-disabled')) !== 'true' && olderSteps < 100) {
    await page.keyboard.press('Enter');
    olderSteps++;
  }
  expect(olderSteps).toBeGreaterThan(0);
  expect(olderSteps).toBeLessThan(100);
  await expect(log.locator('p')).toHaveCount(1);
  await expect(log).toContainText('戦闘開始');
  await expect(log.locator('p')).toBeInViewport();
  const firstRecord = (await log.textContent()) ?? '';
  await navigation.getByRole('button', { name: '最新', exact: true }).click();
  await expect(log).toHaveText(latest);
  await page.getByRole('button', { name: '補助を選ぶ', exact: true }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (let i = 0; i < olderSteps; i++) await page.keyboard.press('ArrowUp');
  await expect(log.locator('p')).toHaveCount(1);
  await expect(log).toHaveText(firstRecord);
  await expect(log.locator('p')).toBeInViewport();
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(0);
});
