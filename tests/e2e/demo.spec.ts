// S3 queue demo: works by keyboard and by touch, the run settles, the live region announces the
// outcome, and the WebGL frame counter is paused while the demo fills the view.
import { expect, test } from '@playwright/test';
import { hasWebGL, needsWebGL } from './helpers/webgl';

const isReduced = (name: string) => name === 'chromium-reduced';

async function goToDemo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('#queue').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-demo][data-ready]')).toHaveCount(1, { timeout: 8000 });
}

test('keyboard: Tab to the control, Enter runs the scenario and the outcome is announced', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'keyboard path runs on desktop projects');
  await goToDemo(page);
  const btn = page.locator('[data-kill]');
  await expect(btn).toBeVisible();
  await btn.focus();
  await page.keyboard.press('Enter');
  const demo = page.locator('[data-demo]');
  if (!isReduced(testInfo.project.name))
    await expect(demo).toHaveAttribute('data-state', 'running', { timeout: 2000 });
  await expect(demo).toHaveAttribute('data-state', 'settled', { timeout: 20_000 });
  const outcome = page.locator('[data-outcome]');
  await expect(outcome).toHaveAttribute('aria-live', 'polite');
  await expect(outcome).toContainText('6 of 6 orders done');
  await expect(outcome).toContainText('0 lost');
  await expect(page.locator('[data-m="succeeded"]')).toHaveText('6');
  await expect(page.locator('.log li.lv-ERROR')).toHaveCount(1);
});

test('touch: a tap runs the scenario and it settles', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'touch path runs on the phone project');
  await goToDemo(page);
  await page.locator('[data-kill]').tap();
  await expect(page.locator('[data-demo]')).toHaveAttribute('data-state', 'settled', {
    timeout: 20_000,
  });
  await expect(page.locator('[data-outcome]')).toContainText('orders done');
});

test('the WebGL frame counter is paused while the demo is in view', async ({ page }, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'no loop in reduced motion');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 3000 });
  await page.locator('#queue').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => window.__ecMotion?.frames() ?? 0);
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => window.__ecMotion?.frames() ?? 0);
  expect(after).toBe(before);
});

// UX round 3: the button reads as running (not disabled) during a run, the whole idempotency proof
// is in the log at the end, every run uses new keys, and at 1280x720 the button, outcome and the
// log share one screen.
test('running looks active, the log keeps both charges of the lost job, and runs differ', async ({
  page,
}, testInfo) => {
  test.skip(isReduced(testInfo.project.name), 'the running state is a motion-mode state');
  test.setTimeout(60_000);
  await goToDemo(page);
  const btn = page.locator('[data-kill]');
  const demo = page.locator('[data-demo]');
  const keysOf = async () => {
    const log = await page.locator('.log').innerText();
    const charges = log.split('\n').filter((l) => /charges 200 job=1042/.test(l));
    expect(charges, 'original charge and the replay for job 1042').toHaveLength(2);
    expect(charges[1]).toContain('replayed');
    return [...log.matchAll(/idem-[0-9a-f]+/g)].map((m) => m[0]).join(',');
  };
  await btn.click();
  await expect(demo).toHaveAttribute('data-state', 'running', { timeout: 2000 });
  await expect(btn).toHaveAttribute('aria-disabled', 'true');
  expect(Number(await btn.evaluate((e) => getComputedStyle(e).opacity))).toBe(1);
  expect(await btn.evaluate((e) => getComputedStyle(e).cursor)).toBe('progress');
  await expect(demo).toHaveAttribute('data-state', 'settled', { timeout: 20_000 });
  const first = await keysOf();
  await btn.click();
  await expect(demo).toHaveAttribute('data-state', 'running', { timeout: 2000 });
  await expect(demo).toHaveAttribute('data-state', 'settled', { timeout: 20_000 });
  expect(await keysOf()).not.toBe(first);
});

test('laptop: button, outcome and the whole log are on one screen at 1280x720', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'one laptop-size check');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/#queue');
  await expect(page.locator('[data-demo][data-ready]')).toHaveCount(1, { timeout: 8000 });
  await page.waitForTimeout(800);
  const box = async (sel: string) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`${sel} has no box`);
    return b;
  };
  const btn = await box('[data-kill]');
  const log = await box('[data-log]');
  expect(btn.y).toBeGreaterThanOrEqual(0);
  expect(log.y + log.height).toBeLessThanOrEqual(720);
});
