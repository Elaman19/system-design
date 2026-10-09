import type { NextFunction, Request, Response } from 'express';

/**
 * While shutting down, answer every response with `Connection: close`, so
 * keep-alive clients (balancers) stop reusing the socket and `server.close()`
 * can finish. The header is set when the response head is written, not when the
 * request arrives: a request that started before SIGTERM gets it too.
 */
export function connectionCloseOnShutdown(isShuttingDown: () => boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const writeHead = res.writeHead.bind(res);
    res.writeHead = ((...args: unknown[]) => {
      if (isShuttingDown()) res.setHeader('Connection', 'close');
      return Reflect.apply(writeHead, res, args);
    }) as typeof res.writeHead;
    next();
  };
}
