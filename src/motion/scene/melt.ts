// Liquid melt: the hero name melts under the mouse (decision 12; an original implementation of the
// "liquid melt" look the founder picked). Decoration only: the DOM letters keep their text, their
// place and their accessible name; while a letter melts its DOM glyph is hidden (visibility) and
// one quad of the shared WebGL context draws it from a canvas atlas. Nothing else about the page
// changes: no layout change, no second context.
//
// A letter melts only when all of these hold: the particle intro has handed over, a fine mouse is
// near, the visitor has not paused motion, the hero is not blowing away as dust, the page is on
// the motion path and the viewport is not a phone. Anything else puts the plain DOM text back at
// once (`release`), and a watchdog does the same if the frames stop while a letter is melted.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CustomBlending,
  DoubleSide,
  LinearFilter,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { MELT, NAME } from '../config.ts';
import { letterGuard, setLetterHidden } from '../dom/split.ts';
import { canvasFont } from '../font.ts';
import { clamp01, rand } from '../math.ts';
import { extrusion, heroDust, type Letter } from '../state.ts';
import { pixelsOf } from './pixels.ts';
import { mouse } from './pointer.ts';
import meltFrag from './shaders/melt.frag.glsl?raw';
import meltVert from './shaders/melt.vert.glsl?raw';
import { view } from './view.ts';

export interface Melt {
  scene: Scene;
  /** One frame; returns how many letters it draws (0 = nothing to render). */
  update: (time: number, dt: number, settled: boolean, slow: boolean) => number;
  /** The layout changed: rebuild the atlas when it is next needed. */
  resize: () => void;
  /** Start listening for a shader that fails to compile or link (call before compileAsync/prime). */
  watch: (r: WebGLRenderer) => void;
  /** Links the shader program with a two-pixel draw, so the first hover does not pay for it. */
  prime: (r: WebGLRenderer, cam: Camera) => void;
  /** Letters currently drawn by the melt. */
  active: () => number;
}

const DROPS = 3;

const FALLBACK_RGB: readonly [number, number, number] = [245, 246, 240];

/**
 * "#rgb", "#rrggbb", "rgb(r, g, b)" or "rgba(...)" to 0..1 floats (what the DOM paints, with no
 * colour conversion). Anything else (oklch(), a name, an empty token) gets the paper colour.
 */
export function rgb(css: string): Vector3 {
  const t = css.trim();
  let c: readonly number[] = FALLBACK_RGB;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((x) => x + x).join('') : hex[1]!;
    const n = parseInt(h, 16);
    c = [n >> 16, (n >> 8) & 255, n & 255];
  } else if (fn) c = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return new Vector3(c[0]! / 255, c[1]! / 255, c[2]! / 255);
}

interface Cell {
  mesh: Mesh;
  rect: { value: Vector4 };
  atlas: { value: Vector4 };
  ink: { value: Vector2 };
  centre: { value: Vector2 };
  heat: { value: number };
  drops: { value: Vector4[] };
  /** Cell origin relative to the name box, and the letter's box there (css px). */
  x0: number;
  y0: number;
  box: [number, number, number, number];
  /** Droplets (cell-local css px): position, fall speed, radius, alpha, life left. */
  dx: Float32Array;
  dy: Float32Array;
  dv: Float32Array;
  dr: Float32Array;
  da: Float32Array;
  dl: Float32Array;
}

export function createMelt(letters: Letter[], nameEl: HTMLElement): Melt {
  const root = document.documentElement;
  const NL = letters.length;
  const scene = new Scene();
  const quad = new BufferGeometry();
  quad.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0]),
      3,
    ),
  );

  const atlas = { value: null as CanvasTexture | null };
  const uView = { value: new Vector2(1, 1) };
  const uTime = { value: 0 };
  const uExt = { value: new Vector2() };
  const uE = { value: 60 };
  const uFace = { value: new Vector3(0.96, 0.96, 0.94) };
  const token = (n: string) => ({ value: rgb(getComputedStyle(root).getPropertyValue(n)) });
  const shared = {
    tAtlas: atlas,
    uView,
    uTime,
    uExt,
    uE,
    uFace,
    uR: { value: MELT.radius },
    uX1: token('--x1'),
    uX2: token('--x2'),
    uX3: token('--x3'),
    uAcc: token('--acc'),
    uHi: token('--hi'),
    uSig: token('--sig'),
  };

  const cells: Cell[] = letters.map((_, i) => {
    const rect = { value: new Vector4() };
    const at = { value: new Vector4() };
    const ink = { value: new Vector2() };
    const centre = { value: new Vector2() };
    const heat = { value: 0 };
    const drops = { value: Array.from({ length: DROPS }, () => new Vector4()) };
    const mat = new ShaderMaterial({
      transparent: true,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        ...shared,
        uRect: rect,
        uAtlas: at,
        uInk: ink,
        uC: centre,
        uHeat: heat,
        uSeed: { value: i * 7.31 + 1.7 },
        // An M keeps the DOM's three shallow layers so its notch does not read as an N.
        uM: { value: /m/i.test(letters[i]!.c) ? 1 : 0 },
        uDrop: drops,
      },
      vertexShader: meltVert,
      fragmentShader: meltFrag,
    });
    const mesh = new Mesh(quad, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    const f = () => new Float32Array(DROPS);
    return {
      mesh,
      rect,
      atlas: at,
      ink,
      centre,
      heat,
      drops,
      x0: 0,
      y0: 0,
      box: [0, 0, 0, 0],
      dx: f(),
      dy: f(),
      dv: f(),
      dr: f(),
      da: f(),
      dl: f(),
    };
  });
  /** 1 while the melt has hidden that letter's DOM glyph. */
  const hid = new Uint8Array(NL);

  let ready = false;
  let scheduled = false;
  /** Why the melt is off for good (until a resize): the atlas cannot be built, or the shader failed. */
  let off = '';
  let shaderBroken = false;
  let prevOnShaderError: WebGLRenderer['debug']['onShaderError'] = null;
  function disable(reason: string): void {
    off = reason;
    nameEl.dataset.mmelt = `off:${reason}`;
  }
  let fs = 60;
  let cw = 0;
  let ch = 0;
  let lastFrame = 0;
  let activeN = 0;
  let cx = 0;
  let cy = 0;
  let speed = 0;
  let lastX = 0;
  let lastY = 0;
  let watchdog = 0;

  /** Draws every letter once into a canvas atlas and measures where each one sits. */
  function build(): void {
    scheduled = false;
    if (!NL || !letters[0]!.ch.isConnected) return disable('detached');
    const nr = nameEl.getBoundingClientRect();
    const cs = getComputedStyle(letters[0]!.ch.closest('.w') ?? nameEl);
    fs = parseFloat(cs.fontSize) || 60;
    uFace.value.copy(rgb(cs.color));
    const P = MELT.pad;
    cw = Math.ceil(
      Math.max(...letters.map((l) => l.ch.getBoundingClientRect().width)) + 2 * P.x * fs,
    );
    ch = Math.ceil(fs * (1 + P.top + P.bottom));
    const baseLocal = fs * (1 + P.top);
    // The atlas scale follows the pixel ratio, kept inside the texture limit.
    let sc = Math.min(view.dpr, MELT.maxScale);
    let cols = 1;
    for (;;) {
      cols = Math.max(1, Math.min(NL, Math.floor(MELT.maxAtlas / (cw * sc + 2)), 6));
      const rows = Math.ceil(NL / cols);
      if (rows * (ch * sc + 2) <= MELT.maxAtlas && cols * (cw * sc + 2) <= MELT.maxAtlas) break;
      sc *= 0.85;
      if (sc < 0.4) return disable('atlas-size');
    }
    const cellW = Math.ceil(cw * sc) + 2;
    const cellH = Math.ceil(ch * sc) + 2;
    const AW = cols * cellW;
    const AH = Math.ceil(NL / cols) * cellH;
    const canvas = document.createElement('canvas');
    canvas.width = AW;
    canvas.height = AH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return disable('no-2d');
    ctx.font = canvasFont(fs * sc);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    letters.forEach((l, i) => {
      const c = cells[i]!;
      const ox = (i % cols) * cellW + 1;
      const oy = Math.floor(i / cols) * cellH + 1;
      ctx.fillText(l.c, ox + P.x * fs * sc, oy + baseLocal * sc);
      const r = l.ch.getBoundingClientRect();
      const base = l.bl.getBoundingClientRect().top;
      c.x0 = r.left - nr.left - P.x * fs;
      c.y0 = base - nr.top - baseLocal;
      c.box = [r.left - nr.left, base - nr.top - fs, r.right - nr.left, base - nr.top];
      c.atlas.value.set(ox / AW, oy / AH, (cw * sc) / AW, (ch * sc) / AH);
      c.rect.value.set(0, 0, cw, ch);
      c.ink.value.set(P.top * fs, baseLocal);
    });
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    atlas.value?.dispose();
    atlas.value = tex;
    uE.value = fs;
    ready = true;
  }

  /** The atlas is built when the browser is idle, after the intro: the first hover finds it ready. */
  function schedule(): void {
    if (scheduled || ready) return;
    scheduled = true;
    const idle = (
      window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }
    ).requestIdleCallback;
    if (idle) idle(build, { timeout: 1500 });
    else window.setTimeout(build, 200);
  }

  /** Every letter back to its plain DOM text at once (the dust keeps the letters it owns). */
  function release(): void {
    for (let i = 0; i < NL; i += 1) {
      const c = cells[i]!;
      c.heat.value = 0;
      c.da.fill(0);
      c.mesh.visible = false;
      if (hid[i]) {
        hid[i] = 0;
        if (heroDust.p <= 0.0005) setLetterHidden(letters[i]!, false);
      }
    }
    activeN = 0;
    lastFrame = 0;
    delete nameEl.dataset.melt;
    window.clearInterval(watchdog);
    watchdog = 0;
  }

  /** If the frames stop while a letter is melted (hidden tab, a stalled loop), the text comes back. */
  function arm(): void {
    if (watchdog) return;
    watchdog = window.setInterval(() => {
      if (performance.now() - lastFrame > MELT.watchdogMs) release();
    }, MELT.watchdogMs / 2);
  }

  /** Pulls a droplet off a font pixel near the pointer, preferring the lowest of three picks. */
  function spawn(c: Cell, i: number, nr: DOMRect): void {
    const slot = Array.prototype.findIndex.call(c.da, (a: number) => a <= 0);
    if (slot < 0) return;
    const px = pixelsOf(letters[i]!.c);
    if (!px.length) return;
    const u = fs / 11;
    let best = px[Math.floor(Math.random() * px.length)]!;
    for (let k = 0; k < 2; k += 1) {
      const cand = px[Math.floor(Math.random() * px.length)]!;
      if (cand[1] > best[1]) best = cand;
    }
    const x = MELT.pad.x * fs + (best[0] + 0.5) * u;
    const y = c.ink.value.y + (best[1] + 0.5) * u;
    if (Math.hypot(nr.left + c.x0 + x - cx, nr.top + c.y0 + y - cy) > MELT.radius * 0.9) return;
    c.dx[slot] = x;
    c.dy[slot] = y;
    c.dv[slot] = rand(10, 40);
    c.dr[slot] = u * rand(0.55, 0.95);
    c.da[slot] = 1;
    c.dl[slot] = rand(...MELT.dropLife);
  }

  function update(time: number, dt: number, settled: boolean, slow: boolean): number {
    const allowed =
      NL > 0 &&
      settled &&
      !slow &&
      !view.phone &&
      heroDust.p < 0.0005 &&
      root.classList.contains('motion') &&
      !root.classList.contains('mpaused') &&
      !letterGuard.noHide;
    if (!allowed) {
      if (activeN || watchdog) release();
      return 0;
    }
    if (off || shaderBroken) {
      if (activeN || watchdog) release();
      return 0;
    }
    if (!ready) {
      schedule();
      return 0;
    }
    const mOn = mouse.on;
    if (!mOn && !activeN) {
      lastFrame = 0;
      return 0;
    }
    // Heat follows the wall clock, not the frame's clamped step: on a CPU-starved page (software GL)
    // a frame can take half a second, and the letters must still come back within a second or two.
    const now = performance.now();
    const wall = Math.min(0.5, lastFrame ? (now - lastFrame) / 1000 : dt);
    lastFrame = now;
    const nr = nameEl.getBoundingClientRect();
    if (mOn) {
      cx = mouse.x;
      cy = mouse.y;
      speed += (Math.hypot(cx - lastX, cy - lastY) / Math.max(dt, 0.001) - speed) * 0.2;
    } else speed *= 0.9;
    lastX = cx;
    lastY = cy;
    uTime.value = time;
    uView.value.set(view.W, view.H);
    uExt.value.set(extrusion.x * NAME.step * fs, extrusion.y * NAME.step * fs);
    let n = 0;
    for (let i = 0; i < NL; i += 1) {
      const c = cells[i]!;
      const b = c.box;
      const dxo = Math.max(nr.left + b[0] - cx, 0, cx - (nr.left + b[2]));
      const dyo = Math.max(nr.top + b[1] - cy, 0, cy - (nr.top + b[3]));
      const near = mOn ? clamp01(1 - Math.hypot(dxo, dyo) / MELT.radius) : 0;
      const target = near > 0 ? 0.35 + 0.65 * near : 0;
      const h0 = c.heat.value;
      let h = h0 + (target - h0) * (1 - Math.exp(-wall * (target > h0 ? MELT.rise : MELT.fall)));
      if (target === 0 && h < MELT.off) h = 0;
      c.heat.value = h;

      let live = 0;
      for (let d = 0; d < DROPS; d += 1) {
        if (c.da[d]! > 0) {
          c.dl[d] = c.dl[d]! - dt;
          c.dv[d] = c.dv[d]! + MELT.dropGravity * dt;
          c.dy[d] = c.dy[d]! + c.dv[d]! * dt;
          if (c.dl[d]! <= 0 || c.dy[d]! > ch - 4) c.da[d] = 0;
          else {
            c.da[d] = clamp01(c.dl[d]! * 2.2);
            live += 1;
          }
        }
        const rad = Math.max(1, c.dr[d]! * (0.6 + 0.4 * c.da[d]!));
        c.drops.value[d]!.set(c.dx[d]!, c.dy[d]!, rad, c.da[d]!);
      }
      const rate = MELT.dropRate * h * h * (0.4 + clamp01(speed / 500));
      if (mOn && h > 0.45 && Math.random() < rate * dt) spawn(c, i, nr);

      const need = h > 0 || live > 0;
      if (need) {
        c.rect.value.set(nr.left + c.x0, nr.top + c.y0, cw, ch);
        c.centre.value.set(cx - (nr.left + c.x0), cy - (nr.top + c.y0));
        n += 1;
      }
      c.mesh.visible = need;
      if (need !== Boolean(hid[i])) {
        hid[i] = need ? 1 : 0;
        setLetterHidden(letters[i]!, need);
      }
    }
    if (n) {
      arm();
      if (!nameEl.dataset.melt) nameEl.dataset.melt = '1';
    } else {
      window.clearInterval(watchdog);
      watchdog = 0;
      delete nameEl.dataset.melt;
    }
    activeN = n;
    return n;
  }

  return {
    scene,
    update,
    resize() {
      ready = false;
      if (off) {
        off = '';
        delete nameEl.dataset.mmelt;
      }
      release();
    },
    watch(r) {
      prevOnShaderError = r.debug.onShaderError;
      r.debug.onShaderError = (...args) => {
        shaderBroken = true;
        nameEl.dataset.mmelt = 'off:shader';
        console.warn('melt shader failed to compile or link; the hero name stays plain DOM text');
        prevOnShaderError?.(...args);
      };
    },
    prime(r, cam) {
      const c = cells[0];
      if (!c) return;
      uView.value.set(view.W, view.H);
      c.rect.value.set(0, 0, 2, 2);
      c.mesh.visible = true;
      r.render(scene, cam);
      c.mesh.visible = false;
      r.debug.onShaderError = prevOnShaderError;
    },
    active: () => activeN,
  };
}
