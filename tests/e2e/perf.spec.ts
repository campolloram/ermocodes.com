// Phone perf check (Chromium only, its own project so it runs alone after the others): CPU throttled
// 4x, 390x844, a scripted scroll from top to bottom. Informational (warn-only, founder decision
// 2026-11-10): long tasks over 200ms and the p95 frame time are reported and attached, never
// fail; Lighthouse is the hard gate.
//
// CI noise (A/B on the same runners, 2026-11-10): the first page load on a fresh runner is ~100 ms
// slower on every CPU class (cold caches), and on the slow class (2 vCPU EPYC 7763) the rest is
// SwiftShader's GPU process competing for the cores: the throttle rate barely moves it (a quick
// unthrottled warm-up does not warm it either). So the gate takes the best of up to three passes (the report uses it),
// stopping at the first one under the limit; a real main-thread long task shows up in every pass.
import { expect, test, type Page } from '@playwright/test';
import { hasWebGL, needsWebGL } from './helpers/webgl';

const HARD_LONG_TASK_MS = 200;
const PASSES = 3;

declare global {
  interface Window {
    __ecLong?: number[];
    __ecFrames?: number[];
    __ecWhere?: string[];
  }
}

interface Pass {
  long: number[];
  frames: number[];
  where: string[];
  max: number;
  summary: string;
}

/** One throttled load and scripted scroll from top to bottom, timed from after start-up. */
async function measure(page: Page): Promise<Pass> {
  await page.goto('/');
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 10_000 });
  // Intro and engine start-up are done once the canvas is on and has settled; from here on, every
  // long task counts (shader compiles and the first frames are covered by the LHCI TBT budget).
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__ecLong?.push(e.duration);
        if (e.duration > 150)
          window.__ecWhere?.push(`${Math.round(e.duration)}ms@y${Math.round(scrollY)}`);
      }
    }).observe({ type: 'longtask' });
  });

  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const total = document.documentElement.scrollHeight - innerHeight;
        // Time-based, so a slow runner still finishes in 14 s (a fixed px/frame step would not).
        const duration = 14_000;
        const start = performance.now();
        let last = start;
        const step = (t: number) => {
          window.__ecFrames?.push(t - last);
          last = t;
          const y = Math.min(total, (total * (t - start)) / duration);
          scrollTo(0, y);
          if (y >= total) done();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  await page.waitForTimeout(500);

  const { long, frames, where } = await page.evaluate(() => ({
    long: window.__ecLong ?? [],
    frames: window.__ecFrames ?? [],
    where: window.__ecWhere ?? [],
  }));
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const max = Math.max(0, ...long);
  const summary = `p95 frame ${p95.toFixed(1)}ms, p50 ${p50.toFixed(1)}ms over ${frames.length} frames, longest task ${max.toFixed(0)}ms`;
  console.log(`perf.spec: ${summary}; tasks over 150ms: ${where.join(' ') || 'none'}`);
  return { long, frames, where, max, summary };
}

test('4x CPU throttle: long tasks over 200ms after load and p95 frame time reported (warn-only)', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-perf', 'phone perf project only');
  test.setTimeout(180_000);
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await page.goto('about:blank');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__ecLong = [];
    window.__ecFrames = [];
    window.__ecWhere = [];
  });
  const passes: Pass[] = [];
  for (let i = 0; i < PASSES; i += 1) {
    const pass = await measure(page);
    passes.push(pass);
    if (pass.max < HARD_LONG_TASK_MS) break;
  }
  const best = passes.reduce((a, b) => (b.max < a.max ? b : a));
  testInfo.annotations.push({ type: 'perf', description: best.summary });
  // Warn-only (founder decision 2026-11-10): report long tasks and p95, never fail the job.
  // Lighthouse (lhci) stays the hard gate.
  if (best.max >= HARD_LONG_TASK_MS) {
    const msg = `long tasks after load (ms), best of ${passes.length}: ${best.long.join(', ')}`;
    testInfo.annotations.push({ type: 'perf-warning', description: msg });
    console.warn(`perf.spec WARNING (not a failure): ${msg}`);
  }
});
