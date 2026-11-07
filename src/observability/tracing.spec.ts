import { setTracingSdk, TracingShutdown } from './tracing.js';

describe('TracingShutdown', () => {
  afterEach(() => setTracingSdk(undefined));

  it('flushes the spans of the SDK started by the preload', async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    setTracingSdk({ shutdown });

    await new TracingShutdown().onApplicationShutdown();

    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('does nothing when tracing was not preloaded', async () => {
    await expect(
      new TracingShutdown().onApplicationShutdown(),
    ).resolves.toBeUndefined();
  });
});
