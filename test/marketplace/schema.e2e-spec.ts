import { randomUUID } from 'node:crypto';
import {
  balanceOf,
  createHarness,
  expectLedgerMatchesBalance,
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
    expect(names.map((r: { name: string }) => r.name)).toEqual(
      expect.arrayContaining([
        'InitMarketplace1760400000000',
        'EnforceDealRules1760700000000',
      ]),
    );
  });

  it('the app connections carry the lock, statement and idle-in-transaction timeouts', async () => {
    const [row] = await h.db.query(
      `SELECT current_setting('lock_timeout') AS lock,
              current_setting('statement_timeout') AS statement,
              current_setting('idle_in_transaction_session_timeout') AS idle`,
    );
    expect(row).toEqual({ lock: '5s', statement: '30s', idle: '30s' });
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

  // seedLot's default price: a deal must carry exactly the lot's price.
  const PRICE = 100_000;

  it('a deal cannot name a seller who does not own the lot', async () => {
    const lot = await seedLot(h, await seedCompany(h));
    const [stranger, buyer] = [await seedCompany(h), await seedCompany(h)];
    await expectPgError(
      h.db.query(
        `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price) VALUES ($1, $2, $3, 1, ${PRICE})`,
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
        `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price) VALUES ($1, $2, $2, 1, ${PRICE})`,
        [lot, seller],
      ),
      '23514',
      'deals_buyer_is_not_seller',
    );
  });

  describe('terms of a deal are checked by the database', () => {
    const insertDeal = (
      lot: string,
      seller: string,
      buyer: string,
      price = PRICE,
    ) =>
      h.db.query(
        `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price) VALUES ($1, $2, $3, 1, $4)`,
        [lot, seller, buyer, price],
      );

    it('a lot that is not published cannot be sold', async () => {
      const seller = await seedCompany(h);
      const lot = await seedLot(h, seller, { published: false });
      await expectPgError(
        insertDeal(lot, seller, await seedCompany(h)),
        '23514',
        'deals_lot_is_published',
      );
    });

    it('the deal price must be the current price of the lot', async () => {
      const seller = await seedCompany(h);
      const lot = await seedLot(h, seller);
      await expectPgError(
        insertDeal(lot, seller, await seedCompany(h), 1),
        '23514',
        'deals_unit_price_is_lot_price',
      );
    });
  });

  describe('the balance follows the journal and nothing else', () => {
    it('cannot be set directly', async () => {
      const company = await seedCompany(h);
      await expectPgError(
        h.db.query(`UPDATE wallets SET balance = 5 WHERE company_id = $1`, [
          company,
        ]),
        '23514',
        'wallets_balance_journal_only',
      );
      const [created] = await h.db.query(
        `INSERT INTO companies (name, email) VALUES ('X', $1) RETURNING id`,
        [`${randomUUID()}@example.com`],
      );
      await expectPgError(
        h.db.query(`INSERT INTO wallets (company_id, balance) VALUES ($1, 5)`, [
          created.id,
        ]),
        '23514',
        'wallets_balance_journal_only',
      );
    });

    it('moves with each journal row, and a journal row cannot overdraw it', async () => {
      const company = await seedCompany(h, 500);
      await h.db.query(
        `INSERT INTO wallet_operations (wallet_id, type, amount, bank_notification_id)
         SELECT id, 'deposit', 250, $2 FROM wallets WHERE company_id = $1`,
        [company, randomUUID()],
      );
      expect(await balanceOf(h, company)).toBe(750);
      await expectLedgerMatchesBalance(h, company);

      const seller = await seedCompany(h);
      const lot = await seedLot(h, seller, { stock: 5 });
      await expectPgError(
        h.db.transaction(async (em) => {
          const [deal] = await em.query(
            `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price)
             VALUES ($1, $2, $3, 1, ${PRICE}) RETURNING id`,
            [lot, seller, company],
          );
          await em.query(
            `INSERT INTO wallet_operations (wallet_id, type, amount, deal_id)
             SELECT id, 'purchase', -${PRICE}, $2 FROM wallets WHERE company_id = $1`,
            [company, deal.id],
          );
        }),
        '23514',
        'wallets_balance_non_negative',
      );
    });
  });

  it('stock cannot go negative', async () => {
    const lot = await seedLot(h, await seedCompany(h));
    await expectPgError(
      h.db.query(`UPDATE lots SET stock = -1 WHERE id = $1`, [lot]),
      '23514',
      'lots_stock_non_negative',
    );
  });

  describe('the stock history is a chain that matches the lot', () => {
    const history = (
      lot: string,
      delta: number,
      stockAfter: number,
      reason = 'restock',
    ) =>
      h.db.query(
        `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, changed_at)
         VALUES ($1, $2, $3, $4, clock_timestamp())`,
        [lot, delta, stockAfter, reason],
      );

    it('a row must show the real stock of the lot', async () => {
      const lot = await seedLot(h, await seedCompany(h), { stock: 3 });
      await expectPgError(
        history(lot, 1, 99),
        '23514',
        'lot_stock_history_matches_lot',
      );
    });

    it('a row must continue the previous one, and "initial" can only be first', async () => {
      const lot = await seedLot(h, await seedCompany(h), { stock: 3 });
      await expectPgError(
        h.db.transaction(async (em) => {
          await em.query(`UPDATE lots SET stock = 10 WHERE id = $1`, [lot]);
          await em.query(
            `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, changed_at)
             VALUES ($1, 1, 10, 'restock', now())`,
            [lot],
          );
        }),
        '23514',
        'lot_stock_history_chain',
      );
      await expectPgError(
        history(lot, 3, 3, 'initial'),
        '23514',
        'lot_stock_history_chain',
      );
    });

    it('the stock of a lot cannot change without a history row (checked at commit)', async () => {
      const lot = await seedLot(h, await seedCompany(h), { stock: 3 });
      await expectPgError(
        h.db.transaction((em) =>
          em.query(`UPDATE lots SET stock = 4 WHERE id = $1`, [lot]),
        ),
        '23514',
        'lots_stock_matches_history',
      );
    });
  });

  describe('price and publication of a lot match their history (checked at commit)', () => {
    it.each([
      [
        'price',
        `UPDATE lots SET price = 5 WHERE id = $1`,
        'lots_price_matches_history',
      ],
      [
        'publication',
        `UPDATE lots SET is_published = NOT is_published WHERE id = $1`,
        'lots_publication_matches_history',
      ],
    ])(
      'the %s cannot change without a history row',
      async (_name, sql, constraint) => {
        const lot = await seedLot(h, await seedCompany(h));
        await expectPgError(
          h.db.transaction((em) => em.query(sql, [lot])),
          '23514',
          constraint,
        );
      },
    );

    it('a history row cannot be written without the matching change of the lot', async () => {
      const lot = await seedLot(h, await seedCompany(h));
      await expectPgError(
        h.db.transaction((em) =>
          em.query(
            `INSERT INTO lot_price_history (lot_id, price, valid_from) VALUES ($1, 5, clock_timestamp())`,
            [lot],
          ),
        ),
        '23514',
        'lots_price_matches_history',
      );
      await expectPgError(
        h.db.transaction((em) =>
          em.query(
            `INSERT INTO lot_publication_history (lot_id, is_published, changed_at)
             SELECT id, NOT is_published, clock_timestamp() FROM lots WHERE id = $1`,
            [lot],
          ),
        ),
        '23514',
        'lots_publication_matches_history',
      );
    });

    it('a lot cannot be created without its price and publication history', async () => {
      const seller = await seedCompany(h);
      await expectPgError(
        h.db.transaction((em) =>
          em.query(
            `INSERT INTO lots (seller_id, title, price, stock) VALUES ($1, 'x', 5, 0)`,
            [seller],
          ),
        ),
        '23514',
        'lots_price_matches_history',
      );
    });
  });

  it('a deal gets the time of the insert, not of the transaction start (price lookup by valid_from <= created_at)', async () => {
    const [row] = await h.db.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'deals' AND column_name = 'created_at'`,
    );
    expect(row.column_default).toContain('clock_timestamp()');
  });

  describe('a deal and its journal must agree (deferred trigger, checked at commit)', () => {
    type Wallets = { walletBuyer: string; walletSeller: string };
    const TOTAL = 2 * PRICE;

    // A whole deal of 2 items written by hand: stock, deal, stock history, then the
    // journal rows given by `mutate`; `stockHistory: false` leaves the history out.
    async function dealTx(
      mutate: (w: Wallets) => [string, number][],
      { stockHistory = true } = {},
    ) {
      const seller = await seedCompany(h, 1_000_000);
      const buyer = await seedCompany(h, 1_000_000);
      const lot = await seedLot(h, seller, { stock: 5 });
      const wallet = async (c: string) =>
        (
          await h.db.query(`SELECT id FROM wallets WHERE company_id = $1`, [c])
        )[0].id as string;
      const w = {
        walletBuyer: await wallet(buyer),
        walletSeller: await wallet(seller),
      };
      return h.db.transaction(async (em) => {
        await em.query(`UPDATE lots SET stock = 3 WHERE id = $1`, [lot]);
        const [deal] = await em.query(
          `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price)
           VALUES ($1, $2, $3, 2, ${PRICE}) RETURNING id`,
          [lot, seller, buyer],
        );
        if (stockHistory) {
          await em.query(
            `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, deal_id, changed_at)
             VALUES ($1, -2, 3, 'sale', $2, clock_timestamp())`,
            [lot, deal.id],
          );
        } else {
          await em.query(
            `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, changed_at)
             VALUES ($1, -2, 3, 'writeoff', clock_timestamp())`,
            [lot],
          );
        }
        for (const [sql, amount] of mutate(w)) {
          const [type, walletId] = sql.split(':');
          await em.query(
            `INSERT INTO wallet_operations (wallet_id, type, amount, deal_id) VALUES ($1, $2, $3, $4)`,
            [walletId, type, amount, deal.id],
          );
        }
      });
    }

    const right = (w: Wallets): [string, number][] => [
      [`purchase:${w.walletBuyer}`, -TOTAL],
      [`sale:${w.walletSeller}`, TOTAL],
    ];

    it('accepts the right pair of rows', async () => {
      await expect(dealTx(right)).resolves.toBeUndefined();
    });

    it.each([
      ['no journal rows at all', () => []],
      [
        'a wrong amount',
        (w: Wallets) =>
          [
            [`purchase:${w.walletBuyer}`, -(TOTAL - 1)],
            [`sale:${w.walletSeller}`, TOTAL - 1],
          ] as [string, number][],
      ],
      [
        'money credited to the wrong wallet',
        (w: Wallets) =>
          [
            [`purchase:${w.walletSeller}`, -TOTAL],
            [`sale:${w.walletBuyer}`, TOTAL],
          ] as [string, number][],
      ],
      [
        'a missing sale row',
        (w: Wallets) =>
          [[`purchase:${w.walletBuyer}`, -TOTAL]] as [string, number][],
      ],
    ])('rejects %s', async (_name, mutate) => {
      await expectPgError(
        dealTx(mutate),
        '23514',
        'wallet_operations_deal_ledger',
      );
    });

    it('rejects a deal that took no stock out of the lot', async () => {
      await expectPgError(
        dealTx(right, { stockHistory: false }),
        '23514',
        'wallet_operations_deal_ledger',
      );
    });
  });

  describe('the ledger and the histories are append-only', () => {
    async function oneDeal() {
      const seller = await seedCompany(h);
      const buyer = await seedCompany(h, 1_000_000);
      const lot = await seedLot(h, seller, { price: PRICE, stock: 3 });
      const res = await h
        .http()
        .post('/deals')
        .send({ buyerId: buyer, lotId: lot, quantity: 1 })
        .expect(201);
      return { lot, deal: res.body.id as string };
    }

    it.each([
      [
        'changing a journal amount',
        `UPDATE wallet_operations SET amount = amount + 1 WHERE deal_id = $1 AND type = 'sale'`,
        'wallet_operations_append_only',
      ],
      [
        'deleting a journal row',
        `DELETE FROM wallet_operations WHERE deal_id = $1 AND type = 'sale'`,
        'wallet_operations_append_only',
      ],
      [
        'repricing a deal',
        `UPDATE deals SET unit_price = 1 WHERE id = $1`,
        'deals_append_only',
      ],
      [
        'deleting a deal',
        `DELETE FROM deals WHERE id = $1`,
        'deals_append_only',
      ],
      [
        'editing stock history',
        `UPDATE lot_stock_history SET delta = 5 WHERE deal_id = $1`,
        'lot_stock_history_append_only',
      ],
    ])('rejects %s', async (_name, sql, constraint) => {
      const { deal } = await oneDeal();
      await expectPgError(h.db.query(sql, [deal]), '23514', constraint);
    });

    it.each([
      [
        'rewriting a price in the history',
        `UPDATE lot_price_history SET price = 1 WHERE lot_id = $1`,
        'lot_price_history_append_only',
      ],
      [
        'deleting a publication record',
        `DELETE FROM lot_publication_history WHERE lot_id = $1`,
        'lot_publication_history_append_only',
      ],
    ])('rejects %s', async (_name, sql, constraint) => {
      const { lot } = await oneDeal();
      await expectPgError(h.db.query(sql, [lot]), '23514', constraint);
    });

    it.each([
      'wallet_operations',
      'lot_price_history',
      'lot_publication_history',
    ])('rejects TRUNCATE of %s', async (table) => {
      await expectPgError(
        h.db.query(`TRUNCATE ${table}`),
        '23514',
        `${table}_append_only`,
      );
    });
  });

  describe('stock history of a sale must agree with its deal', () => {
    it('rejects a delta that differs from the deal quantity, another lot, and a second row', async () => {
      const seller = await seedCompany(h, 1_000_000);
      const buyer = await seedCompany(h, 1_000_000);
      const [lot, other] = [
        await seedLot(h, seller, { stock: 3 }),
        await seedLot(h, seller, { stock: 3 }),
      ];
      const wallet = async (c: string) =>
        (
          await h.db.query(`SELECT id FROM wallets WHERE company_id = $1`, [c])
        )[0].id as string;
      const [walletBuyer, walletSeller] = [
        await wallet(buyer),
        await wallet(seller),
      ];
      // A deal of one item with a correct journal, then one stock-history row for
      // `lotId`; the lot's stock is moved to `stockAfter` first so that only the rule
      // under test is violated, not the "history matches the lot" ones.
      const history = (lotId: string, delta: number, stockAfter: number) =>
        h.db.transaction(async (em) => {
          const [deal] = await em.query(
            `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price)
             VALUES ($1, $2, $3, 1, ${PRICE}) RETURNING id`,
            [lot, seller, buyer],
          );
          await em.query(
            `INSERT INTO wallet_operations (wallet_id, type, amount, deal_id)
             VALUES ($1, 'purchase', -${PRICE}, $3), ($2, 'sale', ${PRICE}, $3)`,
            [walletBuyer, walletSeller, deal.id],
          );
          await em.query(`UPDATE lots SET stock = $2 WHERE id = $1`, [
            lotId,
            stockAfter,
          ]);
          await em.query(
            `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, deal_id, changed_at)
             VALUES ($1, $2, $3, 'sale', $4, now())`,
            [lotId, delta, stockAfter, deal.id],
          );
        });

      await expectPgError(
        history(lot, 5, 2),
        '23514',
        'lot_stock_history_deal_delta',
      );
      await expectPgError(
        history(other, -1, 2),
        '23503',
        'lot_stock_history_deal_lot_fkey',
      );

      // The API already wrote the history row of this deal; a second one is a duplicate.
      const bought = await h
        .http()
        .post('/deals')
        .send({ buyerId: buyer, lotId: lot, quantity: 1 })
        .expect(201);
      await expectPgError(
        h.db.transaction(async (em) => {
          await em.query(`UPDATE lots SET stock = 1 WHERE id = $1`, [lot]);
          await em.query(
            `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, deal_id, changed_at)
             VALUES ($1, -1, 1, 'sale', $2, now())`,
            [lot, bought.body.id],
          );
        }),
        '23505',
        'lot_stock_history_deal_key',
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
