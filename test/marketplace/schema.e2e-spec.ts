import { randomUUID } from 'node:crypto';
import {
  createHarness,
  expectPgError,
  type Harness,
  seedCompany,
  seedLot,
} from './helpers.js';

describe('schema rules enforced by the database', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('migrations were applied to an empty database by the separate migrate step', async () => {
    const names = await h.db.query(`SELECT name FROM migrations`);
    expect(names.map((r: { name: string }) => r.name)).toContain(
      'InitMarketplace1760400000000',
    );
  });

  it('rule 1: e-mail is unique ignoring case -> 409', async () => {
    const local = randomUUID();
    await h
      .http()
      .post('/companies')
      .send({ name: 'A', email: `${local}@Example.com` })
      .expect(201);
    const res = await h
      .http()
      .post('/companies')
      .send({ name: 'B', email: `${local.toUpperCase()}@example.COM` })
      .expect(409);
    expect(res.body).toMatchObject({
      code: 'ALREADY_EXISTS',
      message: 'Компания с таким email уже зарегистрирована',
    });
  });

  it('rule 2: a company has one wallet', async () => {
    const company = await seedCompany(h);
    await expectPgError(
      h.db.query(`INSERT INTO wallets (company_id) VALUES ($1)`, [company]),
      '23505',
      'wallets_company_id_key',
    );
  });

  it('rule 3: one bank notification cannot credit two wallets either', async () => {
    const [a, b] = [await seedCompany(h), await seedCompany(h)];
    const notification = randomUUID();
    await h
      .http()
      .post(`/companies/${a}/wallet/deposits`)
      .send({ bankNotificationId: notification, amount: 100 })
      .expect(201);
    const res = await h
      .http()
      .post(`/companies/${b}/wallet/deposits`)
      .send({ bankNotificationId: notification, amount: 100 })
      .expect(409);
    expect(res.body.message).toBe('Это банковское уведомление уже обработано');
  });

  it('rule 4: one price record per lot and moment', async () => {
    const lot = await seedLot(h, await seedCompany(h));
    // Copy the timestamp inside SQL: the driver would round it to milliseconds.
    await expectPgError(
      h.db.query(
        `INSERT INTO lot_price_history (lot_id, price, valid_from)
         SELECT lot_id, 5, valid_from FROM lot_price_history WHERE lot_id = $1`,
        [lot],
      ),
      '23505',
      'lot_price_history_lot_id_valid_from_key',
    );
  });

  it('a deal cannot name a seller who does not own the lot', async () => {
    const lot = await seedLot(h, await seedCompany(h));
    const [stranger, buyer] = [await seedCompany(h), await seedCompany(h)];
    await expectPgError(
      h.db.query(
        `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price) VALUES ($1, $2, $3, 1, 1)`,
        [lot, stranger, buyer],
      ),
      '23503',
      'deals_lot_seller_fkey',
    );
  });

  it('a company cannot buy from itself', async () => {
    const seller = await seedCompany(h);
    const lot = await seedLot(h, seller);
    await expectPgError(
      h.db.query(
        `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price) VALUES ($1, $2, $2, 1, 1)`,
        [lot, seller],
      ),
      '23514',
      'deals_buyer_is_not_seller',
    );
  });

  it('balance and stock cannot go negative', async () => {
    const company = await seedCompany(h);
    const lot = await seedLot(h, company);
    await expectPgError(
      h.db.query(`UPDATE wallets SET balance = -1 WHERE company_id = $1`, [
        company,
      ]),
      '23514',
      'wallets_balance_non_negative',
    );
    await expectPgError(
      h.db.query(`UPDATE lots SET stock = -1 WHERE id = $1`, [lot]),
      '23514',
      'lots_stock_non_negative',
    );
  });

  describe('a deal and its journal must agree (deferred trigger, checked at commit)', () => {
    async function dealTx(
      mutate: (ids: {
        walletBuyer: string;
        walletSeller: string;
      }) => [string, number][],
    ) {
      const seller = await seedCompany(h);
      const buyer = await seedCompany(h);
      const lot = await seedLot(h, seller);
      const wallet = async (c: string) =>
        (
          await h.db.query(`SELECT id FROM wallets WHERE company_id = $1`, [c])
        )[0].id as string;
      const walletBuyer = await wallet(buyer);
      const walletSeller = await wallet(seller);
      return h.db.transaction(async (em) => {
        const [deal] = await em.query(
          `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price)
           VALUES ($1, $2, $3, 2, 100) RETURNING id`,
          [lot, seller, buyer],
        );
        for (const [sql, amount] of mutate({ walletBuyer, walletSeller })) {
          const [type, walletId] = sql.split(':');
          await em.query(
            `INSERT INTO wallet_operations (wallet_id, type, amount, deal_id) VALUES ($1, $2, $3, $4)`,
            [walletId, type, amount, deal.id],
          );
        }
      });
    }

    it('accepts the right pair of rows', async () => {
      await expect(
        dealTx((w) => [
          [`purchase:${w.walletBuyer}`, -200],
          [`sale:${w.walletSeller}`, 200],
        ]),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['no journal rows at all', () => []],
      [
        'a wrong amount',
        (w: { walletBuyer: string; walletSeller: string }) =>
          [
            [`purchase:${w.walletBuyer}`, -199],
            [`sale:${w.walletSeller}`, 199],
          ] as [string, number][],
      ],
      [
        'money credited to the wrong wallet',
        (w: { walletBuyer: string; walletSeller: string }) =>
          [
            [`purchase:${w.walletSeller}`, -200],
            [`sale:${w.walletBuyer}`, 200],
          ] as [string, number][],
      ],
      [
        'a missing sale row',
        (w: { walletBuyer: string; walletSeller: string }) =>
          [[`purchase:${w.walletBuyer}`, -200]] as [string, number][],
      ],
    ])('rejects %s', async (_name, mutate) => {
      await expectPgError(
        dealTx(mutate),
        '23514',
        'wallet_operations_deal_ledger',
      );
    });
  });

  it('a journal row must match its type', async () => {
    const company = await seedCompany(h);
    const [wallet] = await h.db.query(
      `SELECT id FROM wallets WHERE company_id = $1`,
      [company],
    );
    await expectPgError(
      h.db.query(
        `INSERT INTO wallet_operations (wallet_id, type, amount, bank_notification_id) VALUES ($1, 'deposit', -5, 'x')`,
        [wallet.id],
      ),
      '23514',
      'wallet_operations_shape',
    );
  });

  it('API: unknown seller -> 422, duplicate delivery method -> 409, malformed id -> 400', async () => {
    await h
      .http()
      .post('/lots')
      .send({ sellerId: randomUUID(), title: 'X', price: 1, stock: 1 })
      .expect(422);
    const seller = await seedCompany(h);
    const dup = await h
      .http()
      .post('/lots')
      .send({
        sellerId: seller,
        title: 'X',
        price: 1,
        stock: 1,
        deliveryMethods: ['pickup', 'pickup'],
      })
      .expect(409);
    expect(dup.body.message).toBe('Способ доставки указан дважды');
    await h.http().get('/companies/not-a-uuid').expect(400);
  });
});
