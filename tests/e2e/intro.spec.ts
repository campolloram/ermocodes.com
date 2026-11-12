// Decision 1, as changed on 2026-11-09 (L6a): on the motion path the dust particles build the name
// and the crisp text fades in over them; the real h1 text is in the DOM and the accessibility tree
// the whole time. The plain path, reduced motion, motion paused and a failed engine show the plain
// name at first paint. A safety timer (head-script FALLBACK_MS) shows the text if the particles
// have not started in time. Later lanes (first screen, melt) must keep this true.
import { expect, test, type Page } from '@playwright/test';
import { SITE } from '../../src/content/site';
import { FALLBACK_MS, MOTION_PAUSE_KEY } from '../../src/motion/head-script.mjs';
import { CLS_BUDGET, trackLayoutShifts } from './helpers/cls';
import { disableWebGL, failWebGLAfterProbe, hasWebGL, needsWebGL } from './helpers/webgl';

/** The intro's own time budget (bits + cross-fade, 3.5 s hard cap) plus slack for slow runners. */
const INTRO_MS = 8000;
/** Plain paths show the name at once; the safety timer is the longest the name can stay unpainted. */
const SAFETY_MS = FALLBACK_MS + 1500;

const isReduced = (name: string) => name === 'chromium-reduced';

function ratio(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The name is real DOM: both words opaque, no hidden letter, AA contrast against the page. */
async function nameReadable(page: Page): Promise<void> {
  const r = await page.evaluate(() => {
    const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const words = [...document.querySelectorAll<HTMLElement>('.name .w')];
    const bg = parse(getComputedStyle(document.body).backgroundColor);
    return {
      n: words.length,
      opacity: words.map((w) => getComputedStyle(w).opacity),
      colors: words.map((w) => parse(getComputedStyle(w).color)),
      hiddenLetters: document.querySelectorAll('.name .w [style*="visibility: hidden"]').length,
      bg,
    };
  });
  expect(r.n).toBe(2);
  expect(r.opacity).toEqual(['1', '1']);
  for (const c of r.colors) {
    expect(c[3] ?? 1, 'name colour is opaque').toBe(1);
    expect(ratio(c.slice(0, 3), r.bg.slice(0, 3))).toBeGreaterThanOrEqual(4.5);
  }
  expect(r.hiddenLetters).toBe(0);
}

/** The name is readable through accessibility at every moment, whatever is painted. */
async function nameInA11yTree(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(SITE.name);
}

/** Computed opacity of the two drawn words. */
const wordOpacity = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.name .w')].map((w) => getComputedStyle(w).opacity),
  );

/** Marks whether the particle intro ran (html.pbuild appeared) before any page script runs. */
async function watchIntro(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __sawBuild: boolean }).__sawBuild = false;
    new MutationObserver(() => {
      if (document.documentElement.classList.contains('pbuild'))
        (window as unknown as { __sawBuild: boolean }).__sawBuild = true;
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
}

test('the name is in the accessibility tree from the first moment to the end of the intro', async ({
  page,
}, testInfo) => {
  await page.goto('/', { waitUntil: 'commit' });
  const gl = !isReduced(testInfo.project.name) && (await hasWebGL(page).catch(() => false));
  const until = Date.now() + (gl ? 2500 : 800);
  do {
    await page.waitForLoadState('domcontentloaded');
    await nameInA11yTree(page);
    await page.waitForTimeout(100);
  } while (Date.now() < until);
});

test('plain paths (no WebGL, reduced motion) show the name as text at first paint', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  if (!isReduced(testInfo.project.name)) await disableWebGL(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.name .w1')).toBeVisible();
  expect(await wordOpacity(page)).toEqual(['1', '1']);
  await expect(page.locator('html')).not.toHaveClass(/\bpwait\b|\bpbuild\b/);
  await nameReadable(page);
  await page.waitForTimeout(500);
  await nameReadable(page);
  expect(errors).toEqual([]);
});

test('a visit paused earlier shows the name as text at first paint, with no intro', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project: no intro');
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), MOTION_PAUSE_KEY);
  await watchIntro(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('html')).toHaveClass(/\bmpaused\b/);
  expect(await wordOpacity(page)).toEqual(['1', '1']);
  await expect(page.locator('html')).not.toHaveClass(/\bpwait\b/, { timeout: INTRO_MS });
  await nameReadable(page);
  expect(await page.evaluate(() => (window as unknown as { __sawBuild: boolean }).__sawBuild)).toBe(
    false,
  );
});

test('an engine that cannot start falls back to the plain name at once', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project: no intro');
  await failWebGLAfterProbe(page);
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/, { timeout: INTRO_MS });
  await expect(page.locator('html')).not.toHaveClass(/\bpwait\b|\bpbuild\b|\bpshow\b/);
  await nameReadable(page);
});

test('WebGL: the particles build the name, then the text shows (or the safety timer shows it)', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced project: no intro');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await watchIntro(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('html')).toHaveClass(/\bmotion\b/);
  // First paint: the name is not drawn as text yet, but it keeps its box and its accessible name.
  const first = await page.evaluate(() => {
    const r = (document.querySelector('.name') as HTMLElement).getBoundingClientRect();
    return {
      op: [...document.querySelectorAll('.name .w')].map((w) => getComputedStyle(w).opacity),
      h: Math.round(r.height),
      pwait: document.documentElement.classList.contains('pwait'),
    };
  });
  if (first.pwait) {
    expect(first.op).toEqual(['0', '0']);
    expect(first.h).toBeGreaterThan(100);
  }
  await nameInA11yTree(page);
  // Visible text shows after the particles settle, or at the latest after the safety timeout.
  await expect
    .poll(() => wordOpacity(page), { timeout: SAFETY_MS + INTRO_MS, intervals: [100] })
    .toEqual(['1', '1']);
  await expect(page.locator('html')).not.toHaveClass(/\bpwait\b|\bpbuild\b|\bpshow\b/, {
    timeout: INTRO_MS,
  });
  // Nothing fell back, and the box did not move.
  await expect(page.locator('html')).toHaveClass(/\bmotion\b/);
  await expect(page.locator('html')).not.toHaveAttribute('data-mfallback', /.*/);
  const last = await page.evaluate(() =>
    Math.round((document.querySelector('.name') as HTMLElement).getBoundingClientRect().height),
  );
  expect(last).toBe(first.h);
  await nameReadable(page);
  // The engine started the intro or the safety timer won on a slow runner: either way it drew.
  await expect
    .poll(() => page.evaluate(() => window.__ecMotion?.frames() ?? 0), { timeout: INTRO_MS })
    .toBeGreaterThan(5);
  const sawBuild = await page.evaluate(
    () => (window as unknown as { __sawBuild: boolean }).__sawBuild,
  );
  if (!sawBuild) test.info().annotations.push({ type: 'note', description: 'safety timer won' });
  expect(errors).toEqual([]);
});

test('the intro stays within the CLS budget', async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith('chromium') || isReduced(testInfo.project.name),
    'layout-shift entries are Chromium-only; motion projects only',
  );
  await trackLayoutShifts(page);
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect.poll(() => wordOpacity(page), { timeout: SAFETY_MS + INTRO_MS }).toEqual(['1', '1']);
  await page.waitForTimeout(800);
  const cls = await page.evaluate(() => window.__ecCls ?? { value: 0, sources: [] });
  expect(cls.value, `layout shift: ${cls.sources.join(', ')}`).toBeLessThanOrEqual(CLS_BUDGET);
});
