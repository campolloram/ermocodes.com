/** Keys that a control uses itself: Space on a button, any page key in a text field. */
const OWN_SPACE = 'button, summary, [role="button"], [role="checkbox"], [role="switch"]';

/** The browser's own steps: a 40px line, 87.5% of the view a page. 0 = not ours. */
export function keyStep(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey'>,
  t: Element | null,
  viewH: number = innerHeight,
): number {
  const page = Math.round(viewH * 0.875);
  if (e.key === ' ') return t?.closest(OWN_SPACE) ? 0 : e.shiftKey ? -page : page;
  if (e.shiftKey) return 0;
  const steps: Record<string, number> = {
    ArrowDown: 40,
    ArrowUp: -40,
    PageDown: page,
    PageUp: -page,
    End: Infinity,
    Home: -Infinity,
  };
  return steps[e.key] ?? 0;
}
