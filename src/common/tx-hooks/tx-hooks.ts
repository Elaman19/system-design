import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export type TxPoint =
  'deposit:afterJournalInsert' | 'price:afterUpdate' | 'purchase:afterRead';

/**
 * Test seam. Production does nothing here; tests replace it to pause a
 * transaction between its read and its write (a "slow transaction") or to
 * fail it halfway, which is how races and rollbacks are reproduced. The
 * transaction's EntityManager is passed so a test can ask which backend it runs
 * on and wait until another one is queued behind it (pg_blocking_pids).
 */
@Injectable()
export class TxHooks {
  at(_point: TxPoint, _em: EntityManager): Promise<void> | void {}
}
