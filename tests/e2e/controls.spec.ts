import { test, expect, type Page } from '@playwright/test';
import { createState, command } from '../../src/sim/engine';
import type { State } from '../../src/sim/types';
import { expectFullSizeFieldAndReachableLog } from './field-layout';
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
        axes: [0, 0, 0, 0],
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
const live = (page: Page) =>
  page.locator('.pad-plan-list li:is([data-plan-status=draft], [data-plan-status=committed])');
const drafts = (page: Page) => page.locator('.pad-plan-list li[data-plan-status=draft]');
const confirmed = (page: Page) => page.locator('.pad-plan-list li[data-plan-status=committed]');
async function start(page: Page) {
  await page.getByRole('button', { name: '戦闘開始 →', exact: true }).click();
}

async function sideStick(page: Page, side: number) {
  await page.evaluate((x) => ((window as any).testPad.axes = [0, 0, x, 0]), side);
  await page.clock.runFor(32);
  await page.evaluate(() => ((window as any).testPad.axes = [0, 0, 0, 0]));
  await page.clock.runFor(32);
}
async function loadSnapshot(page: Page, state: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'controls.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: state.version, state })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
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
  await page.locator('[data-skill-id=guard]').click();
  await expect(live(page)).toHaveCount(4);
  await expect(page.locator('.feedback-blocked')).toBeVisible();
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
  await page.keyboard.press('z');
  await page.keyboard.press('h');
  await page.keyboard.press('v');
  await page.keyboard.press('c');
  for (const key of ['Escape', 'Backspace', 'Delete'])
    for (let i = 0; i < 10; i++) await page.keyboard.press(key);
  await expect(confirmed(page)).toHaveCount(1);
  await expect(drafts(page)).toHaveCount(2);
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
  await page.keyboard.press('v');
  await page.keyboard.press('b');
  await expect(page.getByRole('listbox', { name: '戦場で対象を選ぶ' })).toHaveCount(0);
  await expect(confirmed(page)).toHaveCount(0);
  await expect(drafts(page)).toHaveCount(3);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
});

test('unit targets support mixed skills and stop at the edge without entering a row selection', async ({
  page,
}) => {
  await start(page);
  const field = page.getByRole('group', { name: '行動の対象候補' });
  await field.locator('[data-unit=e1]').click();
  await expect(page.locator('[data-skill-id=sweep]')).toHaveAccessibleName(/敵後列・1体/);
  await page.keyboard.press('z');
  await page.keyboard.press('z');
  await page.keyboard.press('x');
  await expect(drafts(page)).toHaveCount(3);
  await expect(drafts(page).first().getByRole('button')).toHaveAccessibleName(/灰の砲術師/);
  await expect(drafts(page).last().getByRole('button')).toHaveAccessibleName(/後列/);
  await field.locator('[data-unit=e0]').click();
  await expect(drafts(page).first().getByRole('button')).toHaveAccessibleName(/灰の砲術師/);
  await expect(
    page.getByRole('button', { name: '仲間の集中攻撃対象にする', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('b'); // Draft-only cutoff is inert.
  await expect(drafts(page)).toHaveCount(3);
  await page.keyboard.press('h');
  await page.keyboard.press('b');
  await expect(field.getByRole('option', { name: /敵.*列を対象候補にする/ })).toHaveCount(0);
  for (const [key, name] of [
    ['ArrowRight', '灰の砲術師'],
    ['ArrowRight', '灰の砲術師'],
    ['ArrowLeft', '鐘楼の衛兵'],
    ['ArrowLeft', '鐘楼の衛兵'],
  ]) {
    await page.keyboard.press(key);
    await expect(page.locator('[data-skill-id=slash]')).toBeEnabled();
    await expect(page.locator('[data-skill-id=slash]')).toHaveAccessibleName(new RegExp(name));
  }
  await page.keyboard.press('z');
  await page.keyboard.press('x');
  await expect(drafts(page).first().getByRole('button')).toHaveAccessibleName(/鐘楼の衛兵/);
  await expect(drafts(page).last().getByRole('button')).toHaveAccessibleName(/前列/);
});

test('healing destinations and direct weapon skills stay distinct from the manual actor', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('3');
  await page.clock.runFor(1500);
  const field = page.getByRole('group', { name: '行動の対象候補' });
  await field.locator('[data-unit=a0]').click();
  await page.keyboard.press('z');
  await field.locator('[data-unit=a1]').click();
  await page.keyboard.press('z');
  await expect(drafts(page).first().getByRole('button')).toHaveAccessibleName(/アルト/);
  await expect(drafts(page).last().getByRole('button')).toHaveAccessibleName(/リネ/);
  await expect(page.locator('.pad-page-heading')).toContainText('セナ');
  await page.keyboard.press('w');
  await expect(page.locator('[data-skill-id=jab]')).toBeVisible();
  await expect(field.locator('[data-unit=e0]')).toHaveAttribute('aria-pressed', 'true');
  await expect(field.locator('[data-unit=a1]')).toHaveAttribute('data-editing', 'true');
});

test('mouse double click and confirm spam delete only one explicitly chosen draft', async ({
  page,
}) => {
  await start(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('c');
  const chosen = page.getByRole('button', { name: /2手目の防御、.*下書きを取消/ });
  const chosenNode = await chosen.elementHandle();
  await chosen.dblclick();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Enter');
  await expect(drafts(page)).toHaveCount(3);
  const receipt = page.getByRole('button', { name: '防御：取消済み', exact: true });
  await expect(receipt).toHaveAttribute('aria-disabled', 'true');
  await expect(receipt).toBeFocused();
  expect(
    await chosenNode!.evaluate((node) => node.isConnected && node === document.activeElement),
  ).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /2手目の防御、.*下書きを取消/ })).toBeFocused();
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
    await stick(page, 1, 0);
    await down(page, confirm);
    await page.clock.runFor(500);
    await release(page);
    await expect(drafts(page)).toHaveCount(1);
    await press(page, confirm);
    await press(page, 2);
    await expect(drafts(page)).toHaveCount(3);
    await expect(drafts(page).first().getByRole('button')).toHaveAccessibleName(/灰の砲術師/);
    for (let i = 0; i < 10; i++) await press(page, back);
    await expect(drafts(page)).toHaveCount(3);
    await press(page, 7);
    await press(page, 7);
    await expect(confirmed(page)).toHaveCount(3);
    await press(page, 6);
    await press(page, 6);
    await expect(live(page)).toHaveCount(0);
    await sideStick(page, -1);
    await stick(page, -1, 0); // Hold Rine as the support recipient before adding medicine.
    await press(page, 8); // Auxiliary navigation; the command controls remain visible.
    await stick(page, 0, 1);
    await stick(page, 0, 1); // Highlight potion.
    await press(page, 7); // No draft, so the highlighted potion is not added.
    await expect(live(page)).toHaveCount(0);
    await press(page, confirm);
    await expect(drafts(page)).toContainText('救急薬');
    await expect(drafts(page).getByRole('button', { name: /リネ/ })).toHaveCount(1);
    await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
    await press(page, 13); // Direct weapon swap keeps the existing support target and panel.
    await expect(drafts(page)).toHaveCount(1);
    await expect(page.locator('[data-skill-id=ward]')).toBeVisible();
    await press(page, 8); // Auxiliary -> reservations.
    await press(page, 8); // Reservations -> target navigation, without using Back.
    await press(page, confirm);
    await expect(drafts(page).last()).toContainText('護りの誓い');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expectFullSizeFieldAndReachableLog(page);
    await page.screenshot({
      path: test.info().outputPath(`sequence-palette-${label}.png`),
      fullPage: true,
    });
    await press(page, 9);
    await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toBeVisible();
    await press(page, back);
    await expect(page.getByRole('dialog', { name: '休憩ポーズ' })).toHaveCount(0);
  });
}

test('digital navigation completes auxiliary and queue operations without analog axes, chords or Back', async ({
  page,
}) => {
  await virtualPad(page, 'Xbox Wireless Controller');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await page.getByLabel('パッドの選択方式', { exact: true }).selectOption('dpad');
  await page.getByRole('button', { name: '設定を閉じる ×', exact: true }).click();
  await page.clock.runFor(32);
  const state = createState({ atbRate: 0.2 });
  command(state, { type: 'start' });
  state.allies.forEach((ally) => {
    ally.atb = 0;
    ally.executionHeld = ally.id !== 0;
  });
  state.enemies.forEach((enemy) => {
    enemy.nextAttack = 999;
  });
  await loadSnapshot(page, state);
  const destination = (name: string) => page.getByRole('button', { name, exact: true });
  await press(page, 15); // D-pad chooses an enemy without adding a command.
  await expect(drafts(page)).toHaveCount(0);
  await press(page, 0);
  await expect(drafts(page).getByRole('button', { name: /灰の砲術師/ })).toHaveCount(1);
  await press(page, 0); // A second draft makes the group wait for its full ATB cost.
  await press(page, 8); // Target -> auxiliary.
  await expect(destination('補助を選ぶ')).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 4; i++) await press(page, 13);
  await expect(drafts(page)).toHaveCount(2);
  await press(page, 0);
  await expect(page.locator('.field-time-symbol')).toHaveAttribute('title', 'スロー ×0.25');
  await expect(destination('補助を選ぶ')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-skill-id=slash]')).toBeVisible();
  await press(page, 7); // Execute while auxiliary stays selected.
  await expect(confirmed(page)).toHaveCount(2);
  await expect(destination('補助を選ぶ')).toHaveAttribute('aria-pressed', 'true');
  await press(page, 8); // Auxiliary -> reservations.
  await expect(destination('予約を選ぶ')).toHaveAttribute('aria-pressed', 'true');
  await press(page, 0); // Explicitly cancel the highlighted reservation.
  await expect(live(page)).toHaveCount(1);
  await press(page, 0); // The receipt cannot cancel another row or add a skill.
  await expect(live(page)).toHaveCount(1);
  await press(page, 13); // Deliberately select the next reservation.
  await press(page, 0);
  await expect(live(page)).toHaveCount(0);
  await press(page, 8); // Reservations -> target; the auxiliary panel remains present.
  await expect(destination('対象を選ぶ')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
  await press(page, 0);
  await expect(drafts(page)).toHaveCount(1);
  await expect(drafts(page).getByRole('button')).toHaveAccessibleName(/斬撃、灰の砲術師/);
  await press(page, 8);
  await expect(destination('補助を選ぶ')).toHaveAttribute('aria-pressed', 'true');
  await press(page, 15); // Directly move through the flat auxiliary tabs.
  await press(page, 15);
  await press(page, 15);
  await expect(page.locator('.pad-auxiliary')).toHaveAttribute('data-panel', 'log');
  await press(page, 2); // The primary skill remains available while reading the log.
  await expect(drafts(page)).toHaveCount(2);
  await expect(page.locator('.pad-auxiliary')).toHaveAttribute('data-panel', 'log');
  for (let i = 0; i < 3; i++) await press(page, 14);
  await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
  for (let i = 0; i < 6; i++) await press(page, 13); // Auxiliary tabs start at the first item; choose ally targeting.
  await press(page, 0);
  await expect(page.locator('[data-unit=a0]')).toHaveAttribute('data-editing', 'true');
  await expect(drafts(page)).toHaveCount(2);
  await page.reload();
  await virtualPad(page, 'Xbox Wireless Controller');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await expect(page.getByLabel('パッドの選択方式', { exact: true })).toHaveValue('dpad');
});

test('v4 custom physical slots and axes migrate to the palette and remain editable', async ({
  page,
}) => {
  await page.evaluate(() => {
    localStorage.removeItem('orchestra-gamepad-v7');
    localStorage.removeItem('orchestra-gamepad-v6');
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
  await press(page, 20);
  await expect(drafts(page)).toHaveCount(2);
  await press(page, 7);
  await expect(confirmed(page)).toHaveCount(2);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('orchestra-gamepad-v7')!),
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
    sideAxis: -1,
    invertX: true,
    rowBack: 14,
    rowFront: 15,
    weapon: 13,
    slow: 11,
    queue: -1,
  });
  expect(saved.custom['Custom USB']).not.toHaveProperty('stop');
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
    JSON.parse(localStorage.getItem('orchestra-gamepad-v7')!),
  );
  expect(retained.custom['Custom USB']).toMatchObject({ execute: 7, up: -1, confirm: 21 });
});

for (const [id, label, confirm] of [
  ['Xbox Wireless Controller', 'Xbox', 0],
  ['DualSense Wireless Controller (054c)', 'PS', 0],
  ['Nintendo Switch Pro Controller (057e)', 'Switch', 1],
] as const) {
  test(`${label}: right stick switches sides and left stick follows the visible positions`, async ({
    page,
  }) => {
    await page.setViewportSize(
      label === 'Switch' ? { width: 390, height: 844 } : { width: 1366, height: 752 },
    );
    await virtualPad(page, id);
    await page.getByRole('button', { name: '交差砲火', exact: true }).click();
    await start(page);
    const selected = (name: string) =>
      page
        .getByRole('button', { name: new RegExp(`^${name}を(攻撃|支援)対象にする`) })
        .filter({ has: page.locator('.target-edit-corners') });
    const sideStick = async (x: number) => {
      await page.evaluate((x) => ((window as any).testPad.axes = [0, 0, x, 0]), x);
      await page.clock.runFor(64);
      await page.evaluate(() => ((window as any).testPad.axes = [0, 0, 0, 0]));
      await page.clock.runFor(32);
    };
    await stick(page, 1, 0);
    await expect(selected('後列狙いの砲手')).toBeVisible();
    const upper = await selected('後列狙いの砲手').boundingBox();
    await stick(page, 0, 1);
    await expect(selected('前列狙いの砲手')).toBeVisible();
    const lower = await selected('前列狙いの砲手').boundingBox();
    expect(lower!.y).toBeGreaterThan(upper!.y);
    expect(lower!.x).toBeCloseTo(upper!.x, 0);
    await stick(page, 0, 1); // Bottom edge stays on the same target.
    await expect(selected('前列狙いの砲手')).toBeVisible();
    await sideStick(-1);
    await expect(selected('アルト')).toBeVisible();
    await stick(page, -1, 0);
    await expect(selected('リネ')).toBeVisible();
    await stick(page, 0, 1);
    await expect(selected('セナ')).toBeVisible();
    await sideStick(1);
    await expect(selected('前列狙いの砲手')).toBeVisible();
    await stick(page, -1, 0);
    await expect(selected('砲列の衛兵')).toBeVisible();
    await sideStick(-1);
    await expect(selected('セナ')).toBeVisible();
    // A same-poll context change consumes the skill edge and requires a fresh press.
    await page.evaluate((confirm) => {
      (window as any).testPad.axes = [1, 0, 1, 0];
      (window as any).testPad.buttons[confirm] = { pressed: true, value: 1 };
    }, confirm);
    await page.clock.runFor(100);
    await expect(drafts(page)).toHaveCount(0);
    await expect(page.locator('.pad-feedback')).toContainText('もう一度');
    await expect(selected('後列狙いの砲手')).toBeVisible();
    await page.evaluate(() => ((window as any).testPad.axes = [0, 0, 0, 0]));
    await release(page);
    await press(page, confirm);
    await expect(drafts(page).getByRole('button')).toHaveAccessibleName(/後列狙いの砲手/);
    await press(page, 8);
    await sideStick(-1);
    await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
    await page
      .getByRole('group', { name: '補助メニュー', exact: true })
      .getByRole('button', { name: /味方を対象にする/ })
      .click();
    await expect(selected('セナ')).toBeVisible();
    await expect(drafts(page)).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`spatial-${label}.png`), fullPage: true });
  });
}

test('v5 settings add a configurable right stick and preserve its inversion after reload', async ({
  page,
}) => {
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('orchestra-gamepad-v7')!);
    stored.custom['Xbox Wireless Controller'] = {
      confirm: 0,
      back: 1,
      skill: 2,
      guard: 3,
      execute: 7,
      cutQueue: 6,
      previous: 4,
      next: 5,
      slow: 14,
      stop: 15,
      pause: 9,
      menu: 8,
      tactics: 12,
      aux: 13,
      up: -1,
      down: -1,
      left: -1,
      right: -1,
      queue: 11,
      mark: 10,
      navigation: 'stick',
      axisX: 0,
      axisY: 1,
      invertX: false,
      invertY: false,
    };
    localStorage.setItem('orchestra-gamepad-v5', JSON.stringify(stored));
    localStorage.removeItem('orchestra-gamepad-v7');
    localStorage.removeItem('orchestra-gamepad-v6');
  });
  await page.reload();
  await virtualPad(page, 'Xbox Wireless Controller');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await expect(page.getByLabel('敵味方切替の軸', { exact: true })).toHaveValue('2');
  await page.getByLabel('敵味方切替の軸', { exact: true }).selectOption('0');
  await expect(page.getByRole('dialog', { name: 'ゲームパッド設定' })).toContainText(
    '別に割り当て',
  );
  await expect(page.getByLabel('敵味方切替の軸', { exact: true })).toHaveValue('2');
  await page.getByLabel('敵味方切替の左右を反転', { exact: true }).check();
  await page.getByRole('button', { name: '設定を閉じる ×', exact: true }).click();
  await page.reload();
  await virtualPad(page, 'Xbox Wireless Controller');
  await start(page);
  await page.evaluate(() => ((window as any).testPad.axes = [0, 0, 1, 0]));
  await page.clock.runFor(64);
  await expect(page.locator('[data-unit=a0]')).toHaveAttribute('data-editing', 'true');
});

for (const [width, height] of [
  [1366, 752],
  [1440, 900],
  [390, 844],
])
  test(`full-size battlefield, four drafts and auxiliary menu remain reachable at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    for (let i = 0; i < 4; i++) await page.keyboard.press('c');
    await expect(drafts(page)).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`palette-${width}.png`), fullPage: true });
    await expectFullSizeFieldAndReachableLog(page);
    await page.keyboard.press('i');
    await expect(page.getByRole('group', { name: '補助メニュー', exact: true })).toBeVisible();
    await page
      .getByRole('group', { name: '補助メニュー', exact: true })
      .getByRole('button', { name: /戦闘ログ.*記録/ })
      .click();
    await expect(page.getByRole('log', { name: 'パッドの戦闘ログ' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

test('D-pad movement, weapon and Optima issue direct commands while R3 only toggles slow', async ({
  page,
}) => {
  await virtualPad(page, 'Xbox Wireless Controller');
  await start(page);
  await press(page, 14);
  await expect(drafts(page)).toHaveCount(0);
  await expect(page.locator('[data-unit=a0]')).toContainText('移動');
  await page.clock.runFor(950);
  await expect(
    page.getByRole('region', { name: '味方後列', exact: true }).locator('[data-unit=a0]'),
  ).toBeVisible();
  await press(page, 15);
  await page.clock.runFor(950);
  await expect(
    page.getByRole('region', { name: '味方前列', exact: true }).locator('[data-unit=a0]'),
  ).toBeVisible();
  await expect(drafts(page)).toHaveCount(0);
  await down(page, 11);
  await page.clock.runFor(650);
  await expect(page.locator('.field-time-symbol')).toHaveAttribute('title', 'スロー ×0.25');
  await release(page);
  await expect(page.locator('.field-time-symbol')).toHaveAttribute('title', 'スロー ×0.25');
  await press(page, 11);
  await expect(page.locator('.field-time-symbol')).toHaveAttribute('title', '通常 ×1.00');
  await expect(page.getByRole('button', { name: /戦術停止/ })).toHaveCount(0);
  await press(page, 13);
  await expect(page.locator('[data-skill-id=ward]')).toBeVisible();
  await expect(drafts(page)).toHaveCount(0);
  await press(page, 12);
  await expect(page.locator('.pad-page-heading h2')).toHaveText('コマンド');
  await expect(page.locator('.pad-feedback')).toContainText('崩しの連奏');
  await expect(page.locator('[data-skill-id=slash]')).toBeVisible();
  await expect(drafts(page)).toHaveCount(0);
});

test('support uses the marked ally while editing the enemy and keeps existing draft recipients', async ({
  page,
}) => {
  await virtualPad(page, 'Xbox Wireless Controller');
  await start(page);
  await page.locator('[data-unit=a1]').click();
  await sideStick(page, 1);
  await press(page, 13);
  await expect(page.locator('[data-unit=e0]')).toHaveAttribute('data-editing', 'true');
  await expect(page.locator('[data-unit=a1]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-skill-id=ward]')).toHaveAccessibleName(/リネ/);
  await press(page, 0);
  await expect(drafts(page)).toHaveCount(1);
  await expect(drafts(page).first().getByRole('button')).toHaveAccessibleName(/護りの誓い、リネ/);
  await expect(page.locator('[data-unit=e0]')).toHaveAttribute('data-editing', 'true');
  await page.locator('[data-unit=a2]').click();
  await expect(drafts(page).first().getByRole('button')).toHaveAccessibleName(/護りの誓い、リネ/);
  await expect(page.locator('[data-skill-id=ward]')).toHaveAccessibleName(/セナ/);
  await press(page, 3);
  await expect(drafts(page).last().getByRole('button')).toHaveAccessibleName(/防御、アルト/);
});

test('a fallen marked ally switches automatically and the next skill press adds exactly once', async ({
  page,
}) => {
  const s = createState();
  command(s, { type: 'start' });
  s.allies[0].slot = 1;
  s.allies[1].hp = 1;
  s.enemies[0].cast = {
    name: '追尾攻撃',
    target: 'single',
    row: 'back',
    allyId: 1,
    remaining: 0.4,
    total: 0.4,
    power: 100,
    movable: false,
    push: false,
  };
  s.enemies.forEach((e) => (e.nextAttack = 10));
  await loadSnapshot(page, s);
  await virtualPad(page, 'Xbox Wireless Controller');
  await page.locator('[data-unit=a1]').click();
  await sideStick(page, 1);
  await page.clock.runFor(450);
  await expect(page.locator('[data-unit=a1]')).toBeDisabled();
  await expect(page.locator('[data-unit=a1]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-unit=a0]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-unit=e0]')).toHaveAttribute('data-editing', 'true');
  await expect(page.locator('[data-skill-id=ward]')).toHaveAccessibleName(/アルト/);
  await down(page, 0);
  await page.clock.runFor(600);
  await expect(drafts(page)).toHaveCount(1);
  await release(page);
  await expect(drafts(page).getByRole('button')).toHaveAccessibleName(/護りの誓い、アルト/);
  await expect(page.locator('[data-unit=a0]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-unit=a0]')).not.toHaveAttribute('data-candidate');
});

test('a weapon and skill pressed together change context without adding until the button is released', async ({
  page,
}) => {
  await virtualPad(page, 'Xbox Wireless Controller');
  await start(page);
  await page.evaluate(() => {
    for (const index of [13, 0])
      (window as any).testPad.buttons[index] = { pressed: true, value: 1 };
  });
  await page.clock.runFor(500);
  await expect(page.locator('[data-skill-id=ward]')).toBeVisible();
  await expect(drafts(page)).toHaveCount(0);
  await expect(page.locator('.pad-feedback')).toContainText('もう一度');
  await release(page);
  await press(page, 0);
  await expect(drafts(page)).toHaveCount(1);
  await expect(drafts(page).getByRole('button')).toHaveAccessibleName(/護りの誓い、アルト/);
});

test('same-poll side and navigation select the new side, while side-only plus skill retains that editing side', async ({
  page,
}) => {
  await virtualPad(page, 'Xbox Wireless Controller');
  await start(page);
  await page.evaluate(() => ((window as any).testPad.axes = [-1, 0, -1, 0]));
  await page.clock.runFor(32);
  await expect(page.locator('[data-unit=a1]')).toHaveAttribute('data-editing', 'true');
  await expect(page.locator('[data-unit=a1]')).toHaveAttribute('aria-pressed', 'true');
  await expect(drafts(page)).toHaveCount(0);
  await page.evaluate(() => ((window as any).testPad.axes = [0, 0, 0, 0]));
  await release(page);
  await press(page, 13);
  await page.evaluate(() => {
    (window as any).testPad.axes = [0, 0, 1, 0];
    (window as any).testPad.buttons[0] = { pressed: true, value: 1 };
  });
  await page.clock.runFor(32);
  await expect(page.locator('[data-unit=e0]')).toHaveAttribute('data-editing', 'true');
  await expect(drafts(page)).toHaveCount(1);
  await expect(drafts(page).getByRole('button')).toHaveAccessibleName(/護りの誓い、リネ/);
});

test('digital navigation can move through the auxiliary menu while the draft is full', async ({
  page,
}) => {
  await virtualPad(page, 'Xbox Wireless Controller');
  await page.getByRole('button', { name: 'ゲームパッド設定', exact: true }).click();
  await page.getByLabel('パッドの選択方式', { exact: true }).selectOption('dpad');
  await page.getByRole('button', { name: '設定を閉じる ×', exact: true }).click();
  await page.clock.runFor(32);
  await start(page);
  for (let i = 0; i < 4; i++) await press(page, 3);
  await expect(drafts(page)).toHaveCount(4);
  await press(page, 8);
  await press(page, 0);
  await expect(
    page
      .getByRole('group', { name: '列を移動', exact: true })
      .getByRole('button', { name: /後列へ移動/ }),
  ).toBeEnabled();
  await press(page, 0);
  await expect(drafts(page)).toHaveCount(4);
  await page.clock.runFor(950);
  await expect(
    page.getByRole('region', { name: '味方後列', exact: true }).locator('[data-unit=a0]'),
  ).toBeVisible();
  await expect(drafts(page)).toHaveCount(4);
});
