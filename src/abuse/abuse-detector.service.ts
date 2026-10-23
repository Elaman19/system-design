import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Consumer, Producer } from '@platformatic/kafka';
import { PinoLogger } from 'nestjs-pino';
import { viewEventSchema } from '../clickstream/view-event.js';
import { ProcessFailure } from '../common/process-failure.js';
import { Stoppable, retryUntilDone } from '../common/retry.js';
import { ENV, type Env } from '../config/env.js';
import { createConsumer, createProducer } from '../kafka/clients.js';
import { readStream } from '../kafka/read-stream.js';
import { SlidingWindow } from './sliding-window.js';
import { type Position, WindowTail } from './window-tail.js';

export const ABUSE_DETECTOR_GROUP = 'abuse-detector';

export interface BanEvent {
  ip: string;
  bannedFrom: string;
  bannedUntil: string;
  views: number;
}

const HOUSEKEEPING_EVERY_MS = 1000;

/**
 * Reads `lot-views` in group `abuse-detector`, counts views per IP in a sliding window and
 * publishes a ban to `ip-bans` when an IP exceeds ABUSE_MAX_VIEWS.
 *
 * The count lives in memory. That is correct only because the topic is keyed by IP: all
 * views of one IP sit in one partition and reach one copy of the detector. To survive a
 * restart without storing counters anywhere, the committed offset is not "after the last
 * handled view" but the oldest view still inside the window (see WindowTail): a restart
 * re-reads one window of views and rebuilds the counters. The price is that the group
 * always shows a lag of about one window, and that bans of the replayed views are
 * published again (see below).
 *
 * The ban event is a pure function of the event that crossed the limit (its time and the
 * configured durations), so a replay after a restart produces the identical message and the
 * consumer of `ip-bans` can safely see it twice.
 */
@Injectable()
export class AbuseDetectorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly consumer: Consumer<string, string, string, string>;
  private readonly producer: Producer<string, string, string, string>;
  private readonly window: SlidingWindow;
  private readonly tail: WindowTail;
  private readonly bannedUntil = new Map<string, number>();
  private readonly processed = new Map<number, Position>();
  private readonly control = new Stoppable();
  private timer?: NodeJS.Timeout;
  private reading?: Promise<void>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
    private readonly failure: ProcessFailure,
  ) {
    this.logger.setContext(AbuseDetectorService.name);
    this.consumer = createConsumer(env, ABUSE_DETECTOR_GROUP);
    this.producer = createProducer(env);
    this.window = new SlidingWindow(env.ABUSE_WINDOW_MS);
    this.tail = new WindowTail(env.ABUSE_WINDOW_MS);
  }

  async onApplicationBootstrap() {
    const stream = await this.consumer.consume({
      topics: [this.env.KAFKA_TOPIC_LOT_VIEWS],
      autocommit: false,
      mode: 'committed',
      // A new group reads the retained history. Bans derived from it are skipped when
      // already over (see handle), so replaying a week costs time, not wrong bans.
      fallbackMode: 'earliest',
    });
    this.timer = setInterval(
      () => void this.housekeeping(),
      HOUSEKEEPING_EVERY_MS,
    ).unref();
    this.reading = readStream(
      stream,
      (message) =>
        this.handle(message.value, {
          partition: message.partition,
          offset: message.offset,
          leaderEpoch: message.leaderEpoch,
        }),
      this.control,
      this.failure,
      'detector read loop failed',
    );
  }

  async onApplicationShutdown() {
    this.control.stop();
    clearInterval(this.timer);
    await this.consumer.close(true);
    await this.reading;
    await this.commitProcessed();
    await this.producer.close();
  }

  /** Counts one view; bans the IP if it just crossed the limit. */
  async handle(
    value: string,
    at: { partition: number; offset: bigint; leaderEpoch: number },
  ) {
    const parsed = viewEventSchema.safeParse(safeJson(value));
    if (!parsed.success) {
      this.logger.error(
        { offset: String(at.offset) },
        'unparseable view event skipped',
      );
    } else {
      const viewedAt = Date.parse(parsed.data.viewedAt);
      this.tail.add(at.partition, viewedAt, at);
      await this.count(parsed.data.ip, at.partition, viewedAt);
    }
    this.processed.set(at.partition, at);
  }

  private async count(ip: string, partition: number, viewedAt: number) {
    const views = this.window.add(ip, partition, viewedAt);
    if (views <= this.env.ABUSE_MAX_VIEWS) return;
    // Already banned by an earlier event of this IP.
    if (viewedAt < (this.bannedUntil.get(ip) ?? 0)) return;
    const until = viewedAt + this.env.ABUSE_BAN_MS;
    this.bannedUntil.set(ip, until);
    // Catching up on an old backlog: the ban would be over by now, publishing it is noise.
    if (until <= Date.now()) return;
    const ban: BanEvent = {
      ip,
      bannedFrom: new Date(viewedAt).toISOString(),
      bannedUntil: new Date(until).toISOString(),
      views,
    };
    await retryUntilDone(
      () => this.publish(ban),
      this.control,
      (error, attempt) =>
        this.logger.warn(
          { err: error, ip, attempt },
          'publishing ban failed, retrying',
        ),
    );
    this.logger.info({ ip, views }, 'ip banned');
  }

  private async publish(ban: BanEvent) {
    await this.producer.send({
      // acks=all: a ban is a decision, unlike a view it must not vanish with a leader.
      acks: -1,
      messages: [
        {
          topic: this.env.KAFKA_TOPIC_IP_BANS,
          key: ban.ip,
          value: JSON.stringify(ban),
        },
      ],
    });
  }

  /** Once a second: commit what was handled, forget IPs that went quiet and bans that are over. */
  async housekeeping() {
    await this.commitProcessed();
    this.window.prune();
    const now = Date.now();
    for (const [ip, until] of this.bannedUntil) {
      if (until <= now) this.bannedUntil.delete(ip);
    }
  }

  /**
   * Commits how far the partitions have been handled, held back to the start of the window:
   * the oldest view still counted, or the next one to read when the window is empty (only
   * unparseable views were handled). On failure the next tick commits again.
   */
  async commitProcessed() {
    const offsets = [...this.processed].map(([partition, p]) => {
      const from = this.tail.start(partition) ?? {
        offset: p.offset + 1n,
        leaderEpoch: p.leaderEpoch,
      };
      return {
        topic: this.env.KAFKA_TOPIC_LOT_VIEWS,
        partition,
        offset: from.offset,
        leaderEpoch: from.leaderEpoch,
      };
    });
    this.processed.clear();
    if (offsets.length === 0) return;
    try {
      await this.consumer.commit({ offsets });
    } catch (error) {
      this.logger.warn(
        { err: error },
        'offset commit failed, views will be re-read',
      );
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
