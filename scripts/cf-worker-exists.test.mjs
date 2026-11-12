import { expect, test } from 'vitest';
import { workerExists } from './cf-worker-exists.mjs';

const args = (status) => ({
  name: 'ermocodes-site',
  accountId: 'acc',
  token: 'tok',
  fetchFn: async () => ({ status }),
});

test('maps 200 to true and 404 to false', async () => {
  await expect(workerExists(args(200))).resolves.toBe(true);
  await expect(workerExists(args(404))).resolves.toBe(false);
});

test('throws on other statuses, bad names and missing credentials', async () => {
  await expect(workerExists(args(403))).rejects.toThrow('HTTP 403');
  await expect(workerExists({ ...args(200), name: '../x' })).rejects.toThrow('invalid worker name');
  await expect(workerExists({ ...args(200), token: '' })).rejects.toThrow('required');
});
