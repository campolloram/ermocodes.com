import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { PERF, PHONE_QUERY, SCROLL } from '../motion/config';

const css = readFileSync(
  fileURLToPath(new URL('./sections/motion-scenes.css', import.meta.url)),
  'utf8',
);

describe('motion-scenes.css mirrors motion/config.ts', () => {
  test('the native snap margin is 100svh minus snap.at of a 60svh chapter', () => {
    const found = /height: (\d+)svh;\s*\n\s*scroll-snap-align/.exec(css)?.[1];
    expect(found, 'chapter height (svh) not found before scroll-snap-align').toBeDefined();
    const chapter = Number(found);
    expect(css).toContain(`${chapter}svh`);
    const m = /scroll-margin-top: calc\((\d+)svh/.exec(css);
    expect(Number(m?.[1])).toBeCloseTo(100 - SCROLL.snap.at * chapter, 5);
  });
  test('the phone breakpoint is the same width in JS and CSS', () => {
    expect(PHONE_QUERY).toContain(`width < ${PERF.phoneWidth}px`);
    expect(css).toContain(`(width < ${PERF.phoneWidth}px)`);
    expect(css).toContain(`(width >= ${PERF.phoneWidth}px)`);
    expect(css).toContain('(pointer: coarse) and (max-height: 500px)');
  });
});
