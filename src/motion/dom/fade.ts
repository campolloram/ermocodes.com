// Scroll reveal: a section's lines fade in (opacity only) the first time they enter the view.
// The text itself is never touched, so nothing reflows and the DOM always holds the real text.
// Nothing is hidden up front (a scanner or a reader that never scrolls sees the real, opaque text):
// when a line first enters the view it gets `fade-in`, an animation from opacity 0. Only the
// motion path calls this; reduced motion and plain DOM never get the class.
// A passive scroll listener and one rect read per pending line, at most once a frame: an
// IntersectionObserver here left Chromium ignoring the first ArrowDown on a CPU-starved page.

const pending = new Set<Element>();
let queued = false;
let wired = false;

function check(): void {
  queued = false;
  const h = innerHeight;
  for (const el of pending) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > h) continue;
    el.classList.add('fade-in');
    pending.delete(el);
  }
}

function onScroll(): void {
  if (queued || !pending.size) return;
  queued = true;
  requestAnimationFrame(check);
}

/** Fades each element in (opacity only) the first time it enters the view. */
export function fadeOnEnter(els: Iterable<Element>): void {
  // Lines already in view when this runs just stay as they are (no blink).
  const h = innerHeight;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.bottom >= 0 && r.top <= h) continue;
    pending.add(el);
  }
  if (wired) return;
  wired = true;
  addEventListener('scroll', onScroll, { passive: true });
}

/** Puts every line back to plain (the fall-back to plain DOM). */
export function undoFade(): void {
  removeEventListener('scroll', onScroll);
  wired = false;
  pending.clear();
  document.querySelectorAll('.fade-in').forEach((el) => el.classList.remove('fade-in'));
}
