/**
 * The public Cal.com event, from PUBLIC_CAL_LINK. Accepts the full URL
 * (https://cal.com/ermocodes/intro-call) or the bare "username/event-slug".
 * An unset or blank variable gives undefined and [book a call] stays off; a malformed value
 * throws, so a bad setting fails the build instead of silently dropping the buttons.
 */
export function calHref(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  const bad = (): never => {
    throw new Error('PUBLIC_CAL_LINK is not a cal.com event ("username/event" or a cal.com URL)');
  };
  // A path segment of dots only ("..") would let the browser resolve to another user's event.
  const dotted = (path: string) => path.split('/').some((seg) => /^\.{1,2}$/.test(seg));
  if (/^[\w.-]+(\/[\w.-]+)+$/.test(v) && !dotted(v)) return `https://cal.com/${v}`;
  if (!/^https:\/\/cal\.com\/[\w.-]+(\/[\w.-]+)+\/?$/.test(v)) return bad();
  return dotted(v.slice('https://cal.com/'.length)) ? bad() : v;
}
