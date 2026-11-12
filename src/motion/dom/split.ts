// Splits big type into solid letters (one inline-block per glyph) so they can tumble in, hide
// behind particles and be sampled. The lines are aria-hidden in the markup; the real heading text
// stays in a .sr span.
import type { Letter } from '../state.ts';

/** The lines split so far, with their text, so a fall-back to plain DOM can put them back. */
const split: { el: HTMLElement; text: string }[] = [];

/**
 * Set when nothing draws the stand-in bits any more (WebGL context lost, a render error): letters
 * then stay in the DOM and no hide request is honoured, so a name never goes missing.
 */
export const letterGuard = { noHide: false };

/** Replaces the text of `el` (one visual line) with letter spans; returns the letters. */
export function splitLine(el: HTMLElement, line: number): Letter[] {
  const text = (el.textContent ?? '').trim();
  split.push({ el, text });
  el.textContent = '';
  const bl = document.createElement('i');
  bl.className = 'bl';
  const out: Letter[] = [];
  for (const c of text) {
    if (c === ' ') {
      const sp = document.createElement('span');
      sp.className = 'sp';
      el.appendChild(sp);
      continue;
    }
    const ch = document.createElement('span');
    ch.className = 'ch';
    const g = document.createElement('span');
    g.className = 'g';
    g.textContent = c;
    if (c === 'M' || c === 'm') g.classList.add('mm');
    ch.appendChild(g);
    el.appendChild(ch);
    out.push({ ch, g, c, line, bl, hidden: false });
  }
  el.appendChild(bl);
  el.classList.add('split');
  return out;
}

/** Splits every line element inside `root` (or `root` itself when it has none). */
export function splitLines(root: HTMLElement, selector = '.ln'): Letter[] {
  const lines = [...root.querySelectorAll<HTMLElement>(selector)];
  return lines.flatMap((el, i) => splitLine(el, i));
}

/** Puts every split line back as the plain text it was (the fall-back to plain DOM). */
export function unsplitAll(): void {
  for (const { el, text } of split.splice(0)) {
    el.textContent = text;
    el.classList.remove('split');
  }
}

export function setLetterHidden(l: Letter, wantHidden: boolean): void {
  const hidden = wantHidden && !letterGuard.noHide;
  if (l.hidden === hidden) return;
  l.hidden = hidden;
  l.ch.style.visibility = hidden ? 'hidden' : '';
}
