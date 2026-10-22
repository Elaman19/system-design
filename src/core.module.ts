import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { loggerConfig } from './config/logger.config.js';

/**
 * What every process of the system needs: validated config and JSON logs. The database is
 * not here: the detector, the archiver and the scheduler never touch Postgres, so they
 * neither open a pool nor need Postgres to start (see DatabaseModule).
 */
@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => loggerConfig(env),
    }),
  ],
})
export class CoreModule {}
