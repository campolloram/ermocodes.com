// The hero name as particles. On load it forms from pixel bits that stream in from the grid and
// off-screen, then hands over to the solid DOM headline; the hover is the liquid melt (melt.ts);
// on scroll it blows away as dust (scrubbed, so scrolling back re-forms it). The DOM name stays
// the source of truth: particles only draw while something is happening.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
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
import { NAME, PERF } from '../config.ts';
import { setLetterHidden } from '../dom/split.ts';
import { clamp01, hash2, lerp, rand, smooth, subdivision, vnoise } from '../math.ts';
import { extrusion, heroDust, type Letter } from '../state.ts';
import { pixelsOf } from './pixels.ts';
import { colors } from './renderer.ts';
import nameFrag from './shaders/name.frag.glsl?raw';
import nameVert from './shaders/name.vert.glsl?raw';
import { view } from './view.ts';

export interface ParticleName {
  scene: Scene;
  start: () => void;
  resize: (buffer: Vector2) => void;
  update: (time: number) => number;
  freeze: (t: number) => void;
  count: () => number;
  /** Re-sample on the next frame (tier change, resize). */
  invalidate: () => void;
  /** The intro has handed over to the DOM text and its cross-fade is over: the melt may start. */
  settled: () => boolean;
  /** Bits drawn in the last frame (0 outside the intro and the scroll dust). */
  drawn: () => number;
}

export function createParticleName(
  letters: Letter[],
  nameEl: HTMLElement,
  words: HTMLElement[],
): ParticleName {
  const html = document.documentElement;
  const { layers: LAYERS, maxParticles: MAXP, step: ST } = NAME;
  const NL = letters.length;

  /* GPU side: one buffer, drawn 7 times (6 extrusion layers back to front, then the face) */
  const geo = new BufferGeometry();
  const gPos = new Float32Array(MAXP * 3);
  const gCol = new Float32Array(MAXP * 4);
  const gDep = new Float32Array(MAXP);
  const aP = new BufferAttribute(gPos, 3).setUsage(DynamicDrawUsage);
  const aC = new BufferAttribute(gCol, 4).setUsage(DynamicDrawUsage);
  const aD = new BufferAttribute(gDep, 1).setUsage(DynamicDrawUsage);
  geo.setAttribute('position', aP);
  geo.setAttribute('aC', aC);
  geo.setAttribute('aD', aD);
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new Sphere(new Vector3(), 1e9);
  const uOff = { value: new Vector2() };
  const uRes = { value: new Vector2(1, 1) };
  const cs = getComputedStyle(html);
  const css = (n: string) => new Color(cs.getPropertyValue(n).trim());
  const layerCol: (Color | null)[] = [
    null,
    css('--x1'),
    css('--x1'),
    css('--x2'),
    css('--x2'),
    css('--x3'),
    css('--x3'),
  ];
  const scene = new Scene();
  for (let k = LAYERS; k >= 0; k -= 1) {
    const mat = new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: { uK: { value: k }, uOff, uRes, uCol: { value: layerCol[k] ?? new Color() } },
      vertexShader: nameVert,
      fragmentShader: nameFrag,
    });
    const pts = new Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = LAYERS - k;
    scene.add(pts);
  }

  /* CPU side: per-bit state */
  const F = () => new Float32Array(MAXP);
  const hx = F();
  const hy = F();
  const esx = F(),
    esy = F(),
    ecx = F(),
    ecy = F(),
    edl = F(),
    edu = F(),
    esz = F();
  const ecr = F(),
    ecg = F(),
    ecb = F();
  const dst = F(),
    d1x = F(),
    d1y = F(),
    d2x = F(),
    d2y = F(),
    d3x = F(),
    d3y = F();
  const dcr = F(),
    dcg = F(),
    dcb = F(),
    dph = F();
  const lHide = new Uint8Array(NL);
  let N = 0;
  let s = 2;
  let fs = 60;
  let entryEnd = 0;

  const pick = (r: number): Color =>
    r < NAME.entry.colorWeights[0]
      ? colors.acc
      : r < NAME.entry.colorWeights[1]
        ? colors.sig
        : colors.hi;

  function buildEntry(i: number, nr: DOMRect, word: number): void {
    const E = NAME.entry;
    const X = nr.left + hx[i]!;
    const Y = nr.top + hy[i]!;
    let sx: number;
    let sy: number;
    if (Math.random() < E.fromGrid) {
      const cw = view.W / view.cols;
      const chh = view.H / view.rows;
      sx = (Math.floor(Math.random() * view.cols) + 0.5) * cw;
      sy = (Math.floor(Math.random() * view.rows) + 0.5) * chh;
      esz[i] = Math.min(
        E.sizeGrid.max,
        Math.max(s * E.sizeGrid.mul, cw * rand(...E.sizeGrid.share)),
      );
    } else {
      const side = Math.random();
      if (side < 0.36) {
        sx = -rand(30, 260);
        sy = rand(-0.1, 1.1) * view.H;
      } else if (side < 0.72) {
        sx = view.W + rand(30, 260);
        sy = rand(-0.1, 1.1) * view.H;
      } else if (side < 0.86) {
        sx = rand(0, view.W);
        sy = -rand(30, 200);
      } else {
        sx = rand(0, view.W);
        sy = view.H + rand(30, 200);
      }
      esz[i] = Math.min(E.sizeEdge.max, s * rand(...E.sizeEdge.mul));
    }
    const dx = X - sx;
    const dy = Y - sy;
    const m = Math.hypot(dx, dy) || 1;
    const bend = rand(-E.bend, E.bend) * m;
    esx[i] = sx - nr.left;
    esy[i] = sy - nr.top;
    ecx[i] = (sx + X) / 2 - (dy / m) * bend - nr.left;
    ecy[i] = (sy + Y) / 2 + (dx / m) * bend - nr.top;
    edl[i] =
      E.delay.base +
      E.delay.byX * Math.min(1, X / view.W) +
      E.delay.byWord * word +
      Math.random() * E.delay.jitter;
    edu[i] = rand(...E.duration);
    const c0 = pick(Math.random());
    ecr[i] = c0.r;
    ecg[i] = c0.g;
    ecb[i] = c0.b;
  }

  /* dust: each bit breaks off at its own moment (noise + right-to-left sweep) and rides a wind field */
  function buildDust(i: number, nr: DOMRect, xn: number): void {
    const D = NAME.dust;
    const X = nr.left + hx[i]!;
    const Y = nr.top + hy[i]!;
    const n = vnoise(X * 0.012, Y * 0.012) * 0.75 + vnoise(X * 0.035, Y * 0.035) * 0.25;
    dst[i] =
      Math.min(
        1,
        Math.max(0, D.noiseWeight * n + D.sweepWeight * (1 - xn) + rand(-D.jitter, D.jitter)),
      ) *
      (1 - NAME.dustSpan);
    let qx = X;
    let qy = Y;
    const P: number[] = [];
    for (let k = 0; k < 3; k += 1) {
      const a = vnoise(qx * 0.0035 + 7.1, qy * 0.0035 + 3.3) * Math.PI * 3.2;
      const wx = D.windDrift[0] + Math.cos(a) * D.windSpread;
      const wy = D.windDrift[1] + Math.sin(a) * D.windSpread;
      const wm = Math.hypot(wx, wy) || 1;
      const step = rand(...D.stepShare) * Math.max(view.W, 600) * (1 + k * D.stepGrowth);
      qx += (wx / wm) * step;
      qy += (wy / wm) * step;
      P.push(qx - X, qy - Y);
    }
    d1x[i] = P[0]!;
    d1y[i] = P[1]!;
    d2x[i] = P[2]!;
    d2y[i] = P[3]!;
    d3x[i] = P[4]!;
    d3y[i] = P[5]!;
    const c = pick(Math.random() * 0.9 + 0.1);
    dcr[i] = c.r;
    dcg[i] = c.g;
    dcb[i] = c.b;
    dph[i] = Math.random() * 6.283;
  }

  /* sample the name: every font pixel of every glyph, split into sub x sub square bits */
  function build(): void {
    if (!NL) return;
    const nr = nameEl.getBoundingClientRect();
    fs = parseFloat(getComputedStyle(words[0]!).fontSize) || 60;
    const u = fs / NAME.pixelsPerEm;
    let nPix = 0;
    for (const Lt of letters) nPix += pixelsOf(Lt.c).length;
    const tier = PERF.tiers[view.tier] ?? PERF.tiers[0]!;
    const target = (view.phone ? NAME.target.phone : NAME.target.desktop) * tier.particles;
    const sub = subdivision(nPix, target);
    s = u / sub;
    N = 0;
    let minX = 1e9;
    let maxX = -1e9;
    letters.forEach((Lt) => {
      const r = Lt.ch.getBoundingClientRect();
      const base = Lt.bl.getBoundingClientRect().top;
      const word = Lt.ch.closest('.w2') ? 1 : 0;
      for (const [c, rr] of pixelsOf(Lt.c)) {
        if (N + sub * sub > MAXP) return;
        for (let a2 = 0; a2 < sub; a2 += 1) {
          for (let b2 = 0; b2 < sub; b2 += 1) {
            const i = N++;
            hx[i] = r.left - nr.left + c * u + (a2 + 0.5) * s;
            hy[i] = base - nr.top + rr * u + (b2 + 0.5) * s;
            minX = Math.min(minX, hx[i]!);
            maxX = Math.max(maxX, hx[i]!);
            buildEntry(i, nr, word);
          }
        }
      }
    });
    const span = Math.max(1, maxX - minX);
    entryEnd = 0;
    for (let i = 0; i < N; i += 1) {
      buildDust(i, nr, (hx[i]! - minX) / span);
      entryEnd = Math.max(entryEnd, edl[i]! + edu[i]!);
    }
  }

  /* DOM hand-over */
  let t0 = -1;
  let entryOn = false;
  let handed = false;
  let frozen = -1;
  let built = false;
  let drawn = 0;

  function hideLetter(l: number, h: number): void {
    if (lHide[l] === h) return;
    lHide[l] = h;
    setLetterHidden(letters[l]!, Boolean(h));
  }
  const showAll = () => {
    for (let l = 0; l < NL; l += 1) hideLetter(l, 0);
  };
  // The DOM name is laid out but not drawn (html.pwait, then html.pbuild) until the bits have
  // gathered into it; then the crisp text fades in over the bits (the concept's hand-over). Past
  // the head script's safety timeout the page already shows the text, and there is no intro.
  function start(): void {
    if (!html.classList.contains('pwait') || !NL) {
      handed = true;
      return;
    }
    html.classList.replace('pwait', 'pbuild');
    entryOn = true;
    // Whatever happens to the frames, the text shows by then.
    window.setTimeout(() => html.classList.remove('pbuild'), NAME.introMaxMs);
  }
  function handOver(): void {
    handed = true;
    if (!html.classList.contains('pbuild')) return;
    html.classList.add('pshow');
    html.classList.remove('pbuild');
    window.setTimeout(() => html.classList.remove('pshow'), NAME.entryFade * 1000 + 60);
  }

  /** One frame: returns how many bits to draw. */
  function update(time: number): number {
    if (!NL) return 0;
    const p = heroDust.p;
    const dust = p > 0.0005;
    if (!entryOn && !dust) {
      showAll();
      drawn = 0;
      return 0;
    }
    // Fully blown away (every bit's dust has run out and faded): nothing to sample or draw, so
    // the rest of the page pays no per-bit loop and a tier change rebuilds only on the way back.
    const spent = p >= 1;
    if (!built && !spent) {
      build();
      built = true;
    }
    if (entryOn && t0 < 0) t0 = time;
    const et = frozen >= 0 ? frozen : entryOn ? time - t0 : 1e9;
    const entryLive = entryOn && et < entryEnd + NAME.entryFade;
    if (entryOn && !handed && et >= entryEnd) handOver();
    if (entryOn && et >= entryEnd + NAME.entryFade) entryOn = false;

    const nr = nameEl.getBoundingClientRect();
    /* which letters must be particles this frame: none unless the entry or the dust runs */
    if (!entryOn) for (let l = 0; l < NL; l += 1) hideLetter(l, dust ? 1 : 0);
    if (spent || (!entryLive && !dust)) {
      geo.setDrawRange(0, 0);
      drawn = 0;
      return 0;
    }

    const dpr = view.dpr;
    uOff.value.set(extrusion.x * ST * fs * dpr, extrusion.y * ST * fs * dpr);
    const fr = colors.paper.r,
      fg = colors.paper.g,
      fb = colors.paper.b;
    const flick = Math.floor(time * 24);
    let o = 0;
    for (let i = 0; i < N; i += 1) {
      const X = nr.left + hx[i]!;
      const Y = nr.top + hy[i]!;
      let x = X,
        y = Y,
        size = s,
        r = fr,
        g = fg,
        b = fb,
        a = 1,
        d = 1;

      /* entry */
      if (entryLive) {
        const q = clamp01((et - edl[i]!) / edu[i]!);
        if (q <= 0) continue;
        if (q < 1) {
          const e = 1 - Math.pow(1 - q, 4);
          const u1 = 1 - e;
          x = u1 * u1 * (nr.left + esx[i]!) + 2 * u1 * e * (nr.left + ecx[i]!) + e * e * X;
          y = u1 * u1 * (nr.top + esy[i]!) + 2 * u1 * e * (nr.top + ecy[i]!) + e * e * Y;
          size = lerp(esz[i]!, s, smooth(0.25, 0.85, q));
          const cm = smooth(0.5, 0.95, q);
          r = lerp(ecr[i]!, fr, cm);
          g = lerp(ecg[i]!, fg, cm);
          b = lerp(ecb[i]!, fb, cm);
          a = smooth(0, 0.1, q);
          if (q < 0.7) a *= 0.55 + 0.45 * hash2(i, flick);
          d = smooth(0.75, 1, q);
        }
      }

      /* dust */
      if (dust) {
        const st = dst[i]!;
        const q = clamp01((p - st) / NAME.dustSpan);
        if (q <= 0) {
          const glow = smooth(st - 0.03, st, p) * 0.7;
          if (glow > 0) {
            r = lerp(r, colors.sig.r, glow);
            g = lerp(g, colors.sig.g, glow);
            b = lerp(b, colors.sig.b, glow);
          }
        } else {
          const e = Math.pow(q, 1.35),
            u1 = 1 - e;
          const c1 = 3 * u1 * u1 * e,
            c2 = 3 * u1 * e * e,
            c3 = e * e * e;
          x +=
            c1 * d1x[i]! +
            c2 * d2x[i]! +
            c3 * d3x[i]! +
            Math.sin(time * 1.6 + dph[i]!) * NAME.dust.wobble[0] * q;
          y +=
            c1 * d1y[i]! +
            c2 * d2y[i]! +
            c3 * d3y[i]! +
            Math.cos(time * 1.3 + dph[i]!) * NAME.dust.wobble[1] * q;
          const cm = smooth(0, 0.3, q);
          r = lerp(colors.sig.r, dcr[i]!, cm);
          g = lerp(colors.sig.g, dcg[i]!, cm);
          b = lerp(colors.sig.b, dcb[i]!, cm);
          size *= 1 - 0.55 * smooth(0, 0.55, q);
          a *= 1 - smooth(0.35, 1, q);
          d *= 1 - smooth(0, 0.1, q);
          if (a < 0.01) continue;
        }
      }

      const k3 = o * 3,
        k4 = o * 4;
      gPos[k3] = x * dpr;
      gPos[k3 + 1] = y * dpr;
      gPos[k3 + 2] = Math.max(1, size * dpr + 0.45);
      gCol[k4] = r;
      gCol[k4 + 1] = g;
      gCol[k4 + 2] = b;
      gCol[k4 + 3] = a;
      gDep[o] = d;
      o += 1;
    }
    geo.setDrawRange(0, o);
    drawn = o;
    if (o) {
      aP.needsUpdate = true;
      aC.needsUpdate = true;
      aD.needsUpdate = true;
    }
    return o;
  }

  return {
    scene,
    start,
    resize(buffer) {
      uRes.value.copy(buffer);
      built = false;
    },
    update,
    freeze(t) {
      frozen = t;
    },
    count: () => N,
    settled: () =>
      handed && !entryOn && !html.classList.contains('pbuild') && !html.classList.contains('pshow'),
    drawn: () => drawn,
    invalidate() {
      built = false;
    },
  };
}
