import { test, expect, type Page } from '@playwright/test';
import { command, createState } from '../../src/sim/engine';
import type { State } from '../../src/sim/types';

const drafts = (page: Page) => page.locator('.pad-plan-list li[data-plan-status=draft]');
const clockSeconds = async (page: Page) => {
  const [minutes, seconds] = (await page.locator('.battle-clock strong').innerText())
    .split(':')
    .map(Number);
  return minutes * 60 + seconds;
};
async function loadSnapshot(page: Page, state: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'battle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: state.version, state })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});

test('keyboard selection, quarter-speed slow, direct movement, reservation and opaque system pause', async ({
  page,
}) => {
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(1000);
  await page.keyboard.press('Space');
  const time = await clockSeconds(page);
  const focus = Number(
    await page.getByRole('meter', { name: '集中力', exact: true }).getAttribute('aria-valuenow'),
  );
  await page.clock.runFor(2000);
  expect((await clockSeconds(page)) - time).toBeCloseTo(0.5, 1);
  const spent =
    focus -
    Number(
      await page.getByRole('meter', { name: '集中力', exact: true }).getAttribute('aria-valuenow'),
    );
  // The meter rounds its displayed value to whole focus points.
  expect(spent).toBeGreaterThanOrEqual(7);
  expect(spent).toBeLessThanOrEqual(9);
  await page.keyboard.press('Space');
  await page.keyboard.press('3');
  await expect(page.locator('.pad-plan-list')).toContainText('キャラ交代');
  await page.clock.runFor(1200);
  await expect(page.locator('.pad-page-heading')).toContainText('セナ');
  await page.getByRole('button', { name: /^アルトを支援対象にする/ }).click();
  await page.keyboard.press('x');
  await expect(drafts(page)).toHaveCount(1);
  await expect(drafts(page)).toContainText('祝福の鐘');
  await page.keyboard.press('h');
  await expect(page.locator('.pad-plan-list li[data-plan-status=committed]')).toContainText(
    '祝福の鐘',
  );
  await page.clock.runFor(4500);
  await page.keyboard.press('1');
  await expect(page.locator('.atb-reservation').first()).toContainText('キャラ交代');
  await page.clock.runFor(2000);
  await expect(page.locator('.pad-page-heading')).toContainText('アルト');
  await page.keyboard.press('j');
  await expect(drafts(page)).toHaveCount(0);
  await expect(page.locator('.pad-actor').nth(0)).toContainText('前列');
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
  const pausedFocus = await page
    .getByRole('meter', { name: '集中力', exact: true, includeHidden: true })
    .getAttribute('aria-valuenow');
  const pausedTime = await page.locator('.battle-clock strong').innerText();
  await page.clock.runFor(5000);
  expect(
    await page
      .getByRole('meter', { name: '集中力', exact: true, includeHidden: true })
      .getAttribute('aria-valuenow'),
  ).toBe(pausedFocus);
  await expect(page.locator('.battle-clock strong')).toHaveText(pausedTime);
  await expect(page.locator('.pad-actor').nth(0)).toContainText('前列');
  await page.getByRole('button', { name: '戦場へ戻る Esc' }).click();
  await page.clock.runFor(1000);
  await expect(page.locator('.pad-actor').nth(0)).toContainText('後列');
});

test('first battle, equipment update, preset edit, second battle and victory', async ({ page }) => {
  // Sena is controlled manually; the two attackers keep acting automatically.
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('3');
  await page.getByRole('button', { name: /^灰の砲術師を攻撃対象にする/ }).click();
  await page.keyboard.press('s');
  await page.clock.runFor(45000);
  const loot = page.getByRole('dialog', { name: '戦利品と編成' });
  await expect(loot).toBeVisible();
  await loot.getByRole('button', { name: 'アルトの武器枠2を編集', exact: true }).click();
  await loot.getByRole('button', { name: '轟砕の槌をアルトの枠2に装備', exact: true }).click();
  await expect(loot.getByRole('status')).toContainText('守護騎士 D｜防護 → 破砕士 B｜押し出し');
  await loot.getByRole('button', { name: 'リネの武器枠2を編集', exact: true }).click();
  await loot.getByRole('button', { name: '流星の弓をリネの枠2に装備', exact: true }).click();
  await loot.getByRole('tab', { name: 'オプティマ', exact: true }).click();
  await loot.getByRole('button', { name: 'オプティマ2を編集', exact: true }).click();
  await loot.getByRole('button', { name: 'オプティマ2のアルトを枠2に変更', exact: true }).click();
  await loot.getByRole('button', { name: '次の戦闘へ →' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('夜渡りの包囲陣');
  await expect(page.locator('.pad-actor').nth(0).locator('.role')).toHaveText('B');
  await page.keyboard.press('u');
  await page.clock.runFor(700);
  await expect(page.locator('.pad-actor').nth(0).locator('.role')).toHaveText('A');
  await page.getByRole('button', { name: /^夜渡りの砲術師を攻撃対象にする/ }).click();
  await page.keyboard.press('a');
  // The manually controlled healer must act; target priority no longer suppresses all rear fire.
  for (let i = 0; i < 15; i++) {
    await page.clock.runFor(6000);
    if (await page.getByRole('dialog', { name: '戦闘結果' }).isVisible()) break;
    const health = await Promise.all(
      ['アルト', 'リネ', 'セナ'].map(async (name) => ({
        name,
        hp: Number(
          await page
            .getByRole('meter', { name: `${name}のHP`, exact: true })
            .getAttribute('aria-valuenow'),
        ),
        max: Number(
          await page
            .getByRole('meter', { name: `${name}のHP`, exact: true })
            .getAttribute('aria-valuemax'),
        ),
      })),
    );
    const hurt = health.filter((x) => x.hp > 0).sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
    if (hurt.hp < hurt.max * 0.85) {
      await page.getByRole('button', { name: new RegExp(`^${hurt.name}を支援対象にする`) }).click();
      await expect(page.getByRole('button', { name: /^基本技：小さな祈り、/ })).toBeEnabled();
      await page.keyboard.press('z');
      await page.keyboard.press('z');
      await page.keyboard.press('h');
    }
  }
  await expect(page.getByRole('dialog', { name: '戦闘結果' })).toContainText('境界を、越えた。');
  expect(errors).toEqual([]);
});

test('lab snapshot roundtrip, invalid JSON and separate/individual control modes', async ({
  page,
}) => {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.getByLabel('操作方式', { exact: true }).selectOption('separate');
  await page.getByRole('button', { name: '条件を反映して再開始' }).click();
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('g');
  await page.clock.runFor(1000);
  await expect(page.locator('.pad-actor').nth(0)).toContainText('前列');
  await expect(page.locator('[data-unit=a0]')).toContainText('D');
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.getByRole('button', { name: '状態を保存', exact: true }).click();
  const savedTime = await page.locator('.battle-clock strong').innerText();
  await page.clock.runFor(5000);
  await page.getByRole('button', { name: '保存状態へ戻る', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('保存時点へ戻りました');
  await expect(page.locator('.battle-clock strong')).toHaveText(savedTime);
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"kind":"snapshot","state":{}}'),
  });
  await expect(page.locator('.toast')).toContainText('不正');
  await page.getByLabel('操作方式', { exact: true }).selectOption('individual');
  await page.getByRole('button', { name: '条件を反映して再開始' }).click();
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.getByRole('button', { name: '補助を選ぶ', exact: true }).click();
  await page
    .getByRole('group', { name: '補助メニュー', exact: true })
    .getByRole('button', { name: /全体指示/ })
    .click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.pad-no-choices')).toContainText('個別操作モード');
});

test('mobile layout and touch controls stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '戦闘開始 →', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.keyboard.press('s');
  await page.clock.runFor(1000);
  await page.getByRole('button', { name: 'セナに指示', exact: true }).click();
  await page.clock.runFor(1600);
  await page.getByRole('button', { name: /^主力技：引き寄せ、/ }).click();
  await expect(page.getByRole('group', { name: '行動の対象候補' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('horizontal battlefield, enemy-based range targeting, and a glanceable desktop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(3200);
  const lanes = page.locator('.battle-lane');
  const boxes = await lanes.evaluateAll((nodes) =>
    nodes.map((n) => ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y })),
  );
  expect(boxes.every((b, i) => i === 0 || (b.x > boxes[i - 1].x && b.y === boxes[0].y))).toBe(true);
  await page.getByRole('button', { name: /^主力技：円弧斬り、/ }).click();

  await expect(page.locator('.pad-plan-list')).toContainText('円弧斬り');
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
  await page.clock.runFor(4500);
  await expect(page.getByText('前列への交差砲撃', { exact: true })).toBeVisible();
  await expect(page.getByText('後列への交差砲撃', { exact: true })).toBeVisible();
  expect(await page.locator('.danger-lane').count()).toBe(2);
});

test('mobile crossfire shows all three enemies and their gauges in the formation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '交差砲火', exact: true }).click();
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
  await page.clock.runFor(4500);
  const cards = await page
    .locator('.field-unit.foe')
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y));
  expect(cards).toHaveLength(3);
  await expect(page.locator('.field-unit.foe [role=meter]')).toHaveCount(9);
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

function targetBoundaryState() {
  const state = createState({ atbRate: 3 });
  command(state, { type: 'start' });
  state.allies[0].atb = 4;
  state.allies.slice(1).forEach((ally) => (ally.executionHeld = true));
  state.enemies.forEach((enemy) => {
    enemy.nextAttack = 999;
    enemy.hp = 1;
  });
  return state;
}

test('a new encounter clears the defeated target and starts with visible valid party destinations', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await loadSnapshot(page, targetBoundaryState());
  await page.getByRole('button', { name: /^セナを支援対象にする/ }).click();
  await page.keyboard.press('z');
  await page.keyboard.press('h');
  await page.clock.runFor(2500);
  await expect(page.locator('[data-unit=e0]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-unit=e1]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^灰の砲術師を攻撃対象にする/ }).click();
  await page.keyboard.press('z');
  await page.keyboard.press('h');
  await page.clock.runFor(2500);
  const loot = page.getByRole('dialog', { name: '戦利品と編成' });
  await expect(loot).toBeVisible();
  await loot.getByRole('button', { name: '次の戦闘へ →' }).click();
  await expect(page.locator('[data-unit=e0]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-unit=a0]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-unit=a2]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-unit=e0] .unit-target-marks')).not.toHaveClass(/invalid/);
  await page.keyboard.press('z');
  await expect(drafts(page)).toHaveCount(1);
  await expect(drafts(page).locator('button')).toHaveAttribute('aria-label', /鉄殻の衛兵/);
  await expect(page.locator('[data-candidate=true]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('ordinary snapshot import resets stale invalid targets to the loaded actor and first living enemy', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const source = targetBoundaryState();
  source.enemies[1].hp = source.enemies[1].maxHp;
  await loadSnapshot(page, source);
  await page.getByRole('button', { name: /^セナを支援対象にする/ }).click();
  await page.keyboard.press('z');
  await page.keyboard.press('h');
  await page.clock.runFor(2500);
  await expect(page.locator('[data-unit=e0]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-unit=e1]')).toHaveAttribute('aria-pressed', 'true');
  const restored = targetBoundaryState();
  restored.selected = 1;
  restored.allies[1].executionHeld = false;
  await loadSnapshot(page, restored);
  await expect(page.locator('.pad-page-heading')).toContainText('リネ');
  await expect(page.locator('[data-unit=e0]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-unit=a1]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-unit=a2]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-unit=e0] .unit-target-marks')).not.toHaveClass(/invalid/);
  await page.keyboard.press('z');
  await expect(drafts(page)).toHaveCount(1);
  await expect(drafts(page).locator('button')).toHaveAttribute('aria-label', /鐘楼の衛兵/);
  await expect(page.locator('[data-candidate=true]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
