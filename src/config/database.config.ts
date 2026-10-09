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
  return { ...baseOptions(env), autoLoadEntities: true };
}

export function dataSourceOptions(env: Env): DataSourceOptions {
  return baseOptions(env);
}
