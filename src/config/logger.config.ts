import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Params } from 'nestjs-pino';
import type { Env } from './env.js';

const HEALTH_PATHS = new Set(['/live', '/ready']);
const REQUEST_ID_PATTERN = /^[\w.-]{1,128}$/;

export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

/** Level and transport shared by the request logger and the bootstrap logger. */
export function baseLogOptions(env: Env) {
  const isDevelopment = env.NODE_ENV === 'development';

  return {
    level: env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info'),
    transport: isDevelopment
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
  };
}

export function loggerConfig(env: Env): Params {
  return {
    pinoHttp: {
      ...baseLogOptions(env),
      genReqId,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      // Probes fire every few seconds; logging them drowns real traffic.
      autoLogging: {
        ignore: (req) => HEALTH_PATHS.has(req.url ?? ''),
      },
    },
  };
}
