/** Deterministic PRNG (mulberry32). Pure: the state is passed in and returned. */

const UINT32_RANGE = 4294967296;
const MULBERRY_INCREMENT = 0x6d2b79f5;

/** Normalises any number into a uint32 seed. */
export function seedState(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
}

/** Returns a float in [0, 1) and the next state. */
export function nextFloat(state: number): [number, number] {
  const next = (state + MULBERRY_INCREMENT) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE, next];
}

/** Returns an integer in [min, max] (inclusive) and the next state. */
export function nextInt(state: number, min: number, max: number): [number, number] {
  const [u, next] = nextFloat(state);
  return [min + Math.floor(u * (max - min + 1)), next];
}

/** Returns `chars` lowercase hex characters and the next state. */
export function nextHex(state: number, chars: number): [string, number] {
  let out = '';
  let s = state;
  while (out.length < chars) {
    const [u, next] = nextFloat(s);
    out += Math.floor(u * UINT32_RANGE)
      .toString(16)
      .padStart(8, '0');
    s = next;
  }
  return [out.slice(0, chars), s];
}
