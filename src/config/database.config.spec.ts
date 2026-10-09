import { databaseConfig, dataSourceOptions } from './database.config.js';
import type { Env } from './env.js';

const env = {
  DB_HOST: 'db-host',
  DB_PORT: 5433,
  DB_USER: 'db-user',
  DB_PASSWORD: 'db-password',
  DB_NAME: 'db-name',
} as Env;

describe('databaseConfig', () => {
  it('builds TypeORM module options from env', () => {
    expect(databaseConfig(env)).toMatchObject({
      type: 'postgres',
      host: 'db-host',
      port: 5433,
      username: 'db-user',
      password: 'db-password',
      database: 'db-name',
      synchronize: false,
      autoLoadEntities: true,
    });
  });

  it('builds CLI data source options without autoLoadEntities', () => {
    const options = dataSourceOptions(env);

    expect(options).toMatchObject({
      type: 'postgres',
      host: 'db-host',
      port: 5433,
      database: 'db-name',
      synchronize: false,
    });
    expect(options).not.toHaveProperty('autoLoadEntities');
  });
});
