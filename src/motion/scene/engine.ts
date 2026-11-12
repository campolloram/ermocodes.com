// Wires the stage, figure, grid, bits and particle name into one render function. Everything
// here needs WebGL; boot.ts imports it dynamically after first paint and falls back to plain DOM
// when createStage throws.
import { type Camera, type Points, type Scene, Vector2 } from 'three';
import { FIGURE, GRID, PERF } from '../config.ts';
import { lerp, smooth, ss, clamp01 } from '../math.ts';
import { clusterPose } from '../poses.ts';
import { refs, scene as S } from '../state.ts';
import { yieldTask } from '../loop.ts';
import { lastTier } from '../tier.ts';
import { createBits } from './bits.ts';
import { createFigure } from './figure.ts';
import { createGrid } from './grid.ts';
import { createMelt, type Melt } from './melt.ts';
import { updateMasks } from './masks.ts';
import { createParticleName, type ParticleName } from './particle-name.ts';
import { bindPointer, ptr } from './pointer.ts';
import { createStage, type Stage } from './renderer.ts';
import { view } from './view.ts';

export interface Engine {
  render: (timeMs: number, dt: number) => void;
  /** Rebuild sizes after a resize or a tier change. */
  relayout: () => void;
  setTier: (tier: number) => void;
  name: ParticleName | null;
  /** Liquid melt of the hero name (decoration; null in reduced motion). */
  melt: Melt | null;
  stage: Stage;
  /** The starting tier: the asked one, or the last on a software rasteriser. */
  tier: number;
  /**
   * Compiles every shader, without blocking the main thread where KHR_parallel_shader_compile
   * exists, one program per task.
   */
  warm: () => Promise<void>;
  /** Draws one static frame (reduced motion). */
  still: () => void;
  onActivity: (fn: () => void) => void;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  reduce: boolean;
  tier: number;
  /** Runs once the WebGL context exists and before the DOM is read (motion DOM prep). */
  prepare?: () => void;
}

/**
 * Rejects when WebGL is unavailable, before anything in the DOM changed. The set-up runs as a few
 * short tasks rather than one long one, so a phone stays responsive while the engine starts.
 */
export async function createEngine({
  canvas,
  reduce,
  tier,
  prepare,
}: EngineOptions): Promise<Engine> {
  const stage = createStage(canvas);
  await yieldTask();
  prepare?.();
  await yieldTask();
  // Software GL renders every frame on the CPU (and headless Chromium reads each one back at
  // commit), so it starts on the lightest tier instead of dropping to it mid-scroll.
  view.tier = stage.software ? lastTier : tier;
  const figure = createFigure();
  const bits = createBits();
  const grid = createGrid((t) => {
    stage.asciiMat.uniforms.tData!.value = t;
  });
  await yieldTask();
  const heroEl = document.querySelector<HTMLElement>('.hero')!;
  const slotEl = document.querySelector<HTMLElement>('.fig-slot')!;
  const nameEl = heroEl.querySelector<HTMLElement>('.name')!;
  const words = [...nameEl.querySelectorAll<HTMLElement>('.w')];
  const heroLetters = refs.hero ? [...refs.hero[0], ...refs.hero[1]] : [];
  const name = reduce ? null : createParticleName(heroLetters, nameEl, words);
  // The melt is for a fine mouse on a non-phone screen only; elsewhere it is never built, so no
  // shader compile, atlas or idle task is spent on it.
  const wantsMelt =
    matchMedia('(hover: hover) and (pointer: fine)').matches && innerWidth >= PERF.phoneWidth;
  const melt = name && wantsMelt && heroLetters.length ? createMelt(heroLetters, nameEl) : null;
  const clBig = document.getElementById('cl-big');
  const clSt = document.getElementById('cl-st');
  const countEl = document.querySelector('.count');
  let activity: () => void = () => {};

  if (!reduce) bindPointer(() => activity());

  function relayout(): void {
    stage.resize(canvas);
    const hr = heroEl.getBoundingClientRect();
    const sr = slotEl.getBoundingClientRect();
    figure.resize({
      cx: sr.left + sr.width / 2,
      cy: sr.top - hr.top + sr.height / 2,
      w: sr.width,
      h: sr.height,
    });
    const buf = stage.renderer.getDrawingBufferSize(new Vector2());
    bits.setRes(buf);
    bits.invalidate();
    grid.build(view.cols, view.rows);
    name?.resize(buf);
    melt?.resize();
  }

  let lastT = 0;
  let fadeT0 = -1;
  const placeLabel = (
    el: HTMLElement,
    p: ReturnType<typeof clusterPose>,
    op: number,
    front: number,
    color: string,
  ) => {
    // The chips keep their cluster's x but share one row under the stage counter, so they read as
    // part of the counter's group read-out and not as loose tags over the figures.
    const { x } = figure.project(p);
    const y = (countEl?.getBoundingClientRect().bottom ?? 90) + 44;
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
    el.style.opacity = op.toFixed(3);
    el.style.color = front > 0.5 ? color : 'var(--mute)';
  };

  function render(timeMs: number): void {
    const time = timeMs * 0.001;
    const dt = Math.min(0.05, lastT ? time - lastT : 0.016);
    lastT = time;
    ptr.x += (ptr.tx - ptr.x) * FIGURE.parallax.ease;
    ptr.y += (ptr.ty - ptr.y) * FIGURE.parallax.ease;
    figure.update(time, ptr, reduce);
    if (!reduce) grid.update(dt);
    const u = stage.asciiMat.uniforms;
    u.uTime!.value = reduce ? 0 : time;
    u.uGrid!.value = S.grid;
    u.uObj!.value = S.obj;
    updateMasks(stage);
    const cellPx = view.W / view.cols;
    const n = reduce ? 0 : bits.update(cellPx);
    const pn = name ? name.update(time) : 0;
    if (fadeT0 < 0) fadeT0 = time;
    u.uFade!.value = reduce ? 1 : smooth(0, GRID.fadeIn, time - fadeT0);

    const r = stage.renderer;
    r.setRenderTarget(stage.rt);
    r.clear();
    r.render(figure.scene, figure.camera);
    r.setRenderTarget(null);
    r.clear();
    r.render(stage.quadScene, stage.quadCam);
    if (pn && name) r.render(name.scene, stage.quadCam);
    if (n) r.render(bits.scene, stage.quadCam);
    // On a GPU the melt stops when the tier has dropped to the last one; software GL (a test
    // build) starts there and keeps it.
    if (
      melt &&
      melt.update(time, dt, name?.settled() ?? false, view.tier >= lastTier && !stage.software)
    )
      r.render(melt.scene, stage.quadCam);

    if (!reduce && clBig && clSt) {
      const ga = ss(clamp01(S.gather));
      const e = ss(clamp01(S.emph));
      // The group chips wait until What I do has left the view: one scene at a time.
      const arrive = ss(clamp01((S.cluster - 0.88) / 0.12));
      const lo = arrive * (1 - ga) * clamp01(S.labels);
      if (lo > 0.001 || clBig.style.opacity !== '0') {
        const lay = figure.layout;
        placeLabel(
          clBig,
          clusterPose(lay, 1, e, -9),
          lo * lerp(0.32, 1, 1 - e),
          1 - e,
          'var(--acc)',
        );
        placeLabel(clSt, clusterPose(lay, 4, e, -9), lo * lerp(0.32, 1, e), e, 'var(--sig)');
      }
    }
  }

  return {
    render,
    relayout,
    setTier(t) {
      view.tier = t;
      relayout();
    },
    name,
    melt,
    stage,
    tier: view.tier,
    warm: async () => {
      // Link each program in the background (three's compileAsync polls the parallel-compile
      // status instead of waiting on it), then draw it once, a task apart, so no single task pays
      // for all the shader compiles (weak phones stall the main thread on the first frame).
      const r = stage.renderer;
      const scenes: [Scene, Camera][] = [
        [figure.scene, figure.camera],
        [stage.quadScene, stage.quadCam],
        [bits.scene, stage.quadCam],
      ];
      if (name) scenes.push([name.scene, stage.quadCam]);
      // An empty draw builds no GPU pipeline, so the bits and the name (still empty here) each
      // draw one zeroed point: fully transparent, culled before any fragment. The driver then
      // compiles their pipelines now instead of on their first real frame mid-scroll, where
      // software GL stalls a whole frame (a long task) on it.
      for (const [sc, cam] of scenes) {
        await r.compileAsync(sc, cam);
        const empty: Points[] = [];
        sc.traverse((o) => {
          const pts = o as Points;
          if (pts.isPoints && pts.geometry.drawRange.count === 0) empty.push(pts);
        });
        empty.forEach((pts) => pts.geometry.setDrawRange(0, 1));
        r.render(sc, cam);
        empty.forEach((pts) => pts.geometry.setDrawRange(0, 0));
        await yieldTask();
      }
      if (melt) {
        melt.watch(r);
        await r.compileAsync(melt.scene, stage.quadCam);
        melt.prime(r, stage.quadCam);
        await yieldTask();
      }
      r.clear();
    },
    still: () => render(performance.now()),
    onActivity(fn) {
      activity = fn;
    },
  };
}
