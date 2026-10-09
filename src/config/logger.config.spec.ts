import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Env } from './env.js';
import { baseLogOptions, genReqId, loggerConfig } from './logger.config.js';

const env = (over: Partial<Env>) => ({ NODE_ENV: 'test', ...over }) as Env;

describe('loggerConfig', () => {
  it('uses pretty transport and debug level in development', () => {
    const config = loggerConfig(env({ NODE_ENV: 'development' }));

    expect(config.pinoHttp).toMatchObject({
      level: 'debug',
      transport: { target: 'pino-pretty', options: { singleLine: true } },
    });
  });

  it('uses info level and no transport otherwise', () => {
    expect(loggerConfig(env({})).pinoHttp).toMatchObject({
      level: 'info',
      transport: undefined,
    });
  });

  it('lets LOG_LEVEL override the default', () => {
    expect(loggerConfig(env({ LOG_LEVEL: 'warn' })).pinoHttp).toMatchObject({
      level: 'warn',
    });
  });

  it('does not log probe requests', () => {
    const { autoLogging } = loggerConfig(env({})).pinoHttp as any;
    const ignore = autoLogging.ignore;

    expect(ignore({ url: '/live' })).toBe(true);
    expect(ignore({ url: '/ready' })).toBe(true);
    expect(ignore({ url: '/work' })).toBe(false);
    expect(ignore({})).toBe(false);
  });
});

describe('baseLogOptions', () => {
  it('matches what loggerConfig feeds to pino-http', () => {
    const e = env({ NODE_ENV: 'development', LOG_LEVEL: 'trace' });

    expect(loggerConfig(e).pinoHttp).toMatchObject(baseLogOptions(e));
    expect(baseLogOptions(e).level).toBe('trace');
  });
});

describe('genReqId', () => {
  const res = () => {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader: (k: string, v: string) => void (headers[k] = v),
    };
  };
  const req = (id?: string | string[]) =>
    ({ headers: { 'x-request-id': id } }) as unknown as IncomingMessage;

  it('reuses a valid incoming x-request-id and echoes it', () => {
    const r = res();

    expect(genReqId(req('abc-123'), r as unknown as ServerResponse)).toBe(
      'abc-123',
    );
    expect(r.headers['x-request-id']).toBe('abc-123');
  });

  it.each([undefined, 'bad id!', 'x'.repeat(200), ['a', 'b']])(
    'generates a uuid for %j',
    (incoming) => {
      const r = res();
      const id = genReqId(req(incoming), r as unknown as ServerResponse);

      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.headers['x-request-id']).toBe(id);
    },
  );
});
