// Copy the user has not confirmed. `draft()` wraps a line with the source it was drafted from;
// <Draft> marks it on preview builds and scripts/check-drafts.mjs lists every one. Drafts never
// block the build, only the production deploy (guard --main).
export interface Draft {
  readonly draft: true;
  readonly text: string;
  /** Where the line came from, e.g. 'cv:BACKEND.jobs[2]', 'gtm:§1 offer C'. */
  readonly src: string;
}

export type Copy = string | Draft;

export function draft(text: string, opts: { src: string }): Draft {
  return { draft: true, text, src: opts.src };
}

export const isDraft = (value: Copy): value is Draft => typeof value !== 'string';
export const textOf = (value: Copy): string => (isDraft(value) ? value.text : value);
