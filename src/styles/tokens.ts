// Token catalogue. tokens.test.ts checks every value against tokens.css, so it cannot drift.
export interface ColorToken {
  readonly name: string;
  readonly value: string;
  readonly use: string;
}

export const COLOR_TOKENS: readonly ColorToken[] = [
  { name: '--ink', value: '#131413', use: 'Matte charcoal ground' },
  { name: '--paper', value: '#e6e9e1', use: 'Body text' },
  { name: '--hd', value: '#f5f6f0', use: 'Headers' },
  { name: '--mute', value: '#9a9f93', use: 'Labels' },
  { name: '--acc', value: '#a3bb95', use: 'Moss: big companies, links' },
  { name: '--sig', value: '#cdf03d', use: 'Acid lime: startups' },
  { name: '--pop', value: '#cdf03d', use: 'Caret, live dot' },
  { name: '--hi', value: '#f4ffd0', use: 'Canvas highlight (S2)' },
  { name: '--x1', value: '#5d6e55', use: 'Extrusion, lightest' },
  { name: '--x2', value: '#3e4a39', use: 'Extrusion, mid' },
  { name: '--x3', value: '#262e24', use: 'Extrusion, darkest' },
  { name: '--rule', value: 'rgba(170, 185, 160, 0.17)', use: 'Hairlines' },
];

/** Hex colours the old cyan palette used; none may come back. */
export const RETIRED_COLORS = ['#3cf0ff', '#070a10'] as const;
