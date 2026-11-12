// Lenis + ScrollTrigger. Each section declares what it drives; the shared scene state (state.ts)
// is scrubbed, and the engine reads it every frame. Sections the concept did not have park the
// figure dim so the type stays readable.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { keyStep } from './keys.ts';
import { FIGURE, PHONE_QUERY, PROJECTS_BURST, SCROLL } from '../config.ts';
import { focusTarget, targetOf } from '../dom/anchor.ts';
import { heroDust, refs, scene as S } from '../state.ts';

export interface Scroll {
  /** The single clock: GSAP's ticker. */
  clock: typeof gsap.ticker;
  /** Advances smooth scroll; called from the loop every frame. */
  raf: (timeMs: number) => void;
  /** Ends any project-name burst in flight now (the visitor paused motion). */
  settle: () => void;
}

export interface ScrollOptions {
  /** A touch screen (pointer: coarse): scroll stays native, no Lenis. */
  touch: boolean;
}

const qs = <T extends Element = HTMLElement>(sel: string): T | null =>
  document.querySelector<T>(sel);

/** Where a target lands: its real top (pins and the sticky stage included) under the header. */
function landingY(el: HTMLElement): number {
  if (el.id === 'top' || el.id === 'main') return 0;
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  return Math.max(0, Math.round(el.getBoundingClientRect().top + scrollY - pad));
}

/** The page's top-level blocks in order: the hero's run (it holds the sticky hero), then sections. */
const blocks = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('#main > .hero-run, #main > section'),
];

/**
 * Called on the first refresh. The held scenes have their final length from the first paint
 * (sections/motion-scenes.css), so the browser's own #link jump or scroll restore is already right and a reader who
 * scrolled on before this script arrived stays where they are; this only keeps the block at the top
 * of the view at the same offset should the refresh still move anything.
 */
function keepPlace(): () => void {
  if (scrollY < 1) return () => {};
  const el = blocks().find((s) => s.getBoundingClientRect().bottom > 0);
  if (!el) return () => {};
  const top = el.getBoundingClientRect().top;
  return () => {
    const d = el.getBoundingClientRect().top - top;
    if (Math.abs(d) > 1) scrollTo({ top: scrollY + d, behavior: 'instant' });
  };
}

/** Notes how far into its section the view top is, and returns a function that goes back there. */
function holdSection(): () => void {
  if (scrollY < 1) return () => {};
  const el = blocks().find((s) => s.getBoundingClientRect().bottom > 1);
  if (!el) return () => {};
  const r = el.getBoundingClientRect();
  const f = r.height > 0 ? -r.top / r.height : 0;
  return () => {
    const n = el.getBoundingClientRect();
    const y = Math.max(0, Math.round(n.top + scrollY + f * n.height));
    if (Math.abs(y - scrollY) > 1) scrollTo({ top: y, behavior: 'instant' });
  };
}

/** Where the figure parks while a text-only section is on. */
interface Park {
  obj: number;
  grid: number;
}

/** Lenis (not on touch), the first-refresh place keeping and the in-page link handling. */
function setupScrollLayer(touch: boolean): { raf: (ms: number) => void; lenis: Lenis | null } {
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });
  gsap.ticker.lagSmoothing(0);
  // The first refresh keeps the reader's place. Every later one (a rotate, a resize) keeps the
  // reader at the same point of the same section.
  let restore: (() => void) | null = keepPlace();
  ScrollTrigger.addEventListener('refreshInit', () => {
    restore ??= holdSection();
  });
  ScrollTrigger.addEventListener('refresh', () => {
    const r = restore;
    restore = null;
    r?.();
  });

  // Lenis smooths the wheel. A touch screen gets none: Lenis 1.1 puts non-passive touch and wheel
  // listeners on window, so every touch scroll would wait for the main thread (a long task meant
  // a stuck finger). Native scroll drives the ScrollTrigger scrubs and the sticky scenes by itself.
  const lenis = touch
    ? null
    : new Lenis({ lerp: SCROLL.lenis.lerp, smoothWheel: SCROLL.lenis.smoothWheel });
  lenis?.on('scroll', ScrollTrigger.update);
  // In-page links: Lenis glides to the target's real position (measured now, with the pins in),
  // the URL gets the hash and focus moves to the target, as a native jump would. Lenis is first
  // re-synced to the real scroll: a focus or a native scroll it has not seen yet would otherwise
  // make it measure from a stale position and stop thousands of pixels short.
  const glideTo = (el: HTMLElement): void => {
    // A glide to a link is not a reader's step: the Experience stops leave it where it lands.
    snapState.moved = false;
    snapState.rest = null;
    // Without Lenis the browser glides (on the compositor, so a busy main thread cannot stall it).
    if (!lenis) return void scrollTo({ top: landingY(el), behavior: 'smooth' });
    if (lenis.isScrolling !== 'smooth' && Math.abs(lenis.animatedScroll - scrollY) > 1)
      lenis.scrollTo(scrollY, { immediate: true, force: true });
    lenis.scrollTo(landingY(el), { duration: SCROLL.anchorDuration, force: true });
  };
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    const hash = a?.getAttribute('href') ?? '';
    const el = targetOf(hash);
    if (!el) return;
    e.preventDefault();
    if (location.hash !== hash) history.pushState(null, '', hash);
    focusTarget(el);
    glideTo(el);
  });
  // Back/forward between in-page entries, or a hash typed into the address bar.
  addEventListener('hashchange', () => {
    const el = targetOf(location.hash);
    if (el) glideTo(el);
  });
  if (lenis) scrollKeys(lenis);
  return { raf: (ms) => lenis?.raf(ms), lenis };
}

/** Elements that use a key themselves: typing, choosing, or Space pressing a control. */
const OWN_KEYS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** Whether an element between the target and the page can still scroll that way by itself. */
function innerScroller(from: Element | null, down: boolean): boolean {
  for (let el = from; el && el !== document.body && el !== document.documentElement;) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
      if (down ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)
        return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * The page keys (arrows, Page Up/Down, Space, Home, End) scroll through Lenis, as the wheel does.
 * Left to the browser, a key scroll is Chromium's smooth-scroll animation, which starts on the
 * compositor after a main-thread frame: on a page whose main thread is saturated (software WebGL,
 * a slow CPU) that animation was sometimes never started, and from then on every key press of the
 * page was ignored while the wheel (Lenis, in script) still worked. Keys that a text field or a
 * control uses stay theirs, as does an inner box that can still scroll that way.
 */
function scrollKeys(lenis: Lenis): void {
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || lenis.isStopped) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest(OWN_KEYS)) return;
    const d = keyStep(e, t);
    if (!d || innerScroller(t, d > 0)) return;
    e.preventDefault();
    // Repeated presses add up from where the glide is going; a scroll Lenis has not seen yet
    // (a focus, a native jump) is taken from the page first.
    const gliding = lenis.isScrolling === 'smooth';
    if (!gliding && Math.abs(lenis.animatedScroll - scrollY) > 1)
      lenis.scrollTo(scrollY, { immediate: true, force: true });
    const from = gliding ? lenis.targetScroll : scrollY;
    lenis.scrollTo(Math.min(lenis.limit, Math.max(0, from + d)));
  });
}

/** Shared with the link glide: whether the reader moved the page since the last glide or load. */
const snapState = { moved: false, rest: null as number | null };

/**
 * EXPERIENCE stops on the Lenis path (a mouse or trackpad on desktop): one company per step. A
 * step from a stop goes to the next stop in that direction (a nudge under SCROLL.snap.nudge goes
 * back, a long drag goes to the nearest), and only inside the run: before the first stop it
 * catches a reader coming down, after the last stop (and above the first when leaving upward) it
 * lets go, so nothing traps the rest of the page. Keys and wheel both end in a scroll, so
 * ArrowDown, PageDown and Space take the same steps. Link jumps and reloads are never snapped.
 * The native path (touch, reduced motion, plain DOM) is CSS scroll-snap instead, never both.
 */
function experienceStops(lenis: Lenis): void {
  const sec = qs('#experience');
  const run = qs('#experience .exp-run');
  if (!sec || !run?.children.length) return;
  const C = SCROLL.snap;
  const stops = (): { y: number[]; ch: number } => {
    const top = sec.getBoundingClientRect().top + scrollY;
    const ch = (run.children[0] as HTMLElement).offsetHeight;
    return { y: Array.from(run.children, (_, k) => Math.round(top + (k + C.at) * ch)), ch };
  };
  for (const t of ['wheel', 'keydown', 'pointerdown', 'touchstart'])
    addEventListener(t, () => (snapState.moved = true), { passive: true, capture: true });
  const go = (y: number): void => {
    snapState.rest = y;
    if (Math.abs(y - scrollY) < 2) return;
    lenis.scrollTo(y, { duration: C.duration, userData: { initiator: 'snap' } });
  };
  const settle = (): void => {
    if (!snapState.moved) return;
    if (lenis.isScrolling === 'smooth') return void schedule();
    const { y: s, ch } = stops();
    const y = scrollY;
    const first = s[0]!;
    const last = s[s.length - 1]!;
    const nearest = nearestTo(s, y);
    const rest = snapState.rest;
    if (rest !== null && y >= first - 0.6 * ch && y <= last + 0.6 * ch) {
      const d = y - rest;
      if (Math.abs(d) <= C.nudge) return go(rest);
      if (Math.abs(d) < 0.6 * ch) {
        const next = s[s.indexOf(nearestTo(s, rest)) + Math.sign(d)];
        if (next !== undefined) return go(next);
        snapState.rest = null;
        return;
      }
      return go(nearest);
    }
    snapState.rest = null;
    // Not at a stop: catch a reader coming down before the first, or up after the last.
    const down = lenis.direction >= 0;
    if (down ? y >= first - 0.6 * ch && y <= last : y >= first && y <= last + 0.6 * ch) go(nearest);
  };
  let timer = 0;
  function schedule(): void {
    clearTimeout(timer);
    timer = window.setTimeout(settle, C.settleMs);
  }
  lenis.on('scroll', schedule);
}

const nearestTo = (s: number[], v: number): number =>
  s.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/* HERO: hold, split the object, the name blows away as dust */
function heroScene(park: Park): void {
  const H = SCROLL.hero;
  // The hero is position: sticky inside .hero-run (sections/motion-scenes.css), not a ScrollTrigger pin: the run's
  // height is reserved in CSS from the first paint, so the page never grows when this script
  // arrives, and a sticky hold is not scored as a layout shift the way a pin's fixed flip is.
  const heroRun = qs('.hero-run');
  const heroEl = qs('.hero');
  const heroHold = () => Math.max(1, (heroRun?.offsetHeight ?? 0) - (heroEl?.offsetHeight ?? 0));
  gsap
    .timeline({
      scrollTrigger: {
        trigger: heroRun ?? '.hero',
        start: 'top top',
        end: () => `+=${heroHold()}`,
        scrub: H.scrub,
      },
    })
    .to(S, { split: 1, ease: 'none', duration: 1 }, 0)
    // Opacity only (not autoAlpha): faded text stays in the accessibility tree, so a screen reader
    // browsing back to the top still finds the intro.
    .to(
      '.hero .lbl,.hero .hero-info,.hero .meta',
      { opacity: 0, y: -16, stagger: 0.03, duration: 0.22, ease: 'power1.in' },
      0,
    )
    .to(heroDust, { p: 1, ease: 'none', duration: H.dustLen }, H.dustAt)
    // What I do follows: the figure steps back.
    .to(S, { obj: park.obj, grid: park.grid, ease: 'none', duration: 0.25 }, 0.75);
}

/* into EXPERIENCE: the object divides into two clusters and lights up again */
function clusterIntro(): void {
  gsap.to(S, {
    cluster: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: '#experience',
      start: 'top bottom',
      end: 'top top',
      scrub: SCROLL.experienceScrub,
    },
  });
  gsap.to(S, {
    obj: 1,
    grid: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: '#experience',
      start: 'top 55%',
      end: 'top top',
      scrub: SCROLL.experienceScrub,
    },
  });
}

/** What the Experience chapters share. */
interface ExpContext {
  cos: HTMLElement[];
  metas: HTMLElement[];
  bigCount: number;
  exp: gsap.core.Timeline;
  expSec: HTMLElement;
  expStage: HTMLElement;
}

/** One chapter's letters tumbling in (and its meta line fading in), on `tl` at `at`. */
function enterChapter(
  x: ExpContext,
  k: number,
  tl: gsap.core.Timeline,
  at: number,
  metaAt: number,
  dur: number,
): void {
  const co = x.cos[k]!;
  const chs = co.querySelectorAll('.ch');
  const L = SCROLL.letters;
  // A name on two lines: line 1 tumbles in from above and line 2 from below, with a smaller
  // turn, so a letter never crosses into the other line while it is extruded and mid-flight.
  const lns = [...co.querySelectorAll('.ln')];
  const multi = lns.length > 1;
  const rot = L.rot * (multi ? 0.55 : 1);
  const turns = Array.from(chs, () => gsap.utils.random(-rot, rot));
  const fromY = (i: number): number => {
    if (!multi) return i % 2 ? -L.y : L.y;
    const second = lns.indexOf(chs[i]!.parentElement as Element) > 0;
    return (second ? 1 : -1) * (i % 2 ? L.y : L.y * 0.55);
  };
  // Letters are opaque the moment they start (a bit of opacity on an extruded block shows the
  // extrusion through the face); they tumble in from a short offset, inside the name's band.
  tl.fromTo(chs, { opacity: 0 }, { opacity: 1, duration: 0.01, stagger: { amount: L.stagger } }, at)
    .fromTo(
      chs,
      {
        yPercent: fromY,
        rotation: (i: number) => turns[i]!,
        // --r mirrors the turn, so the extrusion keeps pointing the same way on screen.
        '--r': (i: number) => `${turns[i]}deg`,
      },
      {
        yPercent: 0,
        rotation: 0,
        '--r': '0deg',
        stagger: { amount: L.stagger },
        duration: dur,
        ease: 'expo.out',
      },
      at,
    )
    .fromTo(
      x.metas[k]!,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' },
      metaAt,
    );
}

/**
 * The first chapter settles BEFORE the pin: while the stage slides in, SoFi holds its pinned spot
 * on screen (counter-moves with the stage), tumbles in, and is at rest when the stage arrives.
 * Nothing shows until the stage's top is above the name, so What I do stays clean. The section is
 * the trigger: it moves with the page while the sticky stage holds.
 */
function firstChapter(x: ExpContext): void {
  const co = x.cos[0]!;
  const rel = () =>
    co.getBoundingClientRect().top -
    x.expStage.getBoundingClientRect().top -
    Number(gsap.getProperty(co, 'y'));
  const from = () => Math.max(60, rel() - 16);
  const pre = gsap.timeline({
    scrollTrigger: {
      trigger: x.expSec,
      start: () => `top ${Math.round(from())}px`,
      end: () => `top ${Math.round(from() * 0.4)}px`,
      scrub: true,
      invalidateOnRefresh: true,
    },
  });
  enterChapter(x, 0, pre, 0, 0.2, 0.3);
  // Hold the pinned screen position: the stage moves up by its own top, the chapter moves down.
  gsap.fromTo(
    co,
    { y: () => -from() },
    {
      y: 0,
      ease: 'none',
      immediateRender: true,
      scrollTrigger: {
        trigger: x.expSec,
        start: () => `top ${Math.round(from())}px`,
        end: 'top top',
        scrub: true,
        invalidateOnRefresh: true,
      },
    },
  );
}

/** EXPERIENCE: one chapter per company on the sticky stage; returns what the dissolve needs. */
function experienceScene(): ExpContext & { syncAll: () => void } {
  const cos = gsap.utils.toArray<HTMLElement>('.co');
  const count = qs('.count')!;
  const cg = count.querySelector<HTMLElement>('.g')!;
  const cn = count.querySelector<HTMLElement>('.n')!;
  const metas = cos.map((co) => co.querySelector<HTMLElement>('.co-meta')!);
  const bigCount = cos.filter((c) => c.dataset.g === 'big').length;
  let shown = -1;
  const bigText = count.dataset.big ?? 'big companies';
  const stText = count.dataset.st ?? 'startups';
  function syncShown(tl: gsap.core.Timeline): void {
    const k = Math.max(0, Math.min(cos.length - 1, Math.floor(tl.time() + 0.02)));
    if (k === shown) return;
    shown = k;
    const big = k < bigCount;
    cg.textContent = big ? bigText : stText;
    cn.textContent = `${big ? k + 1 : k - bigCount + 1}/${big ? bigCount : cos.length - bigCount}`;
    cn.style.color = big ? 'var(--acc)' : 'var(--sig)';
  }
  // The stage is position: sticky inside #experience (sections/motion-scenes.css), not a ScrollTrigger pin: a pin
  // flips the stage to position: fixed part-way down the page, which the browser scores as the
  // whole screen jumping (CLS 1.0 on every pass and every rotate). The section is the stage plus
  // .exp-run (one chapter's scroll per company, reserved in CSS from the first paint), so the
  // stage holds for exactly the run's height.
  const expSec = qs('#experience')!;
  const expStage = qs('#experience .stage')!;
  const expRun = qs('#experience .exp-run');
  const expDist = () => Math.max(1, expRun?.offsetHeight ?? 0);
  const exp = gsap.timeline({
    scrollTrigger: {
      trigger: expSec,
      start: 'top top',
      end: () => `+=${expDist()}`,
      scrub: SCROLL.experienceScrub,
    },
    onUpdate: () => syncShown(exp),
  });
  const x: ExpContext = { cos, metas, bigCount, exp, expSec, expStage };
  const L = SCROLL.letters;
  cos.forEach((co, k) => {
    const meta = metas[k]!;
    const t = k;
    if (k === bigCount) exp.to(S, { emph: 1, ease: 'none', duration: 0.5 }, t - 0.3);
    // Chapters after the first start just before the previous one ends, so a stop at a boundary
    // finds the new name already settling instead of at the start of its tumble.
    const lead = k > 0 ? 0.05 : 0;
    exp.set(co, { opacity: 1 }, t - lead);
    if (k === 0) firstChapter(x);
    else enterChapter(x, k, exp, t - lead, t + 0.05, L.dur);
    if (k > 0) exp.to(S, { active: k, ease: 'power1.inOut', duration: 0.3 }, t - 0.05);
    if (k < cos.length - 1) {
      exp
        .to(refs.companyBits[k]!, { p: 1, ease: 'none', duration: L.dustLen }, t + L.dustAt)
        .to(meta, { opacity: 0, duration: 0.1 }, t + L.dustAt + 0.02)
        .set(co, { opacity: 0 }, t + 0.99);
    } else {
      exp.to({}, { duration: 0.35 }, t + L.dustAt - 0.1);
    }
  });
  return { ...x, syncAll: () => syncShown(exp) };
}

/* After the chapters: the last company dissolves as Projects arrives, and the figure parks. */
function projectsArrival(x: ExpContext | null, park: Park): void {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#projects',
      start: 'top bottom',
      end: 'top 70%',
      scrub: SCROLL.dissolveScrub,
    },
  });
  if (x) {
    const last = x.cos.length - 1;
    tl.to(refs.companyBits[last]!, { p: 1, ease: 'none', duration: 1 }, 0).to(
      x.metas[last]!,
      { opacity: 0, ease: 'none', duration: 0.4 },
      0,
    );
  }
  tl.to(S, { labels: 0, ease: 'none', duration: 0.4 }, 0).to(
    S,
    { obj: park.obj, grid: park.grid, ease: 'none', duration: 1 },
    0,
  );
}

/* STACK: the code grid gets stronger behind the list, then parks again for About. */
function stackScene(park: Park): void {
  const stack = qs('#stack[data-scene="grid"]');
  if (!stack) return;
  gsap.fromTo(
    S,
    { grid: park.grid },
    {
      grid: FIGURE.stackGrid,
      ease: 'none',
      immediateRender: false,
      scrollTrigger: {
        trigger: stack,
        start: 'top 85%',
        end: 'top 35%',
        scrub: SCROLL.dissolveScrub,
      },
    },
  );
  gsap.fromTo(
    S,
    { grid: FIGURE.stackGrid },
    {
      grid: park.grid,
      ease: 'none',
      immediateRender: false,
      scrollTrigger: {
        trigger: '#about',
        start: 'top 95%',
        end: 'top 45%',
        scrub: SCROLL.dissolveScrub,
      },
    },
  );
}

/**
 * PROJECTS: hover (mouse) or tap (touch) bursts a name into bits that settle back. Returns a
 * function that ends every burst in flight. While motion is paused a burst does not start: the
 * paused loop would not draw the frame that puts the hidden letters back.
 */
function projectBursts(): () => void {
  const B = PROJECTS_BURST;
  const ends: (() => void)[] = [];
  document.querySelectorAll<HTMLElement>('[data-proj]').forEach((li, k) => {
    const g = refs.projectBits[k];
    if (!g) return;
    let tl: gsap.core.Timeline | null = null;
    const burst = () => {
      if (tl?.isActive() || document.documentElement.classList.contains('mpaused')) return;
      li.dataset.burst = 'on';
      tl = gsap
        .timeline({ onComplete: () => void delete li.dataset.burst })
        .to(g, { p: B.peak, duration: B.upS, ease: 'power2.out' })
        .to(g, { p: 0, duration: B.downS, ease: 'power2.inOut' });
    };
    ends.push(() => {
      if (tl?.isActive()) tl.progress(1);
    });
    li.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && burst());
    li.addEventListener('pointerdown', (e) => e.pointerType !== 'mouse' && burst());
  });
  return () => ends.forEach((end) => end());
}

/* CONTACT: the object reassembles small; LET'S TALK forms from bits */
function contactScene(): void {
  gsap.to(S, {
    gather: 1,
    obj: 1,
    grid: FIGURE.contactGrid,
    ease: 'none',
    scrollTrigger: {
      trigger: '#contact',
      // On a phone About is about one screen tall: the figure lighting up as soon as Contact's top
      // entered would draw it bright over the About copy, so it waits until About is mostly gone.
      start: innerWidth < 700 ? 'top 55%' : 'top bottom',
      end: 'top 15%',
      scrub: SCROLL.contactScrub,
    },
  });
  if (refs.talkBits) {
    gsap.to(refs.talkBits, {
      p: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: '.talk',
        start: 'top 108%',
        end: 'top 64%',
        scrub: SCROLL.talkScrub,
      },
    });
  }
}

export function initScroll({ touch }: ScrollOptions): Scroll {
  const layer = setupScrollLayer(touch);
  // On a phone the figure sits right behind the text column (Projects most of all): parked much
  // dimmer there, figure and code grid both, so the copy reads clean at rest.
  const phone = innerWidth < 700;
  const park: Park = {
    obj: FIGURE.parkedObject * (phone ? 0.3 : 1),
    grid: FIGURE.parkedGrid * (phone ? 0.4 : 1),
  };
  heroScene(park);
  // A phone (decision 11) gets Experience as a plain list: no cluster split, no chapters.
  const list = matchMedia(PHONE_QUERY).matches;
  if (!list) clusterIntro();
  const exp = list ? null : experienceScene();
  projectsArrival(exp, park);
  stackScene(park);
  const settle = projectBursts();
  contactScene();
  exp?.syncAll();
  if (!list) {
    if (layer.lenis) experienceStops(layer.lenis);
    else document.documentElement.classList.add('snapnative');
  }

  // The scroll layer is up and owns in-page links (anchor.ts leaves them to it).
  document.documentElement.classList.add('mscroll');
  return { clock: gsap.ticker, raf: layer.raf, settle };
}
