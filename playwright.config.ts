import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets parallel worktrees each serve their own build (reuseExistingServer is on locally).
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);
// perf.spec and slow.spec throttle the CPU: they run alone in chromium-perf.
const PERF_SPEC = /(perf|slow)\.spec\.ts$/;

// Chromium runs WebGL on SwiftShader where there is no GPU (CI): tests that need the motion layer
// fail there instead of skipping (helpers/webgl.ts needsWebGL); test builds accept software GL.
const chromiumGL = { launchOptions: { args: ['--enable-unsafe-swiftshader'] } };

// Chromium and Firefox only: never WebKit (it grabs keyboard focus even headless).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: PERF_SPEC,
      use: { ...devices['Desktop Chrome'], ...chromiumGL, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      testIgnore: PERF_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumGL,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'firefox-desktop',
      testIgnore: PERF_SPEC,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Firefox has no isMobile: a phone-sized viewport is the closest check.
      name: 'firefox-mobile',
      testIgnore: PERF_SPEC,
      use: { ...devices['Desktop Firefox'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'chromium-reduced',
      testIgnore: PERF_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumGL,
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      },
    },
    {
      // The phone perf check (CPU throttled 4x, scripted scroll). It depends on every other
      // project so it runs alone: parallel workers would starve it and fake long tasks.
      name: 'chromium-perf',
      testMatch: PERF_SPEC,
      // One at a time: the throttled tests would starve each other too.
      workers: 1,
      dependencies: [
        'chromium-desktop',
        'chromium-mobile',
        'firefox-desktop',
        'firefox-mobile',
        'chromium-reduced',
      ],
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumGL,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
  // Without BASE_URL, serve the built dist with astro preview. --ignore-lock keeps it in the
  // foreground (Astro auto-backgrounds preview when it detects a coding agent).
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `npm run preview -- --ignore-lock --host 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 60_000,
      },
});
