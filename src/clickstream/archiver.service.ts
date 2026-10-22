import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Consumer } from '@platformatic/kafka';
import { PinoLogger } from 'nestjs-pino';
import { Stoppable, retryUntilDone } from '../common/retry.js';
import { ENV, type Env } from '../config/env.js';
import { createConsumer } from '../kafka/clients.js';
import { readStream } from '../kafka/read-stream.js';
import { S3 } from '../s3/s3.module.js';

export const ARCHIVER_GROUP = 'clickstream-archiver';

interface Batch {
  firstOffset: bigint;
  lastOffset: bigint;
  leaderEpoch: number;
  firstTimestamp: bigint;
  startedAt: number;
  /** The rebalance generation the batch was collected in; see `generation` below. */
  generation: number;
  lines: string[];
}

/** `clickstream/date=2026-10-20/1-4000.jsonl`: the day of the batch's first view. */
export function archiveKey(
  partition: number,
  batch: Pick<Batch, 'firstOffset' | 'firstTimestamp'>,
) {
  const date = new Date(Number(batch.firstTimestamp))
    .toISOString()
    .slice(0, 10);
  return `clickstream/date=${date}/${partition}-${batch.firstOffset}.jsonl`;
}

/**
 * Archives `lot-views` to S3 in group `clickstream-archiver`.
 *
 * Per partition it collects messages until ARCHIVE_BATCH_SIZE or ARCHIVE_FLUSH_MS, writes
 * them as one JSONL file, and only after the write commits the offset. A crash between the
 * two means Kafka hands the same messages again; the file name is `<partition>-<first
 * offset>`, so the replay overwrites the same object instead of adding a second one.
 *
 * Writes of one partition run strictly one after another, so commits never go backwards.
 * An S3 outage blocks the partition (retry with backoff, the offset stays put); the reading
 * loop then stops at the next full batch, which is the back-pressure.
 *
 * A rebalance may hand the partition to another copy, which starts from the committed
 * offset. Every rebalance therefore bumps `generation`, and a batch from an older generation
 * is neither written nor committed: its owner may be someone else by now. A PUT that is
 * already on the wire cannot be recalled; it carries the same name as the new owner's file
 * and the same messages, so the worst case is one file written twice.
 */
@Injectable()
export class ArchiverService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly consumer: Consumer<string, string, string, string>;
  private readonly open = new Map<number, Batch>();
  private readonly writes = new Map<number, Promise<void>>();
  private readonly control = new Stoppable();
  private generation = 0;
  private ticker?: NodeJS.Timeout;
  private reading?: Promise<void>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(S3) private readonly s3: S3Client,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ArchiverService.name);
    this.consumer = createConsumer(env, ARCHIVER_GROUP);
  }

  async onApplicationBootstrap() {
    await this.ensureBucket();
    // A rebalance reassigns partitions and Kafka re-delivers from the committed offsets:
    // what is still collected in memory would be delivered a second time.
    this.consumer.on('consumer:group:rebalance', () => {
      this.generation++;
      this.open.clear();
    });
    const stream = await this.consumer.consume({
      topics: [this.env.KAFKA_TOPIC_LOT_VIEWS],
      autocommit: false,
      mode: 'committed',
      fallbackMode: 'earliest',
    });
    this.ticker = setInterval(
      () => this.flushOverdue(),
      Math.min(1000, this.env.ARCHIVE_FLUSH_MS),
    ).unref();
    this.reading = readStream(
      stream,
      (message) =>
        this.add(message.partition, {
          offset: message.offset,
          timestamp: message.timestamp,
          leaderEpoch: message.leaderEpoch,
          line: message.value,
        }),
      this.control,
      this.logger,
      'archiver read loop failed',
    );
  }

  async onApplicationShutdown() {
    this.control.stop();
    clearInterval(this.ticker);
    // Writes that are on the wire finish and commit while the consumer is still open;
    // writes behind them see `control` stopped and give up, so their batches are re-read.
    await Promise.all(this.writes.values());
    await this.consumer.close(true);
    await this.reading;
  }

  private async ensureBucket() {
    const Bucket = this.env.S3_BUCKET;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket }));
    }
  }

  private async add(
    partition: number,
    m: { offset: bigint; timestamp: bigint; leaderEpoch: number; line: string },
  ) {
    let batch = this.open.get(partition);
    if (!batch) {
      batch = {
        firstOffset: m.offset,
        lastOffset: m.offset,
        leaderEpoch: m.leaderEpoch,
        firstTimestamp: m.timestamp,
        startedAt: Date.now(),
        generation: this.generation,
        lines: [],
      };
      this.open.set(partition, batch);
    }
    batch.lines.push(m.line);
    batch.lastOffset = m.offset;
    batch.leaderEpoch = m.leaderEpoch;
    if (batch.lines.length >= this.env.ARCHIVE_BATCH_SIZE) {
      this.open.delete(partition);
      // Awaited: while the write is stuck we stop reading.
      await this.enqueueWrite(partition, batch);
    }
  }

  private flushOverdue() {
    const now = Date.now();
    for (const [partition, batch] of this.open) {
      if (now - batch.startedAt >= this.env.ARCHIVE_FLUSH_MS) {
        this.open.delete(partition);
        void this.enqueueWrite(partition, batch);
      }
    }
  }

  /** Queues the write of a detached batch behind the earlier writes of its partition. */
  private enqueueWrite(partition: number, batch: Batch): Promise<void> {
    const previous = this.writes.get(partition) ?? Promise.resolve();
    const done = previous.then(() => this.write(partition, batch));
    this.writes.set(partition, done);
    return done;
  }

  private async write(partition: number, batch: Batch) {
    // Collected before a rebalance: the partition is not ours to write any more.
    if (batch.generation !== this.generation) return;
    const key = archiveKey(partition, batch);
    const stored = await retryUntilDone(
      async () => {
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.env.S3_BUCKET,
            Key: key,
            Body: batch.lines.join('\n') + '\n',
            ContentType: 'application/x-ndjson',
          }),
        );
      },
      this.control,
      (error, attempt) =>
        this.logger.warn(
          { err: error, key, attempt },
          'S3 write failed, retrying',
        ),
    );
    if (!stored || batch.generation !== this.generation) return;
    // After the file, never before: a crash here only means the batch is written again.
    try {
      await this.consumer.commit({
        offsets: [
          {
            topic: this.env.KAFKA_TOPIC_LOT_VIEWS,
            partition,
            offset: batch.lastOffset + 1n,
            leaderEpoch: batch.leaderEpoch,
          },
        ],
      });
      this.logger.info({ key, messages: batch.lines.length }, 'batch archived');
    } catch (error) {
      this.logger.warn(
        { err: error, key },
        'offset commit failed, batch will be re-read',
      );
    }
  }
}
