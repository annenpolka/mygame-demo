import { test, expect, type Page } from '@playwright/test';
import { createState, command } from '../../src/sim/engine';
import { makeAction } from '../../src/sim/execution';
import type { State } from '../../src/sim/types';

function fixture() {
  const s = createState({ encounterSet: 'crossfire' });
  command(s, { type: 'start' });
  s.allies[0].hp = 700;
  s.allies[0].action = makeAction(s.allies[0], 'slash', { kind: 'enemy', id: 0 });
  s.allies[1].action = makeAction(s.allies[1], 'spark', { kind: 'enemy', id: 2 });
  s.allies[2].action = makeAction(s.allies[2], 'heal', { kind: 'ally', id: 0 });
  s.allies.forEach((a) => {
    a.action!.remaining = a.action!.recovery + 0.22;
    a.atb = 0;
  });
  s.allies[2].shield = 3;
  s.enemies[0].chain = 199;
  s.enemies[0].hold = 3;
  s.enemies[1].cast = {
    name: '後列への砲撃',
    target: 'row',
    row: 'back',
    allyId: 0,
    remaining: 0.22,
    total: 2.4,
    power: 200,
    movable: true,
    push: false,
  };
  s.enemies.forEach((e) => (e.nextAttack = 10));
  return s;
}
async function load(page: Page, s: State) {
  await page.getByRole('button', { name: '⚙ 実験室', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'effects.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ kind: 'snapshot', version: s.version, state: s })),
  });
  await expect(page.getByRole('complementary', { name: '実験室', exact: true })).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
});
test('preparation points to real targets; simultaneous break, heal, cannon hit and shielding remain readable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, fixture());
  await expect(page.locator('.fx-intent[data-source=a0] [data-aim-target=e0]')).toHaveCount(1);
  await expect(page.locator('[data-zone=ally-back]')).toHaveCount(1);
  await expect(page.locator('[data-unit=a2] .unit-incoming')).toContainText('範囲攻撃');
  await expect(page.locator('.fx-cue')).toHaveCount(0);
  await page.locator('.battlefield').screenshot({ path: 'test-results/effects-windup.png' });
  await page.clock.runFor(340);
  await expect(page.locator('.fx-cue[data-effect=break]')).toHaveCount(1);
  await expect(page.locator('.fx-cue[data-effect=heal][data-target=a0]')).toHaveAttribute(
    'data-value',
    '190',
  );
  await expect(page.locator('.fx-cue[data-effect=blast][data-target=a2] .fx-mitigated')).toHaveText(
    '軽減',
  );
  await expect(page.locator('[data-zone=ally-back]')).toHaveCount(0);
  expect(
    Number(await page.locator('.battle-particles').getAttribute('data-particles')),
  ).toBeGreaterThan(80);
  await page.locator('.battlefield').screenshot({ path: 'test-results/effects-impact.png' });
  // The feedback baseline is below every meter; labels do not lie over HP/telegraph bars.
  const unobscured = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.fx-number')).every((n) => {
      const target = n.closest('[data-target]')?.getAttribute('data-target');
      const card = document.querySelector(`[data-unit="${target}"]`);
      if (!card) return false;
      return Array.from(card.querySelectorAll('[role=meter]')).every(
        (m) => m.getBoundingClientRect().bottom < n.getBoundingClientRect().top,
      );
    }),
  );
  expect(unobscured).toBe(true);
  await page.keyboard.press('p');
  const before = await page.locator('.fx-foreground').innerHTML();
  const pixels = await page
    .locator('canvas.battle-particles')
    .evaluate((el: HTMLCanvasElement) => el.toDataURL());
  await page.clock.runFor(300);
  expect(await page.locator('.fx-foreground').innerHTML()).toBe(before);
  expect(
    await page
      .locator('canvas.battle-particles')
      .evaluate((el: HTMLCanvasElement) => el.toDataURL()),
  ).toBe(pixels);
  expect(errors).toEqual([]);
});
test('mobile field stays within width and reduced motion retains readable outcomes without particles or recoil', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await load(page, fixture());
  await page.clock.runFor(340);
  await expect(page.locator('[data-effects]')).toHaveAttribute('data-effects', 'reduced');
  await expect(page.locator('.battle-particles')).toHaveAttribute('data-particles', '0');
  await expect(page.locator('.emblem-body').first()).toHaveCSS('transform', 'none');
  await expect(page.locator('.fx-cue[data-effect=heal]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.battlefield')
    .screenshot({ path: 'test-results/effects-mobile-reduced.png' });
});
test('an empty targeted row produces miss feedback without invented hit particles', async ({
  page,
}) => {
  const s = createState();
  command(s, { type: 'start' });
  s.allies.forEach((a) => {
    a.row = 'back';
    a.executionHeld = true;
  });
  s.enemies[0].cast = {
    name: '前列薙ぎ払い',
    target: 'row',
    row: 'front',
    allyId: 0,
    remaining: 0.1,
    total: 2,
    power: 200,
    movable: true,
    push: false,
  };
  s.enemies[1].nextAttack = 10;
  await load(page, s);
  await page.clock.runFor(200);
  await expect(page.locator('.fx-cue[data-effect=miss]')).toContainText('空振り');
  await expect(page.locator('.fx-cue[data-value]')).toHaveCount(0);
  await expect(page.locator('.battle-particles')).toHaveAttribute('data-particles', '0');
});

test('a short desktop keeps every actor and HP gauge inside the battlefield with two or three occupied tracks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 752 });
  const s = fixture();
  for (const packed of [false, true]) {
    if (packed) {
      s.allies.forEach((a) => (a.row = 'front'));
      s.enemies.forEach((e) => (e.row = 'front'));
    }
    await load(page, s);
    const inside = await page.evaluate(() => {
      const field = document.querySelector('.horizontal-field')!.getBoundingClientRect();
      return Array.from(document.querySelectorAll('[data-unit]')).every((el) => {
        const card = el.getBoundingClientRect();
        return (
          card.bottom <= field.bottom + 1 &&
          Array.from(el.querySelectorAll('[role=meter]')).every((g) => {
            const r = g.getBoundingClientRect();
            return r.top >= card.top && r.bottom <= card.bottom;
          })
        );
      });
    });
    expect(inside).toBe(true);
    await page
      .locator('.battlefield')
      .screenshot({ path: `test-results/effects-short-${packed ? 'three' : 'two'}.png` });
  }
});
