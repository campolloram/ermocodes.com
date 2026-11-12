// Shared mutable state of the scene. Module singletons, never window globals.
export interface SceneState {
  split: number;
  cluster: number;
  emph: number;
  active: number;
  gather: number;
  /** Opacity factor of the two cluster labels; 0 once Projects arrives. */
  labels: number;
  /** Code-grid strength. */
  grid: number;
  /** Brightness of the ASCII figure (dimmed while a text-only section is on). */
  obj: number;
}

export const scene: SceneState = {
  split: 0,
  cluster: 0,
  emph: 0,
  active: 0,
  gather: 0,
  labels: 1,
  grid: 1,
  obj: 1,
};

/** Scrub of the hero name turning to dust, 0..1. */
export const heroDust = { p: 0 };

/** Current extrusion direction (follows pointer and scroll). */
export const extrusion = { x: 0.72, y: 0.8 };

export interface Letter {
  ch: HTMLElement;
  g: HTMLElement;
  c: string;
  line: number;
  /** Zero-size baseline marker at the end of the line. */
  bl: HTMLElement;
  hidden: boolean;
}

export interface BitsGroup {
  letters: Letter[];
  p: number;
  mode: 'in' | 'out';
  tint: number;
  reach: number;
  /** 1 scatters bits across the screen (dust); less keeps them near the letters (burst). */
  spread: number;
  anchor: HTMLElement;
  built: unknown;
  on: boolean;
}

/** The split letters and bit groups that masks and the timeline share. */
export const refs: {
  hero: [Letter[], Letter[]] | null;
  companies: Letter[][];
  companyBits: BitsGroup[];
  talk: Letter[];
  talkBits: BitsGroup | null;
  projectBits: BitsGroup[];
} = { hero: null, companies: [], companyBits: [], talk: [], talkBits: null, projectBits: [] };

export const groups: BitsGroup[] = [];

export function addGroup(
  letters: Letter[],
  o: { mode?: 'in' | 'out'; tint?: number; reach?: number; spread?: number; anchor: HTMLElement },
): BitsGroup {
  const g: BitsGroup = {
    letters,
    p: 0,
    mode: o.mode ?? 'out',
    tint: o.tint ?? 0,
    reach: o.reach ?? 1,
    spread: o.spread ?? 1,
    anchor: o.anchor,
    built: null,
    on: false,
  };
  groups.push(g);
  return g;
}
