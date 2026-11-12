// Bits: groups of DOM letters that dissolve into (or form from) pixel bits on the canvas.
import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DynamicDrawUsage,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import { BITS } from '../config.ts';
import { setLetterHidden } from '../dom/split.ts';
import { clamp01, easeInOut, lerp, rand, smooth } from '../math.ts';
import { type BitsGroup, groups } from '../state.ts';
import { pixelsOf } from './pixels.ts';
import { colors } from './renderer.ts';
import bitsFrag from './shaders/bits.frag.glsl?raw';
import bitsVert from './shaders/bits.vert.glsl?raw';
import { view } from './view.ts';

interface Pt {
  rx: number;
  ry: number;
  u: number;
  li: number;
  delay: number;
  ax: number;
  ay: number;
  tx: number;
  ty: number;
  amp: number;
  tone: number;
}
interface Built {
  pts: Pt[];
  ld: number[];
}

export function createBits() {
  const scene = new Scene();
  const geo = new BufferGeometry();
  const bPos = new Float32Array(BITS.max * 3);
  const bA = new Float32Array(BITS.max * 4);
  const bB = new Float32Array(BITS.max * 2);
  const aPos = new BufferAttribute(bPos, 3).setUsage(DynamicDrawUsage);
  const aA = new BufferAttribute(bA, 4).setUsage(DynamicDrawUsage);
  const aB = new BufferAttribute(bB, 2).setUsage(DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aA', aA);
  geo.setAttribute('aB', aB);
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new Sphere(new Vector3(), 1e9);
  const mat = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    uniforms: {
      uRes: { value: new Vector2(1, 1) },
      cA: { value: colors.acc },
      cB: { value: colors.sig },
      cP: { value: colors.paper },
      cX: { value: colors.x1 },
    },
    vertexShader: bitsVert,
    fragmentShader: bitsFrag,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  function buildGroup(g: BitsGroup): void {
    const ar = g.anchor.getBoundingClientRect();
    const pts: Pt[] = [];
    const lrect = g.letters.map((Lt) => Lt.ch.getBoundingClientRect());
    let minX = 1e9;
    let maxX = -1e9;
    let minY = 1e9;
    let maxY = -1e9;
    for (const r of lrect) {
      minX = Math.min(minX, r.left);
      maxX = Math.max(maxX, r.right);
      minY = Math.min(minY, r.top);
      maxY = Math.max(maxY, r.bottom);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const span = Math.max(1, maxX - minX);
    const ld: number[] = [];
    g.letters.forEach((Lt, li) => {
      const r = lrect[li]!;
      const u = parseFloat(getComputedStyle(Lt.ch).fontSize) / 11;
      const base = Lt.bl.getBoundingClientRect().top;
      const delay = ((r.left + r.width / 2 - minX) / span) * 0.28;
      ld.push(delay);
      for (const [c, rr] of pixelsOf(Lt.c)) {
        const hx = r.left + (c + 0.5) * u;
        const hy = base + (rr + 0.5) * u;
        const dx = hx - cx + rand(-30, 30);
        const dy = hy - cy + rand(-30, 30);
        const m = Math.hypot(dx, dy) || 1;
        const reach = rand(0.25, 0.75) * view.H * g.reach;
        pts.push({
          rx: hx - ar.left,
          ry: hy - ar.top,
          u,
          li,
          delay: delay + rand(0, 0.1),
          ax: (dx / m) * reach * 0.6,
          ay: (dy / m) * reach * 0.4 - view.H * rand(0.12, 0.4) * g.reach,
          tx: hx + (rand(0, view.W) - hx) * g.spread,
          ty:
            hy + ((g.mode === 'in' ? rand(0, view.H) : rand(view.H * 0.2, view.H)) - hy) * g.spread,
          tone: Math.random(),
          amp: Math.random() < 0.18 ? rand(0.6, 1) : rand(0, 0.4),
        });
      }
    });
    g.built = { pts, ld } satisfies Built;
  }

  function drawGroup(o: number, g: BitsGroup, cellPx: number): number {
    const d = g.mode === 'in' ? 1 - g.p : g.p;
    if (d <= 0.0005) {
      if (g.on) {
        g.letters.forEach((Lt) => setLetterHidden(Lt, false));
        g.on = false;
        g.built = null;
      }
      return o;
    }
    g.on = true;
    if (d >= 0.999) {
      g.letters.forEach((Lt) => setLetterHidden(Lt, true));
      g.built = null;
      return o;
    }
    if (!g.built) buildGroup(g);
    const { pts, ld } = g.built as Built;
    g.letters.forEach((Lt, li) => setLetterHidden(Lt, d > (ld[li] as number)));
    const ar = g.anchor.getBoundingClientRect();
    const dpr = view.dpr;
    for (let i = 0; i < pts.length && o < BITS.max; i += 1) {
      const P = pts[i]!;
      if (!(d > (ld[P.li] as number))) continue;
      const q = clamp01((d - P.delay) / 0.6);
      if (q >= 1) continue;
      const hx = ar.left + P.rx;
      const hy = ar.top + P.ry;
      const e = easeInOut(q);
      const u1 = 1 - e;
      const x = u1 * u1 * hx + 2 * u1 * e * (hx + P.ax) + e * e * P.tx;
      const y = u1 * u1 * hy + 2 * u1 * e * (hy + P.ay) + e * e * P.ty;
      const bump = Math.sin(q * Math.PI);
      // Hard square bits: they grow a little mid-flight and shrink to nothing at the end (no fade).
      const size =
        lerp(P.u * 1.04, Math.max(P.u, cellPx * 0.55), smooth(0, 0.3, q)) *
        (1 + bump * P.amp) *
        (1 - smooth(0.6, 1, q));
      const k3 = o * 3;
      const k4 = o * 4;
      const k2 = o * 2;
      bPos[k3] = x * dpr;
      bPos[k3 + 1] = y * dpr;
      bPos[k3 + 2] = Math.max(1, Math.round(Math.min(BITS.maxPointSize, size * dpr)));
      bA[k4] = 0;
      bA[k4 + 1] = size * dpr < 0.75 ? 0 : 1;
      bA[k4 + 2] = 0;
      bA[k4 + 3] = Math.pow(1 - smooth(0, 0.4, q), 1.4);
      bB[k2] = P.tone;
      bB[k2 + 1] = g.tint;
      o += 1;
    }
    return o;
  }

  /** Fills the buffers for every group; returns the bit count. */
  function update(cellPx: number): number {
    let n = 0;
    for (const g of groups) n = drawGroup(n, g, cellPx);
    if (n) {
      aPos.needsUpdate = true;
      aA.needsUpdate = true;
      aB.needsUpdate = true;
    }
    geo.setDrawRange(0, n);
    return n;
  }

  return {
    scene,
    update,
    setRes(v: Vector2) {
      (mat.uniforms.uRes!.value as Vector2).copy(v);
    },
    invalidate() {
      for (const g of groups) g.built = null;
    },
  };
}
