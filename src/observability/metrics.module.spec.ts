import http from 'node:http';
import type { PinoLogger } from 'nestjs-pino';
import { Gauge, Registry } from 'prom-client';
import type { Env } from '../config/env.js';
import { MetricsServer } from './metrics.module.js';

function get(port: number, path: string, method = 'GET') {
  return new Promise<number>((resolve, reject) => {
    http
      .request(
        { host: '127.0.0.1', port, path, method, agent: false },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      )
      .on('error', reject)
      .end();
  });
}

describe('MetricsServer', () => {
  const logger = { setContext: vi.fn(), info: vi.fn(), error: vi.fn() };
  const server = (registry: Registry, port?: number) =>
    new MetricsServer(
      { METRICS_PORT: port } as Env,
      registry,
      logger as unknown as PinoLogger,
    );

  it('listens on nothing without METRICS_PORT', async () => {
    const s = server(new Registry());

    await s.onApplicationBootstrap();

    expect(s.port()).toBeUndefined();
    await expect(s.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('answers 404 to anything but GET /metrics, 500 when a metric cannot be collected', async () => {
    const registry = new Registry();
    new Gauge({
      name: 'broken',
      help: 'always fails',
      registers: [registry],
      collect() {
        throw new Error('no data');
      },
    });
    const s = server(registry, 0);
    await s.onApplicationBootstrap();
    const port = s.port()!;

    try {
      expect(await get(port, '/metrics', 'POST')).toBe(404);
      expect(await get(port, '/metrics')).toBe(500);
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'collecting metrics failed',
      );
    } finally {
      await s.onApplicationShutdown();
    }
    expect(s.port()).toBeUndefined();
  });

  it('a port that is taken fails the start', async () => {
    const first = server(new Registry(), 0);
    await first.onApplicationBootstrap();
    try {
      await expect(
        server(new Registry(), first.port()).onApplicationBootstrap(),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.onApplicationShutdown();
    }
  });
});
