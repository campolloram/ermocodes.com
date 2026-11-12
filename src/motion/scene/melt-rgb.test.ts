import { describe, expect, test } from 'vitest';
import { rgb } from './melt';

describe('melt rgb()', () => {
  test('reads #rgb, #rrggbb and rgb()/rgba()', () => {
    expect(rgb('#fff').toArray()).toEqual([1, 1, 1]);
    expect(rgb('#ff0000').x).toBe(1);
    expect(rgb('rgb(255, 0, 51)').z).toBeCloseTo(0.2, 5);
    expect(rgb('rgba(0 255 0 / 0.5)').y).toBe(1);
  });
  test('falls back to paper for anything else, never NaN', () => {
    for (const bad of ['', 'oklch(0.9 0.02 100)', 'tomato', 'rgb(1)']) {
      const v = rgb(bad);
      expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
      expect(v.x).toBeCloseTo(245 / 255, 5);
    }
  });
});
