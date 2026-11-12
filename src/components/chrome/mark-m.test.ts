import { describe, expect, it } from 'vitest';
import { markM } from './mark-m.ts';

describe('markM', () => {
  it('wraps every M or m and nothing else', () => {
    expect(markM('Mom')).toBe('<span class="mm">M</span>o<span class="mm">m</span>');
    expect(markM('SoFi')).toBe('SoFi');
  });

  it('escapes HTML and keeps an entity whole when the text has an m after an ampersand', () => {
    expect(markM('Q&A')).toBe('Q&amp;A');
    expect(markM('m&m')).toBe('<span class="mm">m</span>&amp;<span class="mm">m</span>');
    expect(markM('a<b>"c"')).toBe('a&lt;b&gt;&quot;c&quot;');
  });
});
