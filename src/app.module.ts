import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { databaseConfig } from './config/database.config.js';
import { ENV, type Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { loggerConfig } from './config/logger.config.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => loggerConfig(env),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => databaseConfig(env),
    }),
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
