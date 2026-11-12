import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { heapPeek, heapPop, heapPush } from './heap';
import type { Timer } from './types';

const wake = (at: number, seq: number): Timer => ({ kind: 'wake', at, seq });

function drain(heap: Timer[]): Timer[] {
  const out: Timer[] = [];
  let h = heap;
  for (let { top, rest } = heapPop(h); top; { top, rest } = heapPop(h)) {
    out.push(top);
    h = rest;
  }
  return out;
}

describe('timer min-heap', () => {
  it('pops timers in (at, seq) order', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 60 }), (ats) => {
        // Arrange
        const timers = ats.map((at, seq) => wake(at, seq));
        const heap = timers.reduce<Timer[]>((h, t) => heapPush(h, t), []);

        // Act
        const order = drain(heap).map((t) => [t.at, t.seq]);

        // Assert
        const expected = [...timers]
          .sort((a, b) => a.at - b.at || a.seq - b.seq)
          .map((t) => [t.at, t.seq]);
        expect(order).toEqual(expected);
      }),
    );
  });

  it('never mutates the heap it is given', () => {
    const base = Object.freeze([wake(5, 0), wake(9, 1), wake(7, 2)].reduce<Timer[]>(heapPush, []));
    const snapshot = JSON.stringify(base);
    heapPush(base, wake(1, 3));
    heapPop(base);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('handles the empty heap', () => {
    expect(heapPeek([])).toBeUndefined();
    expect(heapPop([])).toEqual({ top: undefined, rest: [] });
    expect(heapPop([wake(1, 0)])).toEqual({ top: wake(1, 0), rest: [] });
  });
});
