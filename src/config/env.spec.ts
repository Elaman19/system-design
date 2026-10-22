import { loadEnv } from './env.js';

const valid = {
  NODE_ENV: 'production',
  PORT: '3000',
  DB_HOST: 'h',
  DB_PORT: '5432',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'n',
  REDIS_URL: 'redis://r:6379',
  S3_ENDPOINT: 'http://s3:8333',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  KAFKA_BROKERS: 'kafka:9092',
  MAIL_SMTP_URL: 'smtp://mail:1025',
};

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    expect(loadEnv(valid)).toMatchObject({
      PORT: 3000,
      DB_PORT: 5432,
      HEALTH_TIMEOUT_MS: 1500,
      SHUTDOWN_DRAIN_MS: 5000,
      SHUTDOWN_TIMEOUT_MS: 10000,
      DB_LOCK_TIMEOUT_MS: 5000,
      DB_STATEMENT_TIMEOUT_MS: 30000,
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 30000,
      WORK_ENDPOINT_ENABLED: false,
      JOB_ATTEMPTS: 5,
      MAIL_TIMEOUT_MS: 10000,
      ABUSE_MAX_VIEWS: 300,
      ABUSE_WINDOW_MS: 60000,
      ABUSE_BAN_MS: 3600000,
      ARCHIVE_BATCH_SIZE: 1000,
      KAFKA_GROUP_PREFIX: '',
      KAFKA_TOPIC_LOT_VIEWS: 'lot-views',
      KAFKA_TOPIC_IP_BANS: 'ip-bans',
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

  it('requires the service connections and validates their URLs', () => {
    const { REDIS_URL: _r, KAFKA_BROKERS: _k, ...rest } = valid;

    expect(() => loadEnv(rest)).toThrow(/REDIS_URL.*KAFKA_BROKERS/);
    expect(() => loadEnv({ ...valid, REDIS_URL: 'nope' })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ ...valid, S3_ENDPOINT: 'not a url' })).toThrow(
      /S3_ENDPOINT/,
    );
  });

  it('rejects a non-numeric port', () => {
    expect(() => loadEnv({ ...valid, DB_PORT: 'abc' })).toThrow(/DB_PORT/);
  });
});
