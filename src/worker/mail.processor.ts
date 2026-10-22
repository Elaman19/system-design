import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { BanAlertJob } from '../bans/ban-alert.job.js';
import {
  type DailyReportData,
  type DealReceiptData,
  type IpBanAlertData,
  JobName,
  MAIL_QUEUE,
} from '../queue/jobs.js';
import { ReceiptJob } from '../receipts/receipt.job.js';
import { DailyReportJob } from '../reports/daily-report.job.js';

/**
 * The worker: takes jobs off the `mail` queue and dispatches by name. A throw makes
 * BullMQ retry the job (attempts and backoff are set on the queue); UnrecoverableError
 * skips the retries and parks the job in "failed".
 */
@Processor(MAIL_QUEUE, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  constructor(
    private readonly receipts: ReceiptJob,
    private readonly bans: BanAlertJob,
    private readonly reports: DailyReportJob,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(MailProcessor.name);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const attempts = job?.opts.attempts ?? 1;
    // An UnrecoverableError skips the remaining attempts: the job is parked at once.
    const final =
      job !== undefined &&
      (job.attemptsMade >= attempts || error.name === 'UnrecoverableError');
    this.logger[final ? 'error' : 'warn'](
      {
        jobId: job?.id,
        name: job?.name,
        attemptsMade: job?.attemptsMade,
        err: error,
      },
      final ? 'job failed for good' : 'job failed, will be retried',
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.warn({ err: error }, 'worker connection error');
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JobName.dealReceipt:
        return this.receipts.run((job.data as DealReceiptData).dealId);
      case JobName.ipBanAlert:
        return this.bans.run((job.data as IpBanAlertData).banId);
      case JobName.dailyReport:
        return this.reports.run((job.data as DailyReportData).periodEnd);
      default:
        throw new UnrecoverableError(`unknown job ${job.name}`);
    }
  }
}
