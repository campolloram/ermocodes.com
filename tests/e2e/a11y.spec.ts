// axe on every page, on every project, plus reflow at 320px and 360px (WCAG 1.4.10) and CLS.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { expectStableLayout } from './helpers/cls';
import { expectNoHorizontalScroll } from './helpers/reflow';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const PATHS = ['/', '/404'];

for (const path of PATHS) {
  test(`${path} has zero axe violations`, async ({ page }) => {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(
      violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) })),
    ).toEqual([]);
  });

  test(`${path} does not scroll sideways at 320px and 360px`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'viewport-independent');
    await expectNoHorizontalScroll(browser, path);
  });

  test(`${path} stays within the CLS budget`, async ({ page }) => {
    await expectStableLayout(page, path);
  });
}
