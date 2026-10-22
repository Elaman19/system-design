import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { OutboxModule } from '../../src/outbox/outbox.module.js';
import { WorkerModule } from '../../src/worker/worker.module.js';
import { OutboxRelayService } from '../../src/outbox/outbox-relay.service.js';
import { dealReceiptJobId } from '../../src/queue/jobs.js';
import {
  createHarness,
  createScratchHarness,
  type Harness,
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
} from './helpers.js';

// The relay's own loop wakes up once at start and then sleeps this long, so each test
// drives `relayOnce` itself and nothing runs behind its back.
const IDLE = { OUTBOX_POLL_MS: 600_000, OUTBOX_BATCH: 1000 };

// Relays take every unpublished row of the database they run on. Tests of other files
// create such rows all the time, so these tests run on a database of their own where
// nothing but this file writes.
const DB = 'app_test_outbox';

describe('transactional outbox', () => {
  let base: Harness;
  let h: Harness;
  let prefix: string;
  let queue: Queue;
  const processes: Process[] = [];

  beforeAll(async () => {
    base = await createHarness();
    h = await createScratchHarness(base, DB, async () => undefined);
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
  afterAll(async () => {
    await h.close();
    await base.close();
  });

  const relay = async (env: Partial<Process['env']> = {}) => {
    const p = await startProcess([OutboxModule], {
      DB_NAME: DB,
      BULLMQ_PREFIX: prefix,
      ...IDLE,
      ...env,
    });
    processes.push(p);
    return p;
  };

  const purchase = async () => {
    const seller = await seedCompany(h);
    const buyer = await seedCompany(h, 1_000_000);
    const lot = await seedLot(h, seller, { price: 100_000, stock: 5 });
    const res = await h
      .http()
      .post('/deals')
      .send({ buyerId: buyer, lotId: lot, quantity: 1 })
      .expect(201);
    lastBuyer = buyer;
    return res.body.id as string;
  };
  let lastBuyer = '';

  const published = async (dealId: string) =>
    (
      await h.db.query(
        `SELECT published_at IS NOT NULL AS done FROM outbox WHERE aggregate_id = $1`,
        [dealId],
      )
    )[0].done as boolean;

  it('the purchase and its outbox row commit together: no row without the deal, no deal without the row', async () => {
    // A database of its own where inserting into outbox always fails.
    const scratch = await createScratchHarness(
      base,
      'app_test_outbox_trigger',
      async (db) => {
        await db.query(`
        CREATE FUNCTION outbox_refuses() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'outbox unavailable' USING ERRCODE = 'check_violation'; END $$`);
        await db.query(`
        CREATE TRIGGER outbox_refuses BEFORE INSERT ON outbox
          FOR EACH ROW EXECUTE FUNCTION outbox_refuses()`);
      },
    );
    try {
      const seller = await seedCompany(scratch);
      const buyer = await seedCompany(scratch, 1_000_000);
      const lot = await seedLot(scratch, seller, { price: 100_000, stock: 5 });

      await scratch
        .http()
        .post('/deals')
        .send({ buyerId: buyer, lotId: lot, quantity: 1 })
        .expect(409);

      const [{ deals }] = await scratch.db.query(
        `SELECT count(*)::int AS deals FROM deals`,
      );
      const [{ stock }] = await scratch.db.query(
        `SELECT stock FROM lots WHERE id = $1`,
        [lot],
      );
      expect({ deals, stock }).toEqual({ deals: 0, stock: 5 });
    } finally {
      await scratch.close();
    }
  });

  it('the relay puts a job into the queue under the deal id and marks the row', async () => {
    const dealId = await purchase();
    const p = await relay();

    await p.get(OutboxRelayService).relayOnce();

    const job = await queue.getJob(dealReceiptJobId(dealId));
    expect(job?.name).toBe('deal-receipt');
    expect(job?.data).toEqual({ dealId });
    expect(await published(dealId)).toBe(true);
  });

  it('Redis is down: the pass fails, the row stays unpublished; Redis is back: the next pass publishes it', async () => {
    const dealId = await purchase();
    const down = await relay({
      REDIS_URL: 'redis://127.0.0.1:1',
      QUEUE_ADD_TIMEOUT_MS: 300,
    });

    await expect(down.get(OutboxRelayService).relayOnce()).rejects.toThrow(
      /Redis did not answer/,
    );
    expect(await published(dealId)).toBe(false);

    const up = await relay();
    await up.get(OutboxRelayService).relayOnce();
    expect(await published(dealId)).toBe(true);
    expect(await queue.getJob(dealReceiptJobId(dealId))).toBeDefined();
  });

  it('the relay dies after adding the job and before marking the row: the second pass does not make a second job', async () => {
    const dealId = await purchase();
    const p = await relay();
    // Other rows may come first (tests run in parallel on one database): crash right
    // after the job of THIS deal has been added.
    p.hooks.handler = async (point) => {
      if (
        point === 'outbox:afterEnqueue' &&
        (await queue.getJob(dealReceiptJobId(dealId)))
      ) {
        throw new Error('relay crashed');
      }
    };

    await expect(p.get(OutboxRelayService).relayOnce()).rejects.toThrow(
      'relay crashed',
    );
    expect(await published(dealId)).toBe(false);
    expect(await queue.getJob(dealReceiptJobId(dealId))).toBeDefined();

    p.hooks.handler = undefined;
    await p.get(OutboxRelayService).relayOnce();

    expect(await published(dealId)).toBe(true);
    const jobs = await queue.getJobs([
      'waiting',
      'delayed',
      'active',
      'completed',
      'failed',
    ]);
    expect(jobs.filter((j) => j.data.dealId === dealId)).toHaveLength(1);
  });

  it('two relays at once take different rows: FOR UPDATE SKIP LOCKED does not make one wait for the other', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) {
      await h.db.query(
        `INSERT INTO outbox (kind, aggregate_id) VALUES ('deal.receipt', $1)`,
        [id],
      );
    }
    const slow = await relay({ OUTBOX_BATCH: 2 });
    const fast = await relay();
    // The slow relay locks its rows and stays inside its transaction until released.
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const slowHasRows = new Promise<void>((resolve) => (locked = resolve));
    slow.hooks.handler = async () => {
      locked();
      await hold;
    };
    const slowPass = slow.get(OutboxRelayService).relayOnce();
    await slowHasRows;

    // Would hang until `release` if it queued behind the locked rows.
    await fast.get(OutboxRelayService).relayOnce();
    release();
    await slowPass;

    for (const id of ids) {
      expect(await published(id)).toBe(true);
      expect(await queue.getJob(dealReceiptJobId(id))).toBeDefined();
    }
  });

  it('the loop publishes on its own and keeps going after a failed pass', async () => {
    const p = await relay({ OUTBOX_POLL_MS: 20 });
    let failures = 1;
    p.hooks.handler = (point) => {
      if (point === 'outbox:afterEnqueue' && failures-- > 0)
        throw new Error('transient');
    };
    const dealId = await purchase();

    await eventually(
      () => published(dealId),
      'the loop to publish the row after a failure',
    );
  });

  it('a full batch is followed by the next pass at once, a short one by a pause', async () => {
    const p = await relay({ OUTBOX_POLL_MS: 100, OUTBOX_BATCH: 2 });
    const service = p.get(OutboxRelayService);
    const passes = [2, 2, 1];
    vi.spyOn(service, 'relayOnce').mockImplementation(
      async () => passes.shift() ?? 0,
    );
    const sleep = vi.spyOn(service['control'], 'sleep');
    // The loop sleeps first: let that sleep end, then the mocked passes run.
    await eventually(
      () => passes.length === 0 && sleep.mock.calls.length >= 4,
      'three passes',
    );

    // before pass 1: poll; after the full batches: 0; after the short one: poll again.
    expect(sleep.mock.calls.slice(0, 4).map(([ms]) => ms)).toEqual([
      0, 0, 100, 100,
    ]);
  });

  it('end to end: purchase -> outbox -> relay -> BullMQ -> worker -> one receipt mail', async () => {
    const mailer = new RecordingMailer();
    const env = { DB_NAME: DB, BULLMQ_PREFIX: prefix, OUTBOX_POLL_MS: 20 };
    processes.push(
      await startProcess(
        [WorkerModule],
        { ...env, JOB_BACKOFF_MS: 10 },
        mailer,
      ),
    );
    processes.push(await startProcess([OutboxModule], env, mailer));

    const dealId = await purchase();
    const [{ email }] = await h.db.query(
      `SELECT email FROM companies WHERE id = $1`,
      [lastBuyer],
    );

    await eventually(
      () => mailer.to(email).length === 1,
      'the receipt to arrive',
    );
    await eventually(
      async () =>
        (
          await h.db.query(`SELECT 1 FROM deal_receipts WHERE deal_id = $1`, [
            dealId,
          ])
        ).length === 1,
      'the receipt to be recorded',
    );
    expect(await published(dealId)).toBe(true);
  });

  it('stops the loop on shutdown', async () => {
    const p = await relay({ OUTBOX_POLL_MS: 20 });
    await p.close();
    processes.splice(processes.indexOf(p), 1);
  });
});
