// Entry point. The head script has already decided whether the motion layer may run (html.motion:
// a GPU-backed WebGL2 context opened, no reduced motion); only then is the engine loaded, after
// the first paint. Real DOM text is on screen from the first paint; the effects fade in once
// ready. If anything throws (blocked context) the page stays plain DOM, with no console errors.
import { MOTION_PAUSE_KEY } from './head-script.mjs';
import { focusOnJump, targetOf } from './dom/anchor.ts';
import { fadeOnEnter, undoFade } from './dom/fade.ts';
import { prepareDom, showAllLetters, undoPrepare } from './dom/prepare.ts';
import { letterGuard } from './dom/split.ts';
import { createExtrusion } from './dom/extrude.ts';
import { canvasFont, siteFontReady } from './font.ts';
import { PERF, PHONE_QUERY } from './config.ts';
import { createLoop, yieldTask } from './loop.ts';
import { ptr } from './scene/pointer.ts';
import { view } from './scene/view.ts';
import { chooseTier } from './tier.ts';

interface MotionHook {
  frames: () => number;
  freeze: (t: number) => void;
  /** The canvas font string the scene and the demo draw with. */
  font: () => string;
  /** Hero letters the liquid melt is drawing, and particle bits drawn last frame. */
  melt: () => number;
  bits: () => number;
  /** The grid's pointer heat (the lens over the ASCII figure), 0..1. */
  heat: () => number;
}
declare global {
  interface Window {
    __ecMotion?: MotionHook;
  }
}

const root = document.documentElement;
// Tells the head script this module ran: without it, the load event takes html.motion off again.
root.dataset.mboot = '1';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
/** What I do, Projects, Stack, Queue, About and Contact fade in as they enter. */
const FADE_ON_ENTER = [
  '#what-i-do .lbl',
  '.do-list li',
  '#what-i-do .bracket',
  '#projects .lbl',
  '.proj-line',
  '#stack .lbl',
  '.stack-row',
  '#queue .lbl',
  '.queue-intro',
  '.contact .lbl',
  '.contact .ask',
  '.contact .links .bracket',
  '.contact .foot > span',
  '#about .lbl',
  '.about p',
  '.about .bracket',
].join(',');

/**
 * Notes where the reader is before the held scenes' reserved scroll length (html.motion) comes
 * off, and returns a function that puts them back there: a #link target that had landed lands
 * again, otherwise (on a fresh visit) the view keeps the same point of the same block. Without it,
 * a browser with no WebGL (Firefox on a machine without a GPU) that had already jumped to /#queue
 * in the long layout would be left thousands of pixels past it once the page gets shorter.
 */
function keepReaderPlace(): () => void {
  if (!root.classList.contains('motion') || (scrollY < 1 && !savedPlace())) return () => {};
  const pad = () => parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
  const go = (y: number) => {
    const top = Math.max(0, Math.round(y));
    if (Math.abs(top - scrollY) > 1) scrollTo({ top, behavior: 'instant' });
  };
  const target = targetOf(location.hash);
  if (target && Math.abs(target.getBoundingClientRect().top - pad()) <= 2)
    return () => go(target.getBoundingClientRect().top + scrollY - pad());
  // Otherwise the reader keeps the same point of the same block. A reload or Back is put where the
  // last pagehide of this path left them (stored as block index and fraction, so it does not depend
  // on how the browser restored a scroll offset into this long layout: Chromium anchors it, Firefox
  // may not), unless they have scrolled since load; then, and on a fresh visit, the point is
  // measured from where the page is now.
  const nav = performance.getEntriesByType?.('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  const blocks = readerBlocks();
  const saved = nav && nav.type !== 'navigate' && !scrolledByReader ? savedPlace() : null;
  let el = saved ? blocks[saved.i] : undefined;
  let f = saved?.f ?? 0;
  if (!el) {
    el = blocks.find((b) => b.getBoundingClientRect().bottom > 1);
    if (!el) return () => {};
    const r = el.getBoundingClientRect();
    f = r.height > 0 ? -r.top / r.height : 0;
  }
  const block = el;
  return () => {
    const n = block.getBoundingClientRect();
    go(n.top + scrollY + f * n.height);
  };
}

const readerBlocks = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('#main > .hero-run, #main > section'),
];
/** True once the reader has wheeled, touched, typed or pressed since load: their place is theirs. */
let scrolledByReader = false;
for (const t of ['wheel', 'touchmove', 'keydown', 'pointerdown'])
  addEventListener(t, () => (scrolledByReader = true), { passive: true, once: true });

const PLACE_KEY = 'ec-place:' + location.pathname;
/** Remembers the block at the top of the view and how far into it, for the reload or Back that follows. */
addEventListener('pagehide', () => {
  try {
    const blocks = readerBlocks();
    const i = blocks.findIndex((b) => b.getBoundingClientRect().bottom > 1);
    if (i < 0) return;
    const r = blocks[i].getBoundingClientRect();
    const f = r.height > 0 ? Math.max(0, -r.top / r.height) : 0;
    sessionStorage.setItem(PLACE_KEY, JSON.stringify({ i, f }));
  } catch {
    /* storage blocked: the next visit keeps the reader by the browser's restored place */
  }
});
const savedPlace = (): { i: number; f: number } | null => {
  try {
    const v = JSON.parse(sessionStorage.getItem(PLACE_KEY) ?? 'null');
    return v && Number.isInteger(v.i) && Number.isFinite(v.f) ? { i: v.i, f: v.f } : null;
  } catch {
    return null;
  }
};

/** The hero name is drawn as text again (the particle intro is over, or never will finish). */
const showName = (): void => root.classList.remove('pbuild', 'pshow');

/** Removes the scroll layer's listeners and Lenis (set once the timeline loads). */
let disposeScroll: (() => void) | null = null;

const plainDom = (): void => {
  const restore = keepReaderPlace();
  // When the held scenes' length comes off, Chrome scores the Experience section as moved (its
  // sticky stage) even while it is out of view, a layout shift of the whole viewport. Hidden for
  // the frame of the switch it is not scored; out of view, nobody sees it hidden.
  const exp = root.classList.contains('motion') ? document.getElementById('experience') : null;
  const r = exp?.getBoundingClientRect();
  const hide = exp && r && (r.bottom <= 0 || r.top >= innerHeight) ? exp : null;
  hide?.classList.add('mswap');
  root.classList.remove('pwait', 'motion', 'mpaused', 'mscroll');
  showName();
  undoFade();
  undoPrepare();
  disposeScroll?.();
  restore();
  if (hide) requestAnimationFrame(() => setTimeout(() => hide.classList.remove('mswap'), 0));
};
/** Gives up on the motion layer: plain DOM, the reason left on html[data-mfallback] for tests. */
const fallBack = (why: unknown): void => {
  console.warn('[motion] falling back to plain DOM:', why);
  root.dataset.mfallback = (why instanceof Error ? why.message : String(why)).slice(0, 120);
  plainDom();
};
/** The motion layer is still wanted (it is not, once the page fell back to plain DOM). */
const alive = (): boolean => reduce || root.classList.contains('motion');
/** After the load event (the font and the hero are in) and the next frame has painted. */
const afterPaint = (fn: () => void): void => {
  const go = () => requestAnimationFrame(() => setTimeout(fn, 0));
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
};

function introFades(): void {
  fadeOnEnter(document.querySelectorAll(FADE_ON_ENTER));
}

/** Pauses the scene while a data-canvas="off" section fills at least half the view. */
function watchOffSections(setOff: (off: boolean) => void): void {
  const sections = [...document.querySelectorAll('[data-canvas="off"]')];
  if (!sections.length || !('IntersectionObserver' in window)) return;
  const ratio = new Map<Element, number>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) ratio.set(e.target, e.intersectionRatio);
      const viewFill = (el: Element) =>
        Math.min(1, ((ratio.get(el) ?? 0) * el.getBoundingClientRect().height) / innerHeight);
      setOff(sections.some((el) => (ratio.get(el) ?? 0) >= 0.5 || viewFill(el) >= 0.5));
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1] },
  );
  sections.forEach((s) => io.observe(s));
}

/**
 * The [ pause motion ] control in the header (WCAG 2.2.2): it shows under html.motion from the first
 * paint, toggles html.mpaused (CSS swaps its label between "pause" and "play" and stops the
 * blinking cursors) and is remembered for this visit. `apply` reaches the loop once it exists; a
 * press before that is picked up when it starts.
 */
const motionToggle = { apply: (paused: boolean): void => void paused };
function wireMotionToggle(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-mctl]');
  if (!btn) return;
  // The label itself swaps ("pause motion" / "play motion"), so the button is not a toggle button
  // (no aria-pressed): a screen reader hears the action the press will do.
  btn.addEventListener('click', () => {
    const paused = root.classList.toggle('mpaused');
    try {
      if (paused) sessionStorage.setItem(MOTION_PAUSE_KEY, '1');
      else sessionStorage.removeItem(MOTION_PAUSE_KEY);
    } catch {
      /* storage blocked: the choice lasts until the page is left */
    }
    motionToggle.apply(paused);
  });
}

/**
 * The queue demo needs no WebGL: it loads when #queue nears the view, in every mode. Its control
 * is shown (and in the tab order) from the start: focusing it loads the demo, and a press that
 * comes before the demo is ready runs it as soon as it is.
 */
function lazyQueueDemo(): void {
  const el = document.getElementById('queue');
  if (!el) return;
  let loading: Promise<void> | null = null;
  let fails = 0;
  const btn = el.querySelector<HTMLButtonElement>('[data-kill]');
  // A failed fetch of the chunk (a flaky network) is forgotten, so the next focus or press retries;
  // after three failures the button goes away rather than sit there dead.
  const load = (): Promise<void> =>
    (loading ??= import('../demo/queue-demo.ts')
      .then((m) => m.initQueueDemo())
      .catch(() => {
        loading = null;
        if (++fails >= 3 && btn) btn.hidden = true;
      }));
  if (btn) {
    btn.hidden = false;
    btn.addEventListener('focus', () => void load());
    btn.addEventListener('click', () => {
      if (el.querySelector('[data-demo][data-ready]')) return;
      void load().then(() => {
        if (el.querySelector('[data-demo][data-ready]')) btn.click();
      });
    });
  }
  if (!('IntersectionObserver' in window)) return void load();
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void load();
    },
    { rootMargin: '600px 0px' },
  );
  io.observe(el);
}

/** Calls `fn` when the canvas size really changes, once it has stopped changing for 150 ms. */
function onCanvasResize(canvas: HTMLCanvasElement, fn: () => void): void {
  let timer = 0;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const w = canvas.clientWidth || innerWidth;
      const h = canvas.clientHeight || innerHeight;
      if (w !== view.W || h !== view.H) fn();
    }, 150);
  }).observe(canvas);
}

async function run(canvas: HTMLCanvasElement): Promise<void> {
  const tier = chooseTier({ cores: navigator.hardwareConcurrency || 4 });
  // Both chunks download at once; the scroll layer is not needed in reduced motion.
  const timeline = reduce ? null : import('./scroll/timeline.ts');
  timeline?.catch(() => {});
  const [{ createEngine }] = await Promise.all([import('./scene/engine.ts'), siteFontReady()]);
  // The page may have given up on the motion layer while the chunks downloaded (watchStall).
  if (!alive()) return;

  let engine: Awaited<ReturnType<typeof createEngine>>;
  // The layout prepareDom and the timelines were built for (Experience list or held stage).
  let builtPhone = matchMedia(PHONE_QUERY).matches;
  try {
    engine = await createEngine({
      canvas,
      reduce,
      tier,
      prepare: reduce
        ? undefined
        : () => {
            if (!alive()) throw new Error('motion layer abandoned');
            builtPhone = matchMedia(PHONE_QUERY).matches;
            prepareDom();
          },
    });
  } catch (err) {
    return fallBack(err);
  }
  // Gave up while the engine started: let go of the GL context and leave the plain page alone.
  const abandoned = (): boolean => {
    if (alive()) return false;
    engine.stage.renderer.forceContextLoss();
    return true;
  };
  await engine.warm();
  if (abandoned()) return;
  engine.relayout();

  if (reduce) {
    // One static frame; the loop never starts.
    engine.still();
    canvas.classList.add('on');
    onCanvasResize(canvas, () => {
      engine.relayout();
      engine.still();
    });
    return;
  }

  const { initScroll, disposeScrollListeners } = await timeline!;
  disposeScroll = disposeScrollListeners;
  await yieldTask();
  if (abandoned()) return;
  const scroll = initScroll({ touch: coarse });
  // Experience is a list on a phone and a held stage above that (prepareDom and the timelines
  // are built for one of them): crossing the width reloads into the other, the place is kept.
  // Only a real crossing: Chromium also fires 'change' when the viewport is re-emulated at the
  // same width (a full-page capture does that), and a reload there broke the page mid-capture.
  const phoneQuery = matchMedia(PHONE_QUERY);
  // Debounced: a drag-resize or a rotation fires several changes; only the settled state counts.
  let crossTimer = 0;
  const crossed = (): void => {
    if (alive() && phoneQuery.matches !== builtPhone) location.reload();
  };
  phoneQuery.addEventListener('change', () => {
    clearTimeout(crossTimer);
    crossTimer = window.setTimeout(crossed, 300);
  });
  crossed();
  const extrusion = createExtrusion(coarse);
  const hudEl = document.getElementById('fps');
  // Nothing draws the stand-in bits any more (context lost, a render threw): the letters stay in
  // the DOM and the layout stays as it is.
  const degrade = (): void => {
    letterGuard.noHide = true;
    showName();
    showAllLetters();
    canvas.classList.remove('on');
  };
  const loop = createLoop({
    clock: scroll.clock,
    tier: engine.tier,
    render: (t, dt) => engine.render(t, dt),
    always: (ms) => {
      scroll.raf(ms);
      if (extrusion.tick()) loop.poke();
    },
    onTier: (t) => engine.setTier(t),
    onError: (err) => {
      root.dataset.mfallback = err instanceof Error ? err.message.slice(0, 120) : 'render error';
      degrade();
    },
    hud: hudEl,
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    loop.setLost(true);
    degrade();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    letterGuard.noHide = false;
    loop.setLost(false);
    canvas.classList.add('on');
  });
  engine.onActivity(loop.poke);
  watchOffSections(loop.setCanvasOff);
  motionToggle.apply = (p) => {
    // A burst in flight ends now: the frames the paused loop still draws put its letters back.
    if (p) {
      scroll.settle();
      showName();
    }
    loop.setPaused(p);
  };
  const paused = root.classList.contains('mpaused');
  loop.setPaused(paused);
  // Paused from an earlier page view: no particle intro, the name is simply there.
  if (paused) root.classList.remove('pwait');

  onCanvasResize(canvas, () => engine.relayout());

  if (import.meta.env.PUBLIC_TEST_HOOKS === '1') {
    window.__ecMotion = {
      frames: () => loop.frames(),
      freeze: (t) => engine.name?.freeze(t),
      font: () => canvasFont(12),
      melt: () => engine.melt?.active() ?? 0,
      bits: () => engine.name?.drawn() ?? 0,
      heat: () => ptr.on,
    };
  }

  engine.name?.start();
  canvas.classList.add('on');
  introFades();
}

/**
 * Content must never wait on the engine: the Experience names are transparent under html.motion
 * until the scroll layer shows them. If that layer is still not up PERF.stallMs of visible time
 * after the first painted frame (a slow link, a stalled chunk), the page gives up on motion and
 * stays plain DOM.
 */
function watchStall(): void {
  let left: number = PERF.stallMs;
  let since = 0;
  let timer = 0;
  const check = () => {
    timer = 0;
    if (!root.classList.contains('mscroll') && root.classList.contains('motion'))
      fallBack('stalled');
  };
  const arm = () => {
    since = performance.now();
    timer = window.setTimeout(check, left);
  };
  // A hidden tab holds the page's frames back, so the clock runs only while the page is visible.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!timer) return;
      clearTimeout(timer);
      timer = 0;
      left = Math.max(0, left - (performance.now() - since));
    } else if (!timer && alive() && !root.classList.contains('mscroll')) arm();
  });
  if (!document.hidden) arm();
}

lazyQueueDemo();
focusOnJump();
wireMotionToggle();
const ascii = document.getElementById('ascii') as HTMLCanvasElement | null;
// No html.motion (no GPU-backed WebGL2, or the probe failed): the engine is never downloaded, and
// the layout the page painted first is the one it keeps. Reduced motion skips the probe and draws
// one static frame when WebGL works.
if (!ascii || (!reduce && !root.classList.contains('motion'))) plainDom();
else {
  afterPaint(() => {
    void run(ascii).catch(fallBack);
    // The clock starts at the first painted frame, not at load: the engine starts on a frame.
    if (!reduce) watchStall();
  });
}
