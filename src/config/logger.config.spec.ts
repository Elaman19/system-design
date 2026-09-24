import { loggerConfig } from './logger.config.js';

describe('loggerConfig', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('uses pretty transport and debug level in development', () => {
    process.env.NODE_ENV = 'development';

    const config = loggerConfig();

    expect(config.pinoHttp).toMatchObject({
      level: 'debug',
      transport: { target: 'pino-pretty', options: { singleLine: true } },
    });
  });

  it('disables pretty transport and uses info level otherwise', () => {
    process.env.NODE_ENV = 'test';

    const config = loggerConfig();

    expect(config.pinoHttp).toMatchObject({
      level: 'info',
      transport: undefined,
    });
  });
});
