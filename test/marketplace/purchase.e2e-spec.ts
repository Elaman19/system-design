import { randomUUID } from 'node:crypto';
import { DealsService } from '../../src/deals/deals.service.js';

/** The naive purchase of step 1: the same code with the row locks blanked. */
class UnlockedDealsService extends DealsService {
  protected override readonly rowLock = '';
}
import {
  balanceOf,
  barrier,
  createHarness,
  dealCount,
  expectLedgerMatchesBalance,
  type Harness,
  seedCompany,
  seedLot,
  sleep,
} from './helpers.js';

describe('purchase', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterEach(() => {
    h.hooks.handler = undefined;
  });
  afterAll(() => h.close());

  const buy = (buyerId: string, lotId: string, quantity = 1) =>
    h
      .http()
      .post('/deals')
      .send({ buyerId, lotId, quantity })
      .then((r) => r);

  const stockOf = async (lotId: string) =>
    (await h.db.query(`SELECT stock FROM lots WHERE id = $1`, [lotId]))[0]
      .stock as number;

  it('moves stock and money, writes the deal, both journal rows and the stock history', async () => {
    const seller = await seedCompany(h);
    const buyer = await seedCompany(h, 500_000);
    const lot = await seedLot(h, seller, { price: 100_000, stock: 5 });

    const res = await buy(buyer, lot, 3);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      quantity: 3,
      unitPrice: 100_000,
      total: 300_000,
      buyerId: buyer,
      sellerId: seller,
    });
    expect(await stockOf(lot)).toBe(2);
    expect(await balanceOf(h, buyer)).toBe(200_000);
    expect(await balanceOf(h, seller)).toBe(300_000);
    const journal = await h.db.query(
      `SELECT type, amount::int AS amount FROM wallet_operations WHERE deal_id = $1 ORDER BY id`,
      [res.body.id],
    );
    expect(journal).toEqual([
      { type: 'purchase', amount: -300_000 },
      { type: 'sale', amount: 300_000 },
    ]);
    const [stock] = await h.db.query(
      `SELECT delta, stock_after, reason FROM lot_stock_history WHERE deal_id = $1`,
      [res.body.id],
    );
    expect(stock).toEqual({ delta: -3, stock_after: 2, reason: 'sale' });
    await expectLedgerMatchesBalance(h, buyer);
    await expectLedgerMatchesBalance(h, seller);
  });

  it('refuses with a clear reason and changes nothing', async () => {
    const seller = await seedCompany(h);
    const buyer = await seedCompany(h, 1_000);
    const hidden = await seedLot(h, seller, { published: false });
    const scarce = await seedLot(h, seller, { stock: 1 });
    const pricey = await seedLot(h, seller, { price: 5_000, stock: 1 });

    const cases: [string, number, string, number][] = [
      [hidden, 409, 'LOT_NOT_PUBLISHED', 1],
      [scarce, 409, 'OUT_OF_STOCK', 2],
      [pricey, 409, 'INSUFFICIENT_FUNDS', 1],
    ];
    for (const [lot, status, code, qty] of cases) {
      const res = await buy(buyer, lot, qty);
      expect([res.status, res.body.code]).toEqual([status, code]);
    }
    const own = await buy(seller, scarce);
    expect([own.status, own.body.code]).toEqual([422, 'OWN_LOT']);
    expect((await buy(buyer, randomUUID())).status).toBe(404);
    const ghost = await buy(randomUUID(), scarce);
    expect([ghost.status, ghost.body.code]).toEqual([404, 'COMPANY_NOT_FOUND']);
    expect((await h.http().post('/deals').send({ buyerId: 'x' })).status).toBe(
      400,
    );

    expect(await balanceOf(h, buyer)).toBe(1_000);
    expect(await dealCount(h, scarce)).toBe(0);
    expect(await stockOf(scarce)).toBe(1);
  });

  describe('one item left, two buyers at once', () => {
    async function scenario() {
      const seller = await seedCompany(h);
      const [b1, b2] = [
        await seedCompany(h, 1_000_000),
        await seedCompany(h, 1_000_000),
      ];
      const lot = await seedLot(h, seller, { price: 100_000, stock: 1 });
      // A slow transaction: pause after reading, before writing.
      h.hooks.handler = barrier(2);
      return { seller, b1, b2, lot };
    }

    it('step 2, without locks: the transaction does not help, two deals for one item', async () => {
      const { b1, b2, lot } = await scenario();
      const deals = new UnlockedDealsService(h.db, h.hooks);

      const results = await Promise.all([
        deals.purchase({ buyerId: b1, lotId: lot, quantity: 1 }),
        deals.purchase({ buyerId: b2, lotId: lot, quantity: 1 }),
      ]);

      expect(results).toHaveLength(2);
      expect(await dealCount(h, lot)).toBe(2); // sold twice what existed
      expect(await stockOf(lot)).toBe(0); // both wrote "1 - 1"
    });

    it('step 3, with FOR UPDATE: one deal, the other buyer gets a clear refusal, not a 500', async () => {
      const { b1, b2, lot } = await scenario();

      const results = await Promise.all([buy(b1, lot), buy(b2, lot)]);

      expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([
        201, 409,
      ]);
      const refused = results.find((r) => r.status === 409)!;
      expect(refused.body).toMatchObject({
        code: 'OUT_OF_STOCK',
        message: 'Недостаточно товара на складе',
      });
      expect(await dealCount(h, lot)).toBe(1);
      expect(await stockOf(lot)).toBe(0);
    });
  });

  it('accepts ids in upper case and still recognises the seller', async () => {
    const seller = await seedCompany(h);
    const buyer = await seedCompany(h, 500_000);
    const lot = await seedLot(h, seller);
    const own = await buy(seller.toUpperCase(), lot);
    expect([own.status, own.body.code]).toEqual([422, 'OWN_LOT']);
    const res = await buy(buyer.toUpperCase(), lot.toUpperCase());
    expect(res.status).toBe(201);
    expect(res.body.buyerId).toBe(buyer);
  });

  it('money for one lot, buying two different lots at once: one deal', async () => {
    // Different sellers: with one seller his wallet lock alone would serialise the
    // purchases and hide a missing lock on the buyer's wallet.
    const buyer = await seedCompany(h, 100_000);
    const [lotA, lotB] = [
      await seedLot(h, await seedCompany(h), { price: 100_000 }),
      await seedLot(h, await seedCompany(h), { price: 100_000 }),
    ];
    h.hooks.handler = () => sleep(150);

    const results = await Promise.all([buy(buyer, lotA), buy(buyer, lotB)]);

    expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([
      201, 409,
    ]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe(
      'INSUFFICIENT_FUNDS',
    );
    expect((await dealCount(h, lotA)) + (await dealCount(h, lotB))).toBe(1);
    expect(await balanceOf(h, buyer)).toBe(0);
    await expectLedgerMatchesBalance(h, buyer);
  });

  it('a balance above 2^53 is credited exactly and returned as a string', async () => {
    const seller = await seedCompany(h);
    const buyer = await seedCompany(h, 500_000);
    const lot = await seedLot(h, seller, { price: 1, stock: 5 });
    await h.db.query(
      `UPDATE wallets SET balance = 9007199254740992 WHERE company_id = $1`,
      [seller],
    );
    await h.db.query(
      `INSERT INTO wallet_operations (wallet_id, type, amount, bank_notification_id)
       SELECT id, 'deposit', 9007199254740992, 'big-' || id FROM wallets WHERE company_id = $1`,
      [seller],
    );

    expect((await buy(buyer, lot)).status).toBe(201);

    const res = await h.http().get(`/companies/${seller}`).expect(200);
    expect(res.body.balance).toBe('9007199254740993');
    await expectLedgerMatchesBalance(h, seller);
  });

  it('the seller changes the price during the purchase: deal total equals the amount debited', async () => {
    const seller = await seedCompany(h);
    const buyer = await seedCompany(h, 1_000_000);
    const lot = await seedLot(h, seller, { price: 100_000, stock: 5 });
    let priceChange!: Promise<unknown>;
    h.hooks.handler = async (point) => {
      if (point !== 'purchase:afterRead') return;
      h.hooks.handler = undefined;
      // The lot row is locked by the purchase, so this waits until it commits.
      priceChange = h
        .http()
        .patch(`/lots/${lot}/price`)
        .send({ price: 400_000 })
        .then((r) => r);
      await sleep(200);
    };

    const res = await buy(buyer, lot, 2);
    await priceChange;

    expect(res.status).toBe(201);
    const [deal] = await h.db.query(
      `SELECT total::int AS total, unit_price::int AS unit_price FROM deals WHERE id = $1`,
      [res.body.id],
    );
    const [purchase] = await h.db.query(
      `SELECT amount::int AS amount FROM wallet_operations WHERE deal_id = $1 AND type = 'purchase'`,
      [res.body.id],
    );
    expect(deal).toEqual({ total: 200_000, unit_price: 100_000 });
    // The price change waited for the purchase: it was recorded after the deal, not inside it.
    const [change] = await h.db.query(
      `SELECT (h.valid_from >= d.created_at) AS after_deal
         FROM lot_price_history h, deals d
        WHERE h.lot_id = $1 AND h.price = 400000 AND d.id = $2`,
      [lot, res.body.id],
    );
    expect(change.after_deal).toBe(true);
    expect(purchase.amount).toBe(-deal.total);
    expect(await balanceOf(h, buyer)).toBe(800_000);
    // the price did change, just after the deal
    const next = await buy(buyer, lot, 1);
    expect(next.body.unitPrice).toBe(400_000);
  });

  it('A buys from B while B buys from A, many times: no deadlock, total money unchanged', async () => {
    const [a, b] = [
      await seedCompany(h, 5_000_000),
      await seedCompany(h, 5_000_000),
    ];
    const [lotOfA, lotOfB] = [
      await seedLot(h, a, { price: 1_000, stock: 100 }),
      await seedLot(h, b, { price: 1_000, stock: 100 }),
    ];
    h.hooks.handler = () => sleep(5); // widen the window in which a wrong lock order would deadlock

    const rounds = 20;
    const results = await Promise.all(
      Array.from({ length: rounds }, () => [
        buy(a, lotOfB),
        buy(b, lotOfA),
      ]).flat(),
    );

    expect(results.map((r) => r.status)).toEqual(Array(rounds * 2).fill(201));
    expect((await balanceOf(h, a)) + (await balanceOf(h, b))).toBe(10_000_000);
    expect(await dealCount(h, lotOfA)).toBe(rounds);
    expect(await dealCount(h, lotOfB)).toBe(rounds);
    await expectLedgerMatchesBalance(h, a);
    await expectLedgerMatchesBalance(h, b);
  });
});
