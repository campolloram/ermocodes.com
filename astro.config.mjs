// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { createHash } from 'node:crypto';
import { HEAD_SCRIPT } from './src/motion/head-script.mjs';
import { cspFirst } from './scripts/lib/csp-first.mjs';

const SITE_URL = 'https://ermocodes.com';
/** @type {`sha256-${string}`} */
const headScriptHash = `sha256-${createHash('sha256').update(HEAD_SCRIPT).digest('base64')}`;

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  markdown: { syntaxHighlight: false },
  // cspFirst moves the meta CSP ahead of the inline head script and style (a meta CSP only covers
  // what follows it).
  integrations: [sitemap({ filter: (page) => new URL(page).pathname === '/' }), cspFirst()],
  // Astro hashes its own scripts and styles into a meta CSP. frame-ancestors cannot be
  // set from a meta tag, so public/_headers sends it.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self' https://cloudflareinsights.com",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ],
      scriptDirective: {
        resources: ["'self'", 'https://static.cloudflareinsights.com'],
        hashes: [headScriptHash],
      },
      styleDirective: { resources: ["'self'"] },
    },
  },
  // Departure Mono is the only typeface (SIL OFL, files in src/assets/fonts with OFL.txt).
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Departure Mono',
      cssVariable: '--font-departure',
      // The metric-matched stand-ins (tokens.css) come before the generic families; Astro adds its
      // own Courier New one first.
      fallbacks: [
        'Departure Mono fallback A',
        'Departure Mono fallback B',
        'Departure Mono fallback C',
        'ui-monospace',
        'SFMono-Regular',
        'Menlo',
        'monospace',
      ],
      display: 'swap',
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/DepartureMono-Regular.woff2'],
            weight: '400',
            style: 'normal',
          },
        ],
      },
    },
  ],
});
