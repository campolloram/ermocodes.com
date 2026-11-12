import { expect, type Page } from '@playwright/test';

/** Content-page budget (lighthouserc.cjs): CLS at most 0.02. */
export const CLS_BUDGET = 0.02;

/** Time after the last scroll step for late shifts (fonts, images) to be reported. */
const SETTLE_MS = 400;

declare global {
  interface Window {
    __ecCls?: { value: number; sources: string[] };
  }
}

/**
 * Registers a buffered layout-shift observer before any page script runs. Call before goto.
 * Shifts within 500ms of user input don't count (hadRecentInput), as in the CLS metric.
 */
export async function trackLayoutShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { value: 0, sources: [] as string[] };
    window.__ecCls = state;
    type Shift = PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources?: { node?: Node | null }[];
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Shift[]) {
        if (entry.hadRecentInput) continue;
        state.value += entry.value;
        for (const source of entry.sources ?? []) {
          const node = source.node;
          if (node instanceof Element) {
            const cls = node.classList.length
              ? `.${[...node.classList].slice(0, 2).join('.')}`
              : '';
            state.sources.push(`${node.tagName.toLowerCase()}${cls} (${entry.value.toFixed(4)})`);
          }
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

/**
 * Loads the page, waits for fonts, scrolls to the bottom in viewport steps (so below-the-fold
 * content renders) and asserts the summed layout shift stays within the budget.
 */
export async function expectStableLayout(page: Page, path: string): Promise<void> {
  await trackLayoutShifts(page);
  await page.goto(path, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  });
  await page.waitForTimeout(SETTLE_MS);
  const result = await page.evaluate(() => window.__ecCls ?? { value: 0, sources: [] });
  expect(result.value, `${path} layout shift: ${result.sources.join(', ')}`).toBeLessThanOrEqual(
    CLS_BUDGET,
  );
}
