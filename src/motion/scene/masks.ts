// Masks: the figure and grid step back behind big type (hero words, the active company, LET'S TALK).
import { smooth } from '../math.ts';
import { heroDust, refs, scene as S, type Letter } from '../state.ts';
import type { Stage } from './renderer.ts';
import { view } from './view.ts';

type Rect = [number, number, number, number];

/** Union of the first and last letter rect of each line (cheap box around a block of type). */
function unionRect(letters: Letter[]): Rect {
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  let line = -1;
  let prev: Letter | null = null;
  const edge = (Lt: Letter) => {
    const r = Lt.ch.getBoundingClientRect();
    x0 = Math.min(x0, r.left);
    x1 = Math.max(x1, r.right);
    y0 = Math.min(y0, r.top);
    y1 = Math.max(y1, r.bottom);
  };
  for (const Lt of letters) {
    if (Lt.line !== line) {
      if (prev) edge(prev);
      edge(Lt);
      line = Lt.line;
    }
    prev = Lt;
  }
  if (prev) edge(prev);
  return [x0, y0, x1, y1];
}

export function updateMasks(stage: Stage): void {
  const set = (k: number, r: Rect | null, strength: number) => {
    const pad = 6;
    const u = stage.asciiMat.uniforms.uMaskS!.value as number[];
    if (!r || strength <= 0.001 || r[3] < 0 || r[1] > view.H) {
      u[k] = 0;
      return;
    }
    stage.maskRects[k]!.set(
      (r[0] - pad) * view.dpr,
      (view.H - r[3] - pad) * view.dpr,
      (r[2] + pad) * view.dpr,
      (view.H - r[1] + pad) * view.dpr,
    );
    u[k] = strength;
  };
  const hs = 1 - smooth(0, 0.5, heroDust.p);
  set(0, hs > 0 && refs.hero ? unionRect(refs.hero[0]) : null, hs);
  set(1, hs > 0 && refs.hero ? unionRect(refs.hero[1]) : null, hs);
  let r2: Rect | null = null;
  let s2 = 0;
  if (S.cluster > 0.5 && S.gather < 0.5 && refs.companies.length) {
    const k = Math.max(0, Math.min(refs.companies.length - 1, Math.round(S.active)));
    const letters = refs.companies[k]!;
    const co = letters[0]?.ch.closest('.co');
    if (co && getComputedStyle(co).opacity !== '0') {
      r2 = unionRect(letters);
      s2 = 1 - smooth(0, 0.5, refs.companyBits[k]?.p ?? 0);
    }
  }
  set(2, r2, s2);
  const tp = refs.talkBits?.p ?? 0;
  set(3, tp > 0 && refs.talk.length ? unionRect(refs.talk) : null, smooth(0.4, 1, tp));
}
