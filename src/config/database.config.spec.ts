import { databaseConfig, dataSourceOptions } from './database.config.js';

describe('databaseConfig', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.DB_HOST = 'db-host';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'db-user';
    process.env.DB_PASSWORD = 'db-password';
    process.env.DB_NAME = 'db-name';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('builds TypeORM module options from env vars', () => {
    const config = databaseConfig();

    expect(config).toMatchObject({
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
    const options = dataSourceOptions();

    expect(options).toMatchObject({
      type: 'postgres',
      host: 'db-host',
      port: 5433,
      database: 'db-name',
      synchronize: false,
    });
    expect(options).not.toHaveProperty('autoLoadEntities');
  });

  it('throws when DB_PORT is not a valid integer', () => {
    process.env.DB_PORT = 'not-a-number';

    expect(() => databaseConfig()).toThrow(
      'DB_PORT must be a positive integer, got: not-a-number',
    );
  });

  it('throws when DB_PORT is not positive', () => {
    process.env.DB_PORT = '0';

    expect(() => databaseConfig()).toThrow(
      'DB_PORT must be a positive integer, got: 0',
    );
  });
});
