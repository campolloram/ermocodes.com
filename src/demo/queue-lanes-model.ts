// Queue demo lanes (cherry-picked from the P9 case study, restyled for Moss): task glyphs flowing
// through one lane per worker. Pure geometry and timing here (Vitest); drawing and
// the direct callbacks live in queue-lanes.ts.
import type { WorkerId } from '../sim/orchestrator/types.ts';

export const LANES = 3;
export const GLYPHS_PER_LANE = 12;
/** Brand cap: ambient canvases draw at most 30 frames a second. */
export const FRAME_MS = 1000 / 30;
/** Glyph speed in px per second. */
const SPEED = 28;
/** Gap between glyphs of one lane, as a share of the lane width. */
const MARGIN = 20;
/** --dur-slow: a lost lane's red flash. */
const FLASH_MS = 480;
/** The stutter's step (4 steps, like --ease-steps) and amplitude. */
const STUTTER_STEP_MS = 40;
const STUTTER_STEPS = 6;
const STUTTER_PX = 3;
const RING_MS = 1200;
const RING_MAX_RADIUS = 14;

const WORKER_LANE: Readonly<Record<WorkerId, number>> = { w1: 0, w2: 1, w3: 2 };

export function laneOf(worker: WorkerId): number {
  return WORKER_LANE[worker];
}

/** Glyph `index`'s x at time `t` (ms): even spacing, a per-lane offset, wrapping past the edge. */
export function glyphX(index: number, t: number, width: number, lane = 0): number {
  const span = width + MARGIN * 2;
  const offset = ((index + lane * 0.37) / GLYPHS_PER_LANE) * span;
  const travelled = (t / 1000) * SPEED * (1 + lane * 0.18);
  return ((offset + travelled) % span) - MARGIN;
}

/** The lost lane's red flash: 1 at the kill, linear to 0 over FLASH_MS. */
export function flashAlpha(elapsed: number): number {
  if (elapsed < 0 || elapsed >= FLASH_MS) return 0;
  return 1 - elapsed / FLASH_MS;
}

/** A few discrete side-to-side steps right after the kill, then still. */
export function stutterPx(elapsed: number): number {
  const step = Math.floor(elapsed / STUTTER_STEP_MS);
  if (elapsed < 0 || step >= STUTTER_STEPS) return 0;
  return step % 2 === 0 ? STUTTER_PX : -STUTTER_PX;
}

/** A back-off ring: grows while it fades. */
export function ringState(elapsed: number): { radius: number; alpha: number } {
  const p = Math.min(1, Math.max(0, elapsed / RING_MS));
  return { radius: 4 + p * (RING_MAX_RADIUS - 4), alpha: 1 - p };
}

export function frameDue(lastDrawn: number, now: number): boolean {
  return now - lastDrawn >= FRAME_MS;
}
