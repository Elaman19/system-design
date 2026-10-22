import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { MAIL_QUEUE } from './jobs.js';
import { QueueErrorLogger } from './queue-errors.js';
import { redisConnection } from './redis.js';

const DAY_SECONDS = 24 * 60 * 60;

/** The Redis connection and the `mail` queue with the project's retry policy. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        connection: redisConnection(env.REDIS_URL),
        prefix: env.BULLMQ_PREFIX,
      }),
    }),
    BullModule.registerQueueAsync({
      name: MAIL_QUEUE,
      inject: [ENV],
      useFactory: (env: Env) => ({
        defaultJobOptions: {
          // Total runs, the first included: a job that keeps failing stops after this
          // many instead of retrying forever.
          attempts: env.JOB_ATTEMPTS,
          // 1 s, 2 s, 4 s ... between runs, so a dead SMTP server is not hammered.
          backoff: { type: 'exponential', delay: env.JOB_BACKOFF_MS },
          removeOnComplete: { age: DAY_SECONDS },
          // Failed jobs stay: they are what an operator looks at and re-runs
          // (scripts/jobs.mjs).
          removeOnFail: false,
        },
      }),
    }),
  ],
  providers: [QueueErrorLogger],
  exports: [BullModule],
})
export class QueueModule {}
