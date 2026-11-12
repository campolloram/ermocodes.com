import { describe, expect, test } from 'vitest';
import { moveCspFirst } from './csp-first.mjs';

const csp = '<meta http-equiv="content-security-policy" content="default-src \'self\'">';

describe('moveCspFirst', () => {
  test('puts the CSP meta right after the charset, before any script or style', () => {
    const html = `<head><meta charset="utf-8"><meta name="viewport" content="x"><script>a()</script><style>b{}</style>${csp}</head>`;
    const out = moveCspFirst(html);
    expect(out.indexOf(csp)).toBe(
      out.indexOf('<meta charset="utf-8">') + '<meta charset="utf-8">'.length,
    );
    expect(out.indexOf(csp)).toBeLessThan(out.indexOf('<script>'));
    expect(out.indexOf(csp)).toBeLessThan(out.indexOf('<style>'));
    expect(out.split(csp)).toHaveLength(2);
  });

  test('leaves a page alone that has no CSP meta or already has it first', () => {
    const plain = '<head><meta charset="utf-8"><script>a()</script></head>';
    expect(moveCspFirst(plain)).toBe(plain);
    const first = `<head><meta charset="utf-8">${csp}<script>a()</script></head>`;
    expect(moveCspFirst(first)).toBe(first);
  });
});
