import { describe, expect, it } from 'vitest';
import { NAME, PERF } from './config.ts';
import { aimExtrusion, quantise } from './dom/extrude-core.ts';
import { firstFamily } from './font.ts';
import { headScript } from './head-script.mjs';
import { clamp01, gridSize, mixRecord, smooth, subdivision } from './math.ts';
import { type Layout, clusterPose, heroPose, poseFor, splitPose } from './poses.ts';
import { FpsMeter, chooseTier, dprFor, isSoftwareRenderer, lastTier, nextTier } from './tier.ts';

const layout = (phone: boolean): Layout => ({
  halfW: phone ? 2 : 5,
  halfH: 3.4,
  unit: phone ? 2 : 3.4,
  phone,
  slot: { cx: 200, cy: 400, w: 150, h: 300 },
  width: 400,
  height: 800,
});

describe('tier choice', () => {
  it('starts weak hardware one tier down, very weak two', () => {
    expect(chooseTier({ cores: 12 })).toBe(0);
    expect(chooseTier({ cores: 8 })).toBe(0);
    expect(chooseTier({ cores: 4 })).toBe(1);
    expect(chooseTier({ cores: 2 })).toBe(2);
  });

  it('spots software rasterisers by their renderer string', () => {
    expect(
      isSoftwareRenderer(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)',
      ),
    ).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(
      isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)'),
    ).toBe(false);
    expect(isSoftwareRenderer('Adreno (TM) 740')).toBe(false);
    expect(isSoftwareRenderer('')).toBe(false);
  });

  it('caps DPR at 2 desktop and 1.5 phone, minus the tier step', () => {
    expect(dprFor(3, false, 0)).toBe(2);
    expect(dprFor(3, true, 0)).toBe(1.5);
    expect(dprFor(3, true, 1)).toBe(1.25);
    expect(dprFor(1, true, 2)).toBe(1);
  });

  it('drops one tier when fps averages under 50 for the window, never past the last', () => {
    expect(nextTier(0, 49)).toBe(1);
    expect(nextTier(0, 55)).toBe(0);
    expect(nextTier(0, PERF.fpsFloor)).toBe(0);
    expect(nextTier(0, PERF.fpsFloor - 0.01)).toBe(1);
    expect(nextTier(lastTier, 10)).toBe(lastTier);
  });

  it('meters a full window, then waits out a cooldown', () => {
    const m = new FpsMeter();
    let out: number | null = null;
    for (let i = 0; i < 200 && out === null; i += 1) out = m.push(1 / 40);
    expect(out).toBeCloseTo(40, 0);
    m.hold(1);
    expect(m.push(PERF.fpsWindow + 1)).toBeNull();
    // Once the cooldown has run out, a full window reads again.
    m.push(2);
    let again: number | null = null;
    for (let i = 0; i < 200 && again === null; i += 1) again = m.push(1 / 30);
    expect(again).toBeCloseTo(30, 0);
  });
});

describe('sampling-grid maths', () => {
  it('bounds the subdivision of a font pixel', () => {
    expect(subdivision(1000, 13500)).toBe(4);
    expect(subdivision(10, 13500)).toBe(NAME.subMax);
    expect(subdivision(100000, 100)).toBe(NAME.subMin);
  });

  it('keeps the particle budget near the target', () => {
    const n = 380;
    const sub = subdivision(n, NAME.target.desktop);
    expect(n * sub * sub).toBeLessThanOrEqual(NAME.maxParticles);
  });

  it('tiles the canvas with at least the minimum cells', () => {
    expect(gridSize(390, 844, 7, 15, 8)).toEqual({ cols: 56, rows: 56 });
    expect(gridSize(10, 10, 7, 15, 8)).toEqual({ cols: 8, rows: 8 });
  });

  it('clamps and smooths', () => {
    expect(clamp01(-1)).toBe(0);
    expect(smooth(0, 1, 0.5)).toBe(0.5);
    expect(smooth(0, 1, 2)).toBe(1);
  });
});

describe('pose mixing', () => {
  it('mixes records linearly', () => {
    expect(mixRecord({ a: 0, b: 10 }, { a: 10, b: 20 }, 0.25)).toEqual({ a: 2.5, b: 12.5 });
  });

  it('is the hero pose at phase 0 and the split pose at split 1', () => {
    const l = layout(true);
    const none = { split: 0, cluster: 0, gather: 0, emph: 0, active: 0 };
    const close = (x: Record<string, number>, y: Record<string, number>) => {
      for (const k of Object.keys(y)) expect(x[k]).toBeCloseTo(y[k] as number, 9);
    };
    close(poseFor(l, 2, none), heroPose(l, 2));
    close(poseFor(l, 2, { ...none, split: 1 }), splitPose(l, 2));
  });

  it('swaps which group is in front with the emphasis phase', () => {
    const l = layout(false);
    const big = clusterPose(l, 0, 0, -9);
    const startup = clusterPose(l, 0, 1, -9);
    expect(big.pz).toBeGreaterThan(startup.pz);
    expect(big.s).toBeGreaterThan(startup.s);
  });

  it('lights the active disc only', () => {
    const l = layout(false);
    expect(clusterPose(l, 2, 0, 2).hi).toBe(1);
    expect(clusterPose(l, 4, 0, 2).hi).toBe(0);
  });
});

describe('extrusion steering', () => {
  it('is the resting direction at the centre and the top', () => {
    const [x, y] = aimExtrusion(0, 0, 0);
    expect(x).toBeCloseTo(0.72, 5);
    expect(y).toBeCloseTo(0.8 + 0.18 - 0.1, 5);
  });

  it('follows the pointer, and quantises to 0.04', () => {
    expect(aimExtrusion(1, 0, 0)[0]).toBeGreaterThan(aimExtrusion(-1, 0, 0)[0]);
    expect(quantise(0.7213)).toBeCloseTo(0.72, 5);
    expect(quantise(0.7413)).toBeCloseTo(0.76, 5);
  });
});

describe('site font family', () => {
  it('takes the first family of the list, quotes kept', () => {
    expect(
      firstFamily('"Departure Mono-ce98b4f04ffe1567","Departure Mono-ce98 fallback: Courier New"'),
    ).toBe('"Departure Mono-ce98b4f04ffe1567"');
    expect(firstFamily(" 'A b' , monospace")).toBe("'A b'");
    expect(firstFamily('monospace')).toBe('monospace');
    expect(firstFamily('  ')).toBeNull();
  });
});

describe('head script WebGL gate', () => {
  /** Runs the inline head script against a stub page whose WebGL2 renderer is `renderer`. */
  const classesAfter = (renderer: string | null, allowSoftwareGL: boolean): string[] => {
    const classes = new Set<string>();
    const gl = {
      RENDERER: 1,
      getParameter: (k: number) => (k === 1 ? 'WebKit WebGL' : renderer),
      getExtension: (n: string) =>
        n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 2 } : { loseContext() {} },
    };
    const doc = {
      documentElement: {
        classList: {
          add: (...c: string[]) => c.forEach((x) => classes.add(x)),
          remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
        },
        hasAttribute: () => true,
      },
      createElement: () => ({ getContext: () => (renderer === null ? null : gl) }),
    };
    const run = new Function(
      'document',
      'matchMedia',
      'sessionStorage',
      'setTimeout',
      'addEventListener',
      headScript({ allowSoftwareGL }),
    );
    run(
      doc,
      () => ({ matches: false }),
      { getItem: () => null },
      () => 0,
      () => {},
    );
    return [...classes].sort();
  };
  const SWIFTSHADER =
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)';

  it('turns the motion layout on for a GPU', () => {
    expect(classesAfter('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max)', false)).toEqual([
      'js',
      'motion',
      'pwait',
    ]);
  });

  it('keeps software WebGL and no WebGL on plain DOM, unless the build accepts software GL', () => {
    expect(classesAfter(SWIFTSHADER, false)).toEqual(['js']);
    expect(classesAfter('llvmpipe (LLVM 15.0.7, 256 bits)', false)).toEqual(['js']);
    expect(classesAfter(null, false)).toEqual(['js']);
    expect(classesAfter(SWIFTSHADER, true)).toEqual(['js', 'motion', 'pwait']);
    expect(classesAfter(null, true)).toEqual(['js']);
  });
});
