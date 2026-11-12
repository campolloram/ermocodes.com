import { expect, test, vi } from 'vitest';
import { bootstrap } from './cf-bootstrap.mjs';

const env = {
  CLOUDFLARE_API_TOKEN: 'tok',
  CLOUDFLARE_ACCOUNT_ID: 'acc',
  PUBLIC_TEST_HOOKS: '1',
  PATH: '/bin',
};
const quietLog = { log: () => {}, error: () => {} };

test('refuses and runs nothing when the Worker already exists', async () => {
  const run = vi.fn(() => 0);
  const code = await bootstrap({ env, workerExists: async () => true, run, log: quietLog });
  expect(code).toBe(1);
  expect(run).not.toHaveBeenCalled();
});

test('builds without hooks or secrets, guards with main rules, then deploys', async () => {
  const run = vi.fn(() => 0);
  const code = await bootstrap({ env, workerExists: async () => false, run, log: quietLog });
  expect(code).toBe(0);
  const calls = run.mock.calls.map(([cmd, args]) => [cmd, ...args].join(' '));
  expect(calls).toEqual([
    'npm run build',
    'node scripts/guard-content.mjs dist --main',
    'npx wrangler deploy --config wrangler.bootstrap.jsonc',
  ]);
  const [buildEnv, guardEnv, deployEnv] = run.mock.calls.map((c) => c[2]);
  for (const stepEnv of [buildEnv, guardEnv]) {
    expect(stepEnv).toEqual({ PATH: '/bin' });
  }
  expect(deployEnv).toEqual({
    PATH: '/bin',
    CLOUDFLARE_API_TOKEN: 'tok',
    CLOUDFLARE_ACCOUNT_ID: 'acc',
  });
});

test('stops before deploying when the guard fails', async () => {
  const run = vi.fn((cmd) => (cmd === 'node' ? 1 : 0));
  const code = await bootstrap({ env, workerExists: async () => false, run, log: quietLog });
  expect(code).toBe(1);
  expect(run).toHaveBeenCalledTimes(2);
});
