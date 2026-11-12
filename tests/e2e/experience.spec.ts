/* eslint-disable @typescript-eslint/no-non-null-assertion, no-empty-pattern -- DOM lookups inside page.evaluate; Playwright needs the destructured first argument */
// Decision 11: Experience is a plain list on a phone and one company per stop on desktop. Stops are
// the Lenis snap (mouse, trackpad and keys, with the held stage) or CSS scroll-snap (reduced motion,
// plain DOM); neither may trap a reader, and nothing sets a height or pins from script.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { hasWebGL, needsWebGL } from './helpers/webgl';

const isReduced = (name: string) => name === 'chromium-reduced';
const isPhone = (name: string) => name.endsWith('mobile');

/** Waits for the motion layer (html.mscroll) or plain DOM (html.motion came off), returns which. */
async function layer(page: Page): Promise<'motion' | 'plain'> {
  await page
    .locator('html.mscroll, html:not(.motion)')
    .waitFor({ state: 'attached', timeout: 12_000 });
  await page.waitForTimeout(500);
  return (await page.evaluate(() => document.documentElement.classList.contains('mscroll')))
    ? 'motion'
    : 'plain';
}

const stable = async (page: Page, quiet = 3): Promise<number> => {
  let last = Number.NaN;
  let n = 0;
  await expect
    .poll(
      async () => {
        const y = await page.evaluate(() => Math.round(scrollY));
        n = y === last ? n + 1 : 0;
        last = y;
        return n >= quiet;
      },
      { timeout: 8000, intervals: [150] },
    )
    .toBe(true);
  return last;
};

test.describe('phone: a plain list', () => {
  test('no stage, no counter, no sticky element, six names in at most 2.5 screens', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'phone projects only');
    await page.goto('/');
    const mode = await layer(page);
    if (mode === 'motion') await expect(page.locator('html')).toHaveClass(/\bmscroll\b/);
    const r = await page.evaluate(() => {
      const sec = document.getElementById('experience')!;
      const sticky = [sec, ...sec.querySelectorAll('*')].filter(
        (e) => getComputedStyle(e).position === 'sticky',
      ).length;
      const show = (sel: string) =>
        [...sec.querySelectorAll<HTMLElement>(sel)].map((e) => {
          const cs = getComputedStyle(e);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) === 1;
        });
      return {
        screens: sec.getBoundingClientRect().height / innerHeight,
        sticky,
        run: getComputedStyle(sec.querySelector('.exp-run')!).display,
        count: getComputedStyle(sec.querySelector('.count')!).display,
        names: show('.co-name'),
        metas: show('.co-meta'),
        letters: sec.querySelectorAll('.co-name .ch').length,
      };
    });
    expect(r.screens).toBeLessThanOrEqual(2.5);
    expect(r.sticky).toBe(0);
    expect(r.run).toBe('none');
    expect(r.count).toBe('none');
    expect(r.names).toEqual(Array(6).fill(true));
    expect(r.metas).toEqual(Array(6).fill(true));
    expect(r.letters).toBe(0);
  });
});

test.describe('desktop: one company per stop', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'desktop projects only');
  });

  test('a wheel step lands the next company, six steps cover six, the next leaves to Projects', async ({
    page,
  }, testInfo) => {
    test.skip(isReduced(testInfo.project.name), 'the held stage is the motion layer');
    test.setTimeout(90_000);
    await page.goto('/#experience');
    needsWebGL(testInfo, await hasWebGL(page));
    expect(await layer(page)).toBe('motion');
    const stops = await page.evaluate(() => {
      const sec = document.getElementById('experience')!;
      const run = sec.querySelector<HTMLElement>('.exp-run')!;
      const ch = (run.children[0] as HTMLElement).offsetHeight;
      const top = sec.getBoundingClientRect().top + scrollY;
      return Array.from(run.children, (_, k) => Math.round(top + (k + 0.4) * ch));
    });
    expect(stops).toHaveLength(6);
    await page.mouse.move(700, 450);
    const seen: number[] = [];
    for (let k = 0; k < 6; k++) {
      await page.mouse.wheel(0, 300);
      const y = await stable(page, 5);
      expect(Math.abs(y - stops[k]!), `stop ${k}`).toBeLessThanOrEqual(2);
      // The company at that stop is the one on screen.
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.co')].findIndex(
          (c) => Number(getComputedStyle(c).opacity) > 0.9,
        ),
      );
      seen.push(shown);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
    // The step after the last company leaves Experience, and nothing pulls the view back.
    await page.mouse.wheel(0, 300);
    const out = await stable(page, 6);
    expect(out).toBeGreaterThan(stops[5]! + 100);
    await page.waitForTimeout(800);
    expect(Math.abs((await stable(page)) - out)).toBeLessThanOrEqual(1);
    // And back: one step up returns to the last company.
    await page.mouse.wheel(0, -300);
    expect(Math.abs((await stable(page, 6)) - stops[5]!)).toBeLessThanOrEqual(2);
  });

  test('ArrowDown never traps: every press moves on, one company per press while the stage holds', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto('/#experience');
    const mode = isReduced(testInfo.project.name) ? 'plain' : await layer(page);
    let y = await stable(page, 4);
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => page.evaluate(() => scrollY), { timeout: 4000 }).toBeGreaterThan(y);
      const next = await stable(page, 6);
      // The Lenis stops: a press is a step (a company's height), not a 40px nudge that falls back.
      if (mode === 'motion' && i < 6) expect(next - y).toBeGreaterThan(200);
      y = next;
    }
    // Then Space gets out of the last company and into Projects.
    const projectsTop = () =>
      page.evaluate(() => document.getElementById('projects')!.getBoundingClientRect().top);
    for (let i = 0; i < 10 && (await projectsTop()) > 800; i++) {
      await page.keyboard.press('Space');
      await stable(page, 6);
    }
    expect(await projectsTop()).toBeLessThanOrEqual(800);
  });

  test('Space and PageDown move on to the next company, PageUp returns', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.goto('/#experience');
    if (!isReduced(testInfo.project.name)) await layer(page);
    const start = await stable(page, 4);
    for (const key of ['Space', 'PageDown']) {
      const before = await stable(page, 3);
      await page.keyboard.press(key);
      await expect
        .poll(() => page.evaluate(() => scrollY), { timeout: 4000 })
        .toBeGreaterThan(before + 200);
      const after = await stable(page, 6);
      expect(after - before).toBeLessThan(1200);
    }
    const beforeUp = await stable(page, 4);
    expect(beforeUp).toBeGreaterThan(start);
    await page.keyboard.press('PageUp');
    await expect
      .poll(() => page.evaluate(() => scrollY), { timeout: 4000 })
      .toBeLessThan(beforeUp - 200);
  });

  test('only a real phone-width crossing reloads: a full-page capture at the same width does not', async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('chromium-desktop'), 'Chromium re-emulates here');
    test.setTimeout(90_000);
    await page.goto('/');
    needsWebGL(testInfo, await hasWebGL(page));
    expect(await layer(page)).toBe('motion');
    let loads = 0;
    page.on('load', () => (loads += 1));
    // Chromium fires the phone query's 'change' while it re-emulates the viewport for this.
    await page.screenshot({ fullPage: true, timeout: 45_000 });
    await page.waitForTimeout(1000);
    expect(loads).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => loads, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  for (const hash of ['experience', 'studio', 'about', 'contact']) {
    test(`/#${hash} lands at the header line`, async ({ page }, testInfo) => {
      await page.goto(`/#${hash}`);
      if (!isReduced(testInfo.project.name)) await layer(page);
      await stable(page, 5);
      const top = await page.evaluate((id) => {
        const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        return Math.round(document.getElementById(id)!.getBoundingClientRect().top - pad);
      }, hash);
      // Contact is the last block: the page may end before its top reaches the header line.
      if (hash === 'contact') expect(top).toBeGreaterThanOrEqual(0);
      else expect(Math.abs(top)).toBeLessThanOrEqual(2);
    });
  }
});

test('the scroll code sets no height and pins nothing', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) files.push(p);
    }
  };
  walk('src/motion');
  const src = files.map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  for (const code of src) {
    expect(code).not.toMatch(/\bpin\s*:/);
    expect(code).not.toMatch(/style\.height\s*=/);
    expect(code).not.toMatch(/setProperty\(\s*['"]height/);
    expect(code).not.toMatch(/to\([^)]*\bheight\s*:/);
  }
});
