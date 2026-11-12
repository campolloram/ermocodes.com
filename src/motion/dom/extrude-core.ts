// Pure maths for the extrusion steering: pointer and scroll aim the stacked layers.
import { EXTRUSION } from '../config.ts';

/** Target direction for pointer position (-1..1 each axis) and scroll in viewports. */
export function aimExtrusion(tx: number, ty: number, scrollViewports: number): [number, number] {
  const ex =
    EXTRUSION.base[0] +
    tx * EXTRUSION.pointer[0] +
    Math.sin(scrollViewports * EXTRUSION.scrollWave[0]) * EXTRUSION.scrollAmp[0];
  const ey =
    EXTRUSION.base[1] +
    ty * EXTRUSION.pointer[1] +
    Math.cos(scrollViewports * EXTRUSION.scrollWave[1]) * EXTRUSION.scrollAmp[1] +
    EXTRUSION.yBias;
  return [ex, ey];
}

/** Round to the quantisation step so CSS only restyles when the value visibly moves. */
export const quantise = (v: number): number => Math.round(v * EXTRUSION.quant) / EXTRUSION.quant;
