// UX round 2, slow phone (Chromium, CPU 6x, ~400 kbps / 400 ms latency, 360x740): the page has its
// final length from the first paint, so it never grows while the reader scrolls before the motion
// layer arrives, a direct #link opens in place and stays there, and scrolling stays within the CLS
// budget before and after the engine takes over. Runs in chromium-perf (alone: throttled tests
// starve when other workers run beside them).
import { expect, test, type Page } from '@playwright/test';
import { CLS_BUDGET, trackLayoutShifts } from './helpers/cls';
import { hasWebGL, needsWebGL } from './helpers/webgl';

declare global {
  interface Window {
    __ecHeights?: number[];
  }
}

async function slowPhone(page: Page): Promise<void> {
  await page.setViewportSize({ width: 360, height: 740 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: 51_200,
    uploadThroughput: 25_600,
  });
  // Every document height the page shows from its first frame on.
  await page.addInitScript(() => {
    const seen: number[] = [];
    window.__ecHeights = seen;
    const tick = () => {
      if (document.readyState !== 'loading') {
        const h = document.documentElement.scrollHeight;
        if (seen.at(-1) !== h) seen.push(h);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const motionUp = (page: Page) =>
  page.locator('html.mscroll').waitFor({ state: 'attached', timeout: 60_000 });

test('slow phone: the page height never changes from the first paint, CLS stays in budget while scrolling', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-perf', 'throttled phone project only');
  test.setTimeout(150_000);
  await slowPhone(page);
  await trackLayoutShifts(page);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  // Scroll at once, before the engine is up (the case that used to grow the page under the reader).
  const early = await page.evaluate(async () => {
    let y = 0;
    for (; y < 3000; y += 300) {
      scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 120));
    }
    return document.documentElement.classList.contains('mscroll');
  });
  needsWebGL(testInfo, await hasWebGL(page));
  await motionUp(page);
  // ...and on through the whole page once it is.
  await page.evaluate(async () => {
    const total = document.documentElement.scrollHeight - innerHeight;
    for (let y = 3000; y <= total; y += 300) {
      scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForTimeout(800);
  const heights = await page.evaluate(() => window.__ecHeights ?? []);
  expect(heights, `heights seen (motion up during the early scroll: ${early})`).toHaveLength(1);
  const cls = await page.evaluate(() => window.__ecCls ?? { value: 0, sources: [] });
  expect(cls.value, `layout shift: ${cls.sources.join(', ')}`).toBeLessThanOrEqual(CLS_BUDGET);
});

for (const hash of ['#queue', '#contact']) {
  test(`slow phone: a direct ${hash} link opens on its section and stays there`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-perf', 'throttled phone project only');
    test.setTimeout(150_000);
    await slowPhone(page);
    await page.goto(`/${hash}`, { waitUntil: 'load', timeout: 90_000 });
    const where = () =>
      page.evaluate((h) => {
        const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const top = (document.querySelector(h)?.getBoundingClientRect().top ?? 1e6) - pad;
        return { y: Math.round(scrollY), top: Math.round(top) };
      }, hash);
    const first = await where();
    expect(Math.abs(first.top)).toBeLessThanOrEqual(2);
    await motionUp(page).catch(() => {});
    await page.waitForTimeout(1500);
    expect(await where()).toEqual(first);
  });
}
