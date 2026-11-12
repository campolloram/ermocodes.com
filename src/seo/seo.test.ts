import { describe, expect, it } from 'vitest';
import { PERSON_ID, absoluteUrl, serializeJsonLd, siteGraph } from './jsonld';
import { parseSiteEnv, robotsDirective, robotsTxt } from './site-env';

describe('site environment', () => {
  it('is production unless PUBLIC_SITE_ENV is exactly "preview"', () => {
    expect(parseSiteEnv('preview')).toBe('preview');
    expect(parseSiteEnv(undefined)).toBe('production');
    expect(parseSiteEnv('Preview')).toBe('production');
  });

  it('makes every preview page noindex', () => {
    expect(robotsDirective('preview', false)).toBe('noindex, nofollow');
    expect(robotsDirective('production', true)).toBe('noindex, nofollow');
    expect(robotsDirective('production', false)).toBeNull();
  });

  it('lists the sitemap in robots.txt only in production', () => {
    const url = 'https://ermocodes.com/sitemap-index.xml';
    expect(robotsTxt('production', url)).toContain(`Sitemap: ${url}`);
    expect(robotsTxt('preview', url)).not.toContain('Sitemap:');
  });
});

describe('JSON-LD', () => {
  const graph = siteGraph();

  it('describes the Person with the one public email and only the confirmed LinkedIn link', () => {
    expect(graph['@graph']).toHaveLength(1);
    const [person] = graph['@graph'];
    expect(person?.['@id']).toBe(PERSON_ID);
    expect(person?.email).toBe('mailto:hello@ermocodes.com');
    expect(person?.sameAs).toEqual(['https://www.linkedin.com/in/ermocodes']);
    expect(JSON.stringify(graph)).not.toMatch(/gmail|github/);
  });

  it('escapes < so text cannot close the script tag', () => {
    expect(serializeJsonLd({ a: '</script>' })).not.toContain('</script>');
  });

  it('builds absolute URLs on the site origin', () => {
    expect(absoluteUrl('/og/home.png')).toBe('https://ermocodes.com/og/home.png');
  });
});
