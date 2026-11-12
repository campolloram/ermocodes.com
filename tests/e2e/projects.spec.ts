// S3 projects: a tap (or hover) fractures the extruded project name into bits that settle back.
import { expect, test, type Locator } from '@playwright/test';
import { hasWebGL, needsWebGL } from './helpers/webgl';

test('tap fracture on the phone: the name bursts and settles back', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'tap path runs on the phone project');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 3000 });
  const first = page.locator('[data-proj]').first();
  await first.scrollIntoViewIfNeeded();
  await first.locator('.proj-name').tap();
  await expect(first).toHaveAttribute('data-burst', 'on');
  // Mid-burst some letters hide behind their bits.
  await expect
    .poll(() =>
      first
        .locator('.ch')
        .evaluateAll((els) => els.some((e) => (e as HTMLElement).style.visibility === 'hidden')),
    )
    .toBe(true);
  await expect(first).not.toHaveAttribute('data-burst', 'on', { timeout: 4000 });
  await expect
    .poll(() =>
      first
        .locator('.ch')
        .evaluateAll((els) => els.every((e) => (e as HTMLElement).style.visibility !== 'hidden')),
    )
    .toBe(true);
});

const hiddenLetters = (loc: Locator) =>
  loc
    .locator('.ch')
    .evaluateAll(
      (els) => els.filter((e) => (e as HTMLElement).style.visibility === 'hidden').length,
    );

test('hover on desktop: the name bursts, a second hover mid-burst does not restart it', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('desktop'), 'hover path runs on desktop projects');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 5000 });
  const first = page.locator('[data-proj]').first();
  await first.scrollIntoViewIfNeeded();
  // A slow runner can take longer than the burst's 1.5 s between two polls, so a sampler inside the
  // page records the most letters hidden at once.
  await first.evaluate((el) => {
    const w = window as Window & { __maxHidden?: number };
    w.__maxHidden = 0;
    setInterval(() => {
      const n = [...el.querySelectorAll<HTMLElement>('.ch')].filter(
        (e) => e.style.visibility === 'hidden',
      ).length;
      w.__maxHidden = Math.max(w.__maxHidden ?? 0, n);
    }, 10);
  });
  await first.locator('.proj-name').hover();
  await expect(first).toHaveAttribute('data-burst', 'on');
  await expect(first).not.toHaveAttribute('data-burst', 'on', { timeout: 8000 });
  expect(
    await page.evaluate(() => (window as Window & { __maxHidden?: number }).__maxHidden),
  ).toBeGreaterThan(0);
  await expect.poll(() => hiddenLetters(first)).toBe(0);
});

test('paused motion: hovering a project name never leaves it hidden', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('desktop'), 'hover path runs on desktop projects');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 5000 });
  const first = page.locator('[data-proj]').first();
  await first.scrollIntoViewIfNeeded();
  await page.locator('[data-mctl]').click();
  await expect(page.locator('html')).toHaveClass(/\bmpaused\b/);
  // Let the frames the paused loop still draws after a scroll finish.
  await page.waitForTimeout(2200);
  await first.locator('.proj-name').hover();
  await page.waitForTimeout(2500);
  expect(await hiddenLetters(first)).toBe(0);
  await expect(first.locator('.proj-name .sr')).toBeVisible();
});

test('pausing in the middle of a burst puts the letters back', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('desktop'), 'hover path runs on desktop projects');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 5000 });
  const first = page.locator('[data-proj]').first();
  await first.scrollIntoViewIfNeeded();
  await first.locator('.proj-name').hover();
  await expect.poll(() => hiddenLetters(first)).toBeGreaterThan(0);
  await page.locator('[data-mctl]').click();
  await expect.poll(() => hiddenLetters(first), { timeout: 4000 }).toBe(0);
  await page.waitForTimeout(2500);
  expect(await hiddenLetters(first)).toBe(0);
});

test('WebGL context lost and never restored: no letter is hidden, the layout stays', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('desktop'), 'hover path runs on desktop projects');
  await page.goto('/');
  needsWebGL(testInfo, await hasWebGL(page));
  await expect(page.locator('#ascii.on')).toHaveCount(1, { timeout: 5000 });
  const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('#ascii')?.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await expect(page.locator('#ascii.on')).toHaveCount(0);
  await page.locator('.hero .name').hover();
  await page.waitForTimeout(600);
  expect(await hiddenLetters(page.locator('.hero'))).toBe(0);
  const first = page.locator('[data-proj]').first();
  await first.scrollIntoViewIfNeeded();
  await first.locator('.proj-name').hover();
  await page.waitForTimeout(800);
  expect(await hiddenLetters(first)).toBe(0);
  await expect(page.locator('html')).toHaveClass(/\bmotion\b/);
  // Scrolling kept the same page; the layout did not change under the reader.
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(h0);
});

test('the heading text stays readable: one accessible name per project', async ({ page }) => {
  await page.goto('/');
  const names = await page.locator('.proj-name .sr').allTextContents();
  expect(names).toEqual(['Orchestrator', 'Money movement', 'Doc search']);
});
