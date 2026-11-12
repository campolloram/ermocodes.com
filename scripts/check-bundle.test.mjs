import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { SCRIPT_BUDGET_BYTES, main, scriptSizes } from './check-bundle.mjs';

describe('check-bundle', () => {
  test('sums the gzip size of the JS chunks and fails over the budget', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    try {
      mkdirSync(join(dir, '_astro'));
      writeFileSync(join(dir, '_astro', 'a.js'), 'a'.repeat(5000));
      writeFileSync(join(dir, '_astro', 'b.css'), 'x');
      const { files, total } = scriptSizes(join(dir, '_astro'));
      expect(files.map((f) => f.file)).toEqual(['a.js']);
      expect(total).toBeGreaterThan(0);
      const log = console.log;
      console.log = () => {};
      try {
        expect(main([dir])).toBe(0);
        // Random bytes do not compress: one chunk over the budget.
        writeFileSync(join(dir, '_astro', 'big.js'), randomBytes(SCRIPT_BUDGET_BYTES + 5000));
        const err = console.error;
        console.error = () => {};
        try {
          expect(main([dir])).toBe(1);
        } finally {
          console.error = err;
        }
      } finally {
        console.log = log;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
