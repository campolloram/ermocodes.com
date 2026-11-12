// The living code grid: per-cell glyph state on the CPU, uploaded as a small data texture. Heat
// reacts near the pointer and flares glitch the glyphs.
import { DataTexture, NearestFilter, RGBAFormat } from 'three';
import { GRID } from '../config.ts';
import { ptr } from './pointer.ts';
import { view } from './view.ts';

interface Cells {
  cols: number;
  rows: number;
  N: number;
  glyph: Uint8Array;
  base: Float32Array;
  flare: Float32Array;
  heat: Float32Array;
  data: Uint8Array;
  tex: DataTexture;
}

const randomGlyph = (): number =>
  Math.random() < GRID.emptyChance ? 0 : 1 + ((Math.random() * GRID.glyphs.length) | 0);

export function createGrid(onTexture: (t: DataTexture) => void): {
  cells: () => Cells | null;
  build: (cols: number, rows: number) => void;
  update: (dt: number) => void;
  write: () => void;
} {
  let C: Cells | null = null;

  function write(): void {
    if (!C) return;
    const { N, glyph, base, flare, heat, data } = C;
    for (let i = 0, j = 0; i < N; i += 1, j += 4) {
      data[j] = glyph[i]!;
      data[j + 1] = Math.min(255, (base[i]! + flare[i]! * GRID.flareBoost) * 160);
      data[j + 2] = Math.min(255, heat[i]! * 255);
    }
    C.tex.needsUpdate = true;
  }

  function build(cols: number, rows: number): void {
    const N = cols * rows;
    const glyph = new Uint8Array(N);
    const base = new Float32Array(N);
    for (let i = 0; i < N; i += 1) {
      glyph[i] = randomGlyph();
      base[i] = 0.25 + Math.random() * 0.75;
    }
    const data = new Uint8Array(N * 4);
    const tex = new DataTexture(data, cols, rows, RGBAFormat);
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.generateMipmaps = false;
    C?.tex.dispose();
    C = {
      cols,
      rows,
      N,
      glyph,
      base,
      flare: new Float32Array(N),
      heat: new Float32Array(N),
      data,
      tex,
    };
    write();
    onTexture(tex);
  }

  function update(dt: number): void {
    if (!C) return;
    const { cols, rows, N, glyph, flare, heat } = C;
    const swaps = (N * GRID.swapRate * dt) | 0;
    for (let j = 0; j < swaps; j += 1) {
      const i = (Math.random() * N) | 0;
      glyph[i] = randomGlyph();
      if (Math.random() < GRID.flareChance) flare[i] = 1;
    }
    if (ptr.on > 0.01) {
      const cw = view.W / cols;
      const chh = view.H / rows;
      const reach = view.phone ? GRID.heatReach.phone : GRID.heatReach.desktop;
      const pc = ptr.cx / cw;
      const pr = (view.H - ptr.cy) / chh;
      const c0 = Math.max(0, Math.floor(pc - reach / cw));
      const c1 = Math.min(cols - 1, Math.ceil(pc + reach / cw));
      const r0 = Math.max(0, Math.floor(pr - reach / chh));
      const r1 = Math.min(rows - 1, Math.ceil(pr + reach / chh));
      for (let r = r0; r <= r1; r += 1) {
        for (let q = c0; q <= c1; q += 1) {
          const d = Math.hypot((q + 0.5 - pc) * cw, (r + 0.5 - pr) * chh) / reach;
          if (d >= 1) continue;
          const i = r * cols + q;
          const hv = (1 - d) * (1 - d) * ptr.on;
          if (hv > heat[i]!) heat[i] = hv;
          if (Math.random() < hv * GRID.heatSwapChance)
            glyph[i] = 1 + ((Math.random() * GRID.glyphs.length) | 0);
        }
      }
      ptr.on *= Math.exp(-dt * GRID.pointerDecay);
    }
    const fd = Math.exp(-dt * GRID.flareDecay);
    const hd = Math.exp(-dt * GRID.heatDecay);
    for (let i = 0; i < N; i += 1) {
      flare[i] = flare[i]! * fd;
      heat[i] = heat[i]! * hd;
    }
    write();
  }

  return { cells: () => C, build, update, write };
}
