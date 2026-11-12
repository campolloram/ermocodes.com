/**
 * The public Cal.com event, from PUBLIC_CAL_LINK. Accepts the full URL
 * (https://cal.com/ermocodes/intro-call) or the bare "username/event-slug".
 * Anything else, or an unset variable, gives undefined and [book a call] stays off.
 */
export function calHref(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  // A path segment of dots only ("..") would let the browser resolve to another user's event.
  const dotted = (path: string) => path.split('/').some((seg) => /^\.{1,2}$/.test(seg));
  if (/^[\w.-]+(\/[\w.-]+)+$/.test(v) && !dotted(v)) return `https://cal.com/${v}`;
  if (!/^https:\/\/cal\.com\/[\w.-]+(\/[\w.-]+)+\/?$/.test(v)) return undefined;
  return dotted(v.slice('https://cal.com/'.length)) ? undefined : v;
}
