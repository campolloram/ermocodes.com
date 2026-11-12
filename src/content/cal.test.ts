import { describe, expect, test } from 'vitest';
import { calHref } from './cal';

describe('calHref', () => {
  test('accepts a bare path and the full URL', () => {
    expect(calHref('ermocodes/intro')).toBe('https://cal.com/ermocodes/intro');
    expect(calHref('https://cal.com/ermocodes/intro')).toBe('https://cal.com/ermocodes/intro');
  });
  test('rejects dot-only segments and other hosts', () => {
    expect(calHref('ermocodes/../someone/call')).toBeUndefined();
    expect(calHref('https://cal.com/ermocodes/../someone/call')).toBeUndefined();
    expect(calHref('https://evil.com/ermocodes/x')).toBeUndefined();
    expect(calHref(undefined)).toBeUndefined();
  });
});
