#!/usr/bin/env node
// Prints "true" or "false": whether the named Worker exists in the Cloudflare account.
// Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Exits 2 on any other API response.
// Usage: node scripts/cf-worker-exists.mjs <worker-name>
import { pathToFileURL } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Resolves to true (200), false (404), or throws on any other status. */
export async function workerExists({ name, accountId, token, fetchFn = fetch }) {
  if (!NAME_PATTERN.test(name ?? '')) throw new Error(`invalid worker name: ${name}`);
  if (!accountId || !token)
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
  const url = `${API}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${name}/settings`;
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`Cloudflare API returned HTTP ${res.status} for worker ${name}`);
}

async function main(argv) {
  try {
    const exists = await workerExists({
      name: argv[0],
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_API_TOKEN,
    });
    console.log(String(exists));
    return 0;
  } catch (err) {
    console.error(`cf-worker-exists: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
