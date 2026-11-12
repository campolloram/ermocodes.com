#!/usr/bin/env node
// Headless Chromium screenshots of built pages at 390x844 and 1440x900 (dark only): the first
// screen and the full page. JPEG keeps committed captures small. Needs a running preview server.
// Usage: node scripts/screenshots.mjs <baseUrl> <outDir> <path> [<path> ...]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const QUALITY = 60;
const slug = (path) => (path === '/' ? 'home' : path.slice(1).replaceAll('/', '-'));

async function main([baseUrl, outDir, ...paths]) {
  if (!baseUrl || !outDir || paths.length === 0) {
    console.error('usage: screenshots.mjs <baseUrl> <outDir> <path> [<path> ...]');
    return 1;
  }
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [device, options] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
      const page = await context.newPage();
      for (const path of paths) {
        await page.goto(new URL(path, baseUrl).href, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const base = join(outDir, `${slug(path)}-${device}`);
        await page.screenshot({
          path: `${base}.jpg`,
          type: 'jpeg',
          quality: QUALITY,
          scale: 'css',
        });
        await page.screenshot({
          path: `${base}-full.jpg`,
          type: 'jpeg',
          quality: QUALITY,
          scale: 'css',
          fullPage: true,
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
