// Extrusion steering: pointer and scroll aim the six stacked layers of every big header via
// --ex/--ey. Coarse pointers skip the pointer (scroll still drives it).
import { EXTRUSION } from '../config.ts';
import { extrusion } from '../state.ts';
import { aimExtrusion, quantise } from './extrude-core.ts';

/** The extruded headers (sections/shared.css); their split letters (.ch .g) inherit from them. */
const EXTRUDED = '.w, .co-name, .talk, .h2, .proj-name';

export function createExtrusion(coarse: boolean): { tick: () => boolean } {
  let tx = 0;
  let ty = 0;
  let x: number = EXTRUSION.base[0];
  let y: number = EXTRUSION.base[1];
  let lx = '';
  let ly = '';
  let dirty = true;
  // Written on the headers near the view, not on <html>: an inherited custom property changed on
  // the root restyles and re-lays out the whole page on each scroll step. A header picks up the
  // current value as it nears the view, so it never shows a stale one.
  const near = new Set<HTMLElement>();
  const apply = (el: HTMLElement) => {
    el.style.setProperty('--ex', lx);
    el.style.setProperty('--ey', ly);
  };
  const targets = [...document.querySelectorAll<HTMLElement>(EXTRUDED)];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (!e.isIntersecting) near.delete(el);
          else if (!near.has(el)) {
            near.add(el);
            if (lx) apply(el);
          }
        }
      },
      { rootMargin: '50% 0px' },
    );
    targets.forEach((el) => io.observe(el));
  } else targets.forEach((el) => near.add(el));
  const kick = () => {
    dirty = true;
  };
  if (!coarse) {
    addEventListener(
      'pointermove',
      (e) => {
        tx = (e.clientX / innerWidth) * 2 - 1;
        ty = (e.clientY / innerHeight) * 2 - 1;
        kick();
      },
      { passive: true },
    );
  }
  addEventListener('scroll', kick, { passive: true });
  /** Returns true while it is still easing (the loop counts that as activity). */
  const tick = (): boolean => {
    if (!dirty) return false;
    const [ax, ay] = aimExtrusion(tx, ty, scrollY / Math.max(1, innerHeight));
    x += (ax - x) * EXTRUSION.ease;
    y += (ay - y) * EXTRUSION.ease;
    const qx = quantise(x).toFixed(2);
    const qy = quantise(y).toFixed(2);
    if (qx !== lx || qy !== ly) {
      lx = qx;
      ly = qy;
      near.forEach(apply);
      extrusion.x = Number(qx);
      extrusion.y = Number(qy);
    }
    dirty = Math.abs(ax - x) > EXTRUSION.settle || Math.abs(ay - y) > EXTRUSION.settle;
    return dirty;
  };
  return { tick };
}
