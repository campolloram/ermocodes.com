// Motion DOM prep: splits the big type into letters and registers the bit groups. Runs only when
// the engine will really run. It never turns html.motion (the pinned layout) on: only the head
// script does, before the first paint, so the layout never switches to it later.
import { PHONE_QUERY, PROJECTS_BURST } from '../config.ts';
import { addGroup, groups, refs } from '../state.ts';
import { setLetterHidden, splitLine, splitLines, unsplitAll } from './split.ts';

export function prepareDom(): void {
  const w1 = document.querySelector<HTMLElement>('.hero .w1');
  const w2 = document.querySelector<HTMLElement>('.hero .w2');
  if (w1 && w2) refs.hero = [splitLine(w1, 0), splitLine(w2, 0)];

  // On a phone Experience is a plain list: the names stay text, nothing splits or bursts.
  const cos = matchMedia(PHONE_QUERY).matches
    ? []
    : [...document.querySelectorAll<HTMLElement>('.co')];
  const bigCount = cos.filter((c) => c.dataset.g === 'big').length;
  cos.forEach((co, k) => {
    const name = co.querySelector<HTMLElement>('.co-name');
    if (!name) return;
    const letters = splitLines(name);
    refs.companies.push(letters);
    refs.companyBits.push(
      addGroup(letters, { anchor: name, tint: k < bigCount ? 0 : 1, reach: 0.55 }),
    );
  });

  document.querySelectorAll<HTMLElement>('[data-proj] .proj-name').forEach((name, k) => {
    const line = name.querySelector<HTMLElement>('.ln');
    if (!line) return;
    refs.projectBits.push(
      addGroup(splitLines(name), {
        anchor: name,
        tint: k % 2,
        reach: PROJECTS_BURST.reach,
        spread: PROJECTS_BURST.spread,
      }),
    );
  });

  const talk = document.querySelector<HTMLElement>('.talk');
  if (talk) {
    refs.talk = splitLines(talk);
    refs.talkBits = addGroup(refs.talk, { anchor: talk, mode: 'in', reach: 0.8 });
  }
}

/** Shows every split letter, wherever it is (nothing draws a stand-in for a hidden one any more). */
export function showAllLetters(): void {
  const all = [
    ...(refs.hero?.flat() ?? []),
    ...refs.companies.flat(),
    ...refs.talk,
    ...groups.flatMap((g) => g.letters),
  ];
  all.forEach((l) => setLetterHidden(l, false));
}

/** Undoes prepareDom: the big type is plain text again and the bit groups are forgotten. */
export function undoPrepare(): void {
  unsplitAll();
  refs.hero = null;
  refs.companies.length = 0;
  refs.companyBits.length = 0;
  refs.projectBits.length = 0;
  refs.talk = [];
  refs.talkBits = null;
  groups.length = 0;
}
