import { randomUUID } from 'node:crypto';
import {
  balanceOf,
  createHarness,
  expectLedgerMatchesBalance,
  type Harness,
  seedCompany,
  sleep,
} from './helpers.js';

describe('wallet deposit', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterEach(() => {
    h.hooks.handler = undefined;
  });
  afterAll(() => h.close());

  const journalRows = async (companyId: string) =>
    (
      await h.db.query(
        `SELECT count(*)::int AS n FROM wallet_operations o JOIN wallets w ON w.id = o.wallet_id WHERE w.company_id = $1`,
        [companyId],
      )
    )[0].n as number;

  it('credits the wallet and writes one journal row', async () => {
    const company = await seedCompany(h);
    const res = await h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send({ bankNotificationId: randomUUID(), amount: 500_000 })
      .expect(201);
    expect(res.body.balance).toBe('500000');
    expect(await journalRows(company)).toBe(1);
    await expectLedgerMatchesBalance(h, company);
  });

  it('two identical deposits at once: one credits, the other gets 409; one journal row, balance grew once', async () => {
    const company = await seedCompany(h);
    const body = { bankNotificationId: randomUUID(), amount: 700_000 };
    let reached!: () => void;
    const firstIsInside = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    // The first transaction stops after writing its journal row and is still
    // uncommitted when the second request arrives.
    h.hooks.handler = async () => {
      reached();
      await hold;
    };

    const first = h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send(body)
      .then((r) => r);
    await firstIsInside;
    const second = h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send(body)
      .then((r) => r);
    await sleep(300); // the second INSERT now waits on the unique index
    release();
    const [a, b] = await Promise.all([first, second]);

    expect([a.status, b.status]).toEqual([201, 409]);
    expect(b.body).toMatchObject({
      code: 'ALREADY_EXISTS',
      message: 'Это банковское уведомление уже обработано',
    });
    expect(await journalRows(company)).toBe(1);
    expect(await balanceOf(h, company)).toBe(700_000);
    await expectLedgerMatchesBalance(h, company);
  });

  it('a repeated notification after the first finished is also 409', async () => {
    const company = await seedCompany(h);
    const body = { bankNotificationId: randomUUID(), amount: 10 };
    await h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send(body)
      .expect(201);
    await h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send(body)
      .expect(409);
    expect(await balanceOf(h, company)).toBe(10);
  });

  it('a failure after the journal insert rolls everything back', async () => {
    const company = await seedCompany(h);
    h.hooks.handler = () => {
      throw new Error('boom after journal insert');
    };
    await h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send({ bankNotificationId: randomUUID(), amount: 123 })
      .expect(500);
    expect(await journalRows(company)).toBe(0);
    expect(await balanceOf(h, company)).toBe(0);
  });

  it('validates input and the company', async () => {
    const company = await seedCompany(h);
    await h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send({ bankNotificationId: '', amount: 5 })
      .expect(400);
    await h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send({ bankNotificationId: 'x', amount: 0 })
      .expect(400);
    await h
      .http()
      .post(`/companies/${company}/wallet/deposits`)
      .send({ bankNotificationId: 'x', amount: 1.5 })
      .expect(400);
    await h
      .http()
      .post(`/companies/${randomUUID()}/wallet/deposits`)
      .send({ bankNotificationId: randomUUID(), amount: 5 })
      .expect(404);
  });
});
