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

export interface MeltGate {
  letters: number;
  settled: boolean;
  slow: boolean;
  phone: boolean;
  dust: number;
  motion: boolean;
  paused: boolean;
  noHide: boolean;
}

/** May a letter melt at all this frame? Anything false puts the plain DOM text back. */
export function meltAllowed(g: MeltGate): boolean {
  return (
    g.letters > 0 &&
    g.settled &&
    !g.slow &&
    !g.phone &&
    g.dust < 0.0005 &&
    g.motion &&
    !g.paused &&
    !g.noHide
  );
}

/** Closeness 0..1 of the pointer to a letter box [l, t, r, b] (viewport px); 0 beyond the radius. */
export function nearness(
  box: readonly [number, number, number, number],
  px: number,
  py: number,
  radius: number = MELT.radius,
): number {
  const dx = Math.max(box[0] - px, 0, px - box[2]);
  const dy = Math.max(box[1] - py, 0, py - box[3]);
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

export interface Drop {
  y: number;
  v: number;
  life: number;
  alpha: number;
}

/** One droplet step; `alpha` 0 means it is gone (life over, or it fell past the cell bottom). */
export function stepDrop(d: Drop, dt: number, cellH: number): Drop {
  const life = d.life - dt;
  const v = d.v + MELT.dropGravity * dt;
  const y = d.y + v * dt;
  if (life <= 0 || y > cellH - 4) return { y, v, life, alpha: 0 };
  return { y, v, life, alpha: clamp01(life * 2.2) };
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
