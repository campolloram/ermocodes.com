// Lighthouse CI budgets (budgets listed below). Mobile preset (the
// Lighthouse default), 3 runs per URL. build.format is 'file', so the LHCI static server needs the
// .html path for non-index pages. The server listens on a random port: every pattern allows one.
// CI runs this on the production build (no test hooks), on a runner without a GPU: there `/` is the
// page a visitor without a GPU gets (the head script keeps software WebGL on plain DOM). Run it
// locally (`npm run lhci`, CHROME_PATH set) to measure the WebGL hero on a real GPU.
const KB = 1024;

const categories = {
  'categories:performance': ['error', { minScore: 0.95 }],
  'categories:accessibility': ['error', { minScore: 0.95 }],
  'categories:best-practices': ['error', { minScore: 0.95 }],
  'categories:seo': ['error', { minScore: 0.95 }],
};

// S1 budgets: the 404 is a plain page.
const pageBudgets = {
  ...categories,
  'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
  'total-blocking-time': ['error', { maxNumericValue: 150 }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.02 }],
  'resource-summary:script:size': ['error', { maxNumericValue: 10 * KB }],
  'resource-summary:stylesheet:size': ['error', { maxNumericValue: 30 * KB }],
};

// S2 budgets: `/` carries the WebGL hero (three.js, GSAP, Lenis).
const homeBudgets = {
  ...categories,
  'categories:performance': ['error', { minScore: 0.9 }],
  'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
  'total-blocking-time': ['error', { maxNumericValue: 200 }],
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.02 }],
  'resource-summary:script:size': ['error', { maxNumericValue: 220 * KB }],
  'resource-summary:total:size': ['error', { maxNumericValue: 300 * KB }],
};

// The 404 is noindex by design, which fails Lighthouse's is-crawlable audit, so the SEO category
// is replaced by its individual audits there.
const noindexBudgets = {
  ...pageBudgets,
  'categories:seo': 'off',
  'document-title': 'error',
  'meta-description': 'error',
  'http-status-code': 'error',
  'link-text': 'error',
  'crawlable-anchors': 'error',
};

const HOME = '^http://localhost:\\d+/$';
const NOT_FOUND = '^http://localhost:\\d+/404\\.html$';

module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      url: ['http://localhost/', 'http://localhost/404.html'],
      numberOfRuns: 3,
      settings: { chromeFlags: '--headless=new --no-sandbox' },
    },
    assert: {
      assertMatrix: [
        { matchingUrlPattern: HOME, assertions: homeBudgets },
        { matchingUrlPattern: NOT_FOUND, assertions: noindexBudgets },
        // A collected URL that matches no row above would pass unchecked (as `/` once did): any
        // such URL fails here (a score can never reach 2).
        {
          matchingUrlPattern: `^(?!(${HOME})|(${NOT_FOUND})).*`,
          assertions: { 'categories:performance': ['error', { minScore: 2 }] },
        },
      ],
    },
    upload: { target: 'filesystem', outputDir: './.lighthouseci/reports' },
  },
};
