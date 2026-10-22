import type { INestApplication } from '@nestjs/common';
import type { Env } from './env.js';

/** Express reads "true", "3", "loopback" and CIDR lists differently; env gives only text. */
export function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

/**
 * Behind a balancer `req.ip` is the balancer unless Express is told which hops may
 * set X-Forwarded-For. Bans and the click stream key on the visitor's IP, so this
 * must name the real proxies; "true" (trust everyone) lets a client choose its own IP.
 */
export function configureHttp(app: INestApplication, env: Env) {
  if (env.TRUST_PROXY !== undefined) {
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  }
}
