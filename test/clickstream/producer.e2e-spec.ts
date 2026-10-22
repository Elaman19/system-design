import { randomUUID } from 'node:crypto';
import { viewEventSchema } from '../../src/clickstream/view-event.js';
import { ViewEventsPublisher } from '../../src/clickstream/view-events.publisher.js';
import { newTopic, readMessages } from '../background/kafka.js';
import { eventually } from '../background/helpers.js';
import {
  createHarness,
  type Harness,
  seedCompany,
  seedLot,
} from '../marketplace/helpers.js';

describe('lot card views -> Kafka', () => {
  const open: Harness[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((h) => h.close()));
  });

  const start = async (env: Parameters<typeof createHarness>[0]) => {
    const h = await createHarness({ CLICKSTREAM_LINGER_MS: 20, ...env });
    open.push(h);
    return h;
  };

  it('every view of a published lot is an event keyed by the visitor IP', async () => {
    const topic = await newTopic('views');
    const h = await start({ KAFKA_TOPIC_LOT_VIEWS: topic });
    const lot = await seedLot(h, await seedCompany(h));

    for (const ip of ['203.0.113.7', '203.0.113.7', '198.51.100.9']) {
      const res = await h
        .http()
        .get(`/lots/${lot}`)
        .set('X-Forwarded-For', ip)
        .expect(200);
      expect(res.body).toMatchObject({
        id: lot,
        title: 'Станок',
        published: true,
      });
    }

    const got = await readMessages(topic, 3);
    expect(got.map((m) => m.key).sort()).toEqual([
      '198.51.100.9',
      '203.0.113.7',
      '203.0.113.7',
    ]);
    const events = got.map((m) => viewEventSchema.parse(JSON.parse(m.value)));
    expect(events.every((e) => e.lotId === lot && e.userId === null)).toBe(
      true,
    );
    expect(new Set(events.map((e) => e.viewId)).size).toBe(3);
    // Same key, same partition: all views of one IP are read in order by one consumer.
    const partitionsOf = (ip: string) =>
      new Set(got.filter((m) => m.key === ip).map((m) => m.partition));
    expect(partitionsOf('203.0.113.7').size).toBe(1);
  });

  it('an IPv4 address seen through a dual-stack socket is recorded as plain IPv4', async () => {
    const topic = await newTopic('views');
    const h = await start({ KAFKA_TOPIC_LOT_VIEWS: topic });
    const lot = await seedLot(h, await seedCompany(h));

    await h
      .http()
      .get(`/lots/${lot}`)
      .set('X-Forwarded-For', '::ffff:192.0.2.55')
      .expect(200);

    expect((await readMessages(topic, 1))[0].key).toBe('192.0.2.55');
  });

  it('a hidden or unknown lot is 404 and leaves no event', async () => {
    const h = await start({});
    const hidden = await seedLot(h, await seedCompany(h), { published: false });

    await h.http().get(`/lots/${hidden}`).expect(404);
    await h.http().get(`/lots/${randomUUID()}`).expect(404);
    await h.http().get('/lots/not-a-uuid').expect(400);

    expect(h.app.get(ViewEventsPublisher).droppedCount).toBe(0);
  });

  it('Kafka is unreachable: the card still opens, fast, and the views are counted as dropped', async () => {
    const h = await start({ KAFKA_BROKERS: '127.0.0.1:1' });
    const lot = await seedLot(h, await seedCompany(h));
    const publisher = h.app.get(ViewEventsPublisher);

    const started = Date.now();
    for (let i = 0; i < 5; i++) await h.http().get(`/lots/${lot}`).expect(200);
    expect(Date.now() - started).toBeLessThan(2000);

    await eventually(
      () => publisher.droppedCount === 5,
      'the five views to be dropped',
    );
  });

  it('the buffer is bounded: past the limit views are dropped, not queued without end', async () => {
    const h = await start({
      KAFKA_BROKERS: '127.0.0.1:1',
      CLICKSTREAM_BUFFER_MAX: 2,
      CLICKSTREAM_LINGER_MS: 600_000,
    });
    const publisher = h.app.get(ViewEventsPublisher);
    const lot = await seedLot(h, await seedCompany(h));

    for (let i = 0; i < 5; i++) await h.http().get(`/lots/${lot}`).expect(200);

    expect(publisher.droppedCount).toBe(3);
  });

  it('views still buffered at shutdown are sent', async () => {
    const topic = await newTopic('views');
    const h = await start({
      KAFKA_TOPIC_LOT_VIEWS: topic,
      CLICKSTREAM_LINGER_MS: 600_000,
    });
    const lot = await seedLot(h, await seedCompany(h));
    await h.http().get(`/lots/${lot}`).expect(200);

    await h.close();
    open.splice(open.indexOf(h), 1);

    expect(await readMessages(topic, 1)).toHaveLength(1);
  });
});
