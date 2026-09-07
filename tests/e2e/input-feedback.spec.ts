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
