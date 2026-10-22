import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { JobName } from '../../src/queue/jobs.js';
import { ReceiptJob } from '../../src/receipts/receipt.job.js';
import { WorkerModule } from '../../src/worker/worker.module.js';
import {
  createHarness,
  type Harness,
  seedCompany,
  seedLot,
} from '../marketplace/helpers.js';
import {
  eventually,
  mailQueue,
  type Process,
  startProcess,
  uniquePrefix,
} from './helpers.js';

describe('the receipt of a deal', () => {
  let h: Harness;
  let prefix: string;
  let queue: Queue;
  const processes: Process[] = [];

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(() => {
    prefix = uniquePrefix();
    queue = mailQueue(prefix);
  });
  afterEach(async () => {
    await Promise.all(processes.splice(0).map((p) => p.close()));
    await queue.obliterate({ force: true });
    await queue.close();
  });
  afterAll(() => h.close());

  const worker = async (env: Partial<Process['env']> = {}) => {
    const p = await startProcess([WorkerModule], {
      BULLMQ_PREFIX: prefix,
      JOB_BACKOFF_MS: 10,
      ...env,
    });
    processes.push(p);
    return p;
  };

  const purchase = async () => {
    const seller = await seedCompany(h);
    const buyerEmail = `${randomUUID()}@buyer.example`;
    const created = await h
      .http()
      .post('/companies')
      .send({ name: 'Покупатель', email: buyerEmail })
      .expect(201);
    const buyer: string = created.body.id;
    await h
      .http()
      .post(`/companies/${buyer}/wallet/deposits`)
      .send({ bankNotificationId: randomUUID(), amount: 1_000_000 })
      .expect(201);
    const lot = await seedLot(h, seller, { price: 123_456, stock: 5 });
    const res = await h
      .http()
      .post('/deals')
      .send({ buyerId: buyer, lotId: lot, quantity: 2 })
      .expect(201);
    return { dealId: res.body.id as string, buyerEmail };
  };

  const receiptRows = async (dealId: string) =>
    (
      await h.db.query(
        `SELECT count(*)::int AS n FROM deal_receipts WHERE deal_id = $1`,
        [dealId],
      )
    )[0].n as number;

  it('one job run three times: one mail', async () => {
    const { dealId, buyerEmail } = await purchase();
    const p = await worker();
    const job = p.get(ReceiptJob);

    const results = [
      await job.run(dealId),
      await job.run(dealId),
      await job.run(dealId),
    ];

    expect(results).toEqual(['sent', 'duplicate', 'duplicate']);
    expect(p.mailer.to(buyerEmail)).toHaveLength(1);
    expect(await receiptRows(dealId)).toBe(1);
  });

  it('the mail says what was bought and what it cost', async () => {
    const { dealId, buyerEmail } = await purchase();
    const p = await worker();

    await p.get(ReceiptJob).run(dealId);

    const [mail] = p.mailer.to(buyerEmail);
    expect(mail.subject).toBe(`Чек по сделке ${dealId}`);
    expect(mail.messageId).toBe(`<receipt-${dealId}@marketplace.local>`);
    expect(mail.text).toContain('Количество: 2');
    expect(mail.text).toContain('Цена за штуку: 1234.56');
    expect(mail.text).toContain('Итого списано: 2469.12');
  });

  it('three runs at the same moment: still one mail (the primary key is the lock)', async () => {
    const { dealId, buyerEmail } = await purchase();
    const p = await worker();
    p.mailer.delayMs = 150; // long enough for the others to queue on the unique index

    const results = await Promise.all([
      p.get(ReceiptJob).run(dealId),
      p.get(ReceiptJob).run(dealId),
      p.get(ReceiptJob).run(dealId),
    ]);

    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(p.mailer.to(buyerEmail)).toHaveLength(1);
    expect(await receiptRows(dealId)).toBe(1);
  });

  it('three identical jobs in the queue: one mail', async () => {
    const { dealId, buyerEmail } = await purchase();
    const p = await worker();
    // Distinct job ids on purpose: the queue's own deduplication is bypassed, only the
    // idempotent handler stands between the jobs and three mails.
    for (let i = 0; i < 3; i++) {
      await queue.add(JobName.dealReceipt, { dealId }, { jobId: `copy-${i}` });
    }

    await eventually(
      async () => (await queue.getJobCounts('completed')).completed === 3,
      'all three jobs to complete',
    );

    expect(p.mailer.to(buyerEmail)).toHaveLength(1);
  });

  it('the mail server fails: nothing is recorded as sent, the next run sends', async () => {
    const { dealId, buyerEmail } = await purchase();
    const p = await worker();
    p.mailer.failures = 1;

    await expect(p.get(ReceiptJob).run(dealId)).rejects.toThrow('SMTP is down');
    expect(await receiptRows(dealId)).toBe(0);

    expect(await p.get(ReceiptJob).run(dealId)).toBe('sent');
    expect(p.mailer.to(buyerEmail)).toHaveLength(1);
  });

  it('retries are limited, the failed job is kept and can be run again', async () => {
    const { dealId, buyerEmail } = await purchase();
    const p = await worker({ JOB_ATTEMPTS: 3 });
    p.mailer.failAlways = true;
    await queue.add(
      JobName.dealReceipt,
      { dealId },
      {
        jobId: `limited-${dealId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10 },
      },
    );

    const failed = await eventually(
      async () => (await queue.getFailed())[0],
      'the job to give up',
    );
    expect(failed.attemptsMade).toBe(3);
    expect(p.mailer.sent).toHaveLength(0);

    p.mailer.failAlways = false;
    await failed.retry();
    await eventually(
      async () => (await queue.getJobCounts('completed')).completed === 1,
      'the retried job to complete',
    );
    expect(p.mailer.to(buyerEmail)).toHaveLength(1);
  });

  it('a job for a deal that does not exist fails at once, without retries', async () => {
    const p = await worker({ JOB_ATTEMPTS: 5 });
    await queue.add(
      JobName.dealReceipt,
      { dealId: randomUUID() },
      { attempts: 5, backoff: { type: 'exponential', delay: 10 } },
    );

    const failed = await eventually(
      async () => (await queue.getFailed())[0],
      'the job to fail',
    );
    expect(failed.attemptsMade).toBe(1);
    expect(failed.failedReason).toMatch(/not found/);
    expect(p.mailer.sent).toHaveLength(0);
  });

  it('an alert for a ban that does not exist fails at once', async () => {
    await worker();
    await queue.add(
      JobName.ipBanAlert,
      { banId: '999999999' },
      { attempts: 5 },
    );

    const failed = await eventually(
      async () => (await queue.getFailed())[0],
      'the job to fail',
    );
    expect(failed.attemptsMade).toBe(1);
    expect(failed.failedReason).toBe('ban 999999999 not found');
  });

  it('an unknown job name fails at once', async () => {
    await worker();
    await queue.add('nope', {}, { attempts: 5 });

    const failed = await eventually(
      async () => (await queue.getFailed())[0],
      'the job to fail',
    );
    expect(failed.failedReason).toBe('unknown job nope');
  });
});
