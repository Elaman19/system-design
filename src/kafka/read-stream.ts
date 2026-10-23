import type { Stoppable } from '../common/retry.js';
import type { ProcessFailure } from '../common/process-failure.js';

/**
 * Feeds every message of a consumer stream to `handle`, one at a time and in order.
 * The stream ending or failing while the service is shutting down is normal and silent.
 * Failing otherwise means nothing is read any more, and a process that stays up without
 * reading looks healthy to Compose: it is reported as fatal so the process is restarted.
 */
export async function readStream<M>(
  stream: AsyncIterable<M>,
  handle: (message: M) => Promise<void>,
  control: Stoppable,
  failure: ProcessFailure,
  failureMessage: string,
) {
  try {
    for await (const message of stream) await handle(message);
  } catch (error) {
    if (!control.isStopped) failure.fatal(error, failureMessage);
  }
}
