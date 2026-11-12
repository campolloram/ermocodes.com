import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  BLOCKED_NAMES_MISSING,
  findViolations,
  hasDraftMarkup,
  loadBlockedNames,
  pdfText,
  scanDir,
} from './guard-content.mjs';

const rules = (text, options) => findViolations(text, options).map((v) => v.rule);

describe('guard-content', () => {
  test('flags international phone numbers in HTML', () => {
    expect(rules('<p>Call +52 33 1234 5678</p>')).toEqual(['phone number']);
    expect(rules('<p>+1 (415) 555-0134</p>')).toEqual(['phone number']);
  });

  test('flags local phone numbers without a +, and tel: links', () => {
    expect(rules('<p>Call 33 1234 5678</p>')).toEqual(['phone number']);
    expect(rules('<p>(33) 1234-5678</p>')).toEqual(['phone number']);
    expect(rules('<p>331-234-5678</p>')).toEqual(['phone number']);
    expect(rules('<a href="tel:3312345678">call</a>')).toEqual(['tel: link or telephone field']);
    expect(rules('{"telephone":"x"}')).toEqual(['tel: link or telephone field']);
  });

  test('does not mistake years, versions, sizes or svg numbers for phone numbers', () => {
    expect(rules('<p>2024 – 2026</p><p>v1.2.3</p><path d="M12.5 3456 7890"/>')).toEqual([]);
    expect(rules('<p>1440x900 at 220 KB, 300 KB, 2.5 s</p>')).toEqual([]);
  });

  test('flags any email except the contact address', () => {
    expect(rules('<a href="mailto:hello@ermocodes.com">hello@ermocodes.com</a>')).toEqual([]);
    expect(rules('<a href="mailto:me@mail.example">me</a>')).toEqual([
      'email other than the contact address',
    ]);
    expect(rules('{"email":"someone@other.test"}')).toEqual([
      'email other than the contact address',
    ]);
    expect(rules('var a="x@y.z"', { isScript: true })).toEqual([]);
  });

  test('allows only listed hosts in links, and only the confirmed LinkedIn profile', () => {
    const ok =
      '<a href="https://ermocodes.com/">a</a><a href="https://www.linkedin.com/in/ermocodes">l</a>' +
      '<a href="https://cal.com/ermocodes/intro-call">c</a>';
    expect(rules(ok, { isHtml: true })).toEqual([]);
    for (const bad of [
      'https://bsky.app/profile/x',
      'https://www.threads.net/@x',
      'https://github.com/x',
      'https://www.linkedin.com/in/someone-else',
      'https://www.reddit.com/u/x',
      'https://cal.com/someone-else/call',
    ])
      expect(rules(`<a href="${bad}">x</a>`, { isHtml: true })).toEqual([
        'link to a host not on the allow list',
      ]);
    // The scripts' own URLs (library comments) are not links in a page.
    expect(rules('//docs https://github.com/x', { isScript: true })).toEqual([]);
  });

  test('ignores phone-like numbers in scripts', () => {
    expect(rules('var a=+52 33 1234 5678;', { isScript: true })).toEqual([]);
  });

  test('flags links to x.com, twitter.com and instagram.com, including subdomains', () => {
    const html =
      '<a href="https://x.com/a">a</a><a href="//www.twitter.com/b">b</a><a href="https://instagram.com/c">c</a>';
    expect(rules(html)).toHaveLength(3);
    expect(rules('<a href="https://mobile.x.com/a">a</a>')).toEqual([
      'social link (x/twitter/instagram)',
    ]);
  });

  test('does not flag domains that merely end in x.com', () => {
    expect(rules('<a href="https://dropbox.com/s">s</a> netflix.company')).toEqual([]);
  });

  test('flags a blocked domain entry in any file, without echoing it', () => {
    const blockedNames = ['banned.example'];
    const found = findViolations('see https://www.banned.example/work', { blockedNames });
    expect(found).toEqual([{ rule: 'old portfolio domain', match: '[redacted]' }]);
    expect(findViolations('fine.example notbanned.example', { blockedNames })).toEqual([]);
  });

  test('flags gmail.com, which is public and needs no list', () => {
    expect(rules('<a href="mailto:x@gmail.com">x</a>', { isHtml: true })).toHaveLength(2);
  });

  test('flags blocked names, phrases and the personal email in HTML text, without echoing them', () => {
    const blockedNames = ['acme corp', 'zed', 'me@mail.example'];
    const rule = (html) => rules(html, { isHtml: true, blockedNames });
    expect(rule('<p>Built it at Acme Corp.</p>')).toEqual(['banned client or personal name']);
    expect(rule('<p>ZED</p>')).toEqual(['banned client or personal name']);
    expect(rule('<p>Placed through ACME CORP, for Zed.</p>')).toHaveLength(2);
    // Names are checked on HTML text only.
    expect(rules('<p>zed</p>', { blockedNames })).toEqual([]);
  });

  test('loadBlockedNames reads BLOCKED_NAMES split on "|", else a file, lower-cased', () => {
    expect(loadBlockedNames({ BLOCKED_NAMES: 'Fakeco|Faux Firm| x.example ' })).toEqual([
      'fakeco',
      'faux firm',
      'x.example',
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'guard-list-'));
    try {
      const file = join(dir, 'list');
      writeFileSync(file, 'Dummy Client\nfaux.example\n');
      expect(loadBlockedNames({}, file)).toEqual(['dummy client', 'faux.example']);
      expect(loadBlockedNames({}, join(dir, 'missing'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the CLI fails without a block list when CI is set or with --main, and skips for forks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-cli-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<p>Placed through Fakeco.</p>');
      const script = join(process.cwd(), 'scripts/guard-content.mjs');
      const go = (args, env) =>
        spawnSync(process.execPath, [script, dir, ...args], {
          env: { PATH: process.env.PATH, ...env },
          cwd: tmpdir(),
          encoding: 'utf8',
        });
      const missing = go(['--main'], {});
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain(BLOCKED_NAMES_MISSING);
      expect(go([], { CI: 'true' }).status).toBe(1);
      expect(go([], {}).status).toBe(0);
      const fork = go([], { CI: 'true', GUARD_SKIP_BLOCKED_NAMES: '1' });
      expect(fork.status).toBe(0);
      expect(fork.stderr).toContain('warning');
      expect(go([], { CI: 'true', BLOCKED_NAMES: 'Fakeco|other.example' }).status).toBe(1);
      expect(go([], { CI: 'true', BLOCKED_NAMES: 'nothere|other.example' }).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('main rules flag data-draft markup but not the CSS selector', () => {
    expect(hasDraftMarkup('<span data-draft data-src="x">a</span>')).toBe(true);
    expect(hasDraftMarkup('<style>[data-draft]{color:red}</style><p>a</p>')).toBe(false);
  });

  test('with main rules, flags the __ecSim test hook in client JS', () => {
    const js = 'window.__ecSim={advance(){}}';
    expect(rules('window.__ecMotion={}', { isScript: true, noTestHooks: true })).toEqual([
      'test hook in production JS',
    ]);
    expect(rules(js, { isScript: true, noTestHooks: true })).toEqual([
      'test hook in production JS',
    ]);
    expect(rules(js, { isScript: true })).toEqual([]);
    expect(rules('<p>__ecSim</p>', { noTestHooks: true })).toEqual([]);
  });

  test('scanDir applies the test-hook rule only with isMain and without allowTestHooks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-hooks-'));
    try {
      writeFileSync(join(dir, 'a.js'), 'window.__ecSim={}');
      expect(scanDir(dir).problems).toEqual([]);
      expect(scanDir(dir, { isMain: true }).problems.map((p) => p.rule)).toContain(
        'test hook in production JS',
      );
      expect(
        scanDir(dir, { isMain: true, allowTestHooks: true }).problems.map((p) => p.rule),
      ).not.toContain('test hook in production JS');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an empty or wrong folder fails instead of reading as clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-empty-'));
    try {
      const out = spawnSync(process.execPath, ['scripts/guard-content.mjs', dir]);
      expect(out.status).toBe(1);
      writeFileSync(join(dir, 'index.html'), '<h1>hello</h1>');
      expect(spawnSync(process.execPath, ['scripts/guard-content.mjs', dir]).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--no-test-hooks bans the hooks without the main rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-nohooks-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<p data-draft>x</p>');
      writeFileSync(join(dir, 'a.js'), 'window.__ecMotion={}');
      expect(scanDir(dir, { noTestHooks: true }).problems.map((p) => p.rule)).toEqual([
        'test hook in production JS',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('passes clean content', () => {
    expect(rules('<h1>hello</h1><a href="https://github.com/x">gh</a>')).toEqual([]);
  });

  // The real old-portfolio domain never appears in this repo, so a stand-in entry is injected.
  test('scans extensionless _redirects and skips binary files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'));
    try {
      writeFileSync(
        join(dir, '_redirects'),
        '/old https://www.banned.example/work 301\n/x https://x.com/someone 302\n',
      );
      writeFileSync(join(dir, 'logo.png'), 'https://x.com/ignored-binary');
      const { files, problems } = scanDir(dir, {
        blockedNames: ['banned.example'],
      });
      expect(files).toHaveLength(1);
      expect(problems.map((p) => [p.file, p.rule])).toEqual([
        ['_redirects', 'social link (x/twitter/instagram)'],
        ['_redirects', 'old portfolio domain'],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('scanDir reads the text of PDFs, plain and inside a Flate stream', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-pdf-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<p>ok</p>');
      writeFileSync(join(dir, 'a.pdf'), Buffer.from('%PDF-1.4\n(write to someone@example.com)\n'));
      const packed = Buffer.concat([
        Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'),
        deflateSync(Buffer.from('(Call +52 33 1234 5678)')),
        Buffer.from('\nendstream\nendobj\n'),
      ]);
      writeFileSync(join(dir, 'b.pdf'), packed);
      const found = scanDir(dir).problems.map((p) => `${p.file}:${p.rule}`);
      expect(found).toContain('a.pdf:email other than the contact address');
      expect(found).toContain('b.pdf:phone number');
      writeFileSync(join(dir, 'a.pdf'), Buffer.from('%PDF-1.4\n(hello@ermocodes.com)\n'));
      writeFileSync(join(dir, 'b.pdf'), Buffer.from('%PDF-1.4\n'));
      expect(scanDir(dir).problems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing pdftotext is a loud error, not a fallback', () => {
    const path = process.env.PATH;
    process.env.PATH = '/nonexistent-guard-test';
    try {
      expect(() => pdfText(Buffer.from('%PDF-1.4\n'))).toThrow(/pdftotext is required/);
    } finally {
      process.env.PATH = path;
    }
  });
});
