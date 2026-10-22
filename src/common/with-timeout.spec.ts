import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('returns what the work returns', async () => {
    expect(await withTimeout(Promise.resolve(7), 1000, 'x')).toBe(7);
  });

  it('passes the failure of the work through', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 1000, 'x'),
    ).rejects.toThrow('boom');
  });

  it('rejects, naming the thing, when the work is too slow', async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 20, 'Redis'),
    ).rejects.toThrow('Redis did not answer in 20 ms');
  });
});
