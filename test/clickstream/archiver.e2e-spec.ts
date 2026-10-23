import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ArchiverModule } from '../../src/clickstream/archiver.module.js';
import {
  ARCHIVER_GROUP,
  ArchiverService,
  archiveKey,
} from '../../src/clickstream/archiver.service.js';
import { loadEnv } from '../../src/config/env.js';
import { S3 } from '../../src/s3/s3.module.js';
import {
  eventually,
  type Process,
  startProcess,
} from '../background/helpers.js';
import { committed, newTopic, produce } from '../background/kafka.js';
import { sleep } from '../marketplace/helpers.js';

const s3 = () =>
  new S3Client({
    endpoint: loadEnv().S3_ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
    forcePathStyle: true,
  });

const event = (ip: string, at = new Date()) =>
  JSON.stringify({
    viewId: randomUUID(),
    lotId: randomUUID(),
    ip,
    userId: null,
    viewedAt: at.toISOString(),
  });

describe('clickstream archive: lot-views -> S3', () => {
  const client = s3();
  const processes: Process[] = [];
  const buckets: string[] = [];
  afterEach(async () => {
    await Promise.all(processes.splice(0).map((p) => p.close()));
    // Each bucket holds volumes in SeaweedFS: give them back.
    for (const Bucket of buckets.splice(0)) {
      const list = await client.send(new ListObjectsV2Command({ Bucket }));
      for (const o of list.Contents ?? []) {
        await client.send(new DeleteObjectCommand({ Bucket, Key: o.Key! }));
      }
      await client.send(new DeleteBucketCommand({ Bucket }));
    }
  });
  const newBucket = () => {
    const bucket = `test-${randomUUID()}`;
    buckets.push(bucket);
    return bucket;
  };

  const archiver = async (
    env: Partial<Process['env']>,
    overrides: [unknown, unknown][] = [],
  ) => {
    const p = await startProcess([ArchiverModule], env, undefined, overrides);
    processes.push(p);
    return p;
  };

  const files = async (bucket: string) => {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: bucket }),
    );
    return (list.Contents ?? []).map((o) => o.Key!).sort();
  };
  const lines = async (bucket: string, key: string) => {
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await object.Body!.transformToString()).trimEnd().split('\n');
  };
  const allLines = async (bucket: string) =>
    (
      await Promise.all((await files(bucket)).map((k) => lines(bucket, k)))
    ).flat();

  it('writes batches by size and by time, one folder per day, and commits after writing', async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    await archiver({
      KAFKA_TOPIC_LOT_VIEWS: topic,
      S3_BUCKET: bucket,
      ARCHIVE_BATCH_SIZE: 10,
      ARCHIVE_FLUSH_MS: 500,
    });
    // One key, one partition: a deterministic 25 = 10 + 10 + 5 split.
    await produce(
      topic,
      Array.from({ length: 25 }, () => ({
        key: '203.0.113.7',
        value: event('203.0.113.7'),
      })),
    );

    await eventually(
      async () => (await allLines(bucket)).length === 25,
      'all 25 views in S3',
    );

    const keys = await files(bucket);
    const today = new Date().toISOString().slice(0, 10);
    expect(keys).toHaveLength(3);
    for (const key of keys) {
      expect(key).toMatch(
        new RegExp(`^clickstream/date=${today}/[0-2]-\\d+-\\d+\\.jsonl$`),
      );
    }
    expect(new Set(await allLines(bucket)).size).toBe(25);
    await eventually(
      async () =>
        (await committed(ARCHIVER_GROUP, topic)).some((o) => o === 25n),
      'the offset to be committed after the last file',
    );
  });

  it('a batch is named after its partition, first and last offset; the folder is the day of the first view', () => {
    const key = archiveKey(2, {
      firstOffset: 4000n,
      lastOffset: 4999n,
      firstTimestamp: BigInt(Date.parse('2026-10-20T23:59:59Z')),
    });
    expect(key).toBe('clickstream/date=2026-10-20/2-4000-4999.jsonl');
  });

  it('crash after the file is written but before the offset is committed: the replay overwrites the same file', async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const env = {
      KAFKA_TOPIC_LOT_VIEWS: topic,
      S3_BUCKET: bucket,
      ARCHIVE_BATCH_SIZE: 10,
      ARCHIVE_FLUSH_MS: 600_000,
    };

    const first = await archiver(env);
    // The commit never happens: the process "dies" right after the S3 write.
    vi.spyOn(first.get(ArchiverService).consumer, 'commit').mockRejectedValue(
      new Error('killed'),
    );
    await produce(
      topic,
      Array.from({ length: 10 }, () => ({
        key: '203.0.113.7',
        value: event('203.0.113.7'),
      })),
    );
    await eventually(
      async () => (await files(bucket)).length === 1,
      'the first file',
    );
    const [name] = await files(bucket);
    const before = await lines(bucket, name);
    expect(await committed(ARCHIVER_GROUP, topic)).not.toContain(10n);
    await first.close();
    processes.splice(processes.indexOf(first), 1);

    // New process, same group: Kafka hands out the same 10 messages again.
    await archiver(env);
    await eventually(
      async () =>
        (await committed(ARCHIVER_GROUP, topic)).some((o) => o === 10n),
      'the replayed batch to be committed',
    );

    expect(await files(bucket)).toEqual([name]);
    expect(await lines(bucket, name)).toEqual(before);
    expect(await allLines(bucket)).toHaveLength(10);
  });

  const tenViews = () =>
    Array.from({ length: 10 }, () => ({
      key: '203.0.113.7',
      value: event('203.0.113.7'),
    }));

  it("a replay cut at other places replaces the first run's file: no view is in the archive twice", async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const env = {
      KAFKA_TOPIC_LOT_VIEWS: topic,
      S3_BUCKET: bucket,
      ARCHIVE_FLUSH_MS: 600_000,
    };
    const first = await archiver({ ...env, ARCHIVE_BATCH_SIZE: 10 });
    vi.spyOn(first.get(ArchiverService).consumer, 'commit').mockRejectedValue(
      new Error('killed'),
    );
    await produce(topic, tenViews());
    await eventually(
      async () => (await files(bucket)).length === 1,
      "the first run's file",
    );
    await first.close();
    processes.splice(processes.indexOf(first), 1);

    // The restart batches by 5, not 10: two files where there was one.
    await archiver({ ...env, ARCHIVE_BATCH_SIZE: 5 });
    await eventually(
      async () =>
        (await committed(ARCHIVER_GROUP, topic)).some((o) => o === 10n),
      'the replayed batches to be committed',
    );

    const keys = await eventually(async () => {
      const keys = await files(bucket);
      return keys.length === 2 && keys;
    }, "the first run's file to be replaced by two");
    expect(keys.every((k) => /-(0-4|5-9)\.jsonl$/.test(k))).toBe(true);
    const all = await allLines(bucket);
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(10);
  });

  it('a commit that keeps failing holds the next batch back: nothing is written behind an uncommitted batch', async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const p = await archiver({
      KAFKA_TOPIC_LOT_VIEWS: topic,
      S3_BUCKET: bucket,
      ARCHIVE_BATCH_SIZE: 5,
      ARCHIVE_FLUSH_MS: 600_000,
    });
    const commit = vi
      .spyOn(p.get(ArchiverService).consumer, 'commit')
      .mockRejectedValueOnce(new Error('coordinator moved'))
      .mockRejectedValueOnce(new Error('coordinator moved'));
    await produce(topic, tenViews());

    await eventually(() => commit.mock.calls.length >= 1, 'the first commit');
    await eventually(
      async () => (await files(bucket)).length === 1,
      'the first file',
    );
    // The second batch is full and waiting, but the first is not committed yet.
    await sleep(500);
    expect(await files(bucket)).toHaveLength(1);

    // The third attempt goes through, then the second batch is written.
    await eventually(
      async () =>
        (await committed(ARCHIVER_GROUP, topic)).some((o) => o === 10n),
      'both batches to be committed',
    );
    expect(commit).toHaveBeenCalledTimes(4);
    const all = await allLines(bucket);
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(10);
  });

  it('a rebalance while the commit is being retried: the batch is left to the new owner, nothing is committed', async () => {
    const topic = await newTopic('archive');
    const p = await archiver({
      KAFKA_TOPIC_LOT_VIEWS: topic,
      S3_BUCKET: newBucket(),
      ARCHIVE_BATCH_SIZE: 5,
      ARCHIVE_FLUSH_MS: 600_000,
    });
    const service = p.get(ArchiverService);
    const commit = vi
      .spyOn(service.consumer, 'commit')
      .mockRejectedValue(new Error('coordinator moved'));
    await produce(topic, tenViews().slice(0, 5));
    await eventually(() => commit.mock.calls.length === 1, 'the first commit');

    service.consumer.emit('consumer:group:rebalance', {} as never);
    await Promise.all(service['writes'].values());

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("a PUT of the previous owner that lands late is a separate file: it cannot cut down the new owner's file", async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const client = s3();
    const realSend = client.send.bind(client);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    let puts = 0;
    (client as { send: unknown }).send = async (command: unknown) => {
      if (command instanceof PutObjectCommand && puts++ === 0) {
        held = true;
        await gate; // the old owner's PUT is on the wire
      }
      return realSend(command as never);
    };
    const p = await archiver(
      {
        KAFKA_TOPIC_LOT_VIEWS: topic,
        S3_BUCKET: bucket,
        ARCHIVE_BATCH_SIZE: 5,
        ARCHIVE_FLUSH_MS: 600_000,
      },
      [[S3, client]],
    );
    const service = p.get(ArchiverService);
    const views = tenViews();
    await produce(topic, views.slice(0, 5));
    await eventually(() => held, "the old owner's PUT to start");
    const [partition] = [...service['writes'].keys()];

    // Rebalance: the new owner reads the partition from offset 0 and writes all ten views.
    service.consumer.emit('consumer:group:rebalance', {} as never);
    await service['write'](partition, {
      firstOffset: 0n,
      lastOffset: 9n,
      leaderEpoch: 0,
      firstTimestamp: BigInt(Date.now()),
      startedAt: Date.now(),
      generation: service['generation'],
      lines: views.map((v) => v.value),
    });
    release();
    await Promise.all(service['writes'].values());

    const keys = await files(bucket);
    expect(keys).toHaveLength(2);
    const full = keys.find((k) => k.endsWith('-0-9.jsonl'))!;
    expect(await lines(bucket, full)).toEqual(views.map((v) => v.value));
    expect(
      (await committed(ARCHIVER_GROUP, topic)).filter((o) => o > 0n),
    ).toEqual([10n]);
  });

  it('a listing without files, or one that fails, does not undo the archived batch', async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const client = s3();
    const realSend = client.send.bind(client);
    let listing: 'empty' | 'failing' = 'empty';
    (client as { send: unknown }).send = (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        return listing === 'empty'
          ? Promise.resolve({})
          : Promise.reject(new Error('S3 is down'));
      }
      return realSend(command as never);
    };
    const p = await archiver(
      {
        KAFKA_TOPIC_LOT_VIEWS: topic,
        S3_BUCKET: bucket,
        ARCHIVE_BATCH_SIZE: 5,
        ARCHIVE_FLUSH_MS: 600_000,
      },
      [[S3, client]],
    );
    await produce(topic, tenViews().slice(0, 5));
    await eventually(
      async () =>
        (await committed(ARCHIVER_GROUP, topic)).some((o) => o === 5n),
      'the commit after an empty listing',
    );

    listing = 'failing';
    await produce(topic, tenViews().slice(0, 5));
    await eventually(
      async () =>
        (await committed(ARCHIVER_GROUP, topic)).some((o) => o === 10n),
      'the commit when the listing fails',
    );

    expect(await allLines(bucket)).toHaveLength(10);
    expect(p).toBeDefined();
  });

  it('S3 fails once: the batch is retried, nothing is lost or committed early', async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const flaky = s3();
    const realSend = flaky.send.bind(flaky);
    let failures = 1;
    (flaky as { send: unknown }).send = (command: unknown) => {
      if (command instanceof PutObjectCommand && failures-- > 0) {
        return Promise.reject(new Error('S3 is down'));
      }
      return realSend(command as never);
    };
    await archiver(
      {
        KAFKA_TOPIC_LOT_VIEWS: topic,
        S3_BUCKET: bucket,
        ARCHIVE_BATCH_SIZE: 5,
        ARCHIVE_FLUSH_MS: 600_000,
      },
      [[S3, flaky]],
    );

    await produce(
      topic,
      Array.from({ length: 5 }, () => ({
        key: '203.0.113.7',
        value: event('203.0.113.7'),
      })),
    );

    await eventually(
      async () => (await allLines(bucket)).length === 5,
      'the retry to write the batch',
    );
    await eventually(
      async () =>
        (await committed(ARCHIVER_GROUP, topic)).some((o) => o === 5n),
      'the commit after the retried write',
    );
  });

  it('S3 is down for good and the process is stopped: nothing is committed, the batch is read again next time', async () => {
    const topic = await newTopic('archive');
    // Not tracked for cleanup: this fake S3 never creates it.
    const bucket = `test-${randomUUID()}`;
    const down = s3();
    let attempts = 0;
    (down as { send: unknown }).send = (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        attempts++;
        return Promise.reject(new Error('S3 is down'));
      }
      return Promise.resolve({});
    };
    const p = await archiver(
      {
        KAFKA_TOPIC_LOT_VIEWS: topic,
        S3_BUCKET: bucket,
        ARCHIVE_BATCH_SIZE: 3,
        ARCHIVE_FLUSH_MS: 600_000,
      },
      [[S3, down]],
    );
    await produce(
      topic,
      Array.from({ length: 3 }, () => ({
        key: '203.0.113.7',
        value: event('203.0.113.7'),
      })),
    );
    await eventually(() => attempts >= 1, 'the first write attempt');

    await p.close();
    processes.splice(processes.indexOf(p), 1);

    expect((await committed(ARCHIVER_GROUP, topic)).every((o) => o <= 0n)).toBe(
      true,
    );
  });

  it('a rebalance drops what is collected but not written: Kafka will deliver it again', async () => {
    const topic = await newTopic('archive');
    const p = await archiver({
      KAFKA_TOPIC_LOT_VIEWS: topic,
      S3_BUCKET: newBucket(),
      ARCHIVE_BATCH_SIZE: 100,
      ARCHIVE_FLUSH_MS: 600_000,
    });
    const service = p.get(ArchiverService);
    await produce(topic, [{ key: '203.0.113.7', value: event('203.0.113.7') }]);
    await eventually(
      () => service['open'].size === 1,
      'the message to be collected',
    );

    service.consumer.emit('consumer:group:rebalance', {} as never);

    expect(service['open'].size).toBe(0);
  });

  it('a batch collected before a rebalance is neither written nor committed: its partition may belong to another copy', async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const p = await archiver({
      KAFKA_TOPIC_LOT_VIEWS: topic,
      S3_BUCKET: bucket,
      ARCHIVE_BATCH_SIZE: 100,
      ARCHIVE_FLUSH_MS: 600_000,
    });
    const service = p.get(ArchiverService);
    const commit = vi.spyOn(service.consumer, 'commit');
    const stale = {
      firstOffset: 0n,
      lastOffset: 0n,
      leaderEpoch: 0,
      firstTimestamp: BigInt(Date.now()),
      startedAt: Date.now(),
      generation: service['generation'],
      lines: [event('203.0.113.7')],
    };

    service.consumer.emit('consumer:group:rebalance', {} as never);
    await service['write'](0, stale);

    expect(commit).not.toHaveBeenCalled();
    expect(await files(bucket)).toEqual([]);
  });

  it('a rebalance while the file is being written: the offset is not committed, the new owner reads the batch again', async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const client = s3();
    const realSend = client.send.bind(client);
    let service!: ArchiverService;
    (client as { send: unknown }).send = async (command: unknown) => {
      const result = await realSend(command as never);
      if (command instanceof PutObjectCommand) {
        service.consumer.emit('consumer:group:rebalance', {} as never);
      }
      return result;
    };
    const p = await archiver(
      {
        KAFKA_TOPIC_LOT_VIEWS: topic,
        S3_BUCKET: bucket,
        ARCHIVE_BATCH_SIZE: 3,
        ARCHIVE_FLUSH_MS: 600_000,
      },
      [[S3, client]],
    );
    service = p.get(ArchiverService);

    await produce(
      topic,
      Array.from({ length: 3 }, () => ({
        key: '203.0.113.7',
        value: event('203.0.113.7'),
      })),
    );

    await eventually(
      async () => (await files(bucket)).length === 1,
      'the file',
    );
    await sleep(1000);
    expect((await committed(ARCHIVER_GROUP, topic)).every((o) => o <= 0n)).toBe(
      true,
    );
  });

  it('stopping while a file is being written lets it finish and commit: the consumer is closed last', async () => {
    const topic = await newTopic('archive');
    const bucket = newBucket();
    const client = s3();
    const realSend = client.send.bind(client);
    let putStarted = false;
    (client as { send: unknown }).send = async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        putStarted = true;
        await sleep(600);
      }
      return realSend(command as never);
    };
    const p = await archiver(
      {
        KAFKA_TOPIC_LOT_VIEWS: topic,
        S3_BUCKET: bucket,
        ARCHIVE_BATCH_SIZE: 3,
        ARCHIVE_FLUSH_MS: 600_000,
      },
      [[S3, client]],
    );
    await produce(
      topic,
      Array.from({ length: 3 }, () => ({
        key: '203.0.113.7',
        value: event('203.0.113.7'),
      })),
    );
    await eventually(() => putStarted, 'the write to start');

    await p.close();
    processes.splice(processes.indexOf(p), 1);

    expect(await files(bucket)).toHaveLength(1);
    expect((await committed(ARCHIVER_GROUP, topic)).some((o) => o === 3n)).toBe(
      true,
    );
  });
});
