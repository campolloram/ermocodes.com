// S2 motion acceptance (Chromium and Firefox; the reduced project has its own test). Firefox
// headless may lack WebGL: then these assert the plain-DOM fallback instead.
import { expect, test } from '@playwright/test';
import { FALLBACK_MS } from '../../src/motion/head-script.mjs';
import { disableWebGL, hasWebGL, needsWebGL } from './helpers/webgl';

const isReduced = (name: string) => name === 'chromium-reduced';

test('the canvas turns on within 3s (or the plain DOM shows when WebGL is missing)', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project has its own test');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const gl = await hasWebGL(page);
  if (testInfo.project.name.startsWith('chromium')) needsWebGL(testInfo, gl);
  if (gl) {
    await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 3000 });
    await expect(page.locator('html')).toHaveClass(/\bmotion\b/);
    await expect
      .poll(() => page.evaluate(() => window.__ecMotion?.frames() ?? 0))
      .toBeGreaterThan(3);
  } else {
    await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/);
    await expect(page.locator('.w1')).toHaveCSS('opacity', '1', { timeout: FALLBACK_MS + 1500 });
  }
  expect(errors).toEqual([]);
});

test('canvas text is drawn in the registered site font, once it has loaded', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project has its own test');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 5000 });
  // document.fonts.check() is true for a family no face has (the old "Departure Mono" bug), so
  // the family the canvas code names must be one of the faces that loaded.
  const r = await page.evaluate(() => {
    const unquote = (f: string) => f.trim().replace(/^["']|["']$/g, '');
    const font = window.__ecMotion?.font() ?? '';
    const fam = unquote(font.replace(/^[\d.]+px\s+/, '').split(',')[0] ?? '');
    const faces = [...document.fonts].map((f) => `${unquote(f.family)}:${f.status}`);
    return { fam, faces, ok: faces.includes(`${fam}:loaded`) };
  });
  expect(r.ok, `canvas family "${r.fam}" vs faces ${r.faces.join(', ')}`).toBe(true);
});

test('with WebGL disabled the DOM name is visible once the fallback delay has passed and nothing errors', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project has its own test');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await disableWebGL(page);
  await page.goto('/');
  await expect(page.locator('.w1')).toHaveCSS('opacity', '1', { timeout: FALLBACK_MS + 1500 });
  await expect(page.locator('.w2')).toHaveCSS('opacity', '1');
  await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/);
  await expect(page.locator('#ascii.on')).toHaveCount(0);
  await expect(page.locator('.co')).toHaveCount(6);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('the frame counter stops while the tab is hidden', async ({ page }, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project has its own test');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 3000 });
  await expect.poll(() => page.evaluate(() => window.__ecMotion?.frames() ?? 0)).toBeGreaterThan(5);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Poll until the counter stops changing, then hold: no frame may follow.
  const frames = () => page.evaluate(() => window.__ecMotion?.frames() ?? 0);
  let last = -1;
  await expect
    .poll(
      async () => {
        const n = await frames();
        const same = n === last;
        last = n;
        return same;
      },
      { intervals: [200] },
    )
    .toBe(true);
  const before = last;
  await page.waitForTimeout(600);
  const after = await frames();
  expect(after).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() => page.evaluate(() => window.__ecMotion?.frames() ?? 0))
    .toBeGreaterThan(after);
});

test('a stalled scroll-layer download never leaves the Experience names hidden', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced motion is plain anyway');
  test.setTimeout(80_000);
  // The chunk never arrives: the request just hangs.
  await page.route(/\/_astro\/timeline\./, () => {});
  await page.goto('/#experience');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('html')).toHaveClass(/\bmotion\b/);
  // While waiting, the page is in the held layout; after the stall limit it is plain DOM, and
  // all six companies are on screen.
  await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/, { timeout: 40_000 });
  await expect(page.locator('html')).toHaveAttribute('data-mfallback', 'stalled');
  const co = page.locator('.co');
  await expect(co).toHaveCount(6);
  for (const c of await co.all()) await expect(c).toHaveCSS('opacity', '1');
  // The split letters are plain text again.
  await expect(page.locator('.hero .ch')).toHaveCount(0);
});

test('a page loaded in a background tab keeps its motion when the tab is shown late', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced motion is plain anyway');
  test.setTimeout(80_000);
  // A hidden document: no frames run until it is shown (as in a background tab).
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const held: FrameRequestCallback[] = [];
    let hidden = true;
    Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
    Object.defineProperty(document, 'visibilityState', {
      get: () => (hidden ? 'hidden' : 'visible'),
      configurable: true,
    });
    window.requestAnimationFrame = (cb) => {
      if (hidden) return held.push(cb);
      return raf(cb);
    };
    (window as unknown as { __show: () => void }).__show = () => {
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      for (const cb of held.splice(0)) raf(cb);
    };
  });
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('html')).toHaveClass(/\bmotion\b/);
  await page.waitForTimeout(10_000);
  await expect(page.locator('html')).toHaveClass(/\bmotion\b/);
  await page.evaluate(() => (window as unknown as { __show: () => void }).__show());
  await expect(page.locator('html')).toHaveClass(/\bmscroll\b/, { timeout: 20_000 });
  await expect(page.locator('html')).not.toHaveAttribute('data-mfallback', /./);
});

test('reduced motion: no motion layer, no pin, six companies in flow, the loop never runs', async ({
  page,
}, testInfo) => {
  test.skip(!isReduced(testInfo.project.name), 'reduced-motion project only');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.waitForTimeout(1200);
  await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/);
  await expect(page.locator('html')).not.toHaveClass(/\bmscroll\b/);
  await expect(page.locator('.pin-spacer')).toHaveCount(0);
  await expect(page.locator('.co')).toHaveCount(6);
  for (const co of await page.locator('.co').all()) await expect(co).toBeVisible();
  expect(await page.evaluate(() => window.__ecMotion?.frames() ?? 0)).toBe(0);
  const position = await page.locator('.stage').evaluate((el) => getComputedStyle(el).position);
  expect(position).toBe('static');
  await expect(page.locator('.w1')).toHaveCSS('opacity', '1');
  expect(errors).toEqual([]);
});

test('the hero is never bare: static figure with reduced motion, DOM name always', async ({
  page,
}, testInfo) => {
  test.skip(!isReduced(testInfo.project.name), 'reduced-motion project only');
  await page.goto('/');
  if (await hasWebGL(page))
    await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 3000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
