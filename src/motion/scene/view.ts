// Canvas geometry shared by the scene modules (css px unless noted).
export interface View {
  W: number;
  H: number;
  dpr: number;
  phone: boolean;
  tier: number;
  /** Current cell size in css px. */
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
}

export const view: View = {
  W: 1,
  H: 1,
  dpr: 1,
  phone: true,
  tier: 0,
  cellW: 7,
  cellH: 12,
  cols: 8,
  rows: 8,
};
