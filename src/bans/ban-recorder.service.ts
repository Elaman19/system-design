import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Consumer } from '@platformatic/kafka';
import type { Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { ProcessFailure } from '../common/process-failure.js';
import { Stoppable, retryUntilDone } from '../common/retry.js';
import { withTimeout } from '../common/with-timeout.js';
import { ENV, type Env } from '../config/env.js';
import { rows } from '../db/sql.js';
import { createConsumer } from '../kafka/clients.js';
import { readStream } from '../kafka/read-stream.js';
import { ipBanAlertJobId, JobName, MAIL_QUEUE } from '../queue/jobs.js';

export const BAN_RECORDER_GROUP = 'ip-ban-recorder';

const banEventSchema = z
  .object({
    ip: z.union([z.ipv4(), z.ipv6()]),
    bannedFrom: z.iso.datetime(),
    bannedUntil: z.iso.datetime(),
    views: z.number().int().positive(),
  })
  .refine((ban) => Date.parse(ban.bannedUntil) > Date.parse(ban.bannedFrom), {
    message: 'bannedUntil must be after bannedFrom',
  });

/**
 * Postgres classes 22 (data exception) and 23 (integrity violation): the message itself is
 * wrong, so retrying it fails the same way for ever and would block the partition.
 */
const isBadMessage = (error: unknown) => {
  const code = (error as { driverError?: { code?: unknown } }).driverError
    ?.code;
  return typeof code === 'string' && /^2[23]/.test(code);
};

/**
 * Turns the fact "ip-bans: this IP is banned" into state and a task: the ban row in
 * Postgres (what the API checks) and a BullMQ job that mails the administrator.
 *
 * Kafka delivers at-least-once, so the same ban can arrive twice. The exclusion constraint
 * `ip_bans_no_overlap` makes the second insert a no-op, and the job id `ip-ban-<id>` makes
 * the second `add` a no-op, so the replay changes nothing and still repairs a crash between
 * the insert and the `add`. A message that cannot be parsed, or that the database refuses
 * as a value (a Postgres data exception or constraint violation), is logged and skipped:
 * retrying it cannot help and would stop the partition. A transient failure (database
 * down, Redis down) is retried in place and the offset does not move.
 */
@Injectable()
export class BanRecorderService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly consumer: Consumer<string, string, string, string>;
  private readonly control = new Stoppable();
  private reading?: Promise<void>;

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
    private readonly failure: ProcessFailure,
  ) {
    this.logger.setContext(BanRecorderService.name);
    this.consumer = createConsumer(env, BAN_RECORDER_GROUP);
  }

  async onApplicationBootstrap() {
    const stream = await this.consumer.consume({
      topics: [this.env.KAFKA_TOPIC_IP_BANS],
      autocommit: false,
      mode: 'committed',
      fallbackMode: 'earliest',
    });
    this.reading = readStream(
      stream,
      async (message) => {
        const done = await retryUntilDone(
          () => this.record(message.value),
          this.control,
          (error, attempt) =>
            this.logger.warn(
              { err: error, attempt },
              'recording ban failed, retrying',
            ),
        );
        // Stopped mid-retry: leave the offset, the message comes again.
        if (done) await message.commit();
      },
      this.control,
      this.failure,
      'ban recorder read loop failed',
    );
  }

  async onApplicationShutdown() {
    this.control.stop();
    await this.consumer.close(true);
    await this.reading;
  }

  /** Stores one ban event and queues the alert; the same event twice changes nothing. */
  async record(value: string) {
    let json: unknown;
    try {
      json = JSON.parse(value);
    } catch {
      json = undefined;
    }
    const parsed = banEventSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.error({ value }, 'invalid ban event skipped');
      return;
    }
    const { ip, bannedFrom, bannedUntil, views } = parsed.data;
    try {
      await this.store(ip, bannedFrom, bannedUntil, views);
    } catch (error) {
      if (!isBadMessage(error)) throw error;
      this.logger.error(
        { err: error, value },
        'ban event refused by the database, skipped',
      );
    }
  }

  private async store(
    ip: string,
    bannedFrom: string,
    bannedUntil: string,
    views: number,
  ) {
    const em = this.dataSource.manager;
    const [inserted] = await rows<{ id: string }>(
      em,
      `INSERT INTO ip_bans (ip, banned_from, banned_until, views)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT ip_bans_no_overlap DO NOTHING
       RETURNING id`,
      [ip, bannedFrom, bannedUntil, views],
    );
    // Conflict: the same ban (a replay) or an overlapping earlier one is already stored.
    const [existing] = inserted
      ? [inserted]
      : await rows<{ id: string }>(
          em,
          `SELECT id FROM ip_bans
            WHERE ip = $1 AND tstzrange(banned_from, banned_until) && tstzrange($2, $3)
            ORDER BY id LIMIT 1`,
          [ip, bannedFrom, bannedUntil],
        );
    await withTimeout(
      this.queue.add(
        JobName.ipBanAlert,
        { banId: existing.id },
        { jobId: ipBanAlertJobId(existing.id) },
      ),
      this.env.QUEUE_ADD_TIMEOUT_MS,
      'Redis',
    );
  }
}
