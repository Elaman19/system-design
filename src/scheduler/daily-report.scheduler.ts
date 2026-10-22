import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { CronJob } from 'cron';
import { PinoLogger } from 'nestjs-pino';
import { withTimeout } from '../common/with-timeout.js';
import { ENV, type Env } from '../config/env.js';
import { JobName, MAIL_QUEUE } from '../queue/jobs.js';

export const DAILY_REPORT_JOB = 'daily-report';

/**
 * Fires the daily report on a cron schedule: puts one `daily-report` job into the queue,
 * the worker builds and mails it. The timer lives in this process, so the process must run
 * in ONE copy: every copy would fire its own report. There is no outbox and no dedup on
 * purpose, a report sent twice or skipped costs nothing (docs/background/README.md).
 */
@Injectable()
export class DailyReportScheduler implements OnApplicationBootstrap {
  constructor(
    private readonly registry: SchedulerRegistry,
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.logger.setContext(DailyReportScheduler.name);
  }

  onApplicationBootstrap() {
    const job = new CronJob(
      this.env.DAILY_REPORT_CRON,
      () => void this.fire(),
      null,
      true,
      this.env.DAILY_REPORT_TZ,
    );
    this.registry.addCronJob(DAILY_REPORT_JOB, job);
  }

  async fire() {
    try {
      await withTimeout(
        this.queue.add(JobName.dailyReport, {
          periodEnd: new Date().toISOString(),
        }),
        this.env.QUEUE_ADD_TIMEOUT_MS,
        'Redis',
      );
      this.logger.info('daily report queued');
    } catch (error) {
      this.logger.error({ err: error }, 'could not queue the daily report');
    }
  }
}
