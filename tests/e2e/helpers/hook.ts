// The test hook the motion layer exposes on PUBLIC_TEST_HOOKS builds (src/motion/boot.ts).
declare global {
  interface Window {
    __ecMotion?: {
      frames: () => number;
      freeze: (t: number) => void;
      font: () => string;
      /** Hero letters the liquid melt is drawing. */
      melt: () => number;
      /** Particle bits drawn last frame (intro and scroll dust only). */
      bits: () => number;
      /** The grid's pointer heat (the lens over the ASCII figure), 0..1. */
      heat: () => number;
    };
  }
}
export {};
