// Poses of the six discs for each scroll phase: hero -> split -> cluster -> contact. Pure maths
// over the layout numbers, so the mixing is testable without WebGL.
import { FIGURE } from './config.ts';
import { clamp01, lerp, mixRecord } from './math.ts';

export interface Pose extends Record<string, number> {
  px: number;
  py: number;
  pz: number;
  s: number;
  tx: number;
  tz: number;
  ly: number;
  lx: number;
  rx: number;
  rz: number;
  tint: number;
  hi: number;
}

/** What poses need from the layout: world half-extents, the hero slot, and the phone flag. */
export interface Layout {
  halfW: number;
  halfH: number;
  /** min(halfW, halfH) */
  unit: number;
  phone: boolean;
  /** Hero slot centre in canvas px (y from the top) and size. */
  slot: { cx: number; cy: number; w: number; h: number };
  /** Canvas size in css px. */
  width: number;
  height: number;
}

export function pose(
  px: number,
  py: number,
  pz: number,
  s: number,
  extra: Partial<Pose> = {},
): Pose {
  return {
    px,
    py,
    pz,
    s,
    tx: 0.5,
    tz: -0.12,
    ly: 0,
    lx: 0,
    rx: 0,
    rz: 0,
    tint: 0,
    hi: 0,
    ...extra,
  };
}

const at = (l: Layout, fx: number, fy: number): [number, number] => [fx * l.halfW, fy * l.halfH];
const DISCS = FIGURE.discs;
const MID = (DISCS - 1) / 2;

export function heroPose(l: Layout, i: number): Pose {
  const [x, y] = at(l, (l.slot.cx / l.width) * 2 - 1, -((l.slot.cy / l.height) * 2 - 1));
  const wh = (l.slot.h / l.height) * 2 * l.halfH;
  const ww = (l.slot.w / l.width) * 2 * l.halfW;
  const s = Math.min(wh / FIGURE.heroFit.h, ww / FIGURE.heroFit.w);
  return pose(x, y, 0, s, { tx: FIGURE.heroFit.tx, ly: (i - MID) * FIGURE.heroFit.spread * s });
}

export function splitPose(l: Layout, i: number): Pose {
  const c = l.phone ? FIGURE.split.phone : FIGURE.split.desktop;
  const [x, y] = at(l, c.pos[0], c.pos[1]);
  const s = c.s * l.unit;
  return pose(x, y, 0, s, {
    tx: FIGURE.split.tx,
    tz: FIGURE.split.tz,
    ly: (i - MID) * c.spread * s,
    lx: Math.sin(i * 2.1) * c.lx * s,
    rx: i % 2 ? 0.9 : -0.8,
    rz: Math.cos(i * 1.3) * 0.8,
  });
}

/** `e` is the emphasis swap (0: big companies in front, 1: startups); `act` the active disc. */
export function clusterPose(l: Layout, i: number, e: number, act: number): Pose {
  const g = i < 3 ? 0 : 1;
  const j = i % 3;
  const c = l.phone ? FIGURE.cluster.phone : FIGURE.cluster.desktop;
  const front = { p: at(l, c.front.p[0], c.front.p[1]), s: c.front.s * l.unit };
  const back = { p: at(l, c.back.p[0], c.back.p[1]), s: c.back.s * l.unit };
  const inFront = g === 0 ? 1 - e : e;
  const sideF = g === 0 ? front : { p: [-front.p[0], front.p[1]], s: front.s };
  const sideB = g === 0 ? { p: [-back.p[0], back.p[1]], s: back.s } : back;
  const x = lerp(sideB.p[0] as number, sideF.p[0] as number, inFront);
  const y = lerp(sideB.p[1] as number, sideF.p[1] as number, inFront);
  const s = lerp(sideB.s, sideF.s, inFront);
  const hi = clamp01(1 - Math.abs(act - i));
  return pose(x, y, lerp(FIGURE.cluster.depth, 0, inFront), s, {
    tx: FIGURE.cluster.tx,
    tz: g ? FIGURE.cluster.tz : -FIGURE.cluster.tz,
    ly: (j - 1) * FIGURE.cluster.spread * s,
    lx: hi * FIGURE.cluster.lift.x * s * (g ? -1 : 1),
    rx: hi * FIGURE.cluster.lift.rx,
    tint: g,
    hi,
  });
}

export function contactPose(l: Layout, i: number): Pose {
  const c = l.phone ? FIGURE.contact.phone : FIGURE.contact.desktop;
  const [x, y] = at(l, c.pos[0], c.pos[1]);
  const s = c.s * l.unit;
  return pose(x, y, 0, s, {
    tx: FIGURE.contact.tx,
    tz: FIGURE.contact.tz,
    ly: (i - MID) * FIGURE.contact.spread * s,
    tint: i < 3 ? 0 : 1,
  });
}

export interface Phases {
  split: number;
  cluster: number;
  gather: number;
  emph: number;
  active: number;
}

/** The pose of disc `i` for the current scroll phases (each already eased 0..1). */
export function poseFor(l: Layout, i: number, p: Phases): Pose {
  let out = mixRecord(heroPose(l, i), splitPose(l, i), p.split);
  out = mixRecord(out, clusterPose(l, i, p.emph, p.active), p.cluster);
  return mixRecord(out, contactPose(l, i), p.gather);
}
