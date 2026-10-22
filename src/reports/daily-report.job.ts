import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENV, type Env } from '../config/env.js';
import { Mailer } from '../mail/mailer.js';
import { reportMail } from '../mail/templates.js';
import { buildDailyReport } from './daily-report.js';

/**
 * Sends the daily numbers to the administrator. No marker, no outbox: a report sent twice
 * or not at all costs nothing, unlike a receipt.
 */
@Injectable()
export class DailyReportJob {
  constructor(
    private readonly dataSource: DataSource,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(periodEnd: string) {
    const report = await buildDailyReport(
      this.dataSource.manager,
      new Date(periodEnd),
    );
    await this.mailer.send({ to: this.env.ADMIN_EMAIL, ...reportMail(report) });
  }
}
