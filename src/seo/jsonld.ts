// JSON-LD (Person) for the one page. Only confirmed values go in: LinkedIn is in; the GitHub URL
// stays out (hidden until the user gives it).
import { CONTACT, SITE } from '../content/site';

export const PERSON_ID = `${SITE.url}/#person`;

export function absoluteUrl(path: string): string {
  return new URL(path, SITE.url).href;
}

export function siteGraph() {
  const person = {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: SITE.name,
    url: `${SITE.url}/`,
    jobTitle: SITE.jobTitle,
    email: `mailto:${SITE.email}`,
    sameAs: [CONTACT.linkedin],
    address: { '@type': 'PostalAddress', addressLocality: 'Guadalajara', addressCountry: 'MX' },
  };
  return { '@context': 'https://schema.org', '@graph': [person] };
}

/** JSON for a <script type="application/ld+json">: `<` is escaped so text can't close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c');
}
