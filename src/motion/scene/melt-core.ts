// Pure maths for the hero-name melt (no three, no DOM), so it runs under vitest without WebGL.
import { MELT } from '../config.ts';
import { clamp01 } from '../math.ts';

export const FALLBACK_RGB: readonly [number, number, number] = [245, 246, 240];

/** "#rgb", "#rrggbb", "rgb(r, g, b)" or "rgba(...)" to 0..255 channels; anything else gets paper. */
export function parseCssRgb(css: string): readonly [number, number, number] {
  const t = css.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((x) => x + x).join('') : hex[1]!;
    const n = parseInt(h, 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return FALLBACK_RGB;
}

/** The two root-class checks of the gate, so tests can pass a plain stub. */
export interface ClassProbe {
  contains(name: string): boolean;
}

/**
 * May a letter melt at all this frame? Anything false puts the plain DOM text back.
 * Plain arguments and `&&` order: no object per frame, and the DOM class reads only run once
 * the cheap checks passed.
 */
export function meltAllowed(
  letters: number,
  settled: boolean,
  slow: boolean,
  phone: boolean,
  dust: number,
  classes: ClassProbe,
  noHide: boolean,
): boolean {
  return (
    letters > 0 &&
    settled &&
    !slow &&
    !phone &&
    dust < 0.0005 &&
    classes.contains('motion') &&
    !classes.contains('mpaused') &&
    !noHide
  );
}

/** Closeness 0..1 of the pointer to a letter box (left, top, right, bottom in viewport px); 0 beyond the radius. */
export function nearness(
  l: number,
  t: number,
  r: number,
  b: number,
  px: number,
  py: number,
  radius: number = MELT.radius,
): number {
  const dx = Math.max(l - px, 0, px - r);
  const dy = Math.max(t - py, 0, py - b);
  return clamp01(1 - Math.hypot(dx, dy) / radius);
}

/** Heat the letter chases: 0 when the pointer is away, 0.35..1 when near. */
export function heatTarget(near: number): number {
  return near > 0 ? 0.35 + 0.65 * near : 0;
}

/** One heat step toward its target; snaps to 0 below `MELT.off` once the target is 0. */
export function stepHeat(h0: number, target: number, wall: number): number {
  const h = h0 + (target - h0) * (1 - Math.exp(-wall * (target > h0 ? MELT.rise : MELT.fall)));
  return target === 0 && h < MELT.off ? 0 : h;
}

/** Droplets per second for a letter at heat `h` and pointer speed (px/s). */
export function dropRate(h: number, speed: number): number {
  return MELT.dropRate * h * h * (0.4 + clamp01(speed / 500));
}

/**
 * One droplet step in place on the cell's Float32Arrays (slot `i`), no allocation. Each value is
 * stored (float32-rounded) before the next line reads it, exactly as the inline loop did.
 * Sets alpha to 0 when it is gone (life over, or it fell past the cell bottom); returns "still live".
 */
export function stepDrop(
  dy: Float32Array,
  dv: Float32Array,
  dl: Float32Array,
  da: Float32Array,
  i: number,
  dt: number,
  cellH: number,
): boolean {
  dl[i] = dl[i]! - dt;
  dv[i] = dv[i]! + MELT.dropGravity * dt;
  dy[i] = dy[i]! + dv[i]! * dt;
  if (dl[i]! <= 0 || dy[i]! > cellH - 4) {
    da[i] = 0;
    return false;
  }
  da[i] = clamp01(dl[i]! * 2.2);
  return true;
}

/** Drawn radius: shrinks to 60% as the droplet fades, never under 1 px. */
export function dropRadius(r: number, alpha: number): number {
  return Math.max(1, r * (0.6 + 0.4 * alpha));
}

/** Of three random picks keep the lowest font pixel (largest y); the earlier pick wins ties. */
export function lowestPick(
  px: readonly (readonly [number, number])[],
  rnd: () => number = Math.random,
): readonly [number, number] | undefined {
  if (!px.length) return undefined;
  let best = px[Math.floor(rnd() * px.length)]!;
  for (let k = 0; k < 2; k += 1) {
    const cand = px[Math.floor(rnd() * px.length)]!;
    if (cand[1] > best[1]) best = cand;
  }
  return best;
}

export interface AtlasPlan {
  scale: number;
  cols: number;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
}

/**
 * Atlas layout: the render scale follows the pixel ratio (<= MELT.maxScale) and shrinks by 15%
 * until the grid fits `MELT.maxAtlas`; null (melt off, "atlas-size") below a 0.4 scale.
 */
export function planAtlas(n: number, cw: number, ch: number, dpr: number): AtlasPlan | null {
  let sc = Math.min(dpr, MELT.maxScale);
  for (;;) {
    const cols = Math.max(1, Math.min(n, Math.floor(MELT.maxAtlas / (cw * sc + 2)), 6));
    const rows = Math.ceil(n / cols);
    if (rows * (ch * sc + 2) <= MELT.maxAtlas && cols * (cw * sc + 2) <= MELT.maxAtlas) {
      const cellW = Math.ceil(cw * sc) + 2;
      const cellH = Math.ceil(ch * sc) + 2;
      return { scale: sc, cols, cellW, cellH, width: cols * cellW, height: rows * cellH };
    }
    sc *= 0.85;
    if (sc < 0.4) return null;
  }
}
