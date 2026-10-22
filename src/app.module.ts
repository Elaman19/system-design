import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BanGuardModule } from './bans/ban-guard.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { CoreModule } from './core.module.js';
import { DatabaseModule } from './db/database.module.js';
import { PgErrorFilter } from './db/pg-error.filter.js';
import { DealsModule } from './deals/deals.module.js';
import { HealthModule } from './health/health.module.js';
import { LotsModule } from './lots/lots.module.js';
import { WalletsModule } from './wallets/wallets.module.js';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    BanGuardModule,
    HealthModule,
    CompaniesModule,
    LotsModule,
    WalletsModule,
    DealsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: PgErrorFilter }],
})
export class AppModule {}
