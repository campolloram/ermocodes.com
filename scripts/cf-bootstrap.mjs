#!/usr/bin/env node
// One-time Worker bootstrap . Refuses if the Worker already exists, so it can never
// replace production. Otherwise: production build (no test hooks), guard with main rules, then
// `wrangler deploy --config wrangler.bootstrap.jsonc` (no routes, preview URLs on).
// Cloudflare credentials reach only the existence check and the deploy, never build or guard.
// Usage: node scripts/cf-bootstrap.mjs [wrangler deploy flags...]
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { workerExists as defaultWorkerExists } from './cf-worker-exists.mjs';

export const WORKER_NAME = 'ermocodes-site';
const SECRET_KEYS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];

/** Copy of `env` without Cloudflare credentials or test hooks. */
export function buildEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !SECRET_KEYS.includes(key) && key !== 'PUBLIC_TEST_HOOKS',
    ),
  );
}

function defaultRun(command, args, env) {
  return spawnSync(command, args, { stdio: 'inherit', env }).status ?? 1;
}

/** Returns an exit code. `workerExists` and `run` are injectable for tests. */
export async function bootstrap({
  env = process.env,
  deployArgs = [],
  workerExists = defaultWorkerExists,
  run = defaultRun,
  log = console,
} = {}) {
  const exists = await workerExists({
    name: WORKER_NAME,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_API_TOKEN,
  });
  if (exists) {
    log.error(
      `cf-bootstrap: refusing; Worker ${WORKER_NAME} already exists. Deploys go through CI.`,
    );
    return 1;
  }
  const safeEnv = buildEnv(env);
  const steps = [
    ['npm', ['run', 'build'], safeEnv],
    ['node', ['scripts/guard-content.mjs', 'dist', '--main'], safeEnv],
    [
      'npx',
      ['wrangler', 'deploy', '--config', 'wrangler.bootstrap.jsonc', ...deployArgs],
      { ...safeEnv, ...pick(env, SECRET_KEYS) },
    ],
  ];
  for (const [command, args, stepEnv] of steps) {
    const status = run(command, args, stepEnv);
    if (status !== 0) {
      log.error(`cf-bootstrap: ${command} ${args.join(' ')} failed (exit ${status})`);
      return status;
    }
  }
  log.log(`cf-bootstrap: Worker ${WORKER_NAME} created with preview URLs and no routes`);
  return 0;
}

function pick(env, keys) {
  return Object.fromEntries(keys.filter((key) => key in env).map((key) => [key, env[key]]));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = await bootstrap({ deployArgs: process.argv.slice(2) });
  } catch (err) {
    console.error(`cf-bootstrap: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  }
}
