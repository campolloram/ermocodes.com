// Big extruded type: the stacked shadow fills the inner V of an M and it reads as an N. The M
// glyphs get their own span (.mm) so the stylesheet can give them a shallower extrusion.
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * HTML for `text` with every M or m wrapped in <span class="mm">; the text itself is unchanged.
 * Each character is wrapped or escaped on its own, so an entity such as &amp; is never split.
 */
export const markM = (text: string): string =>
  [...text].map((c) => (/[Mm]/.test(c) ? `<span class="mm">${c}</span>` : esc(c))).join('');
