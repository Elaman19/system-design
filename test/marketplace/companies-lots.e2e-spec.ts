import { randomUUID } from 'node:crypto';
import {
  createHarness,
  type Harness,
  seedCompany,
  seedLot,
} from './helpers.js';

describe('companies and lots', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('creates a company with an empty wallet and reads it back', async () => {
    const email = `${randomUUID()}@example.com`;
    const created = await h
      .http()
      .post('/companies')
      .send({ name: 'ООО Ромашка', email })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'ООО Ромашка',
      email,
      balance: 0,
    });
    const read = await h
      .http()
      .get(`/companies/${created.body.id}`)
      .expect(200);
    expect(read.body).toEqual(created.body);
  });

  it('rejects bad input with 400 and a readable message, and unknown ids with 404', async () => {
    const bad = await h
      .http()
      .post('/companies')
      .send({ name: '', email: 'nope' })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect(bad.body.message).toContain('email');
    await h.http().post('/companies').send({}).expect(400);
    await h.http().get(`/companies/${randomUUID()}`).expect(404);
  });

  it('creates a lot with the first row of every history table', async () => {
    const seller = await seedCompany(h);
    const res = await h
      .http()
      .post('/lots')
      .send({
        sellerId: seller,
        title: 'Токарный станок',
        price: 250_000_00,
        stock: 3,
        deliveryMethods: ['pickup', 'freight'],
      })
      .expect(201);
    expect(res.body).toMatchObject({
      price: 250_000_00,
      stock: 3,
      published: false,
      deliveryMethods: ['pickup', 'freight'],
    });
    const id = res.body.id;
    const count = async (table: string) =>
      (
        await h.db.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE lot_id = $1`,
          [id],
        )
      )[0].n;
    expect(await count('lot_price_history')).toBe(1);
    expect(await count('lot_publication_history')).toBe(1);
    expect(await count('lot_stock_history')).toBe(1);
    expect(await count('lot_delivery_methods')).toBe(2);
  });

  it('publishes and hides a lot, recording each change', async () => {
    const lot = await seedLot(h, await seedCompany(h), { published: false });
    await h
      .http()
      .patch(`/lots/${lot}/publication`)
      .send({ published: true })
      .expect(200)
      .expect((r) => expect(r.body.published).toBe(true));
    await h
      .http()
      .patch(`/lots/${lot}/publication`)
      .send({ published: false })
      .expect(200);
    const history = await h.db.query(
      `SELECT is_published FROM lot_publication_history WHERE lot_id = $1 ORDER BY id`,
      [lot],
    );
    expect(
      history.map((r: { is_published: boolean }) => r.is_published),
    ).toEqual([false, true, false]);
    await h
      .http()
      .patch(`/lots/${randomUUID()}/publication`)
      .send({ published: true })
      .expect(404);
  });

  it('restocks a lot and records the delta', async () => {
    const lot = await seedLot(h, await seedCompany(h), { stock: 2 });
    await h
      .http()
      .patch(`/lots/${lot}/stock`)
      .send({ stock: 7 })
      .expect(200)
      .expect((r) => expect(r.body.stock).toBe(7));
    const [last] = await h.db.query(
      `SELECT delta, stock_after, reason FROM lot_stock_history WHERE lot_id = $1 ORDER BY id DESC LIMIT 1`,
      [lot],
    );
    expect(last).toEqual({ delta: 5, stock_after: 7, reason: 'restock' });
    await h
      .http()
      .patch(`/lots/${randomUUID()}/stock`)
      .send({ stock: 1 })
      .expect(404);
    await h.http().patch(`/lots/${lot}/stock`).send({ stock: -1 }).expect(400);
  });
});
