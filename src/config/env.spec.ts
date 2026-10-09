import { loadEnv } from './env.js';

const valid = {
  NODE_ENV: 'production',
  PORT: '3000',
  DB_HOST: 'h',
  DB_PORT: '5432',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'n',
};

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    expect(loadEnv(valid)).toMatchObject({
      PORT: 3000,
      DB_PORT: 5432,
      HEALTH_TIMEOUT_MS: 1500,
      SHUTDOWN_DRAIN_MS: 5000,
      SHUTDOWN_TIMEOUT_MS: 10000,
      WORK_ENDPOINT_ENABLED: false,
    });
  });

  it('enables /work only on an explicit "true"', () => {
    expect(
      loadEnv({ ...valid, WORK_ENDPOINT_ENABLED: 'true' })
        .WORK_ENDPOINT_ENABLED,
    ).toBe(true);
    expect(() => loadEnv({ ...valid, WORK_ENDPOINT_ENABLED: 'yes' })).toThrow(
      /WORK_ENDPOINT_ENABLED/,
    );
  });

  it('reads process.env by default', () => {
    const saved = { ...process.env };
    Object.assign(process.env, valid);
    try {
      expect(loadEnv().DB_HOST).toBe('h');
    } finally {
      process.env = saved;
    }
  });

  it('names every missing required variable', () => {
    const { DB_HOST: _h, DB_NAME: _n, ...rest } = valid;

    expect(() => loadEnv(rest)).toThrow(/DB_HOST.*DB_NAME/);
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadEnv({ ...valid, DB_PORT: 'abc' })).toThrow(/DB_PORT/);
  });
});
