import { DataSourceOptions } from 'typeorm';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

function baseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
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
