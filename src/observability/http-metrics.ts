import { Injectable, Module } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Histogram, Registry } from 'prom-client';

const ERROR_CODE = Symbol('errorCode');

type WithErrorCode = { [ERROR_CODE]?: string };

/**
 * The machine `code` of the error body this response carried (`RETRY`, `IP_BANNED`,
 * `OUT_OF_STOCK`, ...), if any. Set by the HttpMetrics middleware; the request log and the
 * metrics both read it, so a `409 RETRY` can be told from a `409 OUT_OF_STOCK`.
 */
export function errorCodeOf(res: object): string | undefined {
  return (res as WithErrorCode)[ERROR_CODE];
}

/** The route pattern (`/lots/:id`, never the id itself: one series per route). */
function routeOf(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  // Nest mounts its middleware and its 404 handler as wildcard routes (`{/*splat}`) under
  // a base URL that is the request's own path, ids included: never a label, or every lot
  // id becomes a time series. Those answers (a ban, an unknown path) are "unmatched".
  return typeof path === 'string' && !path.includes('*') ? path : 'unmatched';
}

/**
 * Duration of every API response by method, route, status and error code: the source of
 * the latency/error SLIs (docs/observability, 2.2). Buckets include the SLI boundaries,
 * 0.3 s for the lot card and 1 s for a deal, so "faster than the boundary" is an exact
 * bucket count, not an estimate.
 */
@Injectable()
export class HttpMetrics {
  readonly duration: Histogram<'method' | 'route' | 'status' | 'code'>;

  constructor(registry: Registry) {
    this.duration = new Histogram({
      name: 'http_server_request_duration_seconds',
      help: 'API response time by method, route pattern, status and error code',
      labelNames: ['method', 'route', 'status', 'code'],
      buckets: [0.025, 0.05, 0.1, 0.3, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    });
  }

  /** Express middleware; must run before anything that can answer (see configureHttp). */
  readonly middleware = (req: Request, res: Response, next: NextFunction) => {
    const stop = this.duration.startTimer();
    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      const code = (body as { code?: unknown } | null | undefined)?.code;
      if (typeof code === 'string') (res as WithErrorCode)[ERROR_CODE] = code;
      return json(body);
    };
    const record = (status: string) =>
      stop({
        method: req.method,
        route: routeOf(req),
        status,
        code: errorCodeOf(res) ?? '',
      });
    const finished = () => {
      res.off('close', closed);
      record(String(res.statusCode));
    };
    // Closed before the answer was sent: the client gave up (or the socket broke). The
    // status code would say 200 for a request nobody got an answer to.
    const closed = () => {
      res.off('finish', finished);
      record('aborted');
    };
    res.once('finish', finished);
    res.once('close', closed);
    next();
  };
}

@Module({ providers: [HttpMetrics], exports: [HttpMetrics] })
export class HttpMetricsModule {}
