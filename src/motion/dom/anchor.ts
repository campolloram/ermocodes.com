// In-page links (#hash): which element they point at, and moving focus there as a native jump
// would. Shared by the smooth-scroll handler (timeline.ts) and the plain-DOM path (boot.ts).

/** The in-page target of a `#hash` (inside main), or null. `#top` is the hero. */
export function targetOf(hash: string): HTMLElement | null {
  if (hash.length < 2) return null;
  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  const el = document.getElementById(id);
  return el && (el.id === 'main' || el.closest('#main')) ? el : null;
}

/** Moves keyboard and screen-reader focus to the target without scrolling (like a native jump). */
export function focusTarget(el: HTMLElement): void {
  if (!el.matches('a[href], button, input, select, textarea, [tabindex]'))
    el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/**
 * Without smooth scroll (reduced motion, no WebGL) the browser does the jump itself; this moves
 * focus to the target too, so the next Tab and a screen reader start from the section in every
 * mode. Links the scroll layer takes over (html.mscroll, timeline.ts) are left to it.
 */
export function focusOnJump(): void {
  document.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (document.documentElement.classList.contains('mscroll')) return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    const el = targetOf(a?.getAttribute('href') ?? '');
    if (!el) return;
    // After the browser's own jump (the default action of this click).
    setTimeout(() => {
      if (!e.defaultPrevented) focusTarget(el);
    }, 0);
  });
}
