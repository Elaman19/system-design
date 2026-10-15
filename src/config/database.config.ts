import { DataSourceOptions } from 'typeorm';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { Env } from './env.js';

function baseOptions(env: Env): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    synchronize: false,
    entities: ['dist/**/*.entity.js'],
    migrations: ['dist/migrations/*.js'],
  } as DataSourceOptions;
}

export function databaseConfig(env: Env): TypeOrmModuleOptions {
  const limits = [
    `lock_timeout=${env.DB_LOCK_TIMEOUT_MS}`,
    `statement_timeout=${env.DB_STATEMENT_TIMEOUT_MS}`,
    `idle_in_transaction_session_timeout=${env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
  ];
  return {
    ...baseOptions(env),
    autoLoadEntities: true,
    // Passed to every pooled connection at startup; the migration CLI does not get
    // them, a long DDL statement must not be cut off by statement_timeout.
    extra: { options: limits.map((limit) => `-c ${limit}`).join(' ') },
  };
}

export function dataSourceOptions(env: Env): DataSourceOptions {
  return baseOptions(env);
}
