#!/usr/bin/env node
// Preview guard: every HTML page in a PUBLIC_SITE_ENV=preview build must carry robots noindex,
// and robots.txt must not advertise the production sitemap. CI runs it on dist-preview, the
// build that PR previews deploy.
// Usage: node scripts/check-noindex.mjs <dir>
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles } from './lib/walk.mjs';

const NOINDEX_META = /<meta\s+name="robots"\s+content="[^"]*\bnoindex\b[^"]*"/i;

/** pages: [{ file, html }], robots: robots.txt text or undefined. */
export function findIndexablePages(pages, robots) {
  const problems = pages
    .filter(({ html }) => !NOINDEX_META.test(html))
    .map(({ file }) => `${file}: no robots noindex meta`);
  if (robots === undefined) problems.push('robots.txt: missing');
  else if (/^Sitemap:/m.test(robots)) problems.push('robots.txt: lists the production sitemap');
  return problems;
}

function main(dir) {
  if (!dir || !existsSync(dir)) {
    console.error('usage: node scripts/check-noindex.mjs <dir>');
    return 2;
  }
  const pages = listFiles(dir, (p) => extname(p) === '.html').map((file) => ({
    file: relative(dir, file),
    html: readFileSync(file, 'utf8'),
  }));
  const robotsPath = join(dir, 'robots.txt');
  const robots = existsSync(robotsPath) ? readFileSync(robotsPath, 'utf8') : undefined;
  const problems =
    pages.length === 0 ? [`${dir}: no HTML pages`] : findIndexablePages(pages, robots);
  for (const p of problems) console.error(`check-noindex: ${p}`);
  if (problems.length > 0) return 1;
  console.log(`check-noindex: ${pages.length} pages are noindex`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv[2]);
}
