#!/usr/bin/env node
// Lists every draft() line in src/content/site.ts with its source: the copy the user must confirm.
// `npm run check:drafts` passes --strict: exits 1 while any draft remains. The production
// deploy is blocked separately by `guard --main`, which fails on any data-draft in dist/.
// Usage: node scripts/check-drafts.mjs [--strict]
import { pathToFileURL } from 'node:url';
import * as site from '../src/content/site.ts';

/** Walks exported content and returns every draft object with its path. */
export function collectDrafts(value, path = '') {
  if (value && typeof value === 'object') {
    if (value.draft === true && typeof value.text === 'string') {
      return [{ path, text: value.text, src: value.src }];
    }
    return Object.entries(value).flatMap(([key, child]) =>
      collectDrafts(child, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/** Exit code for a list of drafts: 1 only with --strict while any remain. */
export function main(argv, drafts = collectDrafts(site)) {
  if (drafts.length === 0) {
    console.log('check-drafts: no drafts');
    return 0;
  }
  console.log(`check-drafts: ${drafts.length} draft line(s) to confirm`);
  for (const d of drafts) console.log(`  ${d.path}: "${d.text}"  [${d.src}]`);
  return argv.includes('--strict') ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
