import { expect, test } from 'vitest';
import { findIndexablePages } from './check-noindex.mjs';

const noindex = '<head><meta name="robots" content="noindex, nofollow"></head>';
const indexable = '<head><meta name="description" content="x"></head>';
const robots = 'User-agent: *\nAllow: /\n';

test('passes when every page is noindex and robots.txt has no sitemap', () => {
  expect(findIndexablePages([{ file: 'index.html', html: noindex }], robots)).toEqual([]);
});

test('reports indexable pages, a missing robots.txt and a production sitemap line', () => {
  expect(findIndexablePages([{ file: 'es.html', html: indexable }], undefined)).toEqual([
    'es.html: no robots noindex meta',
    'robots.txt: missing',
  ]);
  expect(
    findIndexablePages([], `${robots}Sitemap: https://ermocodes.com/sitemap-index.xml\n`),
  ).toEqual(['robots.txt: lists the production sitemap']);
});
