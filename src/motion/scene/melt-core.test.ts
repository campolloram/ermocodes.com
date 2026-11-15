import { describe, expect, test } from 'vitest';
import { MELT } from '../config.ts';
import {
  dropRadius,
  dropRate,
  heatTarget,
  lowestPick,
  meltAllowed,
  nearness,
  parseCssRgb,
  planAtlas,
  stepDrop,
  stepHeat,
} from './melt-core.ts';

const classes = (...on: string[]) => ({ contains: (n: string) => on.includes(n) });
const ok = { letters: 5, settled: true, slow: false, phone: false, dust: 0, noHide: false };
const allow = (over: Partial<typeof ok> = {}, cls = classes('motion')) => {
  const g = { ...ok, ...over };
  return meltAllowed(g.letters, g.settled, g.slow, g.phone, g.dust, cls, g.noHide);
};

describe('parseCssRgb', () => {
  test('hex and rgb forms', () => {
    expect(parseCssRgb('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseCssRgb(' #102030 ')).toEqual([16, 32, 48]);
    expect(parseCssRgb('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
    expect(parseCssRgb('rgba(4 5 6 / 0.5)')).toEqual([4, 5, 6]);
  });
  test('percent channels are not parsed: paper', () => {
    expect(parseCssRgb('rgb(50%, 50%, 50%)')).toEqual([245, 246, 240]);
  });
  test('anything else is paper', () => {
    for (const bad of ['', 'tomato', '#12', 'oklch(0.9 0.02 100)'])
      expect(parseCssRgb(bad)).toEqual([245, 246, 240]);
  });
});

describe('meltAllowed', () => {
  test('all clear allows', () => expect(allow()).toBe(true));
  test.each([
    ['letters', { letters: 0 }],
    ['settled', { settled: false }],
    ['slow', { slow: true }],
    ['phone', { phone: true }],
    ['dust', { dust: 0.0005 }],
    ['noHide', { noHide: true }],
  ])('%s blocks', (_, over) => expect(allow(over)).toBe(false));
  test('missing motion class blocks, mpaused blocks', () => {
    expect(allow({}, classes())).toBe(false);
    expect(allow({}, classes('motion', 'mpaused'))).toBe(false);
  });
  test('tiny dust still allows', () => expect(allow({ dust: 0.0004 })).toBe(true));
  test('skips the class reads once a cheap check has failed', () => {
    let reads = 0;
    const spy = {
      contains: () => {
        reads += 1;
        return true;
      },
    };
    for (const over of [
      { letters: 0 },
      { settled: false },
      { slow: true },
      { phone: true },
      { dust: 1 },
    ])
      expect(allow(over, spy)).toBe(false);
    expect(reads).toBe(0);
    allow({}, spy);
    expect(reads).toBe(2);
  });
});

describe('nearness and heat', () => {
  const box = [100, 100, 200, 200] as const;
  const near = (px: number, py: number) => nearness(...box, px, py);
  test('inside the box is 1, at the radius is 0, halfway is 0.5', () => {
    expect(near(150, 150)).toBe(1);
    expect(near(200 + MELT.radius, 150)).toBe(0);
    expect(near(200 + MELT.radius / 2, 150)).toBeCloseTo(0.5, 6);
    expect(near(150, 100 - MELT.radius / 2)).toBeCloseTo(0.5, 6);
    expect(near(5000, 5000)).toBe(0);
  });
  test('uses the corner distance, not one axis', () => {
    const d = MELT.radius / 2;
    const expected = 1 - Math.hypot(d, d) / MELT.radius;
    expect(near(200 + d, 200 + d)).toBeCloseTo(expected, 6);
  });
  test('heatTarget is 0 away and 0.35..1 near', () => {
    expect(heatTarget(0)).toBe(0);
    expect(heatTarget(1)).toBeCloseTo(1, 9);
    expect(heatTarget(0.01)).toBeCloseTo(0.3565, 6);
  });
  test('stepHeat rises with rise, falls with fall, snaps to 0', () => {
    expect(stepHeat(0, 1, 0.1)).toBeCloseTo(1 - Math.exp(-0.1 * MELT.rise), 9);
    expect(stepHeat(1, 0.5, 0.1)).toBeCloseTo(0.5 + 0.5 * Math.exp(-0.1 * MELT.fall), 9);
    expect(stepHeat(MELT.off * 0.9, 0, 0.001)).toBe(0);
    expect(stepHeat(0.5, 0, 0.001)).toBeGreaterThan(0.49);
    // a nonzero target never snaps, even at tiny heat
    expect(stepHeat(0, 0.35, 0.0001)).toBeGreaterThan(0);
  });
  test('stepHeat converges: a long wall step reaches the target', () => {
    expect(stepHeat(0, 0.8, 0.5)).toBeGreaterThan(0.8 * 0.85);
    expect(stepHeat(0.8, 0, 2)).toBe(0);
  });
});

describe('dropRate', () => {
  test('scales with heat squared and pointer speed, speed caps at 500 px/s', () => {
    expect(dropRate(0, 1000)).toBe(0);
    expect(dropRate(1, 0)).toBeCloseTo(MELT.dropRate * 0.4, 9);
    expect(dropRate(1, 500)).toBeCloseTo(MELT.dropRate * 1.4, 9);
    expect(dropRate(1, 250)).toBeCloseTo(MELT.dropRate * 0.9, 9);
    expect(dropRate(1, 5000)).toBeCloseTo(MELT.dropRate * 1.4, 9);
    expect(dropRate(0.5, 0)).toBeCloseTo(MELT.dropRate * 0.25 * 0.4, 9);
  });
});

describe('droplets', () => {
  const mk = (y: number, v: number, life: number) => ({
    dy: new Float32Array([y]),
    dv: new Float32Array([v]),
    dl: new Float32Array([life]),
    da: new Float32Array([1]),
  });
  const step = (y: number, v: number, life: number, dt: number, cellH = 200) => {
    const s = mk(y, v, life);
    const live = stepDrop(s.dy, s.dv, s.dl, s.da, 0, dt, cellH);
    return { ...s, live, y: s.dy[0]!, v: s.dv[0]!, life: s.dl[0]!, alpha: s.da[0]! };
  };
  test('falls under gravity and fades near the end of its life', () => {
    const d = step(10, 20, 1, 0.1);
    expect(d.live).toBe(true);
    expect(d.v).toBeCloseTo(20 + MELT.dropGravity * 0.1, 5);
    expect(d.y).toBeCloseTo(10 + d.v * 0.1, 5);
    expect(d.life).toBeCloseTo(0.9, 6);
    expect(d.alpha).toBe(1);
    expect(step(10, 0, 0.5, 0.1).alpha).toBeCloseTo(0.4 * 2.2, 6);
  });
  test('updates in place, other slots untouched, float32 rounding between lines', () => {
    const dy = new Float32Array([1, 2]);
    const dv = new Float32Array([3, 4]);
    const dl = new Float32Array([5, 6]);
    const da = new Float32Array([1, 1]);
    stepDrop(dy, dv, dl, da, 1, 0.123456789, 1000);
    expect([dy[0], dv[0], dl[0], da[0]]).toEqual([1, 3, 5, 1]);
    // main's inline order: each store rounds to float32 before the next line reads it
    const f = Math.fround;
    const life = f(6 - 0.123456789);
    const v = f(4 + MELT.dropGravity * 0.123456789);
    expect(dl[1]).toBe(life);
    expect(dv[1]).toBe(v);
    expect(dy[1]).toBe(f(2 + v * 0.123456789));
    expect(da[1]).toBe(f(Math.min(1, life * 2.2)));
  });
  test('dies when life runs out or it passes the cell bottom', () => {
    expect(step(10, 0, 0.05, 0.1)).toMatchObject({ alpha: 0, live: false });
    expect(step(197, 100, 5, 0.1)).toMatchObject({ alpha: 0, live: false });
    // lands 2 px above the bottom edge: dead (the 4 px margin), but 6 px above stays alive
    expect(step(196, 0, 5, 0.001).alpha).toBe(0);
    expect(step(190, 0, 5, 0.001)).toMatchObject({ alpha: 1, live: true });
    expect(step(100, 0, 5, 0.1).alpha).toBe(1);
    // life exactly 0 after the step is dead (0.5 - 0.25 is exact in float32)
    expect(step(10, 0, 0.5, 0.5)).toMatchObject({ alpha: 0, live: false });
  });
  test('radius shrinks to 60% with alpha, floor 1 px', () => {
    expect(dropRadius(10, 1)).toBe(10);
    expect(dropRadius(10, 0)).toBe(6);
    expect(dropRadius(1, 0)).toBe(1);
  });
  test('lowestPick prefers the largest y of three picks, ties to the first', () => {
    const px: [number, number][] = [
      [0, 1],
      [1, 5],
      [2, 3],
    ];
    const seq = (...v: number[]) => {
      let i = 0;
      return () => {
        if (i >= v.length) throw new Error('rnd sequence exhausted');
        return v[i++]!;
      };
    };
    expect(lowestPick(px, seq(0, 0.4, 0.9))).toEqual([1, 5]);
    expect(lowestPick(px, seq(0.4, 0, 0.9))).toEqual([1, 5]);
    expect(lowestPick(px, seq(0, 0, 0))).toEqual([0, 1]);
    const tie: [number, number][] = [
      [0, 2],
      [9, 2],
    ];
    expect(lowestPick(tie, seq(0, 0.9, 0.9))).toEqual([0, 2]);
    expect(lowestPick([])).toBeUndefined();
  });
});

describe('planAtlas', () => {
  const plan = (...a: Parameters<typeof planAtlas>) => {
    const p = planAtlas(...a);
    if (!p) throw new Error('expected an atlas plan');
    return p;
  };
  test('a normal hero fits at the dpr scale, capped at maxScale', () => {
    const p = plan(5, 80, 90, 3);
    expect(p.scale).toBe(MELT.maxScale);
    expect(p.cols).toBe(5);
    expect(p.cellW).toBe(Math.ceil(80 * 2) + 2);
    expect(p.cellH).toBe(Math.ceil(90 * 2) + 2);
    expect(p.width).toBe(5 * p.cellW);
    expect(p.height).toBe(p.cellH);
    expect(plan(5, 80, 90, 1).scale).toBe(1);
  });
  test('at most 6 columns, extra letters wrap to rows', () => {
    const p = plan(13, 40, 40, 1);
    expect(p.cols).toBe(6);
    expect(p.height).toBe(3 * p.cellH);
  });
  test('an oversize cell shrinks the scale by 15% steps until it fits', () => {
    const p = plan(1, 3000, 3000, 2);
    expect(p.scale).toBeCloseTo(2 * 0.85 ** 3, 9);
    // one step larger would not fit
    expect(3000 * (p.scale / 0.85) + 2).toBeGreaterThan(MELT.maxAtlas);
    expect(p.width).toBeLessThanOrEqual(MELT.maxAtlas);
    expect(p.height).toBeLessThanOrEqual(MELT.maxAtlas);
  });
  test('returns null when it would need a scale under 0.4', () => {
    expect(planAtlas(1, 20000, 20000, 2)).toBeNull();
  });
});
