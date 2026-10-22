import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config/database.config.js';
import { ENV, type Env } from '../config/env.js';

/**
 * The Postgres connection (global DataSource). Imported by the API and by the processes
 * that read or write Postgres: the outbox relay, the worker, the ban recorder.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => databaseConfig(env),
    }),
  ],
})
export class DatabaseModule {}
