import { describe, expect, test } from 'vitest';
import { keyStep } from './keys';

const key = (k: string, shiftKey = false) => ({ key: k, shiftKey });
const el = (match: boolean) => ({ closest: () => (match ? {} : null) }) as unknown as Element;

describe('keyStep', () => {
  test('arrows are 40px, pages 87.5% of the view, Home and End are the ends', () => {
    expect(keyStep(key('ArrowDown'), null, 800)).toBe(40);
    expect(keyStep(key('ArrowUp'), null, 800)).toBe(-40);
    expect(keyStep(key('PageDown'), null, 800)).toBe(700);
    expect(keyStep(key('PageUp'), null, 800)).toBe(-700);
    expect(keyStep(key('End'), null, 800)).toBe(Infinity);
    expect(keyStep(key('Home'), null, 800)).toBe(-Infinity);
  });
  test("Space pages down, Shift+Space up, but Space on a button stays the button's", () => {
    expect(keyStep(key(' '), null, 800)).toBe(700);
    expect(keyStep(key(' ', true), null, 800)).toBe(-700);
    expect(keyStep(key(' '), el(true), 800)).toBe(0);
    expect(keyStep(key('ArrowDown'), el(true), 800)).toBe(40);
  });
  test('Shift with another key, and other keys, are not ours', () => {
    expect(keyStep(key('ArrowDown', true), null, 800)).toBe(0);
    expect(keyStep(key('a'), null, 800)).toBe(0);
  });
});
