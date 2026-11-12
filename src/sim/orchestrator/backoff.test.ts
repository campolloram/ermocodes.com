import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { backoffBand, backoffCeiling, backoffDelay } from './backoff';
import type { BackoffConfig } from './types';

const cfg: BackoffConfig = { baseMs: 400, factor: 2, maxMs: 8000, jitter: 'none' };

describe('backoff', () => {
  it('grows exponentially from baseMs and caps at maxMs', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6].map((r) => backoffDelay(cfg, r, 0.5));
    expect(delays).toEqual([400, 800, 1600, 3200, 6400, 8000, 8000]);
  });

  it('treats a negative retry index as the first retry', () => {
    expect(backoffCeiling(cfg, -3)).toBe(400);
  });

  it('scales by U(0,1) with full jitter', () => {
    const full: BackoffConfig = { ...cfg, jitter: 'full' };
    expect(backoffDelay(full, 2, 0)).toBe(0);
    expect(backoffDelay(full, 2, 0.5)).toBe(800);
    expect(backoffDelay(full, 2, 0.999999)).toBe(1599);
  });

  it('keeps every jittered delay inside its band', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.integer({ min: 0, max: 60000 }),
        fc.integer({ min: 0, max: 12 }),
        fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
        (baseMs, factor, maxMs, retry, u) => {
          const full: BackoffConfig = { baseMs, factor, maxMs, jitter: 'full' };
          const band = backoffBand(full, retry);
          const d = backoffDelay(full, retry, u);
          expect(band.min).toBe(0);
          expect(band.max).toBeLessThanOrEqual(maxMs);
          expect(d).toBeGreaterThanOrEqual(band.min);
          expect(d).toBeLessThanOrEqual(band.max);
          expect(Number.isInteger(d)).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('has a zero-width band without jitter', () => {
    expect(backoffBand(cfg, 3)).toEqual({ min: 3200, max: 3200 });
  });
});
