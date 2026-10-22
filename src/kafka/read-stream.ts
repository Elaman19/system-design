import type { PinoLogger } from 'nestjs-pino';
import type { Stoppable } from '../common/retry.js';

/**
 * Feeds every message of a consumer stream to `handle`, one at a time and in order.
 * The stream ending or failing while the service is shutting down is normal and silent;
 * failing otherwise is logged (the process keeps running but reads nothing, which the
 * consumer-group lag makes visible).
 */
export async function readStream<M>(
  stream: AsyncIterable<M>,
  handle: (message: M) => Promise<void>,
  control: Stoppable,
  logger: PinoLogger,
  failureMessage: string,
) {
  try {
    for await (const message of stream) await handle(message);
  } catch (error) {
    if (!control.isStopped) logger.error({ err: error }, failureMessage);
  }
}
