// The one Open Graph card, /og/home.png, set in Departure Mono.
import type { APIRoute } from 'astro';
import { SITE } from '../../content/site';
import { renderOgImage } from '../../og/render';

export const GET: APIRoute = async () => {
  const png = await renderOgImage({
    name: SITE.name,
    role: SITE.jobTitle,
    line: 'Python, APIs, queues and data.',
    url: 'ermocodes.com',
  });
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
