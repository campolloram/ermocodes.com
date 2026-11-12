// The single clock. GSAP's ticker owns the one requestAnimationFrame (so scrubs, Lenis and the
// scene advance in the same frame); this module sits on it and adds pause rules, the ambient
// rate, quality tiers and the preview fps HUD. In reduced motion it is never started.
import { PERF } from './config.ts';
import { FpsMeter, nextTier } from './tier.ts';

export interface Clock {
  add: (fn: (timeSec: number, deltaMs: number) => void) => void;
  fps: (n: number) => void;
}

export interface LoopOptions {
  clock: Clock;
  tier: number;
  /** Per-frame scene render (paused when hidden or when the canvas is off). */
  render: (timeMs: number, dt: number) => void;
  /** Always-on work (smooth scroll). */
  always?: (timeMs: number) => void;
  /** Called when the tier drops. */
  onTier: (tier: number) => void;
  /** A render threw: the loop never renders again (scroll keeps working). */
  onError?: (err: unknown) => void;
  hud?: HTMLElement | null;
}

export interface Loop {
  /** Input or an active tween happened: leave the ambient rate. */
  poke: () => void;
  /** Number of scene frames rendered so far. */
  frames: () => number;
  /** Pause while a `data-canvas="off"` section fills the view. */
  setCanvasOff: (off: boolean) => void;
  /** The WebGL context is lost (true) or back (false): nothing is drawn while it is lost. */
  setLost: (lost: boolean) => void;
  /**
   * The visitor's pause (WCAG 2.2.2): the scene no longer moves on its own. It still redraws for a
   * moment after a scroll, a key or a resize, so the scroll-driven scenes follow the reader.
   */
  setPaused: (paused: boolean) => void;
}

/**
 * Ends the current task so input, a paint or other work can run before the next start-up step: one
 * long task becomes several short ones. scheduler.yield() resumes ahead of other tasks where it
 * exists; elsewhere a zero timeout (it also runs in a hidden tab, where rAF would not).
 */
export function yieldTask(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return s?.yield ? s.yield() : new Promise((r) => setTimeout(r, 0));
}

/** While paused, how long the scene keeps drawing after the reader scrolls (covers the scrubs). */
const PAUSED_FOLLOW_MS = 1500;
/** While paused from the start, the first frames (the grid's fade-in, well under 5 s) still draw. */
const PAUSED_START_MS = 2500;

export function createLoop(o: LoopOptions): Loop {
  let tier = o.tier;
  let frames = 0;
  let canvasOff = false;
  let lastActive = performance.now();
  let ambient = false;
  let lastRender = 0;
  let paused = false;
  let lost = false;
  let broken = false;
  let followUntil = performance.now() + PAUSED_START_MS;
  const meter = new FpsMeter();
  let hudAcc = 0;
  let hudFrames = 0;
  const hidden = () => document.hidden;

  const poke = () => {
    lastActive = performance.now();
    if (ambient) {
      ambient = false;
      o.clock.fps(0);
      meter.hold(1);
    }
  };
  for (const ev of [
    'pointermove',
    'pointerdown',
    'wheel',
    'keydown',
    'touchstart',
    'touchmove',
    'scroll',
  ])
    addEventListener(ev, poke, { passive: true });
  const follow = () => {
    followUntil = performance.now() + PAUSED_FOLLOW_MS;
  };
  for (const ev of ['scroll', 'wheel', 'keydown', 'touchmove', 'resize'])
    addEventListener(ev, follow, { passive: true });
  document.addEventListener('visibilitychange', () => {
    lastRender = 0;
    meter.hold(1);
    if (!hidden()) poke();
  });

  o.clock.add((timeSec) => {
    const now = timeSec * 1000;
    o.always?.(now);
    if (hidden() || canvasOff || lost || broken) return;
    const t = performance.now();
    if (paused && t > followUntil) {
      lastRender = 0;
      return;
    }
    if (!ambient && t - lastActive > PERF.idleAfter * 1000) {
      ambient = true;
      o.clock.fps(PERF.ambientFps);
      meter.hold(1);
    }
    const dt = Math.min(0.05, lastRender ? (t - lastRender) / 1000 : 0.016);
    lastRender = t;
    try {
      o.render(t, dt);
    } catch (err) {
      broken = true;
      o.onError?.(err);
      return;
    }
    frames += 1;
    if (!ambient) {
      const fps = meter.push(dt);
      if (fps !== null) {
        const next = nextTier(tier, fps);
        if (next !== tier) {
          tier = next;
          meter.hold();
          o.onTier(tier);
        }
      }
    }
    if (o.hud) {
      hudAcc += dt;
      hudFrames += 1;
      if (hudAcc >= 0.5) {
        o.hud.textContent = `${Math.round(hudFrames / hudAcc)} fps · tier ${tier}${ambient ? ' · ambient' : ''}`;
        hudAcc = 0;
        hudFrames = 0;
      }
    }
  });

  return {
    poke,
    frames: () => frames,
    setCanvasOff(off) {
      canvasOff = off;
      lastRender = 0;
      if (!off) poke();
    },
    setLost(l) {
      lost = l;
      lastRender = 0;
      if (!l) poke();
    },
    setPaused(p) {
      paused = p;
      if (p) follow();
      else poke();
    },
  };
}
