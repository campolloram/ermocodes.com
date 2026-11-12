import { describe, expect, it } from 'vitest';
import { nextFloat, nextHex, nextInt, seedState } from './rng';

describe('mulberry32', () => {
  it('produces the reference sequence for seed 1', () => {
    // Arrange
    let s = seedState(1);
    const values: number[] = [];

    // Act
    for (let i = 0; i < 3; i += 1) {
      const [u, next] = nextFloat(s);
      values.push(u);
      s = next;
    }

    // Assert: published mulberry32 output for seed 1
    expect(values).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it('returns floats in [0, 1) and never repeats state on consecutive draws', () => {
    let s = seedState(42);
    for (let i = 0; i < 10_000; i += 1) {
      const [u, next] = nextFloat(s);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(next).not.toBe(s);
      s = next;
    }
  });

  it('normalises seeds into uint32', () => {
    expect(seedState(-1)).toBe(4294967295);
    expect(seedState(2 ** 32 + 5)).toBe(5);
    expect(seedState(3.9)).toBe(3);
    expect(seedState(Number.NaN)).toBe(0);
    expect(seedState(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('draws inclusive integers within bounds', () => {
    let s = seedState(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) {
      const [n, next] = nextInt(s, 2, 4);
      seen.add(n);
      s = next;
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('draws hex strings of the requested length deterministically', () => {
    const [a] = nextHex(seedState(9), 16);
    const [b] = nextHex(seedState(9), 16);
    const [c] = nextHex(seedState(9), 5);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(c).toBe(a.slice(0, 5));
  });
});
