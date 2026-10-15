import { databaseConfig, dataSourceOptions } from './database.config.js';
import type { Env } from './env.js';

const env = {
  DB_HOST: 'db-host',
  DB_PORT: 5433,
  DB_USER: 'db-user',
  DB_PASSWORD: 'db-password',
  DB_NAME: 'db-name',
  DB_LOCK_TIMEOUT_MS: 4000,
  DB_STATEMENT_TIMEOUT_MS: 20000,
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 10000,
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

  it('sets lock, statement and idle-in-transaction timeouts on app connections only', () => {
    expect(databaseConfig(env)).toMatchObject({
      extra: {
        options:
          '-c lock_timeout=4000 -c statement_timeout=20000 -c idle_in_transaction_session_timeout=10000',
      },
    });
    expect(dataSourceOptions(env)).not.toHaveProperty('extra');
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
