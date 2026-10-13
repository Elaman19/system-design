import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { TxHooks, type TxPoint } from '../../src/common/tx-hooks/tx-hooks.js';

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Replaces the no-op production hooks; a test sets `handler` to pause or fail a transaction. */
export class TestHooks extends TxHooks {
  handler?: (point: TxPoint) => Promise<void> | void;
  override at(point: TxPoint) {
    return this.handler?.(point);
  }
}

export interface Harness {
  app: INestApplication;
  hooks: TestHooks;
  db: DataSource;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const hooks = new TestHooks();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TxHooks)
    .useValue(hooks)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  return {
    app,
    hooks,
    db: app.get(DataSource),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

/** Both callers wait here until `parties` have arrived (or `timeoutMs` passes). */
export function barrier(parties: number, timeoutMs = 300) {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  return async () => {
    if (++arrived >= parties) release();
    await Promise.race([open, sleep(timeoutMs)]);
  };
}

export async function seedCompany(h: Harness, balance = 0) {
  const created = await h
    .http()
    .post('/companies')
    .send({ name: 'ООО Тест', email: `${randomUUID()}@example.com` })
    .expect(201);
  const id: string = created.body.id;
  if (balance > 0) {
    await h
      .http()
      .post(`/companies/${id}/wallet/deposits`)
      .send({ bankNotificationId: randomUUID(), amount: balance })
      .expect(201);
  }
  return id;
}

export async function seedLot(
  h: Harness,
  sellerId: string,
  { price = 100_000, stock = 1, published = true } = {},
) {
  const created = await h
    .http()
    .post('/lots')
    .send({ sellerId, title: 'Станок', price, stock })
    .expect(201);
  const id: string = created.body.id;
  if (published) {
    await h
      .http()
      .patch(`/lots/${id}/publication`)
      .send({ published: true })
      .expect(200);
  }
  return id;
}

export const balanceOf = async (h: Harness, companyId: string) =>
  Number(
    (await h.http().get(`/companies/${companyId}`).expect(200)).body.balance,
  );

export async function dealCount(h: Harness, lotId: string) {
  const [row] = await h.db.query(
    `SELECT count(*)::int AS n FROM deals WHERE lot_id = $1`,
    [lotId],
  );
  return row.n as number;
}

/** The journal is the source of truth: the stored balance must equal the sum of its rows. */
export async function expectLedgerMatchesBalance(
  h: Harness,
  companyId: string,
) {
  const [row] = await h.db.query(
    `SELECT w.balance::bigint AS balance,
            coalesce(sum(o.amount), 0)::bigint AS journal
       FROM wallets w LEFT JOIN wallet_operations o ON o.wallet_id = w.id
      WHERE w.company_id = $1 GROUP BY w.id`,
    [companyId],
  );
  expect(row.balance).toBe(row.journal);
}

export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  constraint: string,
) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as { driverError: { code: string; constraint: string } },
  );
  expect(error?.driverError).toMatchObject({ code, constraint });
}
