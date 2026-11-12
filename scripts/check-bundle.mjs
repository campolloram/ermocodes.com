#!/usr/bin/env node
// Bundle budget for the WebGL page. Lighthouse in CI has no GPU, so it only ever loads the plain
// page; the WebGL page's 220 KB script budget (lighthouserc.cjs) would go unwatched.
// This sums the gzipped size of every JS chunk in dist/_astro (boot + engine + timeline + the lazy
// queue demo: the most the page can fetch) and fails above the budget.
// Usage: node scripts/check-bundle.mjs [dist]
import { readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { listFiles } from './lib/walk.mjs';

/** Same unit as lighthouserc.cjs (KB = 1024 bytes). */
export const SCRIPT_BUDGET_BYTES = 220 * 1024;

/** Gzip size per JS file under `dir`, and their sum. */
export function scriptSizes(dir) {
  const files = listFiles(dir, (p) => extname(p) === '.js').map((file) => ({
    file: relative(dir, file),
    bytes: gzipSync(readFileSync(file), { level: 9 }).length,
  }));
  return { files, total: files.reduce((n, f) => n + f.bytes, 0) };
}

export function main(argv) {
  const dist = argv.find((a) => !a.startsWith('--')) ?? 'dist';
  const { files, total } = scriptSizes(join(dist, '_astro'));
  if (files.length === 0) {
    console.error(`check-bundle: no JS chunks in ${dist}/_astro; run the build first.`);
    return 1;
  }
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  for (const f of files) console.log(`  ${f.file}: ${kb(f.bytes)}`);
  const budget = kb(SCRIPT_BUDGET_BYTES);
  if (total > SCRIPT_BUDGET_BYTES) {
    console.error(`check-bundle: scripts total ${kb(total)} gzip, over the ${budget} budget`);
    return 1;
  }
  console.log(`check-bundle: scripts total ${kb(total)} gzip (budget ${budget})`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
