import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { rows } from '../db/sql.js';
import type { Deposit } from './wallets.schemas.js';
import { TxHooks } from '../common/tx-hooks/tx-hooks.js';

@Injectable()
export class WalletsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hooks: TxHooks,
  ) {}

  /**
   * The administrator credits a wallet after a bank notification. One INSERT into
   * the journal: the database adds the amount to `wallets.balance` in the same
   * statement (trigger `wallet_operations_apply_balance`), so the journal row and
   * the new balance are written together or not at all. No explicit lock: the
   * balance is never read here, and a repeated notification is rejected by the
   * unique index, not by a check in this code.
   */
  deposit(companyId: string, { bankNotificationId, amount }: Deposit) {
    return this.dataSource.transaction(async (em) => {
      const [wallet] = await rows<{ id: string }>(
        em,
        `SELECT id FROM wallets WHERE company_id = $1`,
        [companyId],
      );
      if (!wallet) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'COMPANY_NOT_FOUND',
          'Компания не найдена',
        );
      }
      const [operation] = await rows<{ id: string }>(
        em,
        `INSERT INTO wallet_operations (wallet_id, type, amount, bank_notification_id)
         VALUES ($1, 'deposit', $2, $3) RETURNING id`,
        [wallet.id, amount, bankNotificationId],
      );
      await this.hooks.at('deposit:afterJournalInsert', em);
      const [updated] = await rows<{ balance: string }>(
        em,
        `SELECT balance FROM wallets WHERE id = $1`,
        [wallet.id],
      );
      return {
        operationId: Number(operation.id),
        // bigint as a string: a balance can exceed Number.MAX_SAFE_INTEGER.
        balance: updated.balance,
      };
    });
  }
}
