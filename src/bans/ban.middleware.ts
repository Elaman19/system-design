import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { validClientIp } from '../common/client-ip.js';
import { rows } from '../db/sql.js';

/**
 * Refuses requests from a banned IP with 429. One indexed lookup per request (the
 * exclusion constraint's gist index on `(ip, period)`); a cache is a zone-3 job.
 * A ban appears seconds after the views that caused it, not instantly: the detector works
 * off Kafka, not off the request.
 */
@Injectable()
export class BanMiddleware implements NestMiddleware {
  constructor(private readonly dataSource: DataSource) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // `req.ip` comes from X-Forwarded-For behind a trusted proxy and can be garbage: an
    // address that is not one cannot be banned, and must not reach the `inet` cast.
    const ip = validClientIp(req.ip);
    if (!ip) return next();
    try {
      const [ban] = await rows<{ seconds: number }>(
        this.dataSource.manager,
        `SELECT ceil(extract(epoch FROM banned_until - now()))::int AS seconds
           FROM ip_bans
          WHERE ip = $1 AND tstzrange(banned_from, banned_until) @> now()
          LIMIT 1`,
        [ip],
      );
      if (!ban) return next();
      res
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .setHeader('Retry-After', String(ban.seconds))
        .json({
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'IP_BANNED',
          message: 'Слишком много запросов: IP временно заблокирован',
        });
    } catch (error) {
      next(error);
    }
  }
}
