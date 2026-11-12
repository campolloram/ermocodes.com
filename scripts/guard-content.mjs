#!/usr/bin/env node
// Content guard: scans the built site (dist/) for content that must never ship.
//   - phone numbers, with or without a leading + (non-script files; minified JS produces false
//     positives), and tel: links
//   - any email address other than the contact one (hello@ermocodes.com), in every text file
//   - any absolute link in HTML, XML or text files to a host that is not on the allow list
//     (this also catches x.com, twitter.com, instagram.com and any other social site)
//   - links to x.com, twitter.com or instagram.com
//   - gmail.com, and the old portfolio domain (any host that ends in it)
//   - on HTML text: the consultancy and IT-services firm names, the end client and the personal
//     email address. The private list is never stored in this repo: it is read at run time from
//     the BLOCKED_NAMES env (entries separated by "|") or the git-ignored .blocked-names.local
//     (separated by "|" or newlines), and matched as case-insensitive substrings. List every
//     spelling variant as its own entry. A domain-shaped entry (a.b, no "@") is also checked in
//     every text file, like gmail.com.
//   - with --main, or when CI is set, an empty list is a hard error ("BLOCKED_NAMES secret
//     missing"). Fork PRs get no secrets: the workflow sets GUARD_SKIP_BLOCKED_NAMES=1 for them
//     and the guard then skips this one rule with a warning.
//   - PDFs are scanned as text with the HTML rules (phones, emails, hosts, banned names): pdftotext
//     is required (missing = hard error); link targets inside Flate streams are read as well
//   - with --main: any remaining draft (data-draft), and the test hooks (__ecSim, __ecMotion) in
//     client JS (production builds never carry them). CI's own PUBLIC_TEST_HOOKS=1 build on main
//     passes --allow-test-hooks.
//   --no-test-hooks applies only the hook rule on its own (public PR previews never carry them).
// Usage: node scripts/guard-content.mjs <dir> [--main] [--allow-test-hooks] [--no-test-hooks]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles } from './lib/walk.mjs';

// Everything is scanned (including extensionless _headers and _redirects) except binaries.
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.zip',
  '.gz',
  '.br',
  '.wasm',
]);
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs']);
const TEST_HOOKS = ['__ecSim', '__ecMotion'];

export const PHONE_PATTERN = /\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
// Local numbers, no +: 33 1234 5678, 331 234 5678, 33-1234-5678, (33) 1234-5678.
export const LOCAL_PHONE_PATTERN =
  /(?<![\d.,/#-])(?:\(\d{2,3}\)[\s.-]?\d{3,4}[\s.-]\d{4}|\d{2,3}[\s.-]\d{4}[\s.-]\d{4}|\d{3}[\s.-]\d{3}[\s.-]\d{4})(?![\d.,/-])/g;
export const TEL_PATTERN = /\btel:|"telephone"/gi;
export const EMAIL_PATTERN = /[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
export const CONTACT_EMAIL = 'hello@ermocodes.com';
// The only hosts a link in the pages may point to. LinkedIn only for the confirmed profile path.
export const ALLOWED_HOSTS = new Set([
  'ermocodes.com',
  'www.ermocodes.com',
  'static.cloudflareinsights.com',
  'cloudflareinsights.com',
  'schema.org',
  'www.w3.org',
  'www.sitemaps.org',
]);
export const LINKEDIN_PROFILE = '/in/ermocodes';
export const CAL_PATH_PREFIX = '/ermocodes/';
const URL_PATTERN = /https?:\/\/([a-z0-9.-]+)(\/[^\s"'<>)\\]*)?/gi;
const LINK_EXTENSIONS = new Set(['.html', '.xml', '.txt']);
export const SOCIAL_PATTERN =
  /(?<![a-z0-9.-])(?:[a-z0-9-]+\.)*(?:x|twitter|instagram)\.com(?![a-z0-9-])/gi;

// Public domains that must never appear (no personal mailbox anywhere on the site).
export const BANNED_DOMAINS = ['gmail.com'];

export const BLOCKED_NAMES_MISSING =
  'BLOCKED_NAMES secret missing: set the BLOCKED_NAMES env (names separated by "|") or create the ' +
  'git-ignored .blocked-names.local.';

/** The private block list: BLOCKED_NAMES env first, else .blocked-names.local; lower-case entries. */
export function loadBlockedNames(env = process.env, file = '.blocked-names.local') {
  const raw = env.BLOCKED_NAMES?.trim()
    ? env.BLOCKED_NAMES
    : existsSync(file)
      ? readFileSync(file, 'utf8')
      : '';
  return raw
    .split(/[|\n]/)
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
}

const isDomainEntry = (entry) => !entry.includes('@') && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(entry);
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when a link to `host` + `path` is on the allow list. */
function hostAllowed(host, path) {
  if (ALLOWED_HOSTS.has(host)) return true;
  // The sitemap's XML namespaces.
  if (host === 'www.google.com' && path.startsWith('/schemas/')) return true;
  // Cal.com only for the owner's events, like LinkedIn only for the confirmed profile.
  if (host === 'cal.com')
    return (
      path.startsWith(CAL_PATH_PREFIX) && !path.split('/').some((seg) => /^\.{1,2}$/.test(seg))
    );
  return host === 'www.linkedin.com' && path.replace(/\/$/, '') === LINKEDIN_PROFILE;
}

/** Thrown when pdftotext is not installed: the guard cannot read shipped PDFs without it. */
export const PDFTOTEXT_MISSING =
  'pdftotext is required to scan the shipped PDFs and was not found or did not run. ' +
  'Install poppler (macOS: brew install poppler; Debian/Ubuntu: sudo apt-get install -y poppler-utils).';

/**
 * Text of a PDF: pdftotext's page text, the raw bytes, and the link targets (/URI) found inside
 * Flate streams (object streams hide annotations from the raw scan). A missing pdftotext is a hard
 * error: the raw-stream fallback cannot see page text and reads layout numbers as phones. A file
 * pdftotext cannot parse (not a real PDF) is read through every inflated stream instead.
 */
export function pdfText(buffer) {
  const r = spawnSync('pdftotext', ['-q', '-', '-'], { input: buffer, timeout: 20_000 });
  if (r.error) throw new Error(`${PDFTOTEXT_MISSING} (${r.error.code ?? r.error.message})`);
  const parsed = r.status === 0 && r.stdout;
  const parts = [buffer.toString('latin1')];
  if (parsed) parts.push(r.stdout.toString('utf8'));
  for (const m of buffer.toString('latin1').matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = buffer.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      const text = inflateSync(buffer.subarray(start, end)).toString('latin1');
      parts.push(parsed ? (text.match(/\/URI\s*\([^)]*\)/g) ?? []).join('\n') : text);
    } catch (err) {
      // An image or font stream is not Flate text (a zlib data error): nothing to read. Anything
      // else is a real failure and must not pass the guard silently.
      if (!/^Z_/.test(err?.code ?? '')) throw err;
    }
  }
  return parts.join('\n');
}

/** True when a tag carries data-draft (the attribute selector inside inlined CSS does not count). */
export function hasDraftMarkup(html) {
  return /<[^>]*\bdata-draft\b/.test(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' '));
}

/** Visible text of an HTML page (scripts and styles removed), lower-case. */
function visibleText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/[<>]/g, ' ')
    .toLowerCase();
}

/** Returns violations ({ rule, match }) found in one file's text. */
export function findViolations(
  text,
  {
    isScript = false,
    isHtml = false,
    blockedNames = [],
    noTestHooks = false,
    isLinkFile = isHtml,
  } = {},
) {
  const intl = isScript ? [] : [...text.matchAll(PHONE_PATTERN)].map((m) => m[0]);
  const local = isScript
    ? []
    : [...text.matchAll(LOCAL_PHONE_PATTERN)]
        .map((m) => m[0])
        .filter((n) => !intl.some((i) => i.includes(n)));
  const phones = [...intl, ...local];
  const tels = isScript ? [] : [...text.matchAll(TEL_PATTERN)].map((m) => m[0]);
  const emails = isScript
    ? []
    : [...text.matchAll(EMAIL_PATTERN)]
        .map((m) => m[0])
        .filter((e) => e.toLowerCase() !== CONTACT_EMAIL);
  const hosts = isLinkFile
    ? [...text.matchAll(URL_PATTERN)]
        .filter((m) => !hostAllowed(m[1].toLowerCase(), m[2] ?? ''))
        .map((m) => m[1].toLowerCase())
    : [];
  const socials = [...text.matchAll(SOCIAL_PATTERN)].map((m) => m[0]);
  const lower = text.toLowerCase();
  const domains = [...BANNED_DOMAINS, ...blockedNames.filter(isDomainEntry)];
  const banned = domains.filter((d) =>
    new RegExp(`(?<![a-z0-9-])${escapeRe(d)}(?![a-z0-9-])`).test(lower),
  );
  const visible = isHtml ? visibleText(text) : '';
  const names = isHtml ? blockedNames.filter((n) => visible.includes(n)) : [];
  const hooks = isScript && noTestHooks ? TEST_HOOKS.filter((hook) => text.includes(hook)) : [];
  return [
    ...hooks.map((match) => ({ rule: 'test hook in production JS', match })),
    ...names.map(() => ({ rule: 'banned client or personal name', match: '[redacted]' })),
    ...phones.map((match) => ({ rule: 'phone number', match })),
    ...tels.map((match) => ({ rule: 'tel: link or telephone field', match })),
    ...emails.map(() => ({ rule: 'email other than the contact address', match: '[redacted]' })),
    ...hosts.map((match) => ({ rule: 'link to a host not on the allow list', match })),
    ...socials.map((match) => ({ rule: 'social link (x/twitter/instagram)', match })),
    ...banned.map(() => ({ rule: 'old portfolio domain', match: '[redacted]' })),
  ];
}

/** Scans every non-binary file under `dir`; returns { files, problems }. */
export function scanDir(
  dir,
  {
    isMain = false,
    allowTestHooks = false,
    noTestHooks: hooksBanned = false,
    blockedNames = [],
  } = {},
) {
  const noTestHooks = hooksBanned || (isMain && !allowTestHooks);
  const files = listFiles(dir, (path) => !BINARY_EXTENSIONS.has(extname(path).toLowerCase()));
  const contentProblems = files.flatMap((file) => {
    if (extname(file).toLowerCase() === '.pdf') {
      const found = findViolations(pdfText(readFileSync(file)), {
        isHtml: true,
        isLinkFile: true,
        blockedNames,
      });
      return found.map((v) => ({ ...v, file: relative(dir, file) }));
    }
    const text = readFileSync(file, 'utf8');
    const isScript = SCRIPT_EXTENSIONS.has(extname(file));
    const isHtml = extname(file) === '.html';
    const drafts = isMain && isHtml && hasDraftMarkup(text);
    const isLinkFile = LINK_EXTENSIONS.has(extname(file));
    const found = findViolations(text, {
      isScript,
      isHtml,
      isLinkFile,
      blockedNames,
      noTestHooks,
    });
    if (drafts)
      found.push({ rule: 'unconfirmed draft copy (run check:drafts)', match: 'data-draft' });
    return found.map((v) => ({
      ...v,
      file: relative(dir, file),
    }));
  });
  return { files, problems: contentProblems };
}

function main(argv) {
  const dir = argv.find((arg) => !arg.startsWith('--')) ?? 'dist';
  const isMain = argv.includes('--main');
  const allowTestHooks = argv.includes('--allow-test-hooks');
  if (!existsSync(dir)) {
    console.error(`guard-content: ${dir} not found; run the build first.`);
    return 1;
  }
  const blockedNames = loadBlockedNames();
  if (blockedNames.length === 0) {
    if (process.env.GUARD_SKIP_BLOCKED_NAMES === '1') {
      console.warn('guard-content: warning: no block list (fork PR); name rules skipped.');
    } else if (isMain || process.env.CI) {
      console.error(`guard-content: ${BLOCKED_NAMES_MISSING}`);
      return 1;
    } else {
      console.warn(
        `guard-content: warning: no block list; name rules skipped. ${BLOCKED_NAMES_MISSING}`,
      );
    }
  }
  let scan;
  try {
    scan = scanDir(dir, {
      blockedNames,
      isMain,
      allowTestHooks,
      noTestHooks: argv.includes('--no-test-hooks'),
    });
  } catch (error) {
    console.error(`guard-content: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const { files, problems } = scan;
  // An empty or wrong folder must not read as "clean": the last production gate depends on this.
  if (files.length === 0 || !existsSync(join(dir, 'index.html'))) {
    console.error(`guard-content: ${dir} has no index.html; run the build first.`);
    return 1;
  }
  for (const p of problems) console.error(`guard-content: ${p.file}: ${p.rule}: ${p.match}`);
  if (problems.length > 0) return 1;
  console.log(`guard-content: ${files.length} files clean${isMain ? ' (main rules)' : ''}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
