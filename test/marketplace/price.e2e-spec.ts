import { randomUUID } from 'node:crypto';
import {
  createHarness,
  type Harness,
  seedCompany,
  seedLot,
} from './helpers.js';

describe('price change', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterEach(() => {
    h.hooks.handler = undefined;
  });
  afterAll(() => h.close());

  const history = async (lotId: string) =>
    (
      await h.db.query(
        `SELECT price FROM lot_price_history WHERE lot_id = $1 ORDER BY id`,
        [lotId],
      )
    ).map((r: { price: string }) => Number(r.price));

  it('the new price and its history row appear together', async () => {
    const lot = await seedLot(h, await seedCompany(h), { price: 100 });
    const res = await h
      .http()
      .patch(`/lots/${lot}/price`)
      .send({ price: 150 })
      .expect(200);
    expect(res.body.price).toBe(150);
    expect(await history(lot)).toEqual([100, 150]);
  });

  it('a failure between the two writes leaves the old price and no new history row', async () => {
    const lot = await seedLot(h, await seedCompany(h), { price: 100 });
    h.hooks.handler = () => {
      throw new Error('boom after price update');
    };
    await h.http().patch(`/lots/${lot}/price`).send({ price: 150 }).expect(500);
    h.hooks.handler = undefined;
    const [row] = await h.db.query(`SELECT price FROM lots WHERE id = $1`, [
      lot,
    ]);
    expect(Number(row.price)).toBe(100);
    expect(await history(lot)).toEqual([100]);
  });

  it('validates input and the lot', async () => {
    const lot = await seedLot(h, await seedCompany(h));
    await h.http().patch(`/lots/${lot}/price`).send({ price: 0 }).expect(400);
    await h
      .http()
      .patch(`/lots/${randomUUID()}/price`)
      .send({ price: 5 })
      .expect(404);
  });
});
