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
   * The administrator credits a wallet after a bank notification. Journal row and
   * new balance are written in one transaction. No explicit lock: the balance is
   * changed with `balance = balance + $1` (atomic in the database), and a repeated
   * notification is rejected by the unique index, not by a check in this code.
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
      await this.hooks.at('deposit:afterJournalInsert');
      const [updated] = await rows<{ balance: string }>(
        em,
        `UPDATE wallets SET balance = balance + $1, updated_at = now()
          WHERE id = $2 RETURNING balance`,
        [amount, wallet.id],
      );
      return {
        operationId: Number(operation.id),
        // bigint as a string: a balance can exceed Number.MAX_SAFE_INTEGER.
        balance: updated.balance,
      };
    });
  }
}
