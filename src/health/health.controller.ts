import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ENV, type Env } from '../config/env.js';
import { ShutdownService } from './shutdown.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly shutdown: ShutdownService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Liveness: no dependencies, only proves the process serves requests. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** Readiness: 503 while shutting down or when a dependency is unreachable. */
  @Get('ready')
  @HealthCheck()
  ready() {
    // Answer 503 immediately: no dependency check (which may wait on a busy
    // pool) once shutdown has started.
    if (this.shutdown.isShuttingDown) {
      const down = { status: 'down', message: 'shutting down' };
      throw new ServiceUnavailableException({
        status: 'error',
        info: {},
        error: { shutdown: down },
        details: { shutdown: down },
      });
    }
    return this.health.check([
      () =>
        this.db.pingCheck('database', { timeout: this.env.HEALTH_TIMEOUT_MS }),
    ]);
  }
}
