import { test, expect } from '@playwright/test';
test('real audio graph starts on interaction, gives action feedback, and respects persisted mute', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const stats = { voices: 0, resumes: 0 };
    (window as any).audioStats = stats;
    window.AudioContext = class extends Original {
      createOscillator() {
        stats.voices++;
        return super.createOscillator();
      }
      resume() {
        stats.resumes++;
        return super.resume();
      }
    };
  });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('f');
  await page.keyboard.press('c');
  await expect(page.locator('.toast')).toContainText('防御を予約');
  await expect
    .poll(() => page.evaluate(() => (window as any).audioStats.voices))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '効果音を切り替え', exact: true }).click();
  await expect(page.getByRole('button', { name: '効果音を切り替え', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const voices = await page.evaluate(() => (window as any).audioStats.voices);
  await page.keyboard.press('r');
  await page.keyboard.press('w');
  await page.keyboard.press('b');
  expect(await page.evaluate(() => (window as any).audioStats.voices)).toBe(voices);
  await expect(page.locator('.toast')).toContainText('未実行の予約をすべて取消');
  await page.reload();
  await expect(page.getByRole('button', { name: '効果音を切り替え', exact: true })).toContainText(
    '音OFF',
  );
});

test('bonus presets select the comparison condition and expose the active party multipliers', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '強め・速度比較', exact: true }).click();
  await expect(page.getByRole('button', { name: '強め・速度比較', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('meter', { name: '鐘楼の衛兵のHP', exact: true })).toHaveAttribute(
    'aria-valuemax',
    '2100',
  );
  await page.getByRole('button', { name: 'なし', exact: true }).click();
  await expect(page.getByRole('meter', { name: '鐘楼の衛兵のHP', exact: true })).toHaveAttribute(
    'aria-valuemax',
    '1500',
  );
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await expect(page.locator('.active-bonus')).toContainText(
    '威力 ×1.00 · チェイン ×1.00 · 被害 ×1.00 · ATB ×1.00',
  );
});
