import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type EntityManager } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { TxHooks, type TxPoint } from '../../src/common/tx-hooks/tx-hooks.js';

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Replaces the no-op production hooks; a test sets `handler` to pause or fail a transaction. */
export class TestHooks extends TxHooks {
  handler?: (point: TxPoint, em: EntityManager) => Promise<void> | void;
  override at(point: TxPoint, em: EntityManager) {
    return this.handler?.(point, em);
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

export const backendPid = async (em: EntityManager) =>
  (await em.query(`SELECT pg_backend_pid() AS pid`))[0].pid as number;

/**
 * Resolves once some backend is queued behind `pid` (pg_blocking_pids). This is the
 * observable fact a race test needs: "the second request is waiting for the lock",
 * instead of a sleep that merely hopes it got there. Throws if nobody queues up.
 */
export async function waitUntilBlockedBy(
  db: DataSource,
  pid: number,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [{ n }] = await db.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [pid],
    );
    if (n > 0) return;
    if (Date.now() > deadline) {
      throw new Error(`no backend is waiting for backend ${pid}`);
    }
    await sleep(10);
  }
}

/**
 * Handler for a slow transaction that holds its locks: the first transaction to reach
 * the hook stops there until another one is queued behind it. If the lock under test
 * is missing nobody queues up, and the test fails loudly instead of passing by luck.
 */
export function holdUntilBlocked(h: Harness) {
  let taken = false;
  return async (_point: TxPoint, em: EntityManager) => {
    if (taken) return;
    taken = true;
    await waitUntilBlockedBy(h.db, await backendPid(em));
  };
}

/** Every caller waits here until `parties` have arrived; throws if they never do. */
export function barrier(parties: number, timeoutMs = 5000) {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  return async () => {
    if (++arrived >= parties) release();
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`only ${arrived}/${parties} arrived`)),
        timeoutMs,
      );
    });
    try {
      await Promise.race([open, timeout]);
    } finally {
      clearTimeout(timer!);
    }
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
