import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS, RETIRED_COLORS } from './tokens';

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const tokensCss = read('./tokens.css');
const SECTIONS = readdirSync(fileURLToPath(new URL('./sections', import.meta.url))).sort();
const globalCss = [read('./global.css'), ...SECTIONS.map((f) => read(`./sections/${f}`))].join(
  '\n',
);

function declared(name: string): string | undefined {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss);
  return match?.[1]?.trim();
}

describe('design tokens', () => {
  it.each(COLOR_TOKENS)('$name matches tokens.css', ({ name, value }) => {
    expect(declared(name)).toBe(value);
  });

  it('keeps the retired cyan palette out of the stylesheets', () => {
    for (const color of RETIRED_COLORS) {
      expect(tokensCss.toLowerCase()).not.toContain(color);
      expect(globalCss.toLowerCase()).not.toContain(color);
    }
  });

  it('uses Departure Mono as the only typeface', () => {
    expect(tokensCss).toContain('var(--font-departure)');
    const families = [...globalCss.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(families.every((f) => f === 'var(--f)')).toBe(true);
  });
});
