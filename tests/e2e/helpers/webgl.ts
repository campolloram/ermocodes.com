import { expect, test, type Page, type TestInfo } from '@playwright/test';

/** Makes every WebGL context request fail, in any browser (what --disable-webgl does). */
export async function disableWebGL(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      if (/webgl/i.test(type)) return null;
      // eslint-disable-next-line prefer-rest-params
      return original.apply(this, arguments as unknown as Parameters<typeof original>);
    } as typeof original;
  });
}

/**
 * Lets the head script's probe open its WebGL2 context, then makes every later WebGL request fail:
 * the page paints in the long motion layout and the engine cannot start (a GPU process that died
 * between the probe and the engine).
 */
export async function failWebGLAfterProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    let probed = false;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      if (/webgl/i.test(type)) {
        if (probed) return null;
        probed = true;
      }
      // eslint-disable-next-line prefer-rest-params
      return original.apply(this, arguments as unknown as Parameters<typeof original>);
    } as typeof original;
  });
}

export async function hasWebGL(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));
}

/**
 * For a test that needs the WebGL motion layer. Chromium always has WebGL (SwiftShader when there
 * is no GPU, CI included, and test builds accept it), so there a missing motion layer fails the
 * test instead of skipping it. Firefox has no WebGL on a machine without a GPU (CI): there the
 * test is skipped, by name; plain.spec covers that page.
 */
export function needsWebGL(testInfo: TestInfo, available: boolean): void {
  if (testInfo.project.name.startsWith('chromium')) {
    expect(available, `${testInfo.project.name} must run the WebGL motion layer`).toBe(true);
    return;
  }
  test.skip(!available, 'Firefox without a GPU has no WebGL (plain.spec covers that page)');
}
