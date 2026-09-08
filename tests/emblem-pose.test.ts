import { describe, expect, it } from 'vitest';
import { emblemPose } from '../src/client/effects/emblem-pose';
import type { ActionCue, EffectCue, VisualEffect } from '../src/client/effects/events';

const action = (type: VisualEffect, progress: number, recovery = false): ActionCue => ({
  source: 'a0',
  targets: ['e0'],
  type,
  label: 'test',
  progress,
  remaining: 0.2,
  hostile: false,
  recovery,
  combo: 1,
});
const reaction = (type: VisualEffect = 'hit'): EffectCue => ({
  id: 1,
  type,
  target: 'a0',
  progress: 0.15,
  age: 0.15,
  value: 100,
  label: 'test',
  combo: 1,
  shielded: false,
  lane: 0,
});
const poseValues = [
  'x',
  'y',
  'tilt',
  'weaponAngle',
  'weaponX',
  'weaponY',
  'armAngle',
  'charge',
  'guard',
] as const;

describe('battle-clock emblem poses', () => {
  it('draws back before swinging and mirrors the attack direction for enemies', () => {
    for (const type of ['slash', 'impact', 'hit'] as const) {
      const preparing = emblemPose('a0', action(type, 0.4));
      const striking = emblemPose('a0', action(type, 0.9));
      const enemy = emblemPose('e0', action(type, 0.9));
      expect(preparing.phase).toBe('windup');
      expect(preparing.weaponAngle).toBeLessThan(0);
      expect(preparing.x).toBeLessThan(0);
      expect(striking.phase).toBe('strike');
      expect(striking.weaponAngle).toBeGreaterThan(0);
      expect(striking.x).toBeGreaterThan(0);
      expect(striking.strike).toBeGreaterThan(0);
      expect(enemy.x).toBe(-striking.x);
      expect(enemy.weaponAngle).toBe(-striking.weaponAngle);
    }
  });

  it('distinguishes upward spell focus from a lowered protective stance', () => {
    const spell = emblemPose('a0', action('magic', 0.8));
    const earlySpell = emblemPose('a0', action('magic', 0.2));
    const heal = emblemPose('a0', action('heal', 0.8));
    const shield = emblemPose('a0', action('shield', 0.8));
    expect(spell.phase).toBe('gather');
    expect(spell.charge).toBeGreaterThan(earlySpell.charge);
    expect(spell.focusScale).toBeLessThan(earlySpell.focusScale);
    expect(spell.y).toBeLessThan(0);
    expect(spell.weaponY).toBeLessThan(0);
    expect(heal.charge).toBe(spell.charge);
    expect(shield.phase).toBe('brace');
    expect(shield.y).toBeGreaterThan(0);
    expect(shield.guard).toBeGreaterThan(0);
    expect(shield.charge).toBe(0);
  });

  it('keeps the end of an action continuous with recovery and settles back to the resting pose', () => {
    for (const type of [
      'slash',
      'impact',
      'hit',
      'shot',
      'blast',
      'magic',
      'heal',
      'shield',
    ] as const) {
      const atImpact = emblemPose('a0', action(type, 1));
      const recovering = emblemPose('a0', action(type, 0, true));
      const settled = emblemPose('a0', action(type, 1, true));
      const idle = emblemPose('a0');
      for (const key of poseValues) {
        expect(recovering[key], `${type} ${key} at impact`).toBeCloseTo(atImpact[key], 10);
        expect(settled[key], `${type} ${key} after recovery`).toBeCloseTo(idle[key], 10);
      }
    }
  });

  it('preserves the existing 9px hit recoil even while an attack pose is active', () => {
    const cue = action('slash', 0.8);
    const plain = emblemPose('a0', cue);
    const hit = emblemPose('a0', cue, reaction());
    const enemyPlain = emblemPose('e0', cue);
    const enemyHit = emblemPose('e0', cue, reaction());
    expect(hit.x - plain.x).toBeCloseTo(-9);
    expect(enemyHit.x - enemyPlain.x).toBeCloseTo(9);
    expect(hit.tilt).toBeCloseTo(-9);
    expect(enemyHit.tilt).toBeCloseTo(9);
    expect(hit.phase).toBe('hit');
    expect(hit.flash).toBeCloseTo(0.4);
    expect(emblemPose('a0', cue, reaction('heal')).x).toBe(plain.x);
  });

  it('stops reacting after the existing recoil window without retaining a previous pose', () => {
    const hit = { ...reaction(), age: 0.31 };
    const pose = emblemPose('a0', undefined, hit);
    expect(pose.x).toBeCloseTo(0, 10);
    expect(pose.tilt).toBeCloseTo(0, 10);
    expect(pose.flash).toBe(0);
    expect(emblemPose('a0').phase).toBe('idle');
    for (const key of poseValues) expect(emblemPose('a0')[key]).toBe(0);
  });

  it('reproduces the same pose from the same snapshot without modifying its cues', () => {
    const cue = action('magic', 0.72);
    const hit = reaction();
    const originals = structuredClone({ cue, hit });
    const first = emblemPose('a0', cue, hit);
    emblemPose('e1', action('impact', 0.2), { ...hit, age: 0.03 });
    expect(emblemPose('a0', cue, hit)).toEqual(first);
    expect({ cue, hit }).toEqual(originals);
  });

  it('adds alternating footsteps during actual movement without replacing action or hit poses', () => {
    const cue = action('slash', 0.8);
    const hit = reaction();
    const standing = emblemPose('a0', cue, hit);
    const firstStep = emblemPose('a0', cue, hit, { phase: 'moving', progress: 0.125 });
    const nextStep = emblemPose('a0', cue, hit, { phase: 'moving', progress: 0.375 });
    expect(firstStep.leftLegY).toBeCloseTo(1.8);
    expect(firstStep.rightLegY).toBeCloseTo(-1.8);
    expect(nextStep.leftLegY).toBeCloseTo(-1.8);
    expect(nextStep.rightLegY).toBeCloseTo(1.8);
    expect(firstStep.y - standing.y).toBeCloseTo(-0.8);
    for (const key of [
      'x',
      'tilt',
      'weaponAngle',
      'weaponX',
      'weaponY',
      'armAngle',
      'flash',
    ] as const)
      expect(firstStep[key]).toBe(standing[key]);
    expect(firstStep.phase).toBe('hit');
    expect(emblemPose('a0', undefined, undefined, { phase: 'moving', progress: 0.125 }).phase).toBe(
      'walking',
    );
  });

  it('rests both feet at departure, arrival and throughout the landing cue', () => {
    for (const movement of [
      { phase: 'moving', progress: 0 },
      { phase: 'moving', progress: 1 },
      { phase: 'landing', progress: 0.125 },
    ] as const) {
      const pose = emblemPose('a0', undefined, undefined, movement);
      expect(pose.leftLegY).toBeCloseTo(0, 10);
      expect(pose.rightLegY).toBeCloseTo(0, 10);
      expect(pose.y).toBeCloseTo(0, 10);
    }
  });

  it('bounds every pose across the full cast, recovery and reaction intervals', () => {
    for (const type of [
      'slash',
      'impact',
      'hit',
      'shot',
      'blast',
      'magic',
      'heal',
      'shield',
      'move',
    ] as const)
      for (const recovery of [false, true])
        for (let i = 0; i <= 100; i++) {
          const pose = emblemPose('a0', action(type, i / 100, recovery), {
            ...reaction(),
            age: i / 100,
          });
          for (const key of poseValues) expect(Number.isFinite(pose[key])).toBe(true);
          expect(Math.abs(pose.x)).toBeLessThanOrEqual(14);
          expect(Math.abs(pose.y)).toBeLessThanOrEqual(4);
          expect(Math.abs(pose.weaponAngle)).toBeLessThanOrEqual(56);
          for (const key of ['charge', 'guard', 'strike', 'flash'] as const) {
            expect(pose[key]).toBeGreaterThanOrEqual(0);
            expect(pose[key]).toBeLessThanOrEqual(1);
          }
        }
  });
});
