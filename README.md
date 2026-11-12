# ermocodes-site

Source for [ermocodes.com](https://ermocodes.com), a one-page interactive CV.

Stack: Astro 7 (static output), TypeScript (strict), plain CSS with design tokens, GSAP, Lenis and three.js for the motion, Vitest for unit tests, Playwright for e2e, served from Cloudflare Workers Static Assets.

## Run

Requires Node 24 (see `.nvmrc`) and `pdftotext` (poppler) for the content guard.

```sh
npm ci
npm run dev        # local dev server
npm run build      # static build into dist/
npm run preview    # serve the build
```

## Test

```sh
npm run check      # astro check (types)
npm run lint
npm run format:check
npm test           # unit tests (vitest)
npm run guard      # content guard on dist/
npm run test:e2e   # Playwright (needs browsers: npx playwright install chromium)
npm run verify     # everything above, in CI order
```

Optional configuration is in `.env.example`. To run the guard's blocked-names test against real names, put them in a git-ignored `.blocked-names.local` (one per line, last line an email domain) or set `BLOCKED_NAMES`.

## Deploy

CI (`.github/workflows/ci.yml`) runs on every PR and push. PRs get a preview deploy. Production deploys only by hand: Actions, Deploy, Run workflow, `target=production`, behind the `production` environment. See `.github/workflows/deploy.yml`.
