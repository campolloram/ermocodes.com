// robots.txt: crawl everything; production lists the sitemap. Preview pages carry noindex
// instead of a Disallow, so crawlers can still see it.
import type { APIRoute } from 'astro';
import { SITE } from '../content/site';
import { SITE_ENV, robotsTxt } from '../seo/site-env';

export const GET: APIRoute = () =>
  new Response(robotsTxt(SITE_ENV, `${SITE.url}/sitemap-index.xml`), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
