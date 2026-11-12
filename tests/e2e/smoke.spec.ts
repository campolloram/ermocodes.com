import { expect, test } from '@playwright/test';
import { calHref } from '../../src/content/cal';
import { LABELS, SITE } from '../../src/content/site';

// The build reads PUBLIC_CAL_LINK; the specs expect the book link exactly when it is set.
const CAL = calHref(process.env.PUBLIC_CAL_LINK);

test('the one page renders its 9 sections, the mailto buttons and the book link', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(SITE.title);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(SITE.name);

  // Nine sections (descendant selector: ScrollTrigger wraps the pinned hero in a spacer), each named by a heading; the terminal labels run 01 to 09.
  const sections = page.locator('main section[aria-labelledby]');
  await expect(sections).toHaveCount(9);
  for (const section of await sections.all()) {
    const id = await section.getAttribute('aria-labelledby');
    await expect(page.locator(`#${id}`)).toHaveAccessibleName(/\S/);
  }
  for (const label of Object.values(LABELS)) {
    const [num, name] = label.split(' / ');
    await expect(
      page.locator('.lbl', { hasText: new RegExp(`${num}\\s*/\\s*${name}`) }),
    ).toHaveCount(1);
  }

  // Every mailto points at hello@ (first screen, studio, contact).
  const mailtos = await page
    .locator('a[href^="mailto:"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(mailtos).toHaveLength(3);
  expect(new Set(mailtos)).toEqual(new Set(['mailto:hello@ermocodes.com']));
  // Book a call: first screen, studio and contact, all exactly the Cal URL.
  const book = page.getByRole('link', { name: /book a call/i });
  if (CAL) {
    expect(await book.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([
      CAL,
      CAL,
      CAL,
    ]);
  } else await expect(book).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test('every line is approved: no draft markup and no source tags in any build', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-draft]')).toHaveCount(0);
  await expect(page.locator('[data-src]')).toHaveCount(0);
});

test('unknown routes show the styled 404', async ({ page }) => {
  // astro preview serves the 404 page, with status 404, for a path that does not exist.
  const response = await page.goto('/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('Not found');
});
