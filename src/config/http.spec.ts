import type { INestApplication } from '@nestjs/common';
import type { Env } from './env.js';
import { configureHttp, parseTrustProxy } from './http.js';

describe('parseTrustProxy', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['2', 2],
    ['loopback', 'loopback'],
    ['10.0.0.0/8,192.168.0.0/16', '10.0.0.0/8,192.168.0.0/16'],
  ])('%s', (text, expected) => {
    expect(parseTrustProxy(text)).toBe(expected);
  });
});

describe('configureHttp', () => {
  const appWith = () => {
    const set = vi.fn();
    const use = vi.fn();
    const middleware = () => undefined;
    const app = {
      get: () => ({ middleware }),
      use,
      getHttpAdapter: () => ({ getInstance: () => ({ set }) }),
    } as unknown as INestApplication;
    return { app, set, use, middleware };
  };

  it('measures every request, before any other middleware can answer it', () => {
    const { app, use, middleware } = appWith();

    configureHttp(app, {} as Env);

    expect(use).toHaveBeenCalledWith(middleware);
  });

  it('tells Express which proxies to trust', () => {
    const { app, set } = appWith();

    configureHttp(app, { TRUST_PROXY: 'loopback' } as Env);

    expect(set).toHaveBeenCalledWith('trust proxy', 'loopback');
  });

  it('leaves Express alone when nothing is configured: req.ip is the socket peer', () => {
    const { app, set } = appWith();

    configureHttp(app, {} as Env);

    expect(set).not.toHaveBeenCalled();
  });
});
