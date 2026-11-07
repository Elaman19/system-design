import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ProcessFailureModule } from './common/process-failure.js';
import { ENV, type Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { loggerConfig } from './config/logger.config.js';
import { MetricsModule } from './observability/metrics.module.js';
import { TracingModule } from './observability/tracing.js';

/**
 * What every process of the system needs: validated config, JSON logs, a metrics endpoint
 * and the flush of traces on shutdown. The database is
 * not here: the detector, the archiver and the scheduler never touch Postgres, so they
 * neither open a pool nor need Postgres to start (see DatabaseModule).
 */
@Module({
  imports: [
    EnvModule,
    ProcessFailureModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => loggerConfig(env),
    }),
    MetricsModule,
    TracingModule,
  ],
})
export class CoreModule {}
