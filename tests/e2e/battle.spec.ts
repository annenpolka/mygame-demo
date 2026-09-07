import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});

test('keyboard selection, tactical stop, command reservation, and opaque system pause', async ({
  page,
}) => {
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(1000);
  await page.keyboard.press('f');
  const time = await page.locator('.battle-clock strong').innerText();
  const focus = Number(
    await page.getByRole('meter', { name: '集中力', exact: true }).getAttribute('aria-valuenow'),
  );
  await page.clock.runFor(2000);
  await expect(page.locator('.battle-clock strong')).toHaveText(time);
  expect(
    Number(
      await page.getByRole('meter', { name: '集中力', exact: true }).getAttribute('aria-valuenow'),
    ),
  ).toBeLessThan(focus - 20);
  await page.keyboard.press('3');
  await expect(page.locator('.console-choices > .console-label')).toContainText('セナ');
  await page.keyboard.press('x');
  await expect(page.locator('.target-heading h2')).toBeVisible();
  await page
    .locator('.target-choices')
    .getByRole('button', { name: /アルト/ })
    .click();
  await expect(page.locator('.plan-list')).toContainText('祝福の鐘');
  await page.keyboard.press('1');
  await expect(page.locator('.party-card').nth(2)).toContainText('祝福の鐘');
  await page.getByRole('tab', { name: '移動', exact: true }).click();
  await page.getByRole('button', { name: '← 後列へ 0.6秒 · 末尾に積む', exact: true }).click();
  await expect(page.locator('.party-card').nth(0)).toContainText('前列');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
  const pausedFocus = await page
    .getByRole('meter', { name: '集中力', exact: true, includeHidden: true })
    .getAttribute('aria-valuenow');
  await page.clock.runFor(5000);
  expect(
    await page
      .getByRole('meter', { name: '集中力', exact: true, includeHidden: true })
      .getAttribute('aria-valuenow'),
  ).toBe(pausedFocus);
  await page.getByRole('button', { name: '戦場へ戻る Esc' }).click();
  await page.keyboard.press('f');
  await page.clock.runFor(1000);
  await expect(page.locator('.party-card').nth(0)).toContainText('後列');
});

test('first battle, equipment update, preset edit, second battle and victory', async ({ page }) => {
  // This test renders two full battles while running 110 seconds of browser animation callbacks.
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.getByRole('button', { name: '灰の砲術師の情報' }).click();
  await page.getByRole('button', { name: 'S 崩しの連奏 A B B', exact: true }).click();
  await page.clock.runFor(35000);
  const loot = page.getByRole('dialog', { name: '戦利品と編成' });
  await expect(loot).toBeVisible();
  await loot.getByRole('combobox', { name: 'アルトの武器枠2', exact: true }).selectOption('hammer');
  await expect(loot.getByRole('status')).toContainText(
    '守護騎士〈S・防護〉→ 破砕士〈B・押し出し〉',
  );
  await loot.getByRole('combobox', { name: 'リネの武器枠2', exact: true }).selectOption('starbow');
  await loot.getByRole('combobox', { name: '崩しの連奏のアルト', exact: true }).selectOption('1');
  await loot.getByRole('button', { name: '次の戦闘へ →' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('夜渡りの包囲陣');
  await expect(page.getByRole('button', { name: 'S 崩しの連奏 B B B', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '夜渡りの砲術師の情報' }).click();
  await page.getByRole('button', { name: 'A 均衡の調べ A B S', exact: true }).click();
  await page.clock.runFor(75000);
  await expect(page.getByRole('dialog', { name: '戦闘結果' })).toContainText('境界を、越えた。');
  expect(errors).toEqual([]);
});

test('lab snapshot roundtrip, invalid JSON and linked/individual control modes', async ({
  page,
}) => {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.getByLabel('操作方式', { exact: true }).selectOption('linked');
  await page.getByRole('button', { name: '条件を反映して再開始' }).click();
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.getByRole('button', { name: 'G 守りの祈り S B S', exact: true }).click();
  await page.clock.runFor(1000);
  await expect(page.locator('.party-card').nth(0)).toContainText('後列');
  await expect(page.locator('.party-card').nth(0)).toContainText('守護騎士');
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.getByRole('button', { name: '状態を保存', exact: true }).click();
  const savedTime = await page.locator('.battle-clock strong').innerText();
  await page.clock.runFor(5000);
  await page.getByRole('button', { name: '保存状態へ戻る', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('保存時点へ戻りました');
  await expect(page.locator('.battle-clock strong')).toHaveText(savedTime);
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"kind":"snapshot","state":{}}'),
  });
  await expect(page.getByRole('status')).toContainText('不正');
  await page.getByLabel('操作方式', { exact: true }).selectOption('individual');
  await page.getByRole('button', { name: '条件を反映して再開始' }).click();
  await expect(
    page.getByText('個別操作モード：行動の「移動」から予約', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '全員後列 7', exact: true })).toHaveCount(0);
});

test('mobile layout and touch controls stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '戦闘開始 →', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.getByRole('button', { name: 'S 崩しの連奏 A B B', exact: true }).click();
  await page.clock.runFor(1000);
  await page.getByRole('button', { name: 'セナを選択', exact: true }).click();
  await page.getByRole('button', { name: '引き寄せを選ぶ', exact: true }).click();
  await expect(page.locator('.target-picker')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('horizontal battlefield, direct row targeting, and a glanceable desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(3200);
  const lanes = page.locator('.battle-lane');
  const boxes = await lanes.evaluateAll((nodes) =>
    nodes.map((n) => ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y })),
  );
  expect(boxes.every((b, i) => i === 0 || (b.x > boxes[i - 1].x && b.y === boxes[0].y))).toBe(true);
  await page.getByRole('button', { name: '停止 ×0.00', exact: true }).click();
  await page.getByRole('button', { name: '円弧斬りを選ぶ', exact: true }).click();
  await page.getByRole('button', { name: '敵 前列この列を選ぶ', exact: true }).click();
  await expect(page.locator('.plan-list')).toContainText('円弧斬り');
  const logBox = await page.locator('.log-container').boundingBox();
  expect(logBox!.y + logBox!.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: 'test-results/horizontal-desktop.png', fullPage: true });
});

test('combat log filters, search, follow toggle, and JSON export', async ({ page }) => {
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(8000);
  await page.getByRole('button', { name: /戦闘ログ .*件/ }).click();
  await page.getByLabel('ログの種類', { exact: true }).selectOption('warning');
  await page.getByRole('searchbox', { name: 'ログを検索' }).fill('衛兵');
  await expect(page.locator('.log-entry').first()).toContainText('鐘楼の衛兵');
  expect(
    await page
      .locator('.log-entry')
      .evaluateAll((nodes) => nodes.every((n) => n.classList.contains('log-warning'))),
  ).toBe(true);
  await page.getByLabel('最新を追う', { exact: true }).uncheck();
  await page.getByRole('searchbox', { name: 'ログを検索' }).fill('存在しない技');
  await expect(page.getByText('条件に合うログはありません。', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON保存', exact: true }).click();
  const download = await downloading;
  const { readFile } = await import('node:fs/promises');
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.events[0].text).toContain('戦闘開始');
  expect(exported.events.some((e: { type: string }) => e.type === 'damage')).toBe(true);
});

test('encounter sets and strength change the actual enemies', async ({ page }) => {
  await page.getByRole('button', { name: '交差砲火', exact: true }).click();
  await page.getByRole('button', { name: '強度 4', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('交差砲火');
  await expect(
    page.getByRole('meter', { name: '後列狙いの砲手のHP', exact: true }),
  ).toHaveAttribute('aria-valuemax', '2746');
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(2900);
  await expect(page.getByText('前列への交差砲撃', { exact: true })).toBeVisible();
  await expect(page.getByText('後列への交差砲撃', { exact: true })).toBeVisible();
  expect(await page.locator('.danger-lane').count()).toBe(2);
});

test('mobile crossfire keeps all three enemy cards beside each other', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '交差砲火', exact: true }).click();
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(2900);
  const cards = await page
    .locator('.enemy-card')
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y));
  expect(new Set(cards).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/crossfire-mobile.png', fullPage: true });
});

test('result log remains usable in a small viewport and can return to set selection', async ({
  page,
}) => {
  const { runPolicy } = await import('../../src/ai/runner');
  const run = runPolicy({ policy: 'tactician' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'replay.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(run.recording)),
  });
  const dialog = page.getByRole('dialog', { name: '戦闘結果' });
  await expect(
    dialog.getByRole('button', { name: new RegExp(`戦闘ログ ${run.events.length}件`) }),
  ).toBeVisible();
  await dialog.getByLabel('ログの戦闘', { exact: true }).selectOption('1');
  expect(
    await dialog
      .locator('.log-entry')
      .evaluateAll((nodes) => nodes.every((n) => n.textContent?.includes('1戦 /'))),
  ).toBe(true);
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.height).toBeLessThan(844);
  await page.screenshot({ path: 'test-results/result-log-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: '戦闘セットを選び直す', exact: true }).click();
  await expect(page.getByRole('region', { name: '戦闘セット選択' })).toBeVisible();
});
