/**
 * Persistent binary min-heap of timers, ordered by (at, seq).
 * Every operation copies the array, so callers' heaps are never mutated.
 */
import type { Timer } from './types';

export function timerBefore(a: Timer, b: Timer): boolean {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq);
}

function swap(arr: Timer[], i: number, j: number): void {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

function siftUp(arr: Timer[], start: number): void {
  let i = start;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!timerBefore(arr[i], arr[parent])) return;
    swap(arr, i, parent);
    i = parent;
  }
}

function siftDown(arr: Timer[], start: number): void {
  let i = start;
  for (;;) {
    const left = 2 * i + 1;
    const right = left + 1;
    let smallest = i;
    if (left < arr.length && timerBefore(arr[left], arr[smallest])) smallest = left;
    if (right < arr.length && timerBefore(arr[right], arr[smallest])) smallest = right;
    if (smallest === i) return;
    swap(arr, i, smallest);
    i = smallest;
  }
}

export function heapPeek(heap: readonly Timer[]): Timer | undefined {
  return heap[0];
}

export function heapPush(heap: readonly Timer[], timer: Timer): Timer[] {
  const next = [...heap, timer];
  siftUp(next, next.length - 1);
  return next;
}

export function heapPop(heap: readonly Timer[]): { top: Timer | undefined; rest: Timer[] } {
  if (heap.length === 0) return { top: undefined, rest: [] };
  const top = heap[0];
  const next = heap.slice(0, -1);
  if (next.length > 0) {
    next[0] = heap[heap.length - 1];
    siftDown(next, 0);
  }
  return { top, rest: next };
}
