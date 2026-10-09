import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ENV, type Env } from '../config/env.js';
import { ShutdownService } from './shutdown.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly indicators: HealthIndicatorService,
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
    return this.health.check([
      () => {
        const indicator = this.indicators.check('shutdown');
        return this.shutdown.isShuttingDown
          ? indicator.down({ message: 'shutting down' })
          : indicator.up();
      },
      () =>
        this.db.pingCheck('database', { timeout: this.env.HEALTH_TIMEOUT_MS }),
    ]);
  }
}
