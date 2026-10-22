import { randomUUID } from 'node:crypto';
import {
  createHarness,
  expectPgError,
  type Harness,
  seedCompany,
  seedLot,
} from '../marketplace/helpers.js';

describe('background-job tables enforce their rules in the database', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const purchase = async () => {
    const seller = await seedCompany(h);
    const buyer = await seedCompany(h, 1_000_000);
    const lot = await seedLot(h, seller, { price: 100_000, stock: 5 });
    const res = await h
      .http()
      .post('/deals')
      .send({ buyerId: buyer, lotId: lot, quantity: 1 })
      .expect(201);
    return { dealId: res.body.id as string, buyer };
  };

  it('outbox: one row per kind and aggregate, only known kinds', async () => {
    const id = randomUUID();
    await h.db.query(
      `INSERT INTO outbox (kind, aggregate_id) VALUES ('deal.receipt', $1)`,
      [id],
    );
    await expectPgError(
      h.db.query(
        `INSERT INTO outbox (kind, aggregate_id) VALUES ('deal.receipt', $1)`,
        [id],
      ),
      '23505',
      'outbox_kind_aggregate_id_key',
    );
    await expectPgError(
      h.db.query(
        `INSERT INTO outbox (kind, aggregate_id) VALUES ('nope', $1)`,
        [randomUUID()],
      ),
      '23514',
      'outbox_kind_known',
    );
  });

  it('a purchase leaves exactly one unpublished outbox row for the deal', async () => {
    const { dealId } = await purchase();
    const rows = await h.db.query(
      `SELECT kind, published_at FROM outbox WHERE aggregate_id = $1`,
      [dealId],
    );
    expect(rows).toEqual([{ kind: 'deal.receipt', published_at: null }]);
  });

  it('deal_receipts: one per deal, must name a real deal, append-only', async () => {
    const { dealId } = await purchase();
    await h.db.query(
      `INSERT INTO deal_receipts (deal_id, recipient) VALUES ($1, 'a@b.c')`,
      [dealId],
    );
    await expectPgError(
      h.db.query(
        `INSERT INTO deal_receipts (deal_id, recipient) VALUES ($1, 'a@b.c')`,
        [dealId],
      ),
      '23505',
      'deal_receipts_pkey',
    );
    await expectPgError(
      h.db.query(
        `INSERT INTO deal_receipts (deal_id, recipient) VALUES ($1, 'a@b.c')`,
        [randomUUID()],
      ),
      '23503',
      'deal_receipts_deal_id_fkey',
    );
    await expectPgError(
      h.db.query(
        `UPDATE deal_receipts SET recipient = 'x@y.z' WHERE deal_id = $1`,
        [dealId],
      ),
      '23514',
      'deal_receipts_append_only',
    );
    await expectPgError(
      h.db.query(`DELETE FROM deal_receipts WHERE deal_id = $1`, [dealId]),
      '23514',
      'deal_receipts_append_only',
    );
    await expectPgError(
      h.db.query(`TRUNCATE deal_receipts`),
      '23514',
      'deal_receipts_append_only',
    );
  });

  describe('ip_bans', () => {
    const ban = (ip: string, from: string, until: string, views = 301) =>
      h.db.query(
        `INSERT INTO ip_bans (ip, banned_from, banned_until, views) VALUES ($1, $2, $3, $4)`,
        [ip, from, until, views],
      );
    const ip = () =>
      `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

    it('no two overlapping bans of one IP, but other IPs and later periods are fine', async () => {
      const a = ip();
      await ban(a, '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z');
      await expectPgError(
        ban(a, '2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z'),
        '23P01',
        'ip_bans_no_overlap',
      );
      await ban(a, '2030-01-01T11:00:00Z', '2030-01-01T12:00:00Z');
      await ban(ip(), '2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z');
    });

    it('a ban must have a positive length and positive view count', async () => {
      await expectPgError(
        ban(ip(), '2030-01-01T11:00:00Z', '2030-01-01T11:00:00Z'),
        '23514',
        'ip_bans_period_valid',
      );
      await expectPgError(
        ban(ip(), '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z', 0),
        '23514',
        'ip_bans_views_positive',
      );
    });
  });
});
