// A <meta http-equiv="content-security-policy"> only covers what comes after it. Astro writes it
// late in <head> (after the inline head script, the JSON-LD and the inline style); this moves it to
// right after <meta charset>, so the policy is in force for everything else in the document.
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles } from './walk.mjs';

const CSP_META = /<meta\s+http-equiv=["']content-security-policy["'][^>]*>/i;
const CHARSET_META = /<meta\s+charset=[^>]*>/i;

/** The page with its CSP meta moved to just after <meta charset>; unchanged if it has neither. */
export function moveCspFirst(html) {
  const csp = CSP_META.exec(html);
  const charset = CHARSET_META.exec(html);
  if (!csp || !charset) return html;
  if (csp.index < charset.index) return html;
  const without = html.replace(csp[0], '');
  const at = without.search(CHARSET_META);
  const end = at + CHARSET_META.exec(without)[0].length;
  return without.slice(0, end) + csp[0] + without.slice(end);
}

/** Astro integration: runs on the built output. */
export function cspFirst() {
  return {
    name: 'csp-first',
    hooks: {
      'astro:build:done': ({ dir }) => {
        for (const file of listFiles(fileURLToPath(dir), (p) => extname(p) === '.html')) {
          const html = readFileSync(file, 'utf8');
          const moved = moveCspFirst(html);
          if (moved !== html) writeFileSync(file, moved);
        }
      },
    },
  };
}
