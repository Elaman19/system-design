import { DataSourceOptions } from 'typeorm';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

function requirePort(raw: string | undefined): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`DB_PORT must be a positive integer, got: ${raw}`);
  }
  return port;
}

function baseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST,
    port: requirePort(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    synchronize: false,
    entities: ['dist/**/*.entity.js'],
    migrations: ['dist/migrations/*.js'],
  } as DataSourceOptions;
}

export function databaseConfig(): TypeOrmModuleOptions {
  return { ...baseOptions(), autoLoadEntities: true };
}

export function dataSourceOptions(): DataSourceOptions {
  return baseOptions();
}
