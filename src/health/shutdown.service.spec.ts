import { ShutdownService } from './shutdown.service.js';

function setup(opts: { initialized?: boolean; closes?: boolean } = {}) {
  const { initialized = true, closes = true } = opts;
  const server = {
    close: vi.fn((cb: () => void) => {
      if (closes) setTimeout(cb, 100);
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  };
  const dataSource = {
    isInitialized: initialized,
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const logger = {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const service = new ShutdownService(
    { httpAdapter: { getHttpServer: () => server } } as any,
    dataSource as any,
    { SHUTDOWN_DRAIN_MS: 1000, SHUTDOWN_TIMEOUT_MS: 5000 } as any,
    logger as any,
  );
  return { service, server, dataSource, logger };
}

describe('ShutdownService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flips readiness immediately, then drains and closes the listener', async () => {
    const { service, server, logger } = setup();
    expect(service.isShuttingDown).toBe(false);

    service.onModuleDestroy();
    expect(service.isShuttingDown).toBe(true);

    const done = service.beforeApplicationShutdown('SIGTERM');
    expect(server.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeIdleConnections).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('force-closes connections when in-flight requests outlive the timeout', async () => {
    const { service, server, logger } = setup({ closes: false });

    const done = service.beforeApplicationShutdown();
    await vi.advanceTimersByTimeAsync(1000 + 5000);
    await done;

    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs onModuleDestroy', () => {
    const { service, logger } = setup();
    service.onModuleDestroy();
    expect(logger.info).toHaveBeenCalledWith(
      { hook: 'onModuleDestroy' },
      expect.any(String),
    );
  });

  it('destroys the data source on application shutdown', async () => {
    const { service, dataSource } = setup();
    await service.onApplicationShutdown('SIGTERM');
    expect(dataSource.destroy).toHaveBeenCalledOnce();
  });

  it('skips destroy when the data source never initialized', async () => {
    const { service, dataSource, logger } = setup({ initialized: false });
    await service.onApplicationShutdown();
    expect(dataSource.destroy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith(
      'database connection already closed',
    );
  });
});
