import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseNotes, exportNotes } from '../../src/lab/playtest';
async function exportBook(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '印をJSON保存', exact: true }).click();
  const download = await waiting;
  return parseNotes(await readFile((await download.path())!, 'utf8'));
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});
test('mark, comment, reload and take over an earlier auxiliary panel while retaining the original recording', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 752 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(500);
  await page.getByRole('button', { name: /^リネを支援対象にする/ }).click();
  await page.keyboard.press('v');
  await page.keyboard.press('i');
  await page.clock.runFor(4000);
  const clock = await page.locator('.battle-clock strong').innerText();
  await page.keyboard.press('m');
  await expect(page.getByRole('status', { name: '操作結果' })).toContainText('印 1');
  await expect(page.locator('.battle-clock strong')).toHaveText(clock);
  await page.clock.runFor(1000);
  await expect(page.locator('.battle-clock strong')).not.toHaveText(clock);
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
  expect(
    await page.locator('.log-container').evaluate((e) => e.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(752);
  await page.keyboard.press('Shift+M');
  const notes = page.getByRole('dialog', { name: '気になった場面' });
  await expect(notes).toBeVisible();
  await page
    .getByLabel('場面へのコメント', { exact: true })
    .fill('補助を開いたまま、次の判断に迷った m');
  await page.getByLabel('場面の分類', { exact: true }).selectOption('unclear');
  const original = await exportBook(page);
  expect(original).toHaveLength(1);
  expect(original[0].before.view.battle.page).toBe('aux');
  expect(original[0].before.view.battle.candidates?.ally).toEqual({ kind: 'ally', id: 1 });
  expect(
    original[0].marked.state.realTime - original[0].before.state.realTime,
  ).toBeGreaterThanOrEqual(2.99);
  await page.screenshot({ path: 'test-results/playtest-notes-desktop.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: '印の一覧', exact: true }).click();
  await expect(page.getByLabel('場面へのコメント', { exact: true })).toHaveValue(
    '補助を開いたまま、次の判断に迷った m',
  );
  await page.getByRole('button', { name: /秒前から再操作/ }).click();
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toContainText('印の少し前');
  await page.getByRole('button', { name: 'この場面から操作する Esc', exact: true }).click();
  await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
  await expect(page.locator('[data-plan-status=draft]').getByRole('button')).toHaveAccessibleName(
    /救急薬、リネ/,
  );
  await expect(page.getByRole('meter', { name: '操作キャラのATB' })).toHaveAttribute(
    'aria-valuenow',
    String(original[0].before.state.allies[0].atb),
  );
  await page.keyboard.press('z');
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(2);
  await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
  await page.keyboard.press('m');
  await page.keyboard.press('Shift+M');
  const after = await exportBook(page);
  expect(after).toHaveLength(2);
  expect(after[0]).toEqual(original[0]);
  expect(after[1].sourceId).toBe(original[0].id);
  expect(errors).toEqual([]);
});
test('old-rule notes are retained but offer a fresh encounter comparison instead of transplanting a midway state', async ({
  page,
}) => {
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(1000);
  await page.keyboard.press('m');
  await page.keyboard.press('Shift+M');
  const notes = await exportBook(page);
  notes[0].id = 'old-rules-case';
  notes[0].rules = 'old';
  notes[0].recording.version = 'orchestra-old';
  notes[0].comment = '旧版で記録した場面';
  await page
    .getByRole('dialog', { name: '気になった場面' })
    .locator('input[type=file]')
    .setInputFiles({
      name: 'old-notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportNotes(notes)),
    });
  await page.getByRole('button', { name: /印 2 ·/ }).click();
  await expect(page.getByRole('button', { name: /秒前から再操作/ })).toBeDisabled();
  await page.getByText('現在のルールで、遭遇開始から比較', { exact: true }).click();
  await page.getByRole('button', { name: '現在のルールで遭遇開始から比較', exact: true }).click();
  await page.getByRole('button', { name: 'この場面から操作する Esc', exact: true }).click();
  await expect(page.locator('.battle-clock strong')).toHaveText('00:00.0');
  await expect(page.locator('.pad-plan-list li')).toHaveCount(0);
});
test('mobile notes remain readable and can be reached from results', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(500);
  await page.getByRole('button', { name: '今のところに印を付ける' }).click();
  await page.getByRole('button', { name: '印の一覧', exact: true }).click();
  await page.getByLabel('場面へのコメント', { exact: true }).fill('移動と交代の順を確認したい');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/playtest-notes-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '印の一覧を閉じる Esc', exact: true }).click();
  // The existing replay importer reaches a result while the independent notebook stays available.
  const { runPolicy } = await import('../../src/ai/runner');
  const run = runPolicy({ policy: 'tactician' });
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page
    .getByRole('complementary', { name: '実験室' })
    .locator('input[type=file]')
    .setInputFiles({
      name: 'battle.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(run.recording)),
    });
  await page
    .getByRole('dialog', { name: '戦闘結果' })
    .getByRole('button', { name: '印の一覧（1件）', exact: true })
    .click();
  await expect(page.getByLabel('場面へのコメント', { exact: true })).toHaveValue(
    '移動と交代の順を確認したい',
  );
});
for (const family of [
  'Xbox Wireless Controller',
  'DualSense Wireless Controller',
  'Nintendo Switch Pro Controller',
]) {
  test(`${family}: L3 marks once, pause opens notes, and confirm resumes the marked auxiliary screen`, async ({
    page,
  }) => {
    await page.evaluate((id) => {
      const pad = {
        id,
        index: 0,
        mapping: 'standard',
        connected: true,
        buttons: Array.from({ length: 24 }, () => ({ pressed: false, value: 0 })),
        axes: [0, 0],
      };
      (window as any).playtestPad = pad;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    }, family);
    const press = async (index: number, hold = 32) => {
      await page.evaluate((i) => {
        (window as any).playtestPad.buttons[i] = { pressed: true, value: 1 };
      }, index);
      await page.clock.runFor(hold);
      await page.evaluate((i) => {
        (window as any).playtestPad.buttons[i] = { pressed: false, value: 0 };
      }, index);
      await page.clock.runFor(32);
    };
    await page.clock.runFor(32);
    await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
    await press(8); // Open the auxiliary menu; R3 is now slow.
    await press(10, 600); // Holding a mark button never repeats.
    await expect(page.getByRole('button', { name: '印の一覧', exact: true })).toHaveText('印 1');
    await press(9);
    await press(10); // System pause, then L3 opens the notebook.
    await expect(page.getByRole('dialog', { name: '気になった場面' })).toBeVisible();
    await page.getByRole('button', { name: '印の瞬間から再操作', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'この場面から操作する Esc', exact: true }),
    ).toBeFocused();
    await press(family.includes('Nintendo') ? 1 : 0);
    await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '補助を選ぶ', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
  });
}

test('storage failure keeps the note available for export and tells the player it is only in this tab', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'orchestra-playtest-v1') throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.reload();
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('m');
  await expect(page.getByRole('status', { name: '操作結果' })).toContainText(
    'ブラウザへ保存できない',
  );
  await page.keyboard.press('Shift+M');
  await expect(page.getByRole('alert')).toContainText('JSON保存');
  expect(await exportBook(page)).toHaveLength(1);
});
