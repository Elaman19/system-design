import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { UnrecoverableError, type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { Counter, Registry } from 'prom-client';
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
  private readonly tracer = trace.getTracer('marketplace.worker');
  readonly failures: Counter<'name' | 'final'>;

  constructor(
    private readonly receipts: ReceiptJob,
    private readonly bans: BanAlertJob,
    private readonly reports: DailyReportJob,
    private readonly logger: PinoLogger,
    registry: Registry,
  ) {
    super();
    this.logger.setContext(MailProcessor.name);
    this.failures = new Counter({
      name: 'mail_job_failures_total',
      help: 'Failed runs of mail jobs; final="true": the job gave up and stays in "failed"',
      labelNames: ['name', 'final'],
      registers: [registry],
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    const attempts = job?.opts.attempts ?? 1;
    // An UnrecoverableError skips the remaining attempts: the job is parked at once.
    const final =
      job !== undefined &&
      (job.attemptsMade >= attempts || error.name === 'UnrecoverableError');
    this.failures.inc({ name: job?.name ?? 'unknown', final: String(final) });
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

  /**
   * One span per job run, so the SQL and SMTP of a receipt are one trace. It is not linked
   * to the deal's request: that needs the trace context carried in the outbox row.
   */
  process(job: Job): Promise<unknown> {
    return this.tracer.startActiveSpan(
      `mail ${job.name}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'bullmq',
          'messaging.message.id': job.id,
          'messaging.bullmq.attempt': job.attemptsMade + 1,
        },
      },
      async (span) => {
        try {
          return await this.dispatch(job);
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private dispatch(job: Job): Promise<unknown> {
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
