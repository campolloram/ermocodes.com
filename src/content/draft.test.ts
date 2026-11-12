import { describe, expect, it } from 'vitest';
import { draft, isDraft, textOf } from './draft.ts';

describe('draft copy', () => {
  it('tells a draft line from confirmed copy and keeps its source', () => {
    const d = draft('a line', { src: 'cv:BACKEND' });
    expect(isDraft(d)).toBe(true);
    expect(d).toMatchObject({ draft: true, text: 'a line', src: 'cv:BACKEND' });
    expect(isDraft('confirmed')).toBe(false);
  });

  it('textOf gives the words either way', () => {
    expect(textOf(draft('x', { src: 's' }))).toBe('x');
    expect(textOf('y')).toBe('y');
  });
});
