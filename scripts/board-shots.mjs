#!/usr/bin/env node
// Taste-panel shots: serves a built dir locally, headless Chromium only.
// Usage: node scripts/board-shots.mjs --dir dist --routes / --widths 390,1440 --out out/board [--reduced]
//   [--software] [--allow-plain] (a motion set fails if the page fell back to plain DOM)
// Per route/width: first viewport, full page, and scroll stops (down 0..100% in 10% steps, then back up).
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const dir = resolve(arg('dir', 'dist'));
const out = resolve(arg('out', 'out/board'));
const routes = arg('routes', '/').split(',');
const widths = arg('widths', '390,1440').split(',').map(Number);
const reduced = process.argv.includes('--reduced');
const allowPlain = process.argv.includes('--allow-plain');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.glb': 'model/gltf-binary',
};
const slug = (r) => (r === '/' ? 'home' : r.replace(/^\/|\/$/g, '').replaceAll('/', '-'));

const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = join(dir, p);
  if (!f.startsWith(dir)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  else if (!existsSync(f) && existsSync(`${f}.html`)) f = `${f}.html`;
  if (!existsSync(f)) {
    res.writeHead(404).end('nf');
    return;
  }
  res
    .writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
    .end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const settle = (page, ms = 1600) => page.waitForTimeout(ms);
const pad = (n) => String(n).padStart(3, '0');

// Headless Chromium falls back to SwiftShader (software GL), which the site treats as a weak
// device and starts on its lightest quality tier: coarser, thinner figure than real devices show.
// On macOS ask for the real GPU through ANGLE/Metal so the shots show the normal tier; elsewhere
// (or with --software) keep the default. Override flags with BOARD_CHROMIUM_ARGS="--a --b".
const gpuArgs =
  process.env.BOARD_CHROMIUM_ARGS?.split(' ').filter(Boolean) ??
  (process.platform === 'darwin' && !process.argv.includes('--software')
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : []);
const browser = await chromium.launch({ args: gpuArgs });
let code = 0;
try {
  for (const width of widths) {
    const mobile = width < 700;
    const ctx = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 900 },
      deviceScaleFactor: 1,
      hasTouch: mobile,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    const page = await ctx.newPage();
    for (const route of routes) {
      const d = join(out, `${slug(route)}-${width}`);
      mkdirSync(d, { recursive: true });
      await page.goto(new URL(route, base).href, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await settle(page, 1500);
      // A motion set must show what a GPU visitor sees. Software GL (--software, or no GPU) gets
      // the plain page in a production build, which reads as a broken motion build on the board.
      if (!reduced && !allowPlain) {
        const st = await page.evaluate(() => ({
          motion: document.documentElement.classList.contains('motion'),
          why: document.documentElement.dataset.mfallback ?? '',
        }));
        if (!st.motion)
          throw new Error(
            `motion layer is off on ${route} at ${width}px (${st.why || 'no html.motion: software GL or no WebGL2'}); ` +
              'shoot on a GPU, or use a PUBLIC_TEST_HOOKS=1 build with --software, or pass --allow-plain',
          );
      }
      await page.screenshot({ path: join(d, 'first-viewport.png') });
      const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const stops = [...Array(11).keys()].map((i) => i * 10);
      const seq = [
        ...stops.map((p) => ['down', p]),
        ...stops
          .slice(0, -1)
          .reverse()
          .map((p) => ['up', p]),
      ];
      for (const [dirn, pct] of seq) {
        await page.evaluate((y) => window.scrollTo(0, y), Math.round((total * pct) / 100));
        await settle(page);
        await page.screenshot({ path: join(d, `stop-${dirn}-${pad(pct)}.png`) });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);
      await page.screenshot({ path: join(d, 'full-page.png'), fullPage: true });
    }
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
