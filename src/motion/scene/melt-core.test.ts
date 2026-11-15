import { describe, expect, test } from 'vitest';
import { MELT } from '../config.ts';
import {
  dropRadius,
  dropRate,
  heatTarget,
  lowestPick,
  meltAllowed,
  nearness,
  parseCssRgb,
  planAtlas,
  stepDrop,
  stepHeat,
  type MeltGate,
} from './melt-core.ts';

const gate: MeltGate = {
  letters: 5,
  settled: true,
  slow: false,
  phone: false,
  dust: 0,
  motion: true,
  paused: false,
  noHide: false,
};

describe('parseCssRgb', () => {
  test('hex and rgb forms', () => {
    expect(parseCssRgb('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseCssRgb(' #102030 ')).toEqual([16, 32, 48]);
    expect(parseCssRgb('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseCssRgb('rgba(4 5 6 / 0.5)')).toEqual([4, 5, 6]);
  });
  test('anything else is paper', () => {
    for (const bad of ['', 'tomato', '#12', 'oklch(0.9 0.02 100)'])
      expect(parseCssRgb(bad)).toEqual([245, 246, 240]);
  });
});

describe('meltAllowed', () => {
  test('all clear allows', () => expect(meltAllowed(gate)).toBe(true));
  test.each([
    ['letters', { letters: 0 }],
    ['settled', { settled: false }],
    ['slow', { slow: true }],
    ['phone', { phone: true }],
    ['dust', { dust: 0.0005 }],
    ['motion', { motion: false }],
    ['paused', { paused: true }],
    ['noHide', { noHide: true }],
  ])('%s blocks', (_, over) => expect(meltAllowed({ ...gate, ...over })).toBe(false));
  test('tiny dust still allows', () => expect(meltAllowed({ ...gate, dust: 0.0004 })).toBe(true));
});

describe('nearness and heat', () => {
  const box = [100, 100, 200, 200] as const;
  test('inside the box is 1, at the radius is 0, halfway is 0.5', () => {
    expect(nearness(box, 150, 150)).toBe(1);
    expect(nearness(box, 200 + MELT.radius, 150)).toBe(0);
    expect(nearness(box, 200 + MELT.radius / 2, 150)).toBeCloseTo(0.5, 6);
    expect(nearness(box, 150, 100 - MELT.radius / 2)).toBeCloseTo(0.5, 6);
    expect(nearness(box, 5000, 5000)).toBe(0);
  });
  test('uses the corner distance, not one axis', () => {
    const d = MELT.radius / 2;
    const expected = 1 - Math.hypot(d, d) / MELT.radius;
    expect(nearness(box, 200 + d, 200 + d)).toBeCloseTo(expected, 6);
  });
  test('heatTarget is 0 away and 0.35..1 near', () => {
    expect(heatTarget(0)).toBe(0);
    expect(heatTarget(1)).toBeCloseTo(1, 9);
    expect(heatTarget(0.01)).toBeCloseTo(0.3565, 6);
  });
  test('stepHeat rises with rise, falls with fall, snaps to 0', () => {
    expect(stepHeat(0, 1, 0.1)).toBeCloseTo(1 - Math.exp(-0.1 * MELT.rise), 9);
    expect(stepHeat(1, 0.5, 0.1)).toBeCloseTo(0.5 + 0.5 * Math.exp(-0.1 * MELT.fall), 9);
    expect(stepHeat(MELT.off * 0.9, 0, 0.001)).toBe(0);
    expect(stepHeat(0.5, 0, 0.001)).toBeGreaterThan(0.49);
    // a nonzero target never snaps, even at tiny heat
    expect(stepHeat(0, 0.35, 0.0001)).toBeGreaterThan(0);
  });
  test('stepHeat converges: a long wall step reaches the target', () => {
    expect(stepHeat(0, 0.8, 0.5)).toBeGreaterThan(0.8 * 0.85);
    expect(stepHeat(0.8, 0, 2)).toBe(0);
  });
});

describe('dropRate', () => {
  test('scales with heat squared and pointer speed, speed caps at 500 px/s', () => {
    expect(dropRate(0, 1000)).toBe(0);
    expect(dropRate(1, 0)).toBeCloseTo(MELT.dropRate * 0.4, 9);
    expect(dropRate(1, 500)).toBeCloseTo(MELT.dropRate * 1.4, 9);
    expect(dropRate(1, 250)).toBeCloseTo(MELT.dropRate * 0.9, 9);
    expect(dropRate(1, 5000)).toBeCloseTo(MELT.dropRate * 1.4, 9);
    expect(dropRate(0.5, 0)).toBeCloseTo(MELT.dropRate * 0.25 * 0.4, 9);
  });
});

describe('droplets', () => {
  test('falls under gravity and fades near the end of its life', () => {
    const d = stepDrop({ y: 10, v: 20, life: 1, alpha: 1 }, 0.1, 200);
    expect(d.v).toBeCloseTo(20 + MELT.dropGravity * 0.1, 9);
    expect(d.y).toBeCloseTo(10 + d.v * 0.1, 9);
    expect(d.life).toBeCloseTo(0.9, 9);
    expect(d.alpha).toBe(1);
    const f = stepDrop({ y: 10, v: 0, life: 0.5, alpha: 1 }, 0.1, 200);
    expect(f.alpha).toBeCloseTo(0.4 * 2.2, 9);
  });
  test('dies when life runs out or it passes the cell bottom', () => {
    expect(stepDrop({ y: 10, v: 0, life: 0.05, alpha: 1 }, 0.1, 200).alpha).toBe(0);
    expect(stepDrop({ y: 197, v: 100, life: 5, alpha: 1 }, 0.1, 200).alpha).toBe(0);
    // lands 2 px above the bottom edge: dead (the 4 px margin), but 6 px above stays alive
    expect(stepDrop({ y: 196, v: 0, life: 5, alpha: 1 }, 0.001, 200).alpha).toBe(0);
    expect(stepDrop({ y: 190, v: 0, life: 5, alpha: 1 }, 0.001, 200).alpha).toBe(1);
    expect(stepDrop({ y: 100, v: 0, life: 5, alpha: 1 }, 0.1, 200).alpha).toBe(1);
  });
  test('radius shrinks to 60% with alpha, floor 1 px', () => {
    expect(dropRadius(10, 1)).toBe(10);
    expect(dropRadius(10, 0)).toBe(6);
    expect(dropRadius(1, 0)).toBe(1);
  });
  test('lowestPick prefers the largest y of three picks, ties to the first', () => {
    const px: [number, number][] = [
      [0, 1],
      [1, 5],
      [2, 3],
    ];
    const seq = (...v: number[]) => {
      let i = 0;
      return () => v[i++]!;
    };
    expect(lowestPick(px, seq(0, 0.4, 0.9))).toEqual([1, 5]);
    expect(lowestPick(px, seq(0.4, 0, 0.9))).toEqual([1, 5]);
    expect(lowestPick(px, seq(0, 0, 0))).toEqual([0, 1]);
    const tie: [number, number][] = [
      [0, 2],
      [9, 2],
    ];
    expect(lowestPick(tie, seq(0, 0.9, 0.9))).toEqual([0, 2]);
    expect(lowestPick([])).toBeUndefined();
  });
});

describe('planAtlas', () => {
  test('a normal hero fits at the dpr scale, capped at maxScale', () => {
    const p = planAtlas(5, 80, 90, 3)!;
    expect(p.scale).toBe(MELT.maxScale);
    expect(p.cols).toBe(5);
    expect(p.cellW).toBe(Math.ceil(80 * 2) + 2);
    expect(p.cellH).toBe(Math.ceil(90 * 2) + 2);
    expect(p.width).toBe(5 * p.cellW);
    expect(p.height).toBe(p.cellH);
    expect(planAtlas(5, 80, 90, 1)!.scale).toBe(1);
  });
  test('at most 6 columns, extra letters wrap to rows', () => {
    const p = planAtlas(13, 40, 40, 1)!;
    expect(p.cols).toBe(6);
    expect(p.height).toBe(3 * p.cellH);
  });
  test('an oversize cell shrinks the scale by 15% steps until it fits', () => {
    const p = planAtlas(1, 3000, 3000, 2)!;
    expect(p.scale).toBeLessThan(2);
    expect(p.scale).toBeCloseTo(2 * 0.85 ** Math.round(Math.log(p.scale / 2) / Math.log(0.85)), 9);
    expect(p.width).toBeLessThanOrEqual(MELT.maxAtlas);
    expect(p.height).toBeLessThanOrEqual(MELT.maxAtlas);
  });
  test('returns null when it would need a scale under 0.4', () => {
    expect(planAtlas(1, 20000, 20000, 2)).toBeNull();
  });
});
