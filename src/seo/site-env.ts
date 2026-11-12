// Build environment. PR preview builds set PUBLIC_SITE_ENV=preview: every page gets noindex and
// robots.txt drops the sitemap line (the Worker also sends X-Robots-Tag on previews).
export type SiteEnv = 'production' | 'preview';

export function parseSiteEnv(value: unknown): SiteEnv {
  return value === 'preview' ? 'preview' : 'production';
}

export const SITE_ENV: SiteEnv = parseSiteEnv(import.meta.env.PUBLIC_SITE_ENV);

/** robots meta content, or null when the page is indexable. */
export function robotsDirective(env: SiteEnv, noindex: boolean): string | null {
  return env === 'preview' || noindex ? 'noindex, nofollow' : null;
}

export function robotsTxt(env: SiteEnv, sitemapUrl: string): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (env === 'production') lines.push('', `Sitemap: ${sitemapUrl}`);
  return `${lines.join('\n')}\n`;
}
