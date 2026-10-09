import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * Nest logger backed by pino, for the window before nestjs-pino exists
 * (module init, DB connect retries): those lines are JSON too, not Nest's
 * coloured console output.
 */
export function nestLogger(logger: Logger): LoggerService {
  const emit =
    (level: Level) =>
    (message: unknown, ...params: unknown[]) => {
      // Nest appends the context name, and for errors a stack before it.
      const context =
        typeof params.at(-1) === 'string' ? params.pop() : undefined;
      const [stack] = params;
      const fields = {
        context,
        ...(typeof stack === 'string' ? { stack } : {}),
      };

      if (message instanceof Error) {
        logger[level]({ ...fields, err: message }, message.message);
      } else {
        logger[level](
          fields,
          typeof message === 'string' ? message : JSON.stringify(message),
        );
      }
    };

  return {
    log: emit('info'),
    error: emit('error'),
    warn: emit('warn'),
    debug: emit('debug'),
    verbose: emit('trace'),
    fatal: emit('fatal'),
  };
}
