import type { NextFunction, Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { BanMiddleware } from './ban.middleware.js';

describe('BanMiddleware', () => {
  it('passes the error on when the lookup fails, instead of hanging the request', async () => {
    const failure = new Error('database down');
    const middleware = new BanMiddleware({
      manager: { query: () => Promise.reject(failure) },
    } as unknown as DataSource);
    const next = vi.fn() as unknown as NextFunction;

    await middleware.use(
      { ip: '203.0.113.7' } as Request,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith(failure);
  });

  it('lets a request through without asking the database when the IP is not an address', async () => {
    const query = vi.fn();
    const middleware = new BanMiddleware({
      manager: { query },
    } as unknown as DataSource);
    const next = vi.fn() as unknown as NextFunction;

    await middleware.use({ ip: 'not-an-ip' } as Request, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(query).not.toHaveBeenCalled();
  });
});
