import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CompaniesModule } from './companies/companies.module.js';
import { databaseConfig } from './config/database.config.js';
import { ENV, type Env } from './config/env.js';
import { EnvModule } from './config/env.module.js';
import { loggerConfig } from './config/logger.config.js';
import { PgErrorFilter } from './db/pg-error.filter.js';
import { DealsModule } from './deals/deals.module.js';
import { HealthModule } from './health/health.module.js';
import { LotsModule } from './lots/lots.module.js';
import { WalletsModule } from './wallets/wallets.module.js';

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
    CompaniesModule,
    LotsModule,
    WalletsModule,
    DealsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: PgErrorFilter }],
})
export class AppModule {}
