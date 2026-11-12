// Each glyph's ink on the font's own pixel grid (Departure Mono: 1 px = 1/11 em, baseline at
// row 11), sampled once from a probe canvas and cached.
import { NAME } from '../config.ts';
import { canvasFont } from '../font.ts';

const cache = new Map<string, [number, number][]>();
let ctx: CanvasRenderingContext2D | null = null;

export function pixelsOf(ch: string): [number, number][] {
  const hit = cache.get(ch);
  if (hit) return hit;
  const P = NAME.probe;
  if (!ctx) {
    const probe = document.createElement('canvas');
    probe.width = P.w;
    probe.height = P.h;
    ctx = probe.getContext('2d', { willReadFrequently: true })!;
  }
  ctx.clearRect(0, 0, P.w, P.h);
  ctx.font = canvasFont(NAME.pixelsPerEm * P.unit);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ch, 0, P.baseline * P.unit);
  const d = ctx.getImageData(0, 0, P.w, P.h).data;
  const out: [number, number][] = [];
  for (let r = 0; r < P.rows; r += 1) {
    for (let c = 0; c < P.cols; c += 1) {
      const px = c * P.unit + P.unit / 2;
      const py = r * P.unit + P.unit / 2;
      if ((d[(py * P.w + px) * 4 + 3] as number) > 127) out.push([c, r - P.baseline]);
    }
  }
  cache.set(ch, out);
  return out;
}
