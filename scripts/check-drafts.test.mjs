import { describe, expect, test } from 'vitest';
import { collectDrafts, main } from './check-drafts.mjs';
import * as site from '../src/content/site.ts';

describe('check-drafts', () => {
  test('finds nested drafts with their path and source', () => {
    const found = collectDrafts({ a: { b: [{ draft: true, text: 'x', src: 's' }] }, c: 'plain' });
    expect(found).toEqual([{ path: 'a.b.0', text: 'x', src: 's' }]);
  });

  test('site.ts has no drafts left (all copy approved 2026-11-09)', () => {
    expect(collectDrafts(site)).toEqual([]);
    expect(main(['--strict'], collectDrafts(site))).toBe(0);
  });

  test('--strict fails while any draft remains; otherwise it never fails', () => {
    const drafts = [{ path: 'a', text: 'x', src: 'src one' }];
    const log = console.log;
    console.log = () => {};
    try {
      expect(main([], drafts)).toBe(0);
      expect(main(['--strict'], drafts)).toBe(1);
      expect(main(['--strict'], [])).toBe(0);
    } finally {
      console.log = log;
    }
  });
});
