import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

/** WCAG 1.4.10 reflow widths: 320px is the AA requirement, 360px the most common small phone. */
export const REFLOW_WIDTHS = [320, 360] as const;

/** Sub-pixel rounding allowance when comparing scroll and client widths. */
const TOLERANCE_PX = 1;

/**
 * Lists elements whose content spills out of their own box sideways, ignoring anything inside a
 * scroll or clip container (tables and code blocks scroll on purpose; sr-only text is clipped).
 * Inline elements have no box width of their own, so their block parent is what gets flagged.
 */
function findOverflowingElements(page: Page): Promise<string[]> {
  return page.evaluate((tolerance) => {
    const contains = (value: string) => value !== 'visible';
    const insideContainer = (el: Element): boolean => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        if (node === document.documentElement || node === document.body) return false;
        if (contains(getComputedStyle(node).overflowX)) return true;
      }
      return false;
    };
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = el.classList.length ? `.${[...el.classList].slice(0, 3).join('.')}` : '';
      const text = (el.textContent ?? '').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${id}${cls} "${text}"`;
    };
    return [...document.body.querySelectorAll('*')]
      .filter((el) => el instanceof HTMLElement && el.clientWidth > 0)
      .filter((el) => el.scrollWidth - el.clientWidth > tolerance)
      .filter((el) => !insideContainer(el))
      .map(describe);
  }, TOLERANCE_PX);
}

/**
 * Asserts the page reflows at each width (WCAG 1.4.10): the document never scrolls sideways,
 * and no element's content overflows its own box outside a scroll container. `prepare` runs after
 * the page loads, to check a state such as an open dialog.
 */
export async function expectNoHorizontalScroll(
  browser: Browser,
  path: string,
  widths: readonly number[] = REFLOW_WIDTHS,
  contextOptions: BrowserContextOptions = {},
  prepare?: (page: Page) => Promise<void>,
): Promise<void> {
  for (const width of widths) {
    const context = await browser.newContext({
      ...contextOptions,
      viewport: { width, height: 800 },
    });
    try {
      const page = await context.newPage();
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await prepare?.(page);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `${path} at ${width}px scrolls sideways`).toBeLessThanOrEqual(
        clientWidth,
      );
      expect(await findOverflowingElements(page), `${path} at ${width}px overflows`).toEqual([]);
    } finally {
      await context.close();
    }
  }
}
