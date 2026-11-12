import { expect, test } from '@playwright/test';
import { findViolations } from '../../scripts/guard-content.mjs';
import { ABOUT, CONTACT, EXPERIENCE, WHAT_I_DO } from '../../src/content/site';
import { textOf } from '../../src/content/draft';

const COMPANIES = ['SoFi', "Moody's", 'Anaplan', 'Docsum', 'Pronto Housing', 'NarrativeWave'];

test('the six companies are present', async ({ page }) => {
  await page.goto('/');
  const text = await page.locator('main').innerText();
  const flat = text.replace(/\s+/g, ' ').toLowerCase();
  for (const company of COMPANIES) {
    await expect(
      page.locator('.co-name', { hasText: new RegExp(company.replace(' ', '\\s*'), 'i') }),
    ).toHaveCount(1);
  }
  // Names are split across lines for the extrusion; the accessible name is the whole company.
  for (const company of COMPANIES) {
    expect(
      await page.locator('.co-name .sr', { hasText: company }).count(),
      `${company} accessible name`,
    ).toBe(1);
  }
  expect(flat).not.toContain('through a consultancy');
});

test('no banned names, phones, social links, old domain or personal email in the HTML', async ({
  page,
}) => {
  await page.goto('/');
  // The guard holds the banned names and the old domain as digests; reuse it on the live DOM.
  const html = await page.content();
  expect(findViolations(html, { isHtml: true })).toEqual([]);
  await expect(
    page.locator('a[href*="x.com"], a[href*="twitter.com"], a[href*="instagram.com"]'),
  ).toHaveCount(0);
});

const squash = (t: string) => t.replace(/\s+/g, ' ').trim();

test('the approved lines are on the page verbatim', async ({ page }) => {
  await page.goto('/');
  const text = squash(await page.locator('main').innerText());
  for (const line of [...WHAT_I_DO.items.map((i) => i.lead + i.rest), ...ABOUT.lines]) {
    expect(text, textOf(line)).toContain(squash(textOf(line)));
  }
  // The US line is About's third line; languages sit in the last one.
  await expect(page.locator('#about .sec-body p').nth(2)).toHaveText(textOf(ABOUT.lines[2] ?? ''));
  expect(text).toContain('Fluent English, native Spanish');
  expect(text).toContain("Startups and big companies like SoFi and Moody's");
});

test('the consulting footnote shows once and no entry repeats it', async ({ page }) => {
  await page.goto('/');
  const text = squash(await page.locator('main').innerText());
  expect(text.split(EXPERIENCE.note).length - 1).toBe(1);
  await expect(page.locator('.exp-note')).toHaveCount(1);
  await expect(page.locator('.co-meta', { hasText: /consult/i })).toHaveCount(0);
});

test('contact: email as text, LinkedIn in a new tab, no GitHub', async ({ page }) => {
  await page.goto('/');
  const contact = page.locator('#contact');
  await expect(contact.locator('.email-text')).toHaveText(CONTACT.emailText);
  const li = contact.locator(`a[href="${CONTACT.linkedin}"]`);
  await expect(li).toHaveAttribute('target', '_blank');
  await expect(li).toHaveAttribute('rel', /\bnoopener\b/);
  await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
});
