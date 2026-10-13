import { Injectable } from '@nestjs/common';

export type TxPoint =
  'deposit:afterJournalInsert' | 'price:afterUpdate' | 'purchase:afterRead';

/**
 * Test seam. Production does nothing here; tests replace it to pause a
 * transaction between its read and its write (a "slow transaction") or to
 * fail it halfway, which is how races and rollbacks are reproduced.
 */
@Injectable()
export class TxHooks {
  at(_point: TxPoint): Promise<void> | void {}
}
