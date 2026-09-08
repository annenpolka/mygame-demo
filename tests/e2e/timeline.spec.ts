import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createState, command } from '../../src/sim/engine';
import { parseRecording, parseSnapshot } from '../../src/lab/validation';
import { runReplay } from '../../src/lab/session';
import type { State } from '../../src/sim/types';
const dialog = (page: Page) => page.getByRole('dialog', { name: '戦闘タイムライン', exact: true });
function quiet() {
  const s = createState();
  command(s, { type: 'start' });
  s.allies[0].atb = 4;
  s.allies.slice(1).forEach((a) => (a.executionHeld = true));
  s.enemies.forEach((e) => (e.nextAttack = 999));
  return s;
}
async function load(page: Page, s: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'timeline.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
}
async function download(page: Page, name: string) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const file = await waiting;
  return readFile((await file.path())!, 'utf8');
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});
test('automatically records, freezes browsing, and closes without changing the present or making a save', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, quiet());
  await page.clock.runFor(8000);
  const clock = await page.locator('.battle-clock strong').innerText();
  await page.keyboard.press('y');
  await expect(dialog(page)).toBeVisible();
  const position = dialog(page).getByRole('slider', { name: 'タイムラインの位置' });
  const end = await position.inputValue();
  await dialog(page).getByRole('button', { name: '5秒前', exact: true }).click();
  expect(Number(await position.inputValue())).toBeLessThan(Number(end));
  await expect(dialog(page).getByLabel('選んだ時点')).toContainText('3.');
  await page.clock.runFor(5000);
  await expect(page.locator('.battle-clock strong')).toHaveText(clock);
  await position.focus();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.battle-clock strong')).toHaveText(clock);
  await expect(page.getByRole('button', { name: '印の一覧', exact: true })).toHaveText('印 0');
  await page.clock.runFor(500);
  await expect(page.locator('.battle-clock strong')).not.toHaveText(clock);
  expect(errors).toEqual([]);
});
test('rewinds an input, branches from it, keeps the original future and exports a deterministic replay', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, quiet());
  await page.keyboard.press('z');
  await page.clock.runFor(500);
  await page.keyboard.press('z');
  await page.keyboard.press('h');
  await page.clock.runFor(4000);
  await page.keyboard.press('y');
  const branchSelect = dialog(page).getByLabel('タイムラインの履歴');
  const originalBranch = await branchSelect.inputValue();
  await dialog(page)
    .getByRole('button', { name: /下書き1手目に「斬撃」を追加/ })
    .click();
  await expect(dialog(page).getByLabel('過去の状態')).toContainText('下書き 1手');
  await dialog(page).getByRole('button', { name: 'ここから再開', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toContainText(
    'タイムラインの場面',
  );
  await page.getByRole('button', { name: 'この場面から操作する Esc', exact: true }).click();
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(1);
  await page.keyboard.press('c');
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(2);
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  const snapshot = parseSnapshot(await download(page, '状態JSON'));
  const recording = parseRecording(await download(page, 'リプレイJSON'));
  expect(runReplay(recording)).toEqual(snapshot);
  await page.getByRole('button', { name: '実験室を閉じる', exact: true }).click();
  await page.keyboard.press('y');
  await expect(dialog(page).getByLabel('タイムラインの履歴')).not.toHaveValue(originalBranch);
  await dialog(page).getByLabel('タイムラインの履歴').selectOption(originalBranch);
  await expect(dialog(page).getByLabel('過去の状態')).toContainText('下書き 0手');
  await expect(dialog(page).getByLabel('選んだ時点')).toContainText('4.');
  await dialog(page).getByRole('button', { name: 'ここから再開', exact: true }).click();
  await page.getByRole('button', { name: 'この場面から操作する Esc', exact: true }).click();
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('restores a past auxiliary panel and held support target and leaves an existing manual save intact', async ({
  page,
}) => {
  await load(page, quiet());
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.getByRole('button', { name: '状態を保存', exact: true }).click();
  await page.getByRole('button', { name: '実験室を閉じる', exact: true }).click();
  await page.getByRole('button', { name: /^リネを支援対象にする/ }).click();
  await page.keyboard.press('v');
  await page.keyboard.press('i');
  await page.clock.runFor(6000);
  await page.locator('.pad-panel-tabs').getByRole('button', { name: 'ログ', exact: true }).click();
  await page.clock.runFor(1000);
  await page.keyboard.press('y');
  await dialog(page).getByRole('button', { name: '5秒前', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'ここから再開', exact: true }).click();
  await page.getByRole('button', { name: 'この場面から操作する Esc', exact: true }).click();
  await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
  await expect(page.locator('[data-plan-status=draft]').getByRole('button')).toHaveAccessibleName(
    /救急薬、リネ/,
  );
  await expect(page.getByRole('button', { name: '補助を選ぶ', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存状態へ戻る', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存状態へ戻る', exact: true }).click();
  await expect(page.locator('.battle-clock strong')).toContainText('00.0');
});
for (const width of [1366, 390]) {
  test(`a defeat can rewind to battle and the timeline fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 752 });
    const s = quiet();
    s.allies.forEach((a) => (a.hp = 1));
    s.enemies[0].cast = {
      name: '全体攻撃',
      target: 'all',
      row: 'front',
      allyId: 0,
      remaining: 1,
      total: 1,
      power: 1000,
      movable: false,
      push: false,
    };
    await load(page, s);
    await page.clock.runFor(1500);
    const result = page.getByRole('dialog', { name: '戦闘結果', exact: true });
    await result.getByRole('button', { name: 'タイムラインを開く', exact: true }).click();
    await dialog(page).getByRole('button', { name: '最初', exact: true }).click();
    await expect(dialog(page).getByLabel('選んだ時点')).toContainText('戦闘中');
    expect(await dialog(page).evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `test-results/timeline-${width}.png`, fullPage: true });
    await dialog(page).getByRole('button', { name: 'ここから再開', exact: true }).click();
    await page.getByRole('button', { name: 'この場面から操作する Esc', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '戦闘結果', exact: true })).toHaveCount(0);
    await expect(page.getByRole('meter', { name: 'アルトのHP', exact: true })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
  });
}
test('gamepad can open from pause, scrub and resume without sending combat inputs', async ({
  page,
}) => {
  await load(page, quiet());
  await page.evaluate(() => {
    const w = window as any;
    w.testPad = {
      id: 'Xbox Wireless Controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      buttons: Array.from({ length: 24 }, () => ({ pressed: false, value: 0 })),
      axes: [0, 0, 0, 0],
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [w.testPad],
    });
  });
  const press = async (i: number) => {
    await page.evaluate(
      (i) => ((window as any).testPad.buttons[i] = { pressed: true, value: 1 }),
      i,
    );
    await page.clock.runFor(32);
    await page.evaluate(
      (i) => ((window as any).testPad.buttons[i] = { pressed: false, value: 0 }),
      i,
    );
    await page.clock.runFor(32);
  };
  await page.clock.runFor(7000);
  await press(9);
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
  await press(5); // Cycle from Resume to the timeline entry in the pause dialog.
  await press(0);
  await expect(dialog(page)).toBeVisible();
  const before = await dialog(page).getByRole('slider').inputValue();
  await press(4);
  expect(Number(await dialog(page).getByRole('slider').inputValue())).toBeLessThan(Number(before));
  await press(0);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toContainText(
    'タイムラインの場面',
  );
  await expect(page.locator('[data-plan-status=draft]')).toHaveCount(0);
});
