import { expect, it } from 'vitest';
import { SKILLS, WEAPONS } from '../src/content/data';
it('describes evacuation from its current timing, including when a comparison changes it', () => {
  const original = SKILLS.evacuate.cast;
  expect(WEAPONS.banner.trait).toContain('発動0.45秒');
  expect(WEAPONS.banner.trait).toContain('硬直1.15秒');
  try {
    SKILLS.evacuate.cast = 0.75;
    expect(WEAPONS.banner.trait).toContain('発動0.75秒');
    expect(WEAPONS.banner.trait).not.toContain('0.2秒');
  } finally {
    SKILLS.evacuate.cast = original;
  }
  expect(WEAPONS.sword.trait).toContain('全職共通');
  expect(WEAPONS.staff.trait).toContain('全職共通');
});
