// The site font as canvas code must name it. Astro registers Departure Mono under a hashed family
// name ("Departure Mono-ce98b4f0…", see the --font-departure variable it writes); no face is called
// plain "Departure Mono", so a canvas font string with that name draws the fallback monospace.

/** The first family of a CSS font-family list, with its quotes as written ('"A b", c' -> '"A b"'). */
export function firstFamily(list: string): string | null {
  const m = /^\s*("[^"]+"|'[^']+'|[^,]+)/.exec(list);
  const fam = m?.[1]?.trim();
  return fam ? fam : null;
}

let family: string | null = null;

/** The registered family of the site font, read once from --font-departure. */
export function siteFamily(): string {
  family ??=
    firstFamily(getComputedStyle(document.documentElement).getPropertyValue('--font-departure')) ??
    '"Departure Mono"';
  return family;
}

/** A canvas `font` value in the site font, monospace behind it. */
export const canvasFont = (px: number): string => `${px}px ${siteFamily()}, monospace`;

/**
 * Resolves once the site font is loaded (or failed: the canvas then measures the fallback, as the
 * DOM does). Canvas text never triggers a web font load by itself, so sample nothing before this.
 */
export function siteFontReady(): Promise<unknown> {
  return document.fonts.load(`12px ${siteFamily()}`).catch(() => null);
}
