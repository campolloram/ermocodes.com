import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// fade.ts keeps module state (the pending set, the wired flag), so each test loads a fresh copy.
type Fade = typeof import('./fade');

interface FakeEl {
  top: number;
  classes: Set<string>;
  getBoundingClientRect: () => { top: number; bottom: number };
  classList: { add: (c: string) => void; remove: (c: string) => void };
}

const VIEW = 800;
const fakeEl = (top: number): FakeEl => {
  const classes = new Set<string>();
  const el: FakeEl = {
    top,
    classes,
    getBoundingClientRect: () => ({ top: el.top, bottom: el.top + 40 }),
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
  };
  return el;
};

let listeners: Map<string, () => void>;
let frames: Array<() => void>;
let faded: FakeEl[];

beforeEach(() => {
  listeners = new Map();
  frames = [];
  faded = [];
  vi.stubGlobal('innerHeight', VIEW);
  vi.stubGlobal('addEventListener', (type: string, fn: () => void) => listeners.set(type, fn));
  vi.stubGlobal('removeEventListener', (type: string) => listeners.delete(type));
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => frames.push(fn));
  vi.stubGlobal('document', {
    querySelectorAll: () => faded.filter((e) => e.classes.has('fade-in')),
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const load = (): Promise<Fade> => import('./fade');
const scrollAndFrame = (): void => {
  listeners.get('scroll')?.();
  frames.splice(0).forEach((f) => f());
};

describe('fadeOnEnter', () => {
  test('a line already in view is left alone; one below the fold waits', async () => {
    const { fadeOnEnter } = await load();
    const inView = fakeEl(100);
    const below = fakeEl(VIEW + 500);
    faded = [inView, below];
    fadeOnEnter([inView, below] as unknown as Element[]);
    scrollAndFrame();
    expect(inView.classes.has('fade-in')).toBe(false);
    expect(below.classes.has('fade-in')).toBe(false);
  });

  test('a below-the-fold line gets fade-in once it enters the view, and only then', async () => {
    const { fadeOnEnter } = await load();
    const below = fakeEl(VIEW + 500);
    faded = [below];
    fadeOnEnter([below] as unknown as Element[]);
    below.top = VIEW + 100; // scrolled, still below the view
    scrollAndFrame();
    expect(below.classes.has('fade-in')).toBe(false);
    below.top = VIEW - 20; // now its top edge is inside the view
    scrollAndFrame();
    expect(below.classes.has('fade-in')).toBe(true);
  });

  test('a line that jumped far past stays pending until it is in view, then fades in once', async () => {
    const { fadeOnEnter } = await load();
    const el = fakeEl(VIEW + 500);
    faded = [el];
    fadeOnEnter([el] as unknown as Element[]);
    el.top = -200; // jumped far past: bottom < 0 is skipped, so it stays pending
    scrollAndFrame();
    expect(el.classes.has('fade-in')).toBe(false);
    el.top = 10;
    scrollAndFrame();
    expect(el.classes.has('fade-in')).toBe(true);
    el.classes.delete('fade-in');
    scrollAndFrame(); // already handled: it is no longer pending
    expect(el.classes.has('fade-in')).toBe(false);
  });

  test('scroll events within one frame queue a single check', async () => {
    const { fadeOnEnter } = await load();
    const el = fakeEl(VIEW + 500);
    fadeOnEnter([el] as unknown as Element[]);
    listeners.get('scroll')?.();
    listeners.get('scroll')?.();
    listeners.get('scroll')?.();
    expect(frames).toHaveLength(1);
  });

  test('the scroll listener is added once, however many times it is called', async () => {
    const { fadeOnEnter } = await load();
    const add = vi.fn((type: string, fn: () => void) => listeners.set(type, fn));
    vi.stubGlobal('addEventListener', add);
    fadeOnEnter([fakeEl(VIEW + 100)] as unknown as Element[]);
    fadeOnEnter([fakeEl(VIEW + 200)] as unknown as Element[]);
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe('undoFade', () => {
  test('stops listening, forgets pending lines and strips fade-in everywhere', async () => {
    const { fadeOnEnter, undoFade } = await load();
    const done = fakeEl(VIEW - 10);
    const waiting = fakeEl(VIEW + 500);
    faded = [done, waiting];
    fadeOnEnter([done, waiting] as unknown as Element[]);
    done.classes.add('fade-in');
    undoFade();
    expect(listeners.has('scroll')).toBe(false);
    expect(done.classes.has('fade-in')).toBe(false);
    waiting.top = 100;
    scrollAndFrame();
    expect(waiting.classes.has('fade-in')).toBe(false);
  });

  test('fadeOnEnter after undoFade wires the listener again', async () => {
    const { fadeOnEnter, undoFade } = await load();
    fadeOnEnter([fakeEl(VIEW + 100)] as unknown as Element[]);
    undoFade();
    fadeOnEnter([fakeEl(VIEW + 100)] as unknown as Element[]);
    expect(listeners.has('scroll')).toBe(true);
  });
});
