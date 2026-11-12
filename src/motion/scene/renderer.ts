// The WebGL stage: renderer, the low-res target the figure draws into, and the GPU ASCII pass that
// turns it (plus the living code grid) into glyphs.
import {
  CanvasTexture,
  Color,
  LinearFilter,
  Mesh,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three';
import { COLORS, GRID, PERF } from '../config.ts';
import { canvasFont } from '../font.ts';
import { dprFor, isSoftwareRenderer } from '../tier.ts';
import { gridSize } from '../math.ts';
import asciiFrag from './shaders/ascii.frag.glsl?raw';
import asciiVert from './shaders/ascii.vert.glsl?raw';
import { view } from './view.ts';

export const MASKS = 4;
const ALL = GRID.ramp + GRID.edge + GRID.glyphs;

export const colors = {
  acc: new Color(),
  sig: new Color(),
  hi: new Color(),
  paper: new Color(),
  x1: new Color(),
};

export function syncColors(): void {
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string) => cs.getPropertyValue(n).trim();
  colors.acc.set(g(COLORS.acc));
  colors.sig.set(g(COLORS.sig));
  colors.hi.set(g(COLORS.hi));
  colors.paper.set(g(COLORS.paper));
  colors.x1.set(g(COLORS.x1));
}

export interface Stage {
  renderer: WebGLRenderer;
  rt: WebGLRenderTarget;
  quadScene: Scene;
  quadCam: OrthographicCamera;
  asciiMat: ShaderMaterial;
  maskRects: Vector4[];
  /** WebGL runs on a software rasteriser (SwiftShader, llvmpipe): no GPU behind it. */
  software: boolean;
  /** Re-reads the canvas size and rebuilds the atlas and render targets. Returns the grid size. */
  resize: (canvas: HTMLCanvasElement) => void;
}

/** Throws when WebGL is unavailable; the caller falls back to plain DOM. */
export function createStage(canvas: HTMLCanvasElement): Stage {
  // Ask for the context ourselves: when WebGL is missing this fails quietly, where three would
  // log a console error before throwing.
  const attrs: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    powerPreference: 'default',
  };
  const gl = canvas.getContext('webgl2', attrs);
  if (!gl) throw new Error('WebGL unavailable');
  // Chromium masks RENDERER ("WebKit WebGL") behind the debug extension; Firefox gives the real
  // (sanitised) name and warns that the extension is deprecated, so it is asked for only when masked.
  let glName = String(gl.getParameter(gl.RENDERER) ?? '');
  if (/^webkit/i.test(glName)) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) glName = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '');
  }
  const software = isSoftwareRenderer(glName);
  const renderer = new WebGLRenderer({ canvas, context: gl, ...attrs });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  syncColors();

  const rt = new WebGLRenderTarget(2, 2, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
  });
  const quadScene = new Scene();
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tri = new BufferGeometry();
  tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const maskRects = Array.from({ length: MASKS }, () => new Vector4(-9, -9, -9, -9));
  const asciiMat = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    defines: { MASKS },
    uniforms: {
      tScene: { value: rt.texture },
      tAtlas: { value: null },
      tData: { value: null },
      uCells: { value: new Vector2(1, 1) },
      uRes: { value: new Vector2(1, 1) },
      uN: { value: ALL.length },
      uRamp: { value: GRID.ramp.length },
      uEdge0: { value: GRID.ramp.length },
      uGrid0: { value: GRID.ramp.length + GRID.edge.length },
      uTime: { value: 0 },
      uGrid: { value: 1 },
      uObj: { value: 1 },
      uFade: { value: 0 },
      uMask: { value: maskRects },
      uMaskS: { value: new Array(MASKS).fill(0) },
      uSoft: { value: 10 },
      uNoiseScale: { value: new Vector2(...GRID.noiseScale) },
      uNoiseDrift: { value: new Vector2(...GRID.noiseDrift) },
      uGridBright: { value: new Vector2(GRID.baseBrightness, GRID.heatBrightness) },
      cA: { value: colors.acc },
      cB: { value: colors.sig },
      cH: { value: colors.hi },
    },
    vertexShader: asciiVert,
    fragmentShader: asciiFrag,
  });
  quadScene.add(new Mesh(tri, asciiMat));

  function buildAtlas(): void {
    const tier = PERF.tiers[view.tier] ?? PERF.tiers[0]!;
    const fontPx = GRID.fontPx * tier.cell;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const fpx = fontPx * view.dpr;
    ctx.font = canvasFont(fpx);
    view.cellW = Math.max(GRID.minCellW, Math.round(ctx.measureText('M').width / view.dpr));
    view.cellH = Math.round(fontPx * GRID.cellHeightRatio);
    const cw = view.cellW * view.dpr;
    const ch = view.cellH * view.dpr;
    c.width = Math.ceil(cw * ALL.length);
    c.height = Math.ceil(ch);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = canvasFont(fpx);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < ALL.length; i += 1)
      ctx.fillText(ALL[i] as string, (i + 0.5) * cw, ch * 0.54);
    const tex = new CanvasTexture(c);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    (asciiMat.uniforms.tAtlas!.value as CanvasTexture | null)?.dispose();
    asciiMat.uniforms.tAtlas!.value = tex;
  }

  function resize(cv: HTMLCanvasElement): void {
    view.W = cv.clientWidth || innerWidth;
    view.H = cv.clientHeight || innerHeight;
    view.phone = view.W < PERF.phoneWidth;
    view.dpr = dprFor(window.devicePixelRatio || 1, view.phone, view.tier);
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(view.W, view.H, false);
    buildAtlas();
    const { cols, rows } = gridSize(view.W, view.H, view.cellW, view.cellH, GRID.minCells);
    view.cols = cols;
    view.rows = rows;
    rt.setSize(cols, rows);
    asciiMat.uniforms.uCells!.value.set(cols, rows);
    const buf = renderer.getDrawingBufferSize(new Vector2());
    asciiMat.uniforms.uRes!.value.copy(buf);
    asciiMat.uniforms.uSoft!.value = (buf.y / rows) * 0.9;
  }

  return { renderer, rt, quadScene, quadCam, asciiMat, maskRects, software, resize };
}
