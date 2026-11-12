// Small pure helpers shared by the scene modules.
import { NAME } from './config.ts';

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
export const ss = (t: number): number => t * t * (3 - 2 * t);
export const smooth = (a: number, b: number, v: number): number => ss(clamp01((v - a) / (b - a)));
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const hash2 = (x: number, y: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/** Value noise on a unit lattice, 0..1. */
export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Linear mix of two numeric records with the same keys (pose mixing). */
export function mixRecord<T extends Record<string, number>>(a: T, b: T, t: number): T {
  const out: Record<string, number> = {};
  for (const k of Object.keys(a)) out[k] = lerp(a[k] as number, b[k] as number, t);
  return out as T;
}

/**
 * Each font pixel of the name is split into sub x sub square bits. The side count follows the
 * target particle count and is bounded so a tiny name still reads and a huge one stays cheap.
 */
export function subdivision(fontPixels: number, target: number): number {
  const raw = Math.round(Math.sqrt(target / Math.max(1, fontPixels)));
  return Math.max(NAME.subMin, Math.min(NAME.subMax, raw));
}

/** Cell grid for the code background: whole cells that tile the canvas. */
export function gridSize(
  width: number,
  height: number,
  cellW: number,
  cellH: number,
  min: number,
): { cols: number; rows: number } {
  return {
    cols: Math.max(min, Math.round(width / cellW)),
    rows: Math.max(min, Math.round(height / cellH)),
  };
}
