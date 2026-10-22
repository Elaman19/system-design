import { SchedulerRegistry } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import {
  DAILY_REPORT_JOB,
  DailyReportScheduler,
} from '../../src/scheduler/daily-report.scheduler.js';
import { SchedulerModule } from '../../src/scheduler/scheduler.module.js';
import { buildDailyReport } from '../../src/reports/daily-report.js';
import { WorkerModule } from '../../src/worker/worker.module.js';
import {
  createHarness,
  createScratchHarness,
  seedCompany,
  seedLot,
} from '../marketplace/helpers.js';
import {
  eventually,
  mailQueue,
  type Process,
  RecordingMailer,
  startProcess,
  uniquePrefix,
} from '../background/helpers.js';

describe('daily report', () => {
  it('counts what the administrator asked for, over the 24 hours before the report', async () => {
    const base = await createHarness();
    const scratch = await createScratchHarness(
      base,
      'app_test_report',
      async () => undefined,
    );
    try {
      const seller = await seedCompany(scratch);
      const buyer = await seedCompany(scratch, 10_000_000);
      const lotA = await seedLot(scratch, seller, {
        price: 150_000,
        stock: 10,
      });
      await seedLot(scratch, seller, { price: 100, stock: 1 });
      await seedLot(scratch, seller, {
        price: 100,
        stock: 1,
        published: false,
      });
      await scratch
        .http()
        .post('/deals')
        .send({ buyerId: buyer, lotId: lotA, quantity: 3 })
        .expect(201);
      await scratch
        .http()
        .patch(`/lots/${lotA}/publication`)
        .send({ published: false })
        .expect(200);

      const now = new Date(Date.now() + 60_000);
      const today = await buildDailyReport(scratch.db.manager, now);
      // Two days later the same activity is outside the 24 hours; "now" does not depend on time.
      const later = await buildDailyReport(
        scratch.db.manager,
        new Date(now.getTime() + 2 * 24 * 3_600_000),
      );

      expect(today).toEqual({
        periodEnd: now,
        publishedNow: 1, // lot A was hidden again, the 100-cent lot stays
        publishedLastDay: 2, // both lots were published today, even though one is hidden now
        dealsLastDay: 1,
        dealsAmountLastDay: '450000', // 3 x 1500.00 in cents
      });
      expect(later).toMatchObject({
        publishedNow: 1,
        publishedLastDay: 0,
        dealsLastDay: 0,
        dealsAmountLastDay: '0',
      });
    } finally {
      await scratch.close();
      await base.close();
    }
  });
});

describe('scheduler', () => {
  const processes: Process[] = [];
  let queue: Queue;
  let prefix: string;
  beforeEach(() => {
    prefix = uniquePrefix();
    queue = mailQueue(prefix);
  });
  afterEach(async () => {
    await Promise.all(processes.splice(0).map((p) => p.close()));
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('on schedule puts a daily-report job into the queue, the worker mails the numbers to the administrator', async () => {
    const mailer = new RecordingMailer();
    const env = {
      BULLMQ_PREFIX: prefix,
      DAILY_REPORT_CRON: '* * * * * *', // every second
      ADMIN_EMAIL: 'admin@report.example',
    };
    processes.push(await startProcess([WorkerModule], env, mailer));
    processes.push(await startProcess([SchedulerModule], env, mailer));

    await eventually(
      () => mailer.to('admin@report.example').length > 0,
      'the report mail',
    );

    const [mail] = mailer.to('admin@report.example');
    expect(mail.subject).toMatch(/^Отчёт площадки за сутки до /);
    expect(mail.text).toMatch(/Опубликовано лотов сейчас: \d+/);
    expect(mail.text).toMatch(/Сумма сделок за сутки: \d+\.\d\d/);
  });

  it('the timer is registered under one name, in this process only', async () => {
    const p = await startProcess([SchedulerModule], {
      BULLMQ_PREFIX: prefix,
      DAILY_REPORT_CRON: '0 9 * * *',
      DAILY_REPORT_TZ: 'Asia/Bishkek',
    });
    processes.push(p);

    const job = p.get(SchedulerRegistry).getCronJob(DAILY_REPORT_JOB);

    expect(job.isActive).toBe(true);
    expect(job.cronTime.source).toBe('0 9 * * *');
    expect(job.cronTime.timeZone).toBe('Asia/Bishkek');
  });

  it('Redis does not answer: the failure is logged, the timer keeps running', async () => {
    const p = await startProcess([SchedulerModule], {
      BULLMQ_PREFIX: prefix,
      REDIS_URL: 'redis://127.0.0.1:1',
      QUEUE_ADD_TIMEOUT_MS: 200,
      DAILY_REPORT_CRON: '0 9 * * *',
    });
    processes.push(p);

    await expect(p.get(DailyReportScheduler).fire()).resolves.toBeUndefined();
    expect(p.get(SchedulerRegistry).getCronJob(DAILY_REPORT_JOB).isActive).toBe(
      true,
    );
  });
});
