import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { PinoLogger } from 'nestjs-pino';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { ENV, type Env } from '../config/env.js';

/**
 * Serves the process's metrics to Prometheus on METRICS_PORT (pull model). A port of its
 * own, not a route of the API: the scrape bypasses the balancer, the ban check and the
 * request log, and the background processes, which have no HTTP server, get the same
 * endpoint. No METRICS_PORT: metrics are still counted, nothing listens (tests).
 */
@Injectable()
export class MetricsServer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private server?: Server;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly registry: Registry,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MetricsServer.name);
  }

  async onApplicationBootstrap() {
    if (this.env.METRICS_PORT === undefined) return;
    const server = createServer((req, res) => void this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.env.METRICS_PORT, resolve);
    });
    this.logger.info({ port: this.port() }, 'metrics endpoint is listening');
  }

  /** The port actually bound (METRICS_PORT=0 picks a free one), undefined when off. */
  port(): number | undefined {
    return (this.server?.address() as AddressInfo | null)?.port;
  }

  async onApplicationShutdown() {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await this.registry.metrics();
      res
        .writeHead(200, { 'content-type': this.registry.contentType })
        .end(body);
    } catch (error) {
      this.logger.error({ err: error }, 'collecting metrics failed');
      res.writeHead(500).end();
    }
  }
}

/**
 * One metrics registry per process (per Nest application, so parallel tests never share
 * one), with Node's own metrics: CPU, memory, event loop lag, GC.
 */
@Global()
@Module({
  providers: [
    {
      provide: Registry,
      useFactory: () => {
        const registry = new Registry();
        collectDefaultMetrics({ register: registry });
        return registry;
      },
    },
    MetricsServer,
  ],
  exports: [Registry, MetricsServer],
})
export class MetricsModule {}
