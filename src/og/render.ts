// Build-time Open Graph card (1200x630 PNG): satori lays out the card as SVG, resvg rasterises
// it. Moss palette, Departure Mono only. satori reads TTF, OTF and WOFF (not WOFF2), so the font
// comes from the OTF in src/assets/fonts.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

import { OG_HEIGHT, OG_WIDTH } from './dimensions';

const COLOR = {
  ink: '#131413',
  paper: '#e6e9e1',
  hd: '#f5f6f0',
  mute: '#9a9f93',
  acc: '#a3bb95',
  pop: '#cdf03d',
  x1: '#5d6e55',
  x2: '#3e4a39',
  x3: '#262e24',
  rule: '#2a2f28',
} as const;

const FONT_FILE = join(process.cwd(), 'src', 'assets', 'fonts', 'DepartureMono-Regular.otf');
let fontPromise: Promise<Buffer> | undefined;
const loadFont = () => (fontPromise ??= readFile(FONT_FILE));

interface Node {
  type: string;
  props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown };
}

const h = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style, children },
});

export interface OgCard {
  readonly name: string;
  readonly role: string;
  readonly line: string;
  readonly url: string;
}

/** Six stacked, offset copies of the name give the extruded look (satori has no text-shadow list). */
function extruded(text: string): Node {
  const tones = [COLOR.x3, COLOR.x3, COLOR.x2, COLOR.x2, COLOR.x1, COLOR.x1];
  const layers = tones.map((color, i) => {
    const step = (tones.length - i) * 2.6;
    return h(
      'div',
      { position: 'absolute', left: step, top: step * 1.15, display: 'flex', color },
      text,
    );
  });
  return h(
    'div',
    { position: 'relative', display: 'flex', fontSize: 132, lineHeight: 1, letterSpacing: -2 },
    [...layers, h('div', { position: 'relative', display: 'flex', color: COLOR.hd }, text)],
  );
}

function card({ name, role, line, url }: OgCard): Node {
  const [first = name, ...rest] = name.split(' ');
  return h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      boxSizing: 'border-box',
      width: OG_WIDTH,
      height: OG_HEIGHT,
      padding: 72,
      backgroundColor: COLOR.ink,
      fontFamily: 'Departure Mono',
    },
    [
      h(
        'div',
        { display: 'flex', alignItems: 'center', gap: 14, color: COLOR.paper, fontSize: 30 },
        [h('div', { width: 16, height: 30, backgroundColor: COLOR.pop }), 'ermocodes'],
      ),
      h('div', { display: 'flex', flexDirection: 'column', gap: 28 }, [
        extruded(first.toUpperCase()),
        extruded(rest.join(' ').toUpperCase()),
      ]),
      h(
        'div',
        {
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: 24,
          borderTop: `2px solid ${COLOR.rule}`,
          fontSize: 26,
        },
        [
          h('div', { display: 'flex', color: COLOR.paper }, `${role}. ${line}`),
          h('div', { display: 'flex', color: COLOR.acc }, url),
        ],
      ),
    ],
  );
}

/** Renders the card to PNG bytes. */
export async function renderOgImage(input: OgCard): Promise<Uint8Array<ArrayBuffer>> {
  const svg = await satori(card(input) as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [{ name: 'Departure Mono', data: await loadFont(), weight: 400, style: 'normal' }],
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
  return new Uint8Array(png);
}
