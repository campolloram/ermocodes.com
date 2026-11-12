import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

for (const path of ['/', '/404']) {
  test(`${path} has a meta CSP and triggers no violations or console errors`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__cspViolations?.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });

    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    // Scroll to the bottom so anything lazy has loaded.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);

    const csp = await page
      .locator('meta[http-equiv="content-security-policy"]')
      .getAttribute('content');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src[^;]*'self'/);
    expect(csp).toContain("object-src 'none'");
    // The policy comes first in <head>: a meta CSP covers only what follows it.
    const headOrder = await page.evaluate(() => {
      const kids = [...document.head.children];
      const at = kids.findIndex((e) => e.matches('meta[http-equiv="content-security-policy"]'));
      const firstCode = kids.findIndex((e) => e.matches('script, style'));
      return { at, firstCode };
    });
    expect(headOrder.at).toBeGreaterThanOrEqual(0);
    expect(headOrder.at).toBeLessThan(headOrder.firstCode);
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
