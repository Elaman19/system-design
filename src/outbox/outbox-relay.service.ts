import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { Stoppable } from '../common/retry.js';
import { TxHooks } from '../common/tx-hooks/tx-hooks.js';
import { withTimeout } from '../common/with-timeout.js';
import { ENV, type Env } from '../config/env.js';
import { rows } from '../db/sql.js';
import { dealReceiptJobId, JobName, MAIL_QUEUE } from '../queue/jobs.js';

interface OutboxRow {
  id: string;
  aggregate_id: string;
}

const MAX_PAUSE_MS = 30_000;

/**
 * Moves rows of `outbox` into the BullMQ queue.
 *
 * One pass is one database transaction: lock the unpublished rows, add a job for each,
 * mark the row, commit. The row lock (`FOR UPDATE SKIP LOCKED`) makes several relays safe:
 * each takes different rows. If Redis is down the pass fails and rolls back, the rows stay
 * unpublished and are picked up again. If the relay dies after adding a job but before the
 * commit, the next pass adds the same job again; the job id is the deal id, so the queue
 * ignores the second add. Delivery is therefore at-least-once with a deduplicating queue
 * and an idempotent worker behind it.
 */
@Injectable()
export class OutboxRelayService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly control = new Stoppable();
  private loop?: Promise<void>;

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue,
    private readonly hooks: TxHooks,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.logger.setContext(OutboxRelayService.name);
  }

  onApplicationBootstrap() {
    this.loop = this.run();
  }

  async onApplicationShutdown() {
    this.control.stop();
    await this.loop;
  }

  /** One pass; resolves to the number of rows handed to the queue. */
  relayOnce(): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      const pending = await rows<OutboxRow>(
        em,
        `SELECT id, aggregate_id FROM outbox
          WHERE published_at IS NULL
          ORDER BY id LIMIT $1
            FOR UPDATE SKIP LOCKED`,
        [this.env.OUTBOX_BATCH],
      );
      for (const row of pending) {
        await withTimeout(
          this.queue.add(
            JobName.dealReceipt,
            { dealId: row.aggregate_id },
            { jobId: dealReceiptJobId(row.aggregate_id) },
          ),
          this.env.QUEUE_ADD_TIMEOUT_MS,
          'Redis',
        );
        await this.hooks.at('outbox:afterEnqueue', em);
        await rows(
          em,
          `UPDATE outbox SET published_at = clock_timestamp() WHERE id = $1`,
          [row.id],
        );
      }
      return pending.length;
    });
  }

  private async run() {
    let failures = 0;
    // Wait first: at start the API and Redis may still be coming up, and nothing is lost
    // by looking a poll interval later (the rows are durable).
    let pause = this.env.OUTBOX_POLL_MS;
    while (!this.control.isStopped) {
      await this.control.sleep(pause);
      try {
        const handled = await this.relayOnce();
        failures = 0;
        // A full batch means more is waiting: go again at once.
        pause = handled < this.env.OUTBOX_BATCH ? this.env.OUTBOX_POLL_MS : 0;
      } catch (error) {
        failures++;
        pause = Math.min(this.env.OUTBOX_POLL_MS * 2 ** failures, MAX_PAUSE_MS);
        this.logger.warn(
          { err: error },
          'outbox pass failed, rows stay unpublished and will be retried',
        );
      }
    }
  }
}
