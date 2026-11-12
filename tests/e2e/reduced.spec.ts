import { expect, test } from '@playwright/test';

test('reduced motion: nothing animates and every company is visible in flow', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-reduced', 'reduced-motion project only');
  await page.goto('/');
  await expect(page.locator('.co')).toHaveCount(6);
  for (const co of await page.locator('.co').all()) await expect(co).toBeVisible();
  const caret = await page.locator('.brand i').evaluate((el) => getComputedStyle(el).animationName);
  expect(caret).toBe('none');
});
