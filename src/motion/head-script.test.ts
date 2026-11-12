import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FALLBACK_MS, MOTION_PAUSE_KEY, headScript } from './head-script.mjs';

// Runs the real inline head script against a minimal fake browser and fake timers.
function run(opts: { reduce?: boolean; webgl?: boolean; paused?: boolean }) {
  const classes = new Set<string>();
  const html = {
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (c: string) => classes.delete(c),
    },
    hasAttribute: () => false,
  };
  const gl = {
    RENDERER: 1,
    getParameter: () => 'ANGLE (GPU)',
    getExtension: () => null,
  };
  const loadListeners: Array<() => void> = [];
  const sandbox = {
    document: {
      documentElement: html,
      createElement: () => ({ getContext: () => (opts.webgl === false ? null : gl) }),
    },
    matchMedia: () => ({ matches: Boolean(opts.reduce) }),
    sessionStorage: {
      getItem: (k: string) => (opts.paused && k === MOTION_PAUSE_KEY ? '1' : null),
    },
    setTimeout,
    addEventListener: (t: string, fn: () => void) => t === 'load' && loadListeners.push(fn),
  };
  runInNewContext(headScript({ allowSoftwareGL: true }), sandbox);
  return { classes, loadListeners };
}

describe('head script safety timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('with motion on, the name stays hidden (pwait) until FALLBACK_MS, then shows', () => {
    const { classes } = run({});
    expect(classes.has('motion')).toBe(true);
    expect(classes.has('pwait')).toBe(true);
    vi.advanceTimersByTime(FALLBACK_MS - 1);
    expect(classes.has('pwait')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(classes.has('pwait')).toBe(false);
    expect(classes.has('motion')).toBe(true);
  });

  test('a load event with no engine started (no data-mboot) drops html.motion', () => {
    const { classes, loadListeners } = run({});
    loadListeners.forEach((fn) => fn());
    expect(classes.has('motion')).toBe(false);
  });

  test('reduced motion or no WebGL never sets pwait, so there is nothing to time out', () => {
    for (const opts of [{ reduce: true }, { webgl: false }]) {
      const { classes } = run(opts);
      expect(classes.has('pwait')).toBe(false);
      expect(classes.has('motion')).toBe(false);
      expect(classes.has('js')).toBe(true);
    }
  });

  test('a visit paused earlier is marked mpaused before the timer', () => {
    expect(run({ paused: true }).classes.has('mpaused')).toBe(true);
  });
});
