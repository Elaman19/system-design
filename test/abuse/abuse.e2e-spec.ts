import { randomUUID } from 'node:crypto';
import { AbuseDetectorModule } from '../../src/abuse/abuse-detector.module.js';
import {
  ABUSE_DETECTOR_GROUP,
  type BanEvent,
  AbuseDetectorService,
} from '../../src/abuse/abuse-detector.service.js';
import { BanRecorderModule } from '../../src/bans/ban-recorder.module.js';
import { BanRecorderService } from '../../src/bans/ban-recorder.service.js';
import { WorkerModule } from '../../src/worker/worker.module.js';
import {
  createHarness,
  type Harness,
  seedCompany,
  seedLot,
  sleep,
} from '../marketplace/helpers.js';
import {
  eventually,
  mailQueue,
  type Process,
  RecordingMailer,
  startProcess,
  uniquePrefix,
} from '../background/helpers.js';
import {
  committed,
  newTopic,
  produce,
  readMessages,
} from '../background/kafka.js';

const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

describe('abuse detection: lot-views -> detector -> ip-bans -> recorder -> 429', () => {
  const processes: Process[] = [];
  const harnesses: Harness[] = [];
  afterEach(async () => {
    await Promise.all(processes.splice(0).map((p) => p.close()));
    await Promise.all(harnesses.splice(0).map((h) => h.close()));
  });

  const topics = async () => ({
    KAFKA_TOPIC_LOT_VIEWS: await newTopic('views'),
    KAFKA_TOPIC_IP_BANS: await newTopic('bans'),
  });

  it('301 views from one IP within a minute: the next request gets 429, the administrator gets a mail; 299 views from another IP: nothing', async () => {
    const env = {
      ...(await topics()),
      BULLMQ_PREFIX: uniquePrefix(),
      CLICKSTREAM_LINGER_MS: 20,
    };
    const api = await createHarness(env);
    harnesses.push(api);
    const mailer = new RecordingMailer();
    for (const modules of [
      [AbuseDetectorModule],
      [BanRecorderModule],
      [WorkerModule],
    ]) {
      processes.push(await startProcess(modules, env, mailer));
    }
    const lot = await seedLot(api, await seedCompany(api));
    const attacker = randomIp();
    const bystander = randomIp();
    const view = (ip: string) =>
      api.http().get(`/lots/${lot}`).set('X-Forwarded-For', ip);

    // 299 views from the bystander, 301 from the attacker, sent in parallel batches.
    const jobs = [
      ...Array.from({ length: 299 }, () => bystander),
      ...Array.from({ length: 301 }, () => attacker),
    ];
    for (let i = 0; i < jobs.length; i += 50) {
      await Promise.all(
        jobs.slice(i, i + 50).map((ip) => view(ip).expect(200)),
      );
    }

    // The ban is not instant: the detector works off Kafka. Poll a request that is not a view.
    const banned = await eventually(async () => {
      const res = await api
        .http()
        .get('/lots')
        .set('X-Forwarded-For', attacker);
      return res.status === 429 ? res : false;
    }, 'the attacker to get 429');
    expect(banned.body).toMatchObject({ statusCode: 429, code: 'IP_BANNED' });
    expect(Number(banned.headers['retry-after'])).toBeGreaterThan(3000);

    await api.http().get('/lots').set('X-Forwarded-For', bystander).expect(200);
    const [ban] = await api.db.query(
      `SELECT host(ip) AS ip, views FROM ip_bans WHERE ip = $1`,
      [attacker],
    );
    expect(ban).toEqual({ ip: attacker, views: 301 });
    expect(
      await api.db.query(`SELECT 1 FROM ip_bans WHERE ip = $1`, [bystander]),
    ).toHaveLength(0);

    await eventually(
      () => mailer.sent.some((m) => m.subject === `IP ${attacker} забанен`),
      'the alert mail to the administrator',
    );
    expect(
      mailer.sent.filter((m) => m.subject.includes(bystander)),
    ).toHaveLength(0);
    // Health probes are not subject to bans.
    await api.http().get('/live').set('X-Forwarded-For', attacker).expect(200);
  });

  it('an X-Forwarded-For that is not an address is served like any request: no 500, nobody is banned', async () => {
    const api = await createHarness({
      ...(await topics()),
      BULLMQ_PREFIX: uniquePrefix(),
    });
    harnesses.push(api);
    const lot = await seedLot(api, await seedCompany(api));

    for (const garbage of ['not-an-ip', '1.2.3.4, 5.6.7.8, nope']) {
      await api.http().get('/lots').set('X-Forwarded-For', garbage).expect(200);
      await api
        .http()
        .get(`/lots/${lot}`)
        .set('X-Forwarded-For', garbage)
        .expect(200);
    }
  });

  describe('the detector', () => {
    const detector = async (extra: Partial<Process['env']> = {}) => {
      const env = { ...(await topics()), ...extra };
      const p = await startProcess([AbuseDetectorModule], env);
      processes.push(p);
      return { p, service: p.get(AbuseDetectorService), env };
    };
    let offset = 0n;
    const feed = async (
      service: AbuseDetectorService,
      ip: string,
      times: number[],
      partition = 0,
    ) => {
      for (const at of times) {
        await service.handle(
          JSON.stringify({
            viewId: randomUUID(),
            lotId: randomUUID(),
            ip,
            userId: null,
            viewedAt: new Date(at).toISOString(),
          }),
          { partition, offset: offset++, leaderEpoch: 0 },
        );
      }
    };
    const every = (n: number, from: number, stepMs: number) =>
      Array.from({ length: n }, (_, i) => from + i * stepMs);

    it('bans once, at the 301st view, with a period derived from that view', async () => {
      const { service, env } = await detector();
      const ip = randomIp();
      const start = Date.now() - 10_000;

      await feed(service, ip, every(305, start, 10)); // 305 views, only the 301st crosses

      const [message] = await readMessages(env.KAFKA_TOPIC_IP_BANS, 2, 3000);
      const ban = JSON.parse(message.value) as BanEvent;
      expect(message.key).toBe(ip);
      expect(ban).toEqual({
        ip,
        bannedFrom: new Date(start + 300 * 10).toISOString(),
        bannedUntil: new Date(start + 300 * 10 + 3_600_000).toISOString(),
        views: 301,
      });
      expect(await readMessages(env.KAFKA_TOPIC_IP_BANS, 2, 3000)).toHaveLength(
        1,
      );
    });

    it('300 views in a minute is not abuse; 301 views spread over two minutes is not either', async () => {
      const { service, env } = await detector();
      const quiet = randomIp();
      const slow = randomIp();
      const start = Date.now() - 200_000;

      await feed(service, quiet, every(300, start, 10));
      await feed(service, slow, every(301, start, 400)); // 120 s for 301 views
      await feed(service, randomIp(), []); // nothing

      expect(await readMessages(env.KAFKA_TOPIC_IP_BANS, 1, 2500)).toHaveLength(
        0,
      );
    });

    it('catching up on an old backlog: a ban that would already be over is not published', async () => {
      const { service, env } = await detector();
      const old = randomIp();
      const recent = randomIp();

      await feed(service, old, every(301, Date.now() - 3 * 3_600_000, 10));
      await feed(service, recent, every(301, Date.now() - 30 * 60_000, 10));

      const got = await readMessages(env.KAFKA_TOPIC_IP_BANS, 2, 3000);
      expect(got.map((m) => m.key)).toEqual([recent]);
    });

    it('forgets a ban once it is over and keeps one that still runs', async () => {
      const { service } = await detector();
      const over = randomIp();
      const running = randomIp();
      await feed(service, over, every(301, Date.now() - 3 * 3_600_000, 10));
      await feed(service, running, every(301, Date.now() - 60_000, 10));
      expect(service['bannedUntil'].size).toBe(2);

      await service.housekeeping();

      expect([...service['bannedUntil'].keys()]).toEqual([running]);
    });

    it('the same events again give the identical ban event: a replay after a crash is harmless', async () => {
      const { service, env } = await detector();
      const ip = randomIp();
      const times = every(301, Date.now() - 60_000, 10);

      await feed(service, ip, times);
      const first = await readMessages(env.KAFKA_TOPIC_IP_BANS, 1);
      const restarted = await startProcess([AbuseDetectorModule], env);
      processes.push(restarted);
      await feed(restarted.get(AbuseDetectorService), ip, times);
      const both = await readMessages(env.KAFKA_TOPIC_IP_BANS, 2);

      expect(both.map((m) => m.value)).toEqual([
        first[0].value,
        first[0].value,
      ]);
    });

    it('a partition that is ahead in time does not make the detector forget the views of one that is behind', async () => {
      const { service, env } = await detector();
      const ip = randomIp();
      const start = Date.now() - 20 * 60_000;

      await feed(service, ip, every(200, start, 10)); // partition 0, lagging
      // Partition 1 is ten minutes further on; then the housekeeping tick runs.
      await feed(service, randomIp(), [start + 10 * 60_000], 1);
      await service.housekeeping();
      await feed(service, ip, every(101, start + 2000, 10)); // 301 in the same minute

      const [message] = await readMessages(env.KAFKA_TOPIC_IP_BANS, 1);
      expect(message.key).toBe(ip);
    });

    it('commits the start of the window, not the last handled view: a restart can read the window again', async () => {
      const { service, env } = await detector();
      const start = Date.now() - 20 * 60_000;
      offset = 100n;

      // Views at 0 s, 10 s, 20 s, 70 s and 80 s: with a 60 s window the last two bring the
      // newest view to 80 s, and only the views after 20 s are still counted.
      await feed(
        service,
        randomIp(),
        [0, 10, 20, 70, 80].map((s) => start + s * 1000),
        1,
      );
      await service.commitProcessed();

      expect(
        (await committed(ABUSE_DETECTOR_GROUP, env.KAFKA_TOPIC_LOT_VIEWS))[1],
      ).toBe(103n);
    });

    it('300 views, a restart, the 301st view: the new process counts the 300 again and bans', async () => {
      const first = await detector();
      const handled = vi.spyOn(first.service, 'handle');
      const ip = randomIp();
      const start = Date.now() - 20_000;
      const view = (at: number) => ({
        key: ip,
        value: JSON.stringify({
          viewId: randomUUID(),
          lotId: randomUUID(),
          ip,
          userId: null,
          viewedAt: new Date(at).toISOString(),
        }),
      });

      await produce(
        first.env.KAFKA_TOPIC_LOT_VIEWS,
        every(300, start, 10).map(view),
      );
      await eventually(
        () => handled.mock.calls.length === 300,
        'all 300 views',
      );
      await Promise.all(handled.mock.results.map((r) => r.value));
      await first.service.commitProcessed();
      await first.p.close();
      processes.splice(processes.indexOf(first.p), 1);
      expect(
        await readMessages(first.env.KAFKA_TOPIC_IP_BANS, 1, 1500),
      ).toHaveLength(0);

      // The 301st view arrives while no detector is running.
      await produce(first.env.KAFKA_TOPIC_LOT_VIEWS, [view(start + 300 * 10)]);
      processes.push(await startProcess([AbuseDetectorModule], first.env));

      const [message] = await readMessages(first.env.KAFKA_TOPIC_IP_BANS, 1);
      expect(message.key).toBe(ip);
      expect(JSON.parse(message.value)).toMatchObject({ ip, views: 301 });
    });

    it('a view that is not valid JSON or has the wrong shape is skipped, the offset still moves on', async () => {
      const { service } = await detector();

      await service.handle('not json', {
        partition: 0,
        offset: 5n,
        leaderEpoch: 0,
      });
      await service.handle('{"ip":1}', {
        partition: 1,
        offset: 7n,
        leaderEpoch: 0,
      });

      expect(service['processed'].get(0)?.offset).toBe(5n);
      expect(service['processed'].get(1)?.offset).toBe(7n);
    });

    it('commits what it has handled, as the next offset to read, and only when there is something', async () => {
      const { service, env } = await detector();
      const commit = vi.spyOn(service.consumer, 'commit');

      await service.commitProcessed();
      expect(commit).not.toHaveBeenCalled();

      await service.handle('x', { partition: 2, offset: 41n, leaderEpoch: 0 });
      await service.commitProcessed();
      expect(
        (await committed(ABUSE_DETECTOR_GROUP, env.KAFKA_TOPIC_LOT_VIEWS))[2],
      ).toBe(42n);
    });

    it('a failed commit is logged, not thrown: the next commit covers it', async () => {
      const { service } = await detector();
      vi.spyOn(service.consumer, 'commit').mockRejectedValueOnce(
        new Error('coordinator moved'),
      );
      await service.handle('x', { partition: 0, offset: 1n, leaderEpoch: 0 });

      await expect(service.commitProcessed()).resolves.toBeUndefined();
    });

    it('Kafka refuses the ban once: it is published again after a pause, the view is not lost', async () => {
      const { service, env } = await detector();
      const send = vi
        .spyOn(service['producer'], 'send')
        .mockRejectedValueOnce(new Error('broker down'));
      const ip = randomIp();

      await feed(service, ip, every(301, Date.now() - 60_000, 10));

      expect(send).toHaveBeenCalledTimes(2);
      expect(await readMessages(env.KAFKA_TOPIC_IP_BANS, 1)).toHaveLength(1);
    });
  });

  describe('the ban recorder', () => {
    const banEvent = (ip: string, from: Date, hours = 1) => ({
      ip,
      bannedFrom: from.toISOString(),
      bannedUntil: new Date(from.getTime() + hours * 3_600_000).toISOString(),
      views: 301,
    });

    it('stores a ban and queues one alert; the same event twice changes nothing', async () => {
      const prefix = uniquePrefix();
      const p = await startProcess([BanRecorderModule], {
        ...(await topics()),
        BULLMQ_PREFIX: prefix,
      });
      processes.push(p);
      const queue = mailQueue(prefix);
      const recorder = p.get(BanRecorderService);
      const ip = randomIp();
      const event = JSON.stringify(banEvent(ip, new Date(Date.now() - 1000)));

      await recorder.record(event);
      await recorder.record(event);

      const rows = await p.db.query(`SELECT id FROM ip_bans WHERE ip = $1`, [
        ip,
      ]);
      expect(rows).toHaveLength(1);
      const jobs = await queue.getJobs([
        'waiting',
        'delayed',
        'active',
        'completed',
      ]);
      expect(jobs.filter((j) => j.data.banId === rows[0].id)).toHaveLength(1);
      await queue.obliterate({ force: true });
      await queue.close();
    });

    it('an overlapping later ban of the same IP is not stored twice; the alert goes to the existing ban', async () => {
      const prefix = uniquePrefix();
      const p = await startProcess([BanRecorderModule], {
        ...(await topics()),
        BULLMQ_PREFIX: prefix,
      });
      processes.push(p);
      const queue = mailQueue(prefix);
      const recorder = p.get(BanRecorderService);
      const ip = randomIp();
      const t = Date.now() - 1000;

      await recorder.record(JSON.stringify(banEvent(ip, new Date(t))));
      await recorder.record(JSON.stringify(banEvent(ip, new Date(t + 5000))));

      expect(
        await p.db.query(`SELECT id FROM ip_bans WHERE ip = $1`, [ip]),
      ).toHaveLength(1);
      expect(await queue.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
      await queue.obliterate({ force: true });
      await queue.close();
    });

    it('garbage is skipped: not JSON, wrong shape, not an IP', async () => {
      const p = await startProcess([BanRecorderModule], {
        ...(await topics()),
        BULLMQ_PREFIX: uniquePrefix(),
      });
      processes.push(p);
      const recorder = p.get(BanRecorderService);
      const before = (
        await p.db.query(`SELECT count(*)::int AS n FROM ip_bans`)
      )[0].n;

      await recorder.record('not json');
      await recorder.record('{"ip":"nope"}');
      await recorder.record(
        JSON.stringify({ ...banEvent('not-an-ip', new Date()) }),
      );
      // The period ends before it starts.
      await recorder.record(
        JSON.stringify({
          ...banEvent(randomIp(), new Date()),
          bannedUntil: new Date(Date.now() - 3_600_000).toISOString(),
        }),
      );

      expect(
        (await p.db.query(`SELECT count(*)::int AS n FROM ip_bans`))[0].n,
      ).toBe(before);
    });

    it('a message the database refuses as a value is skipped, not retried for ever', async () => {
      const p = await startProcess([BanRecorderModule], {
        ...(await topics()),
        BULLMQ_PREFIX: uniquePrefix(),
      });
      processes.push(p);
      const recorder = p.get(BanRecorderService);
      const ip = randomIp();
      // A positive integer for the schema, but too big for the integer column (22003).
      const tooBig = {
        ...banEvent(ip, new Date(Date.now() - 1000)),
        views: 3_000_000_000,
      };

      await expect(
        recorder.record(JSON.stringify(tooBig)),
      ).resolves.toBeUndefined();

      expect(
        await p.db.query(`SELECT 1 FROM ip_bans WHERE ip = $1`, [ip]),
      ).toHaveLength(0);
    });

    it('a ban that cannot be queued (Redis down) is retried and not committed; stopping gives up cleanly', async () => {
      const env = await topics();
      const ip = randomIp();
      const p = await startProcess([BanRecorderModule], {
        ...env,
        BULLMQ_PREFIX: uniquePrefix(),
        REDIS_URL: 'redis://127.0.0.1:1',
        QUEUE_ADD_TIMEOUT_MS: 200,
      });
      processes.push(p);

      await produce(env.KAFKA_TOPIC_IP_BANS, [
        {
          key: ip,
          value: JSON.stringify(banEvent(ip, new Date(Date.now() - 1000))),
        },
      ]);

      // The row is written, the alert cannot be queued: the message is retried, not committed.
      await eventually(
        async () =>
          (await p.db.query(`SELECT 1 FROM ip_bans WHERE ip = $1`, [ip]))
            .length === 1,
        'the ban to be stored',
      );
      await sleep(1500); // several retries
      expect(
        (await committed('ip-ban-recorder', env.KAFKA_TOPIC_IP_BANS)).every(
          (o) => o <= 0n,
        ),
      ).toBe(true);
      await p.close();
      processes.splice(processes.indexOf(p), 1);
      expect(
        (await committed('ip-ban-recorder', env.KAFKA_TOPIC_IP_BANS)).every(
          (o) => o <= 0n,
        ),
      ).toBe(true);
    });

    it('commits the message once the ban is recorded', async () => {
      const env = await topics();
      const prefix = uniquePrefix();
      const ip = randomIp();
      const p = await startProcess([BanRecorderModule], {
        ...env,
        BULLMQ_PREFIX: prefix,
      });
      processes.push(p);

      await produce(env.KAFKA_TOPIC_IP_BANS, [
        {
          key: ip,
          value: JSON.stringify(banEvent(ip, new Date(Date.now() - 1000))),
        },
      ]);

      await eventually(
        async () =>
          (await committed('ip-ban-recorder', env.KAFKA_TOPIC_IP_BANS)).some(
            (o) => o === 1n,
          ),
        'the offset to be committed',
      );
      const queue = mailQueue(prefix);
      await queue.obliterate({ force: true });
      await queue.close();
    });
  });
});
