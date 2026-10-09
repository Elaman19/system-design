import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { ENV, type Env } from '../config/env.js';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class ShutdownService
  implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown
{
  private shuttingDown = false;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly dataSource: DataSource,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ShutdownService.name);
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  onModuleDestroy() {
    // First shutdown hook to run: /ready turns 503 right away.
    this.shuttingDown = true;
    this.logger.info({ hook: 'onModuleDestroy' }, 'shutdown hook fired');
  }

  async beforeApplicationShutdown(signal?: string) {
    this.shuttingDown = true;
    this.logger.info(
      { hook: 'beforeApplicationShutdown', signal },
      '/ready now answers 503, draining before closing the listener',
    );
    await sleep(this.env.SHUTDOWN_DRAIN_MS);

    const server = this.adapterHost.httpAdapter.getHttpServer();
    const closed = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    server.closeIdleConnections();
    this.logger.info('listener closed, waiting for in-flight requests');

    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      closed.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), this.env.SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
    // A pending timer would keep the event loop (and the container) alive.
    clearTimeout(timer);
    if (timedOut) {
      this.logger.warn(
        { timeoutMs: this.env.SHUTDOWN_TIMEOUT_MS },
        'in-flight requests did not finish in time, closing connections',
      );
      server.closeAllConnections();
    } else {
      this.logger.info('all in-flight requests finished');
    }
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.info({ hook: 'onApplicationShutdown', signal }, 'closing db');
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
      this.logger.info('database connection closed');
    } else {
      // TypeOrmCoreModule has its own onApplicationShutdown that may run first.
      this.logger.info('database connection already closed');
    }
  }
}
