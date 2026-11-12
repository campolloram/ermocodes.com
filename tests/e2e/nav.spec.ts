// UX round 1 regressions: in-page links, the skip link and direct #links land on their section
// with motion on (pins and the sticky stage in place); lines fade in on enter with the real text always in the DOM; scrolling with motion on keeps CLS in budget; the queue demo's
// control is in the tab order from load.
import { expect, test, type Page } from '@playwright/test';
import { CLS_BUDGET, trackLayoutShifts } from './helpers/cls';
import { failWebGLAfterProbe, hasWebGL, needsWebGL } from './helpers/webgl';

const isReduced = (name: string) => name === 'chromium-reduced';

/**
 * Waits until the motion layer has taken over (html.mscroll) or the page has settled on plain DOM
 * (html.motion came off: no WebGL, as on Firefox in CI), and returns which. Returning as soon as
 * plain DOM is known, rather than waiting out the timeout for a smooth scroll that never comes,
 * keeps the no-WebGL projects from idling 8 s per test.
 */
async function settle(page: Page, project: string): Promise<boolean> {
  if (isReduced(project)) return false;
  // A timeout here is a real failure (neither motion nor plain DOM settled), so it is not caught.
  await page
    .locator('html.mscroll, html:not(.motion)')
    .waitFor({ state: 'attached', timeout: 10_000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => document.documentElement.classList.contains('mscroll'));
}

for (const hash of ['#projects', '#queue', '#contact']) {
  test(`the ${hash} link lands on its section, sets the hash and moves focus`, async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await settle(page, testInfo.project.name);
    // A click right after the browser scrolled the link into view: the case that used to stop
    // thousands of pixels short (smooth scroll measured from a stale position).
    await page.locator(`#main a[href="${hash}"]`).first().click();
    await landedOn(page, hash);
    expect(await page.evaluate(() => location.hash)).toBe(hash);
    // Focus moves to the section in every mode (smooth scroll or the browser's own jump).
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(hash.slice(1));
  });
}

test('a direct #queue link lands on the queue once the pins are in', async ({ page }, testInfo) => {
  await page.goto('/#queue');
  await settle(page, testInfo.project.name);
  await page.waitForTimeout(600);
  await landedOn(page, '#queue');
});

test('a direct #queue link still lands when WebGL fails after the probe', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'motion projects only');
  // The head script's probe got a context, so the page painted in the long layout and the browser
  // jumped to #queue there; then the engine gets none and the page gets shorter: the reader must
  // stay on the queue, and the switch must not count as a layout shift.
  await failWebGLAfterProbe(page);
  await trackLayoutShifts(page);
  await page.addInitScript(() => {
    const w = window as Window & { __ecWasMotion?: boolean };
    w.__ecWasMotion = false;
    const tick = () => {
      if (document.documentElement.classList.contains('motion')) w.__ecWasMotion = true;
      else if (document.readyState === 'complete' && w.__ecWasMotion) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto('/#queue');
  await expect(page.locator('html')).toHaveAttribute('data-mboot', '1');
  await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/, { timeout: 10_000 });
  const wasMotion = await page.evaluate(
    () => (window as Window & { __ecWasMotion?: boolean }).__ecWasMotion ?? false,
  );
  // Firefox without a GPU fails the probe itself, so the long layout never comes up there.
  needsWebGL(testInfo, wasMotion);
  await landedOn(page, '#queue');
  if (testInfo.project.name.startsWith('chromium')) {
    const cls = await page.evaluate(() => window.__ecCls ?? { value: 0, sources: [] });
    expect(cls.value, `layout shift: ${cls.sources.join(', ')}`).toBeLessThanOrEqual(CLS_BUDGET);
  }
  // A reload keeps the place the browser restores (the visit before had the same plain layout).
  const y0 = await page.evaluate(() => Math.round(scrollY));
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/\bmotion\b/, { timeout: 10_000 });
  await restoredTo(page, y0);
});

test('the skip link moves focus to main', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'keyboard path runs on desktop projects');
  await page.goto('/');
  await settle(page, testInfo.project.name);
  await page.keyboard.press('Tab');
  await expect(page.locator('a.skip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
  // The next Tab skips the header and goes into the page.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#main')))).toBeTruthy();
});

test('the kill-a-worker control is in the tab order from load', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'keyboard path runs on desktop projects');
  // Up to 20 Tab presses: on a CPU-starved software-GL runner each press and check took ~3 s.
  test.setTimeout(90_000);
  await page.goto('/');
  await settle(page, testInfo.project.name);
  const btn = page.locator('[data-kill]');
  await expect(btn).not.toHaveAttribute('hidden');
  let reached = false;
  for (let i = 0; i < 20 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await btn.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-demo]')).toHaveAttribute('data-state', /running|settled/, {
    timeout: 8000,
  });
});

test('lines fade in on enter: opacity only, the text never changes, reduced motion has no fade', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const SEL = '.do-list li, .proj-line, .stack-row, .queue-intro, .about p';
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  // The real text, from the page with no script at all.
  const plain = await browser.newContext({ javaScriptEnabled: false });
  const ref = await plain.newPage();
  await ref.goto('/');
  const expected = (await ref.locator(SEL).allTextContents()).map(norm);
  await plain.close();

  await page.goto('/');
  const motion = await settle(page, testInfo.project.name);
  if (isReduced(testInfo.project.name) || !motion) {
    // Reduced motion and plain DOM: no fade class anywhere, every line opaque at load.
    await expect(page.locator('.fade-in')).toHaveCount(0);
    for (const el of await page.locator(SEL).all()) await expect(el).toHaveCSS('opacity', '1');
    return;
  }
  // Scroll through the page, watching every DOM mutation inside the fading lines: no text node or
  // child list may change (no glyph swaps), only the class attribute.
  const seen = await page.evaluate(async (sel) => {
    const els = [...document.querySelectorAll(sel)];
    let textChanges = 0;
    const mo = new MutationObserver((list) => {
      for (const m of list) if (m.type !== 'attributes') textChanges += 1;
    });
    for (const el of els) mo.observe(el, { subtree: true, childList: true, characterData: true });
    const total = document.documentElement.scrollHeight - innerHeight;
    for (let y = 0; y <= total + 400; y += Math.round(innerHeight / 3)) {
      scrollTo({ top: Math.min(y, total), behavior: 'instant' });
      for (let f = 0; f < 2; f += 1) await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => setTimeout(r, 900));
    mo.disconnect();
    return { textChanges, faded: document.querySelectorAll('.fade-in').length };
  }, SEL);
  expect(seen.textChanges).toBe(0);
  expect(seen.faded).toBeGreaterThan(0);
  // Settled within 600 ms of entering: every line that was scrolled past is opaque.
  for (const el of await page.locator('.fade-in').all()) await expect(el).toHaveCSS('opacity', '1');
  expect((await page.locator(SEL).allTextContents()).map(norm)).toEqual(expected);
});

test('scrolling with motion on stays within the CLS budget', async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith('chromium') || isReduced(testInfo.project.name),
    'layout-shift entries are Chromium-only; motion projects only',
  );
  test.setTimeout(60_000);
  await trackLayoutShifts(page);
  await page.goto('/');
  needsWebGL(testInfo, await settle(page, testInfo.project.name));
  await page.evaluate(async () => {
    const total = document.documentElement.scrollHeight - innerHeight;
    for (let y = 0; y <= total; y += 240) {
      scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 40));
    }
  });
  await page.waitForTimeout(600);
  const cls = await page.evaluate(() => window.__ecCls ?? { value: 0, sources: [] });
  expect(cls.value, `layout shift: ${cls.sources.join(', ')}`).toBeLessThanOrEqual(CLS_BUDGET);
});

// UX round 2: reload and back keep the place, the queue demo never moves the page and its counters
// match its log, the pause control, and the hero intro staying in the accessibility tree.

/** Waits until scrollY holds still for half a second, and returns it. */
async function restingY(page: Page): Promise<number> {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const y = await page.evaluate(() => Math.round(scrollY));
        const still = y === last;
        last = y;
        return still;
      },
      { timeout: 10_000, intervals: [500] },
    )
    .toBe(true);
  return last;
}

/**
 * Waits until scrollY is within 2px of `want`, then checks it holds there for a moment. The state
 * to wait on is the target position itself: "scrollY stopped changing" is also true in the gap
 * before the engine restores or starts a scroll, which let a load-starved runner read a stale value
 * (#contact landed 510px off).
 */
async function restoredTo(page: Page, want: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000, intervals: [100] })
    .toBeGreaterThan(want - 3);
  await expect
    .poll(() => page.evaluate(() => Math.round(scrollY)), { timeout: 10_000, intervals: [100] })
    .toBeLessThan(want + 3);
  // It holds: nothing is still moving the page away from the place.
  await page.waitForTimeout(300);
  expect(Math.abs((await page.evaluate(() => Math.round(scrollY))) - want)).toBeLessThanOrEqual(2);
}

/** Waits until the section's top sits on the header line (within 2px), then checks it holds. */
async function landedOn(page: Page, sel: string): Promise<void> {
  const off = () =>
    page.evaluate((s) => {
      const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      return Math.round((document.querySelector(s)?.getBoundingClientRect().top ?? 1e6) - pad);
    }, sel);
  await expect
    .poll(async () => Math.abs(await off()), { timeout: 10_000, intervals: [100] })
    .toBeLessThanOrEqual(2);
  await page.waitForTimeout(300);
  expect(Math.abs(await off())).toBeLessThanOrEqual(2);
}

test('reload part-way down keeps the place; back from a #link returns to it', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await settle(page, testInfo.project.name);
  await page.evaluate(() =>
    scrollTo({
      top: Math.round(document.documentElement.scrollHeight * 0.45),
      behavior: 'instant',
    }),
  );
  const y0 = await restingY(page);
  await page.reload();
  await settle(page, testInfo.project.name);
  await restoredTo(page, y0);
  await page.locator('header a[href="#contact"]').click();
  await landedOn(page, '#contact');
  await page.goBack();
  await restoredTo(page, y0);
});

test('pressing kill a worker never moves the page or changes its height', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await settle(page, testInfo.project.name);
  await page.locator('#queue').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-demo][data-ready]')).toHaveCount(1, { timeout: 8000 });
  const btn = page.locator('[data-kill]');
  await btn.scrollIntoViewIfNeeded();
  await restingY(page);
  const look = () =>
    page.evaluate(() => ({
      y: Math.round(scrollY),
      page: document.documentElement.scrollHeight,
      demo: Math.round(document.querySelector('[data-demo]')?.getBoundingClientRect().height ?? 0),
    }));
  const before = await look();
  if (testInfo.project.name === 'chromium-mobile') await btn.tap();
  else await btn.click();
  const demo = page.locator('[data-demo]');
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(400);
    expect(await look()).toEqual(before);
  }
  await expect(demo).toHaveAttribute('data-state', 'settled', { timeout: 20_000 });
  expect(await look()).toEqual(before);
});

test('the queue demo opens ready, and its retries counter matches the log', async ({ page }) => {
  await page.goto('/');
  await page.locator('#queue').scrollIntoViewIfNeeded();
  const demo = page.locator('[data-demo]');
  await expect(demo).toHaveAttribute('data-state', 'ready', { timeout: 8000 });
  for (const k of ['submitted', 'succeeded', 'retries', 'lost'])
    await expect(page.locator(`[data-m="${k}"]`)).toHaveText('0');
  await expect(page.locator('.o-ready')).toBeVisible();
  await expect(page.locator('.log li')).toHaveCount(0);
  await page.locator('[data-kill]').click();
  await expect(demo).toHaveAttribute('data-state', 'settled', { timeout: 20_000 });
  await expect(page.locator('.log')).toContainText('redelivering job');
  await expect(page.locator('.log')).toContainText('received again (redelivered, attempt 2)');
  await expect(page.locator('[data-m="retries"]')).toHaveText('1');
  await expect(page.locator('[data-m="succeeded"]')).toHaveText('6');
});

test('pause motion stops the scene, is keyboard operable and lasts the visit', async ({
  page,
}, testInfo) => {
  test.skip(
    isReduced(testInfo.project.name) || testInfo.project.name.includes('mobile'),
    'motion desktop projects (keyboard path)',
  );
  test.setTimeout(60_000);
  await page.goto('/');
  needsWebGL(testInfo, await settle(page, testInfo.project.name));
  const ctl = page.locator('[data-mctl]');
  await expect(ctl).toHaveAccessibleName('pause motion');
  // One pattern: the label changes with the state, so it is a plain button (no aria-pressed).
  await expect(ctl).not.toHaveAttribute('aria-pressed');
  await ctl.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveClass(/\bmpaused\b/);
  await expect(ctl).toHaveAccessibleName('play motion');
  await expect(ctl).not.toHaveAttribute('aria-pressed');
  await expect(page.locator('.brand i')).toHaveCSS('animation-name', 'none');
  const frames = () => page.evaluate(() => window.__ecMotion?.frames() ?? 0);
  await page.waitForTimeout(2000);
  const a = await frames();
  await page.waitForTimeout(1000);
  expect(await frames()).toBe(a);
  // Remembered for this visit.
  await page.reload();
  await settle(page, testInfo.project.name);
  await expect(page.locator('html')).toHaveClass(/\bmpaused\b/);
  await page.waitForTimeout(3000);
  const b = await frames();
  await page.waitForTimeout(1000);
  expect(await frames()).toBe(b);
  await expect(ctl).toHaveAccessibleName('play motion');
  await ctl.click();
  await expect(ctl).toHaveAccessibleName('pause motion');
  await expect(page.locator('html')).not.toHaveClass(/\bmpaused\b/);
  await expect.poll(frames).toBeGreaterThan(b);
});

test('the hero intro stays in the accessibility tree after scrolling past it', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await settle(page, testInfo.project.name);
  await page.evaluate(() => scrollTo({ top: 1500, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  for (const sel of ['.hero .lbl', '.hero .lede', '.hero .meta'])
    await expect(page.locator(sel)).toHaveCSS('visibility', 'visible');
  const tree = await page.locator('#top').ariaSnapshot();
  expect(tree).toContain('Backend engineer. Python, APIs');
  expect(tree).toContain('Open to freelance');
});

test('a reload that falls back to plain DOM after a stall keeps the reader in the same section', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced motion is plain anyway');
  test.setTimeout(90_000);
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  expect(await settle(page, testInfo.project.name)).toBe(true);
  // 200px into #projects, in the long motion layout.
  await page.evaluate(() => {
    const p = document.getElementById('projects');
    if (p) scrollTo({ top: p.getBoundingClientRect().top + scrollY + 200, behavior: 'instant' });
  });
  await page.waitForTimeout(500);
  const top = () =>
    page.evaluate(() =>
      Math.round(document.getElementById('projects')?.getBoundingClientRect().top ?? 1e6),
    );
  const before = await top();
  expect(Math.abs(before + 200)).toBeLessThanOrEqual(40);
  // Reload with the scroll layer's chunk hanging: the page falls back to plain DOM after the stall.
  await page.route(/\/_astro\/timeline\./, () => {});
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mfallback', 'stalled', {
    timeout: 40_000,
  });
  await page.waitForTimeout(500);
  expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(40);
});

/** Top of #projects now, and a helper that scrolls 200px into it. */
const projTop = (page: Page) =>
  page.evaluate(() =>
    Math.round(document.getElementById('projects')?.getBoundingClientRect().top ?? 1e6),
  );
const into200 = async (page: Page) => {
  await page.evaluate(() => {
    const p = document.getElementById('projects');
    if (p) scrollTo({ top: p.getBoundingClientRect().top + scrollY + 200, behavior: 'instant' });
  });
  await page.waitForTimeout(500);
};

test('a second stalled reload (the visit before also fell back) keeps the reader in place', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced motion is plain anyway');
  test.setTimeout(150_000);
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  expect(await settle(page, testInfo.project.name)).toBe(true);
  await into200(page);
  await page.route(/\/_astro\/timeline\./, () => {});
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mfallback', 'stalled', {
    timeout: 40_000,
  });
  await page.waitForTimeout(500);
  const before = await projTop(page);
  expect(Math.abs(before + 200)).toBeLessThanOrEqual(40);
  // The chunk still hangs: the visit before ended plain, and the reload falls back again.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mfallback', 'stalled', {
    timeout: 40_000,
  });
  await page.waitForTimeout(500);
  expect(Math.abs((await projTop(page)) - before)).toBeLessThanOrEqual(40);
});

test('a blocked scroll chunk keeps the reader in place across a reload', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced motion is plain anyway');
  test.setTimeout(60_000);
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await page.unroute(/./).catch(() => {});
  await page.route(/\/_astro\/timeline\./, (r) => r.abort());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mfallback', /.+/, { timeout: 20_000 });
  await into200(page);
  const before = await projTop(page);
  expect(Math.abs(before + 200)).toBeLessThanOrEqual(40);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mfallback', /.+/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(Math.abs((await projTop(page)) - before)).toBeLessThanOrEqual(40);
});

test('Back from the 404 page to a stalled / keeps the reader in place', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced motion is plain anyway');
  test.setTimeout(120_000);
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  expect(await settle(page, testInfo.project.name)).toBe(true);
  await into200(page);
  const before = await projTop(page);
  expect(Math.abs(before + 200)).toBeLessThanOrEqual(40);
  await page.route(/\/_astro\/timeline\./, () => {});
  await page.goto('/nope-404');
  await page.waitForTimeout(1000);
  await page.goBack();
  await expect(page.locator('html')).toHaveAttribute('data-mfallback', 'stalled', {
    timeout: 40_000,
  });
  await page.waitForTimeout(500);
  expect(Math.abs((await projTop(page)) - before)).toBeLessThanOrEqual(40);
});

test('a hero control focused mid-fade stays drawn (WCAG 2.4.7)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'keyboard path runs on desktop projects');
  await page.goto('/');
  await settle(page, testInfo.project.name);
  // Part-way into the hero's hold, where the fade-out group has scrubbed to opacity 0.
  await page.evaluate(() => scrollTo({ top: innerHeight * 0.6, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  for (const sel of ['.hero .hero-links a', '.hero .meta a.free']) {
    await page.locator(sel).first().focus();
    const group = page
      .locator(sel)
      .first()
      .locator('xpath=ancestor::*[contains(@class,"hero-info") or contains(@class,"meta")][1]');
    await expect(group).toHaveCSS('opacity', '1');
    await expect(page.locator(sel).first()).toBeFocused();
  }
});

// The header is position: fixed, so the page-reflow test cannot see it overflow: measure it.
for (const width of [412, 430]) {
  test(`the header fits a ${width}px phone: the last link's right edge is inside the viewport`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'viewport is set by the test');
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await settle(page, testInfo.project.name);
    const links = page.locator('.top nav a');
    const last = links.last();
    await expect(last).toBeVisible();
    const box = await last.boundingBox();
    if (!box) throw new Error('last header link has no box');
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    // Every label stays on one line (the pause label is icon-only here, not wrapped).
    for (const el of await page.locator('.top nav a, .top .mctl').all()) {
      if (!(await el.isVisible())) continue;
      const b = await el.boundingBox();
      expect(b?.height ?? 0).toBeLessThanOrEqual(56);
    }
    await expect(page.locator('.top')).toHaveJSProperty('scrollWidth', width);
  });
}

test('on a phone the brand and the pause control draw their own focus ring', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'viewport is set by the test');
  await page.setViewportSize({ width: 412, height: 844 });
  await page.goto('/');
  await settle(page, testInfo.project.name);
  await page.keyboard.press('Tab'); // keyboard modality, so :focus-visible applies
  const targets = [page.locator('.brand'), page.locator('.mctl')];
  for (const el of targets) {
    if (!(await el.isVisible())) continue;
    await el.focus();
    await expect(el).toBeFocused();
    const ring = await el.evaluate((n) => {
      const cs = getComputedStyle(n);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
  }
});

// Gaps from the S4 review (old-repo issue 30): the fade on enter from a real scroll, the Lenis
// keys, and the phone-query reload on rotation.

test('a line below the fold is not faded before scroll, and is opaque after it enters', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'reduced motion has no fade');
  test.setTimeout(60_000);
  await page.goto('/');
  needsWebGL(testInfo, await settle(page, testInfo.project.name));
  const line = page.locator('.stack-row').last();
  const belowFold = await line.evaluate((el) => el.getBoundingClientRect().top > innerHeight);
  expect(belowFold, 'the last stack row starts below the first screen').toBe(true);
  await expect(line).not.toHaveClass(/\bfade-in\b/);
  await expect(line).toHaveCSS('opacity', '1'); // never hidden up front: a scanner sees real text
  await line.evaluate((el) => {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await expect(line).toHaveClass(/\bfade-in\b/, { timeout: 5000 });
  await expect(line).toHaveCSS('opacity', '1', { timeout: 5000 });
});

test.describe('Lenis keys', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(
      isReduced(testInfo.project.name) || testInfo.project.name.includes('mobile'),
      'motion desktop projects (keyboard path)',
    );
  });
  const y = (page: Page) => page.evaluate(() => Math.round(scrollY));
  const max = (page: Page) =>
    page.evaluate(() => Math.round(document.documentElement.scrollHeight - innerHeight));
  /**
   * Records, per key, whether the page's own key handler (Lenis, timeline.ts scrollKeys) took the
   * press: a bubble-phase listener added after it sees defaultPrevented only if it did. Without
   * this, Chromium's native End/Home/ArrowUp give the same scrollY and the tests pass either way.
   */
  const watchKeys = (page: Page) =>
    page.evaluate(() => {
      const w = window as Window & { __kd?: Record<string, boolean> };
      w.__kd = {};
      addEventListener('keydown', (e) => {
        (w.__kd as Record<string, boolean>)[e.key] = e.defaultPrevented;
      });
    });
  const taken = (page: Page, key: string) =>
    page.evaluate((k) => (window as Window & { __kd?: Record<string, boolean> }).__kd?.[k], key);

  test('End goes to the bottom, Home back to the top', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/');
    needsWebGL(testInfo, await settle(page, testInfo.project.name));
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await watchKeys(page);
    await page.keyboard.press('End');
    expect(await taken(page, 'End'), 'Lenis took End').toBe(true);
    await expect
      .poll(async () => (await max(page)) - (await y(page)), { timeout: 15_000 })
      .toBeLessThanOrEqual(2);
    await page.keyboard.press('Home');
    expect(await taken(page, 'Home'), 'Lenis took Home').toBe(true);
    await expect.poll(() => y(page), { timeout: 15_000 }).toBeLessThanOrEqual(2);
  });

  test('ArrowUp scrolls up by a small step', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/');
    needsWebGL(testInfo, await settle(page, testInfo.project.name));
    await page.evaluate(() => scrollTo({ top: 2000, behavior: 'instant' }));
    await restingY(page);
    const before = await y(page);
    await watchKeys(page);
    await page.keyboard.press('ArrowUp');
    expect(await taken(page, 'ArrowUp'), 'Lenis took ArrowUp').toBe(true);
    await expect.poll(() => y(page), { timeout: 5000 }).toBeLessThan(before);
    expect(before - (await restingY(page))).toBeLessThan(200);
  });

  test('Space on a focused button presses the button and does not scroll the page', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/');
    needsWebGL(testInfo, await settle(page, testInfo.project.name));
    const ctl = page.locator('[data-mctl]');
    await ctl.focus();
    const before = await y(page);
    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveClass(/\bmpaused\b/);
    await page.waitForTimeout(600);
    expect(await y(page)).toBe(before);
  });
});

test.describe('rotation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'chromium-mobile', 'coarse pointer: the phone query');
  });
  const mark = (page: Page) =>
    page.evaluate(() => {
      (window as unknown as { __rot?: number }).__rot = 1;
    });
  const marked = (page: Page) =>
    page.evaluate(() => (window as unknown as { __rot?: number }).__rot === 1);

  test('turning a phone sideways (still a short coarse screen) does not reload', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/');
    needsWebGL(testInfo, await settle(page, testInfo.project.name));
    await mark(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(1200); // well past the 300 ms debounce
    expect(await marked(page)).toBe(true);
  });

  /** Whether the page was built as a phone: the Experience names are split into letters only above it. */
  const builtAsPhone = (page: Page) =>
    page.evaluate(() => document.querySelectorAll('.co-name .split').length === 0);

  test('a tablet turned short (becomes a phone) reloads once the debounce settles', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto('/');
    needsWebGL(testInfo, await settle(page, testInfo.project.name));
    expect(await builtAsPhone(page), 'a portrait tablet gets the stage layout').toBe(false);
    await mark(page);
    const reloaded = page.waitForEvent('load', { timeout: 10_000 });
    await page.setViewportSize({ width: 1000, height: 420 });
    await reloaded;
    expect(await marked(page)).toBe(false);
    // The reload builds the phone layout: Experience is a plain list there (no split names).
    needsWebGL(testInfo, await settle(page, testInfo.project.name));
    expect(await builtAsPhone(page)).toBe(true);
  });

  test('a quick there-and-back inside the debounce does not reload', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto('/');
    needsWebGL(testInfo, await settle(page, testInfo.project.name));
    await mark(page);
    // A fake clock makes "within the debounce" exact: a starved runner can take longer than 300 ms
    // between two real resizes, which would be a real settle rather than a flicker.
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000); // time now moves only when the test says so
    // The viewport change reaches the page asynchronously: wait for each state to show before
    // moving the fake clock, or the timer could fire between the two states.
    const phoneNow = () =>
      page.evaluate(() => matchMedia('(pointer: coarse) and (max-height: 500px)').matches);
    await page.setViewportSize({ width: 1000, height: 420 });
    await expect.poll(phoneNow).toBe(true);
    await page.clock.runFor(100);
    await page.setViewportSize({ width: 820, height: 1000 });
    await expect.poll(phoneNow).toBe(false);
    await page.clock.runFor(1200); // well past the 300 ms debounce
    await page.waitForTimeout(300); // let a reload, if one was wrongly started, land
    expect(await marked(page), 'the settled state is the built one: no reload').toBe(true);
  });
});
