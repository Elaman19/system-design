import { Module } from '@nestjs/common';
import { BanAlertJob } from '../bans/ban-alert.job.js';
import { MailModule } from '../mail/mail.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { ReceiptJob } from '../receipts/receipt.job.js';
import { DailyReportJob } from '../reports/daily-report.job.js';
import { MailProcessor } from './mail.processor.js';

/** The background worker process: consumes the `mail` queue. */
@Module({
  imports: [QueueModule, MailModule],
  providers: [MailProcessor, ReceiptJob, BanAlertJob, DailyReportJob],
})
export class WorkerModule {}
