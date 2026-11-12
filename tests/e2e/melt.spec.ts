// Decision 12 (L6b): the hero name melts under a fine mouse, only after the particle intro has
// settled, and replaces the old fracture hover. It is decoration: the h1 text stays in the
// accessibility tree and in the DOM; plain, reduced, paused, phone, touch-only, stalled and
// no-WebGL pages show the plain name with no melt. The lens over the ASCII figure (the grid's
// pointer heat) is untouched.
import { expect, test, type Page } from '@playwright/test';
import { SITE } from '../../src/content/site';
import { MOTION_PAUSE_KEY } from '../../src/motion/head-script.mjs';
import { disableWebGL, failWebGLAfterProbe, hasWebGL, needsWebGL } from './helpers/webgl';

const isReduced = (name: string) => name === 'chromium-reduced';
const isDesktop = (name: string) => name.endsWith('-desktop');

const INTRO_MS = 12_000;

// A software-GL page on a 2-vCPU runner answers each call in up to half a second: give every test room.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => testInfo.setTimeout(120_000));

const melting = (page: Page) => page.evaluate(() => window.__ecMotion?.melt() ?? 0);
const hiddenLetters = (page: Page) =>
  page.evaluate(() => document.querySelectorAll('.name .ch[style*="visibility: hidden"]').length);
const meltAttr = (page: Page) =>
  page.evaluate(() => document.querySelector('.name')?.hasAttribute('data-melt') ?? false);
const wordOpacity = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.name .w')].map((w) => getComputedStyle(w).opacity),
  );

/** The centre of the first word (GUILLERMO), where the mouse goes to melt it. */
async function overName(page: Page): Promise<{ x: number; y: number }> {
  const b = await page.locator('.name .w1').boundingBox();
  if (!b) throw new Error('no name box');
  return { x: b.x + b.width * 0.2, y: b.y + b.height * 0.5 };
}

/** A short mouse wiggle around a point (a mouse that rests sends no events). */
async function wiggle(page: Page, x: number, y: number, steps = 10): Promise<void> {
  await page.mouse.move(x - 30, y);
  for (let k = 0; k < steps; k += 1) {
    await page.mouse.move(x + k * 4, y + (k % 3) * 3);
    await page.waitForTimeout(35);
  }
}

/** The intro is over: its classes are off and the engine has drawn frames. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('html')).not.toHaveClass(/\bpwait\b|\bpbuild\b|\bpshow\b/, {
    timeout: INTRO_MS,
  });
  await expect
    .poll(() => page.evaluate(() => window.__ecMotion?.frames() ?? 0), { timeout: INTRO_MS })
    .toBeGreaterThan(5);
}

/** Wiggles over the name until the melt shows (the atlas is built when the browser is idle). */
async function meltIt(page: Page): Promise<void> {
  const { x, y } = await overName(page);
  await expect
    .poll(
      async () => {
        await wiggle(page, x, y, 6);
        return melting(page);
      },
      { timeout: 15_000, intervals: [50] },
    )
    .toBeGreaterThan(0);
}

async function nameStaysReal(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(SITE.name);
  expect(await page.locator('.name .sr').textContent()).toBe(SITE.name);
}

test('hover does nothing before the intro settles, then the name melts', async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name), 'fine mouse on a desktop viewport');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  needsWebGL(testInfo, await hasWebGL(page));
  // While the particles build the name (or the engine is starting) the mouse does nothing.
  let early = 0;
  const until = Date.now() + INTRO_MS;
  while (Date.now() < until) {
    const cls = await page.evaluate(() => document.documentElement.className);
    if (!/\bpwait\b|\bpbuild\b|\bpshow\b/.test(cls)) break;
    const box = await page.locator('.name .w1').boundingBox();
    if (box)
      await page.mouse.move(box.x + box.width * 0.3 + (early % 9) * 3, box.y + box.height / 2);
    expect(await melting(page), `melt while ${cls}`).toBe(0);
    expect(await meltAttr(page)).toBe(false);
    early += 1;
    await page.waitForTimeout(60);
  }
  await settled(page);
  const before = await page.locator('.name').boundingBox();
  await meltIt(page);
  expect(await meltAttr(page)).toBe(true);
  // The melt replaces the fracture: no particle bit is drawn for the hover.
  expect(await page.evaluate(() => window.__ecMotion?.bits() ?? -1)).toBe(0);
  // The melting letters are hidden from paint (the text itself stays): one read, so the engine
  // cannot move between the two counts.
  const both = await page.evaluate(() => ({
    melt: window.__ecMotion?.melt() ?? 0,
    hidden: document.querySelectorAll('.name .ch[style*="visibility: hidden"]').length,
  }));
  expect(both.hidden).toBeGreaterThan(0);
  expect(both.hidden).toBeLessThanOrEqual(both.melt);
  await nameStaysReal(page);
  expect(await page.locator('.name').boundingBox()).toEqual(before);
  expect(errors).toEqual([]);
});

test('leaving the name returns it to crisp text', async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name), 'fine mouse on a desktop viewport');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await settled(page);
  await meltIt(page);
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  await page.mouse.move(vp.width / 2, vp.height - 20);
  await expect.poll(() => melting(page), { timeout: 8000, intervals: [100] }).toBe(0);
  await expect.poll(() => hiddenLetters(page), { timeout: 3000 }).toBe(0);
  expect(await meltAttr(page)).toBe(false);
  expect(await wordOpacity(page)).toEqual(['1', '1']);
  await nameStaysReal(page);
});

test('the lens over the ASCII figure still follows the pointer and melts nothing', async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name), 'fine mouse on a desktop viewport');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await settled(page);
  await page.waitForTimeout(1500);
  // Well below the name, over the figure's lower half.
  const fig = await page.locator('.fig-slot').boundingBox();
  const name = await page.locator('.name .w2').boundingBox();
  if (!fig || !name) throw new Error('no boxes');
  const x = fig.x + fig.width * 0.5;
  const y = Math.min(fig.y + fig.height - 30, name.y + name.height + 230);
  let heat = 0;
  for (let k = 0; k < 12; k += 1) {
    await page.mouse.move(x + k * 6, y + (k % 2) * 4);
    await page.waitForTimeout(40);
    heat = Math.max(heat, await page.evaluate(() => window.__ecMotion?.heat() ?? 0));
  }
  expect(heat, 'the grid lights up under the pointer').toBeGreaterThan(0.01);
  expect(await melting(page)).toBe(0);
  expect(await hiddenLetters(page)).toBe(0);
});

test('pausing motion puts the plain name back at once and the melt stays off', async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name), 'fine mouse on a desktop viewport');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await settled(page);
  await meltIt(page);
  await page.locator('[data-mctl]').click();
  await expect(page.locator('html')).toHaveClass(/\bmpaused\b/);
  const { x, y } = await overName(page);
  await expect.poll(() => melting(page), { timeout: 3000 }).toBe(0);
  for (let k = 0; k < 3; k += 1) {
    await wiggle(page, x, y, 8);
    expect(await melting(page)).toBe(0);
  }
  expect(await hiddenLetters(page)).toBe(0);
  expect(await meltAttr(page)).toBe(false);
  expect(await wordOpacity(page)).toEqual(['1', '1']);
  await nameStaysReal(page);
});

test('a visit paused earlier never melts the name', async ({ page }, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name), 'fine mouse on a desktop viewport');
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), MOTION_PAUSE_KEY);
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('html')).toHaveClass(/\bmpaused\b/);
  await expect(page.locator('html')).not.toHaveClass(/\bpwait\b|\bpbuild\b|\bpshow\b/, {
    timeout: INTRO_MS,
  });
  await page.waitForTimeout(1500);
  const { x, y } = await overName(page);
  for (let k = 0; k < 4; k += 1) {
    await wiggle(page, x, y, 8);
    expect(await melting(page)).toBe(0);
  }
  expect(await hiddenLetters(page)).toBe(0);
  await nameStaysReal(page);
});

test('no WebGL: the plain name, no melt', async ({ page }, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project: own test');
  await disableWebGL(page);
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/, { timeout: INTRO_MS });
  const { x, y } = await overName(page);
  for (let k = 0; k < 3; k += 1) await wiggle(page, x, y, 8);
  expect(await meltAttr(page)).toBe(false);
  expect(await hiddenLetters(page)).toBe(0);
  expect(await wordOpacity(page)).toEqual(['1', '1']);
  await nameStaysReal(page);
});

test('an engine that cannot start: the plain name, no melt', async ({ page }, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project: own test');
  await failWebGLAfterProbe(page);
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/, { timeout: INTRO_MS });
  const { x, y } = await overName(page);
  for (let k = 0; k < 3; k += 1) await wiggle(page, x, y, 8);
  expect(await meltAttr(page)).toBe(false);
  expect(await hiddenLetters(page)).toBe(0);
  await nameStaysReal(page);
});

test('reduced motion: the plain name, no melt', async ({ page }, testInfo) => {
  test.skip(!isReduced(testInfo.project.name), 'reduced project only');
  await page.goto('/');
  await page.waitForTimeout(1500);
  const { x, y } = await overName(page);
  for (let k = 0; k < 3; k += 1) await wiggle(page, x, y, 8);
  expect(await meltAttr(page)).toBe(false);
  expect(await hiddenLetters(page)).toBe(0);
  expect(await wordOpacity(page)).toEqual(['1', '1']);
  await nameStaysReal(page);
});

test('phones and touch screens: a tap or a mouse on a phone-sized page never melts', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('-mobile'), 'phone projects only');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await settled(page);
  await page.waitForTimeout(1500);
  const { x, y } = await overName(page);
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  await wiggle(page, x, y, 8);
  await page.waitForTimeout(500);
  expect(await melting(page)).toBe(0);
  expect(await hiddenLetters(page)).toBe(0);
  expect(await meltAttr(page)).toBe(false);
  await nameStaysReal(page);
});

test('after a stall the page is plain DOM and the name does not melt', async ({
  page,
}, testInfo) => {
  test.skip(!isDesktop(testInfo.project.name), 'fine mouse on a desktop viewport');
  await page.route(/\/_astro\/timeline\./, () => {});
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('html')).toHaveAttribute('data-mfallback', 'stalled', {
    timeout: 40_000,
  });
  const { x, y } = await overName(page);
  for (let k = 0; k < 3; k += 1) await wiggle(page, x, y, 8);
  expect(await meltAttr(page)).toBe(false);
  expect(await hiddenLetters(page)).toBe(0);
  expect(await wordOpacity(page)).toEqual(['1', '1']);
  await nameStaysReal(page);
});

test.describe('touch-only desktop-sized screen', () => {
  test.use({ hasTouch: true });
  test('a finger on the name never melts it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'one Chromium run is enough');
    await page.goto('/');
    needsWebGL(testInfo, await hasWebGL(page));
    await settled(page);
    await page.waitForTimeout(1500);
    const { x, y } = await overName(page);
    for (let k = 0; k < 4; k += 1) {
      await page.touchscreen.tap(x + k * 20, y);
      await page.waitForTimeout(120);
    }
    expect(await melting(page)).toBe(0);
    expect(await hiddenLetters(page)).toBe(0);
    expect(await meltAttr(page)).toBe(false);
    await nameStaysReal(page);
  });
});
