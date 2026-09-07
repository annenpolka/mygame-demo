import { expect, test } from '@playwright/test';
test('help reflects current combat rules and the configured focus drain', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.getByLabel('スロー消費 / 秒', { exact: true }).fill('7');
  await page.getByRole('button', { name: '条件を反映して再開始' }).click();
  await page.getByRole('button', { name: '操作説明', exact: true }).click();
  const help = page.getByRole('dialog', { name: '操作説明' });
  await expect(help).toContainText('前列は全職の威力×1.25');
  await expect(help).toContainText('スロー中は毎実秒7');
  await expect(help).toContainText('発動0.6秒で交代');
  await expect(help).toContainText('支払い済みATBは戻りません');
  await expect(help).toContainText('○／Bは戻る専用');
  await expect(help).toContainText('Bは確定した後続の取消');
  await expect(help).toContainText('P は休憩ポーズ');
  await expect(help).not.toContainText('戦術停止');
  await expect(help).not.toContainText('先頭予約を取消');
  await expect(help).not.toContainText('Esc は休憩ポーズ');
});
