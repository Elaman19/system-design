import { EventEmitter } from 'node:events';
import type { Queue } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import { QueueErrorLogger } from './queue-errors.js';

describe('QueueErrorLogger', () => {
  it('writes connection errors of the queue to the log instead of stderr', () => {
    const queue = new EventEmitter();
    const logger = { setContext: vi.fn(), warn: vi.fn() };
    new QueueErrorLogger(
      queue as unknown as Queue,
      logger as unknown as PinoLogger,
    ).onModuleInit();
    const error = new Error('ECONNREFUSED');

    queue.emit('error', error);

    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      'queue connection error',
    );
  });
});
