import { describe, expect, it } from 'vitest';
import {
  FRAME_MS,
  LANES,
  flashAlpha,
  frameDue,
  glyphX,
  laneOf,
  ringState,
  stutterPx,
} from './queue-lanes-model.ts';

describe('queue lanes', () => {
  it('maps each worker to its own lane', () => {
    expect(LANES).toBe(3);
    expect([laneOf('w1'), laneOf('w2'), laneOf('w3')]).toEqual([0, 1, 2]);
  });

  it('moves glyphs left to right and wraps them', () => {
    const width = 1000;
    const a = glyphX(0, 0, width);
    const b = glyphX(0, 1000, width);
    expect(b).toBeGreaterThan(a);
    for (let t = 0; t < 120_000; t += 777) {
      const x = glyphX(3, t, width);
      expect(x).toBeGreaterThanOrEqual(-20);
      expect(x).toBeLessThan(width + 20);
    }
  });

  it('flashes a lost lane once: full at the kill, gone after the slow duration', () => {
    expect(flashAlpha(0)).toBe(1);
    expect(flashAlpha(240)).toBeGreaterThan(0);
    expect(flashAlpha(240)).toBeLessThan(1);
    expect(flashAlpha(480)).toBe(0);
    expect(flashAlpha(-1)).toBe(0);
  });

  it('stutters in a few discrete steps, then holds still', () => {
    const offsets = new Set([0, 40, 80, 120, 160].map(stutterPx));
    expect(offsets.size).toBeGreaterThan(1);
    expect(stutterPx(400)).toBe(0);
  });

  it('grows and fades a back-off ring', () => {
    const start = ringState(0);
    const mid = ringState(400);
    expect(mid.radius).toBeGreaterThan(start.radius);
    expect(mid.alpha).toBeLessThan(start.alpha);
    expect(ringState(2000).alpha).toBe(0);
  });

  it('draws at most 30 frames a second', () => {
    expect(FRAME_MS).toBeCloseTo(1000 / 30);
    expect(frameDue(0, 20)).toBe(false);
    expect(frameDue(0, 34)).toBe(true);
  });
});
