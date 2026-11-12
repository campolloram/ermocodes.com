// Every constant of the approved concept (ermocodes-site-concepts/final/index.html) lives here, so
// tuning the motion never means hunting through modules.

/** Quality tiers: 0 is full quality; each step down trades detail for frame time. */
export interface TierSpec {
  /** Multiplier on the particle-name target count. */
  readonly particles: number;
  /** Subtracted from the device-pixel-ratio cap. */
  readonly dprDelta: number;
  /** Multiplier on the code-grid cell size (coarser grid = fewer cells). */
  readonly cell: number;
}

export const PERF = {
  /** DPR cap: 2 desktop, 1.5 phone. */
  dprCap: { desktop: 2, phone: 1.5 },
  /** Width under which the layout counts as a phone. */
  phoneWidth: 700,
  tiers: [
    { particles: 1, dprDelta: 0, cell: 1 },
    { particles: 0.6, dprDelta: 0.25, cell: 1.2 },
    { particles: 0.4, dprDelta: 0.5, cell: 1.45 },
  ] as readonly TierSpec[],
  /** Drop one tier when the average fps stays under this for `fpsWindow` seconds. */
  fpsFloor: 50,
  fpsWindow: 2,
  /** A freshly changed tier is left alone for this long before the meter judges again. */
  tierCooldown: 3,
  /** With no input and no active tween for this long, the loop falls to the ambient rate. */
  idleAfter: 4,
  ambientFps: 20,
  /**
   * If the scroll layer is not up this long (ms) after the first painted frame, counting visible
   * time only, the page gives up on the motion layer and stays plain DOM: a stalled engine download
   * never leaves content hidden. 12 s: motion came up at 6.5-6.8 s at 250 kbps, and a working link
   * at 150 kbps missed the old 8 s limit.
   */
  stallMs: 12000,
  /** Initial tier: weak hardware starts lower. */
  fewCores: 4,
  veryFewCores: 2,
} as const;

export const COLORS = {
  acc: '--acc',
  sig: '--sig',
  hi: '--hi',
  paper: '--hd',
  x1: '--x1',
  x2: '--x2',
  x3: '--x3',
} as const;

export const GRID = {
  fontPx: 13,
  /** Cell height as a multiple of the font size. */
  cellHeightRatio: 1.18,
  minCellW: 5,
  minCells: 8,
  ramp: ' .:-=+*#%@',
  edge: '|-/\\',
  glyphs: '0123456789ABCDEF<>/\\=+-*#%$&!?:|^~',
  /** Chance that a cell shows no glyph. */
  emptyChance: 0.44,
  /** Glyph swaps per cell per second. */
  swapRate: 0.75,
  flareChance: 0.012,
  flareDecay: 2.2,
  heatDecay: 3.2,
  heatReach: { desktop: 96, phone: 74 },
  heatSwapChance: 0.6,
  pointerDecay: 0.6,
  baseBrightness: 0.34,
  heatBrightness: 0.78,
  flareBoost: 1.6,
  noiseScale: [0.07, 0.14] as const,
  noiseDrift: [0.045, 0.02] as const,
  /** Fade-in of the whole canvas after the first frame, in seconds. */
  fadeIn: 1.1,
} as const;

export const FIGURE = {
  discs: 6,
  fov: 32,
  cameraZ: 12,
  radialSegments: 56,
  thickness: 0.15,
  bobAmp: 0.025,
  spinBase: 0.32,
  spinStep: 0.035,
  phase: 1.1,
  /** Pointer parallax on the whole stack. */
  parallax: { tiltX: 0.2, yaw: 0.45, roll: 0.12, ease: 0.06 },
  /** Scale of the slot-filling hero stack relative to the slot, height then width. */
  heroFit: { h: 4.3, w: 2.3, spread: 0.64, tx: 0.4 },
  split: {
    phone: { pos: [0, 0.04], s: 0.5, spread: 1, lx: 0.7 },
    desktop: { pos: [0.06, 0], s: 0.4, spread: 0.78, lx: 1.1 },
    tx: 0.95,
    tz: 0.45,
  },
  cluster: {
    phone: { front: { p: [-0.4, 0.08], s: 0.46 }, back: { p: [0.56, 0.26], s: 0.25 } },
    desktop: { front: { p: [-0.5, 0.16], s: 0.3 }, back: { p: [0.56, 0.32], s: 0.19 } },
    depth: -2.5,
    spread: 0.7,
    tx: 0.45,
    tz: 0.1,
    lift: { x: 0.32, rx: -0.35 },
  },
  contact: {
    phone: { pos: [0.42, 0.4], s: 0.3 },
    desktop: { pos: [0.64, 0.2], s: 0.3 },
    tx: 0.42,
    tz: -0.15,
    spread: 0.62,
  },
  /** Group labels above the two clusters. */
  labelLift: 1.55,
  labelOffsetY: 10,
  /** Brightness of the figure while a section other than hero, experience and contact is on. */
  parkedObject: 0.22,
  parkedGrid: 0.6,
  contactGrid: 0.8,
  /** The code grid behind the Stack section: stronger than the parked value. */
  stackGrid: 1,
} as const;

export const BITS = {
  max: 4000,
  maxPointSize: 62,
} as const;

/** Liquid melt (decision 12): hover on the hero name, desktop mouse only, after the intro. */
export const MELT = {
  /** Reach of the melt around the pointer, css px. */
  radius: 190,
  /** Heat per second chasing its target while the pointer is near / after it left. */
  rise: 4.2,
  fall: 3.0,
  /** A letter is plain DOM text again below this heat. */
  off: 0.012,
  /** Droplets pulled off a hot letter: per second, gravity (px/s2), life (s). */
  dropRate: 9,
  dropGravity: 420,
  dropLife: [0.55, 1.0] as const,
  /** Cell padding around a letter, in em: sides, above the cap line, below the baseline. */
  pad: { x: 0.35, top: 0.25, bottom: 0.75 },
  /** Largest atlas side (px) and the largest render scale of the letter atlas. */
  maxAtlas: 4096,
  maxScale: 2,
  /** No frame for this long while a letter is melted: the DOM text comes back. */
  watchdogMs: 1500,
} as const;

export const NAME = {
  maxParticles: 16000,
  /** Stacked extrusion layers behind the face, and their step in em. */
  layers: 6,
  step: 0.03,
  /** Target particle count: ~13.5k desktop, ~7.8k phone. */
  target: { desktop: 13500, phone: 7800 },
  subMin: 2,
  subMax: 8,
  /** DOM cross-fade after the bits lock, in seconds. */
  entryFade: 0.32,
  /** If the intro has not handed over by then (ms after it starts), the text shows anyway. */
  introMaxMs: 3500,
  /** Share of the scroll each bit takes to blow away. */
  dustSpan: 0.38,
  /** Font pixel grid: one pixel is 1/11 em. */
  pixelsPerEm: 11,
  /** Probe canvas for the glyph pixels. */
  probe: { cols: 7, rows: 15, baseline: 11, unit: 10, w: 70, h: 150 },
  entry: {
    fromGrid: 0.46,
    delay: { base: 0.03, byX: 0.17, byWord: 0.06, jitter: 0.1 },
    duration: [0.5, 0.7] as const,
    bend: 0.38,
    sizeGrid: { max: 4.5, mul: 1.3, share: [0.25, 0.5] as const },
    sizeEdge: { max: 4, mul: [1.1, 1.8] as const },
    colorWeights: [0.5, 0.78] as const,
  },
  dust: {
    noiseWeight: 0.5,
    sweepWeight: 0.5,
    jitter: 0.012,
    windDrift: [1, -0.5] as const,
    windSpread: 0.95,
    stepShare: [0.08, 0.2] as const,
    stepGrowth: 0.35,
    wobble: [7, 5] as const,
  },
} as const;

/** Project names: a tap or hover bursts the letters into bits that settle back (S3). */
export const PROJECTS_BURST = {
  /** Scroll-dust value at the peak (0 = whole, 1 = gone); bits are mid-flight here. */
  peak: 0.45,
  upS: 0.5,
  downS: 1.0,
  /** How far the bits travel: near the name, not across the screen. */
  reach: 0.3,
  spread: 0.3,
} as const;

/** Under this width, or on a short coarse screen (a phone turned sideways: the 600px stage would not
 * fit), Experience is a plain list. motion-scenes.css repeats both halves (a test keeps them equal): no stage, no counter, no scroll-driven reveal. */
export const PHONE_QUERY = `(width < ${PERF.phoneWidth}px), (pointer: coarse) and (max-height: 500px)`;

export const SCROLL = {
  lenis: { lerp: 0.11, smoothWheel: true },
  anchorDuration: 1.6,
  /** The hero's hold (90svh) and each chapter's scroll (60svh) are reserved in sections/motion-scenes.css, so the
   * page has its final length from the first paint; the timelines read them back from the DOM. */
  hero: { scrub: 0.7, dustAt: 0.05, dustLen: 0.8 },
  experienceScrub: 0.7,
  /** Experience stops (desktop and tablet): where inside a chapter's 60svh the view rests (0.4 =
   * letters settled, meta in, dust not started); mirrored in motion-scenes.css (76svh = 100svh -
   * 0.4 * 60svh) for the native snap. */
  snap: {
    at: 0.4,
    /** A move shorter than this (px) from a stop goes back to it: a nudge is not a step. */
    nudge: 24,
    /** Lenis glide to a stop, in seconds. */
    duration: 0.9,
    /** Quiet time (ms) after the last scroll before a stop is chosen. */
    settleMs: 140,
  },
  talkScrub: 0.5,
  contactScrub: 0.7,
  dissolveScrub: 0.6,
  /** Tumble-in of the company letters. */
  letters: {
    y: 70,
    rot: 22,
    stagger: 0.05,
    dur: 0.11,
    /** The readable plateau runs from the settled letters to the dust: about 0.55 of a chapter. */
    dustAt: 0.78,
    dustLen: 0.2,
  },
} as const;

export const EXTRUSION = {
  base: [0.72, 0.8] as const,
  pointer: [0.5, 0.35] as const,
  scrollWave: [2.2, 1.7] as const,
  scrollAmp: [0.28, 0.18] as const,
  yBias: -0.1,
  ease: 0.18,
  /** Quantised to 1/25 = 0.04 so style recalculation stays rare. */
  quant: 25,
  settle: 0.01,
} as const;
