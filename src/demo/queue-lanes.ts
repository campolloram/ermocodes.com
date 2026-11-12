// Canvas 2D lanes for the queue demo: one lane per worker, task glyphs flowing while the worker is
// busy, a flash and stutter when it dies, a ring on each redelivery. At most 30 fps, DPR capped
// at 2, and it draws only while the demo is told it is running (the controller pauses it
// off-screen and in hidden tabs). Colours come from the Moss tokens; no events bus, plain calls.
import { canvasFont } from '../motion/font.ts';
import type { WorkerId, WorkerState } from '../sim/orchestrator/types.ts';
import {
  GLYPHS_PER_LANE,
  LANES,
  flashAlpha,
  frameDue,
  glyphX,
  laneOf,
  ringState,
  stutterPx,
} from './queue-lanes-model.ts';

const MAX_DPR = 2;
const GLYPH_W = 10;
const GLYPH_H = 4;
const LABEL_W = 34;
/** Room for the word "idle" before an idle lane's line. */
const IDLE_W = 42;
const EFFECT_MS = 1500;
const MAX_RINGS = 8;
const IDS: readonly WorkerId[] = ['w1', 'w2', 'w3'];

interface Effect {
  lane: number;
  start: number;
}

export interface Lanes {
  /** Sets each worker's state; busy lanes carry glyphs. */
  setWorkers: (states: Record<WorkerId, WorkerState>) => void;
  killed: (w: WorkerId) => void;
  redelivered: (w: WorkerId) => void;
  /** Starts or stops the 30fps loop; stopped, it draws one frame. */
  run: (on: boolean) => void;
  clear: () => void;
}

export function createLanes(canvas: HTMLCanvasElement): Lanes | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const c2d = ctx;
  let states: Record<WorkerId, WorkerState> = { w1: 'idle', w2: 'idle', w3: 'idle' };
  let flashes: Effect[] = [];
  let rings: Effect[] = [];
  let raf = 0;
  let running = false;
  let last = 0;
  let col = { line: '', glyph: '', hot: '', warn: '', mute: '' };

  const readColors = (): void => {
    const st = getComputedStyle(canvas);
    const t = (n: string) => st.getPropertyValue(n).trim();
    col = {
      line: t('--rule'),
      glyph: t('--acc'),
      hot: t('--hi'),
      warn: t('--sig'),
      mute: t('--mute'),
    };
  };
  const laneY = (lane: number, h: number) => Math.round(((lane + 1) * h) / (LANES + 1)) + 0.5;

  function draw(now: number): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    c2d.clearRect(0, 0, w, h);
    flashes = flashes.filter((f) => now - f.start < EFFECT_MS);
    rings = rings.filter((r) => now - r.start < EFFECT_MS);
    c2d.font = canvasFont(12);
    c2d.textBaseline = 'middle';
    for (let lane = 0; lane < LANES; lane += 1) {
      const id = IDS[lane] as WorkerId;
      const state = states[id];
      const y = laneY(lane, h);
      const fl = flashes.find((f) => f.lane === lane);
      const elapsed = fl ? now - fl.start : -1;
      const hot = flashAlpha(elapsed);
      const shake = stutterPx(elapsed);
      const dead = state === 'dead';
      // An idle worker says so, so the lanes at rest read as waiting workers, not a broken chart.
      const idle = state === 'idle' && hot <= 0;
      c2d.strokeStyle = hot > 0 ? col.hot : col.line;
      c2d.setLineDash(dead ? [3, 5] : []);
      c2d.beginPath();
      c2d.moveTo(idle ? LABEL_W + IDLE_W : LABEL_W, y);
      c2d.lineTo(w, y);
      c2d.stroke();
      c2d.setLineDash([]);
      c2d.fillStyle = dead ? col.warn : col.mute;
      c2d.fillText(dead ? 'x' + id.slice(1) : id, 0, y);
      if (idle) c2d.fillText('idle', LABEL_W, y);
      if (state === 'busy' || hot > 0) {
        c2d.fillStyle = hot > 0 ? col.hot : col.glyph;
        const span = w - LABEL_W;
        for (let i = 0; i < GLYPHS_PER_LANE; i += 1) {
          const x = LABEL_W + glyphX(i, now, span, lane) + shake;
          c2d.fillRect(x, y - GLYPH_H / 2, GLYPH_W, GLYPH_H);
        }
      } else if (state === 'booting') {
        c2d.fillStyle = col.warn;
        c2d.fillRect(LABEL_W + 4, y - 2, 6, 4);
      }
    }
    c2d.strokeStyle = col.warn;
    for (const r of rings) {
      const { radius, alpha } = ringState(now - r.start);
      c2d.globalAlpha = alpha;
      c2d.beginPath();
      c2d.arc(w * 0.55, laneY(r.lane, h), radius, 0, Math.PI * 2);
      c2d.stroke();
    }
    c2d.globalAlpha = 1;
  }

  function tick(now: number): void {
    if (frameDue(last, now)) {
      last = now;
      draw(now);
    }
    if (running) raf = requestAnimationFrame(tick);
  }

  function resize(): void {
    const dpr = Math.min(MAX_DPR, devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    readColors();
    if (!running) draw(performance.now());
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    setWorkers(s) {
      states = s;
      if (!running) draw(performance.now());
    },
    killed(w) {
      flashes = [...flashes, { lane: laneOf(w), start: performance.now() }];
    },
    redelivered(w) {
      rings = [...rings, { lane: laneOf(w), start: performance.now() }].slice(-MAX_RINGS);
    },
    run(on) {
      if (on === running) return;
      running = on;
      cancelAnimationFrame(raf);
      if (on) raf = requestAnimationFrame(tick);
      else draw(performance.now());
    },
    clear() {
      flashes = [];
      rings = [];
      draw(performance.now());
    },
  };
}
