import { randomInt, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Histogram, Registry } from 'prom-client';
import type { DataSource } from 'typeorm';
import { MetricsServer } from '../../src/observability/metrics.module.js';
import { PipelineGauges } from '../../src/outbox/pipeline-gauges.js';
import {
  createHarness,
  createScratchHarness,
  type Harness,
  seedCompany,
  seedLot,
} from '../marketplace/helpers.js';
import { eventually } from '../background/helpers.js';

const HISTOGRAM = 'http_server_request_duration_seconds';

function get(port: number, path: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      })
      .on('error', reject);
  });
}

describe('metrics of the API', () => {
  let h: Harness;
  let registry: Registry;

  beforeAll(async () => {
    h = await createHarness({ METRICS_PORT: 0 });
    registry = h.app.get(Registry);
  });
  afterAll(() => h.close());

  /** Requests counted so far with exactly these labels. */
  const count = async (labels: Record<string, string>) => {
    const histogram = registry.getSingleMetric(HISTOGRAM) as Histogram;
    const { values } = await histogram.get();
    return values
      .filter((v) => v.metricName === `${HISTOGRAM}_count`)
      .filter((v) =>
        Object.entries(labels).every(
          ([k, value]) => v.labels[k as never] === value,
        ),
      )
      .reduce((sum, v) => sum + v.value, 0);
  };
  // Counted on the server's "finish", which may come a moment after the client has read
  // the answer: wait for it.
  const counted = (labels: Record<string, string>, n: number) =>
    eventually(
      async () => (await count(labels)) === n,
      `${JSON.stringify(labels)} to be counted ${n} times`,
    );

  it('serves the Prometheus text format on its own port, nothing else there', async () => {
    const port = h.app.get(MetricsServer).port()!;

    const metrics = await get(port, '/metrics');
    const other = await get(port, '/lots');

    expect(metrics.status).toBe(200);
    expect(metrics.body).toContain('process_cpu_user_seconds_total');
    expect(metrics.body).toContain(`# TYPE ${HISTOGRAM} histogram`);
    expect(other.status).toBe(404);
  });

  it('labels a request by route pattern, status and error code: the id is not a label', async () => {
    const labels = {
      method: 'GET',
      route: '/lots/:id',
      status: '404',
      code: 'LOT_NOT_FOUND',
    };
    const before = await count(labels);

    await h.http().get(`/lots/${randomUUID()}`).expect(404);

    await counted(labels, before + 1);
  });

  it('tells business refusals of a deal apart by code', async () => {
    const seller = await seedCompany(h);
    const buyer = await seedCompany(h); // no money
    const lot = await seedLot(h, seller);
    const labels = { method: 'POST', route: '/deals' };
    const refused = await h
      .http()
      .post('/deals')
      .send({ buyerId: buyer, lotId: lot, quantity: 1 });
    const code: string = refused.body.code;
    const before = await count({ ...labels, code });

    await h
      .http()
      .post('/deals')
      .send({ buyerId: buyer, lotId: lot, quantity: 1 })
      .expect(refused.status);

    expect(code).toBe('INSUFFICIENT_FUNDS');
    await counted({ ...labels, code }, before + 1);
  });

  it('an unknown path is "unmatched": no request path ever becomes a label', async () => {
    const labels = { route: 'unmatched', status: '404' };
    const before = await count(labels);

    await h.http().get(`/nope/${randomUUID()}`).expect(404);

    await counted(labels, before + 1);
    const text = await registry.metrics();
    expect(text).not.toMatch(/route="[^"]*[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('a 429 from the ban check is counted, apart from any route: the false-ban guard counts it', async () => {
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    await h.db.query(
      `INSERT INTO ip_bans (ip, banned_from, banned_until, views)
       VALUES ($1, now() - interval '1 minute', now() + interval '1 hour', 301)`,
      [ip],
    );
    const labels = { route: 'unmatched', status: '429', code: 'IP_BANNED' };
    const before = await count(labels);

    await h
      .http()
      .get(`/lots/${randomUUID()}`)
      .set('X-Forwarded-For', ip)
      .expect(429);

    await counted(labels, before + 1);
  });

  it('a request the client gave up on is "aborted", not the 200 it was going to get', async () => {
    const port = (h.app.getHttpServer().address() as AddressInfo).port;
    const labels = { route: '/work', status: 'aborted' };
    const before = await count(labels);

    const req = http.get({
      host: '127.0.0.1',
      port,
      path: '/work?ms=300',
      agent: false,
    });
    req.on('error', () => undefined);
    setTimeout(() => req.destroy(), 50);

    await counted(labels, before + 1);
    // The handler's pg_sleep goes on after the client left; let it end before the app
    // closes its pool under it.
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
});

describe('metrics of the receipt path', () => {
  let base: Harness;
  let h: Harness;

  beforeAll(async () => {
    base = await createHarness();
    // A database of its own: in app_test other files leave deals without receipts.
    h = await createScratchHarness(base, 'app_test_pipeline_gauges', () =>
      Promise.resolve(),
    );
  });
  afterAll(async () => {
    await h.close();
    await base.close();
  });

  const read = async (registry: Registry, name: string) =>
    (await registry.getSingleMetric(name)!.get()).values[0].value;

  it('0 while nothing waits; the age of the oldest outbox row and of the oldest deal without a receipt', async () => {
    const registry = new Registry();
    new PipelineGauges(h.db, registry);

    expect(await read(registry, 'outbox_oldest_unpublished_seconds')).toBe(0);
    expect(await read(registry, 'receipt_oldest_missing_seconds')).toBe(0);

    const seller = await seedCompany(h);
    const buyer = await seedCompany(h, 1_000_000);
    const lot = await seedLot(h, seller);
    await h
      .http()
      .post('/deals')
      .send({ buyerId: buyer, lotId: lot, quantity: 1 })
      .expect(201);
    await h.db.query(
      `UPDATE outbox SET created_at = now() - interval '2 minutes'`,
    );

    // No relay and no worker run here: the deal waits on both.
    expect(
      await read(registry, 'outbox_oldest_unpublished_seconds'),
    ).toBeGreaterThanOrEqual(120);
    expect(
      await read(registry, 'receipt_oldest_missing_seconds'),
    ).toBeGreaterThan(0);
  });

  it('a query that fails fails the scrape instead of reporting "nothing waits"', async () => {
    const registry = new Registry();
    const broken = {
      manager: { query: () => Promise.reject(new Error('db is down')) },
    } as unknown as DataSource;
    new PipelineGauges(broken, registry);

    await expect(registry.metrics()).rejects.toThrow('db is down');
  });
});
