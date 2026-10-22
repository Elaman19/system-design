import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { MAIL_QUEUE } from './jobs.js';

/**
 * Connection errors of the queue (Redis down, reconnecting) go to the JSON log. Without a
 * listener BullMQ prints them to stderr as plain text, which no log pipeline parses.
 */
@Injectable()
export class QueueErrorLogger implements OnModuleInit {
  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(QueueErrorLogger.name);
  }

  onModuleInit() {
    this.queue.on('error', (error) =>
      this.logger.warn({ err: error }, 'queue connection error'),
    );
  }
}
