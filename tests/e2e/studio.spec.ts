// L3 first screen + L4 studio section + CV downloads.
import { expect, test } from '@playwright/test';
import { calHref } from '../../src/content/cal';
import { CONTACT, HERO, NAV_STUDIO, STUDIO } from '../../src/content/site';

const CAL = calHref(process.env.PUBLIC_CAL_LINK);
const squash = (t: string) => t.replace(/\s+/g, ' ').trim();

test('the first screen shows the proof line and the three links inside the viewport', async ({
  page,
}) => {
  await page.goto('/');
  const vh = page.viewportSize()?.height ?? 0;
  const inside = async (loc: ReturnType<typeof page.locator>) => {
    await expect(loc).toBeVisible();
    const b = await loc.boundingBox();
    if (!b) throw new Error('no box');
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(vh);
    return b;
  };
  await inside(page.locator('.hero .proof'));
  await expect(page.locator('.hero .proof')).toHaveText(HERO.proof);
  const links = page.locator('.hero .hero-links a');
  await expect(links).toHaveCount(CAL ? 4 : 3);
  for (const a of await links.all()) {
    const b = await inside(a);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  await expect(links.nth(0)).toHaveAttribute('href', 'mailto:hello@ermocodes.com');
  await expect(links.nth(1)).toHaveAttribute('href', CONTACT.linkedin);
  await expect(links.nth(2)).toHaveAttribute('href', CONTACT.cv.href);
  await expect(links.nth(2)).toHaveText(`[${HERO.cvLabel}]`);
  if (CAL) await expect(links.nth(3)).toHaveAttribute('href', CAL);
  await inside(page.locator('.hero .visa'));
  await expect(page.locator('.hero .visa')).toHaveText(HERO.visa);
  const nav = page.locator('header nav a', { hasText: NAV_STUDIO });
  await expect(nav).toHaveAttribute('href', '#studio');
  const free = page.locator('.hero .meta a.free');
  await inside(free);
  await expect(free).toHaveText(HERO.open);
  await expect(free).toHaveAttribute('href', '#studio');
});

test('the studio section carries the approved copy, no prices, and sits before About', async ({
  page,
}) => {
  await page.goto('/');
  const studio = page.locator('#studio');
  await expect(studio.getByRole('heading', { level: 2 })).toHaveText(STUDIO.heading);
  const text = squash(await studio.innerText());
  for (const o of STUDIO.offers)
    for (const s of [o.name, o.time, o.line]) expect(text).toContain(s);
  expect(text).toContain(STUDIO.intro);
  expect(text).toContain(STUDIO.howHeading);
  await expect(studio.locator('ol.how > li')).toHaveText([...STUDIO.steps]);
  expect(text).not.toMatch(/\$|USD|MXN|\d{3,}/i);
  const ids = await page.locator('main section[id]').evaluateAll((s) => s.map((e) => e.id));
  expect(ids.indexOf('studio')).toBeGreaterThan(ids.indexOf('projects'));
  expect(ids.indexOf('studio')).toBeLessThan(ids.indexOf('about'));
  const labels = await page.locator('.lbl').allInnerTexts();
  const nums = labels.map((l) => l.trim().slice(0, 2)).filter((n) => /^\d\d$/.test(n));
  expect(nums).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09']);
});

test('the studio CTAs are keyboard reachable', async ({ page }) => {
  await page.goto('/');
  const ctas = page.locator('#studio .studio-cta a');
  await expect(ctas).toHaveCount(CAL ? 2 : 1);
  for (const a of await ctas.all()) {
    await a.focus();
    await expect(a).toBeFocused();
  }
});

test('Contact offers the 1-page CV as the main button and the full CV next to it', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const main = page.locator('#contact a.strong');
  await expect(main).toHaveAttribute('href', CONTACT.cv.href);
  const full = page.locator('#contact a', { hasText: CONTACT.cvFull.label });
  await expect(full).toHaveAttribute('href', CONTACT.cvFull.href);
  for (const href of [CONTACT.cv.href, CONTACT.cvFull.href]) {
    const res = await request.get(href);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('pdf');
  }
});
