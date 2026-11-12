import { describe, expect, test } from 'vitest';
import { calHref } from './cal';

describe('calHref', () => {
  test('accepts a bare path and the full URL', () => {
    expect(calHref('ermocodes/intro')).toBe('https://cal.com/ermocodes/intro');
    expect(calHref('https://cal.com/ermocodes/intro')).toBe('https://cal.com/ermocodes/intro');
  });
  test('throws on dot-only segments and other hosts', () => {
    expect(() => calHref('ermocodes/../someone/call')).toThrow(/PUBLIC_CAL_LINK/);
    expect(() => calHref('https://cal.com/ermocodes/../someone/call')).toThrow(/PUBLIC_CAL_LINK/);
    expect(() => calHref('https://evil.com/ermocodes/x')).toThrow(/PUBLIC_CAL_LINK/);
  });
  test('unset or blank leaves the buttons off', () => {
    expect(calHref(undefined)).toBeUndefined();
    expect(calHref('')).toBeUndefined();
    expect(calHref('  ')).toBeUndefined();
  });
});
