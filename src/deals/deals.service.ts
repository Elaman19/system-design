import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { rows } from '../db/sql.js';
import type { Purchase } from './deals.schemas.js';
import { TxHooks } from '../common/tx-hooks/tx-hooks.js';

interface LotRow {
  id: string;
  seller_id: string;
  price: string;
  stock: number;
  is_published: boolean;
}

interface WalletRow {
  id: string;
  company_id: string;
  balance: string;
}

@Injectable()
export class DealsService {
  /**
   * Row-lock clause of the three reads in `purchase`. Protected so that the race
   * test can subclass and blank it to show what the lock closes; production
   * code has no way to turn it off.
   */
  protected readonly rowLock: string = ' FOR UPDATE';

  constructor(
    private readonly dataSource: DataSource,
    private readonly hooks: TxHooks,
  ) {}

  /**
   * One transaction, default isolation (READ COMMITTED). Read the lot and both
   * wallets, check, then write relative balance changes computed by the database. The reads take row locks: a concurrent purchase waits, then re-reads the committed state.
   *
   * Lock order is always lot, then wallets by id. Two crossing purchases (A buys
   * from B while B buys from A) therefore queue on the first wallet instead of
   * each holding one and waiting for the other, which would be a deadlock.
   */
  purchase({ buyerId, lotId, quantity }: Purchase) {
    const forUpdate = this.rowLock;
    return this.dataSource.transaction(async (em) => {
      const [lot] = await rows<LotRow>(
        em,
        `SELECT id, seller_id, price, stock, is_published FROM lots WHERE id = $1${forUpdate}`,
        [lotId],
      );
      if (!lot) {
        throw apiError(HttpStatus.NOT_FOUND, 'LOT_NOT_FOUND', 'Лот не найден');
      }
      if (lot.seller_id === buyerId) {
        throw apiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'OWN_LOT',
          'Нельзя купить собственный лот',
        );
      }
      const wallets = await rows<WalletRow>(
        em,
        `SELECT id, company_id, balance FROM wallets
          WHERE company_id = ANY($1) ORDER BY id${forUpdate}`,
        [[buyerId, lot.seller_id]],
      );
      const buyer = wallets.find((w) => w.company_id === buyerId);
      if (!buyer) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'COMPANY_NOT_FOUND',
          'Покупатель не найден',
        );
      }
      const seller = wallets.find((w) => w.company_id === lot.seller_id)!;

      await this.hooks.at('purchase:afterRead');

      const unitPrice = Number(lot.price);
      const total = unitPrice * quantity;
      if (!lot.is_published) {
        throw apiError(
          HttpStatus.CONFLICT,
          'LOT_NOT_PUBLISHED',
          'Лот не опубликован',
        );
      }
      if (lot.stock < quantity) {
        throw apiError(
          HttpStatus.CONFLICT,
          'OUT_OF_STOCK',
          'Недостаточно товара на складе',
        );
      }
      if (BigInt(buyer.balance) < BigInt(total)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'INSUFFICIENT_FUNDS',
          'Недостаточно средств на кошельке',
        );
      }

      const stockAfter = lot.stock - quantity;
      await rows(
        em,
        `UPDATE lots SET stock = $2, updated_at = now() WHERE id = $1`,
        [lotId, stockAfter],
      );
      const [deal] = await rows<{ id: string; created_at: Date }>(
        em,
        `INSERT INTO deals (lot_id, seller_id, buyer_id, quantity, unit_price, created_at)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp())
         RETURNING id, created_at`,
        [lotId, lot.seller_id, buyerId, quantity, unitPrice],
      );
      await rows(
        em,
        `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, deal_id, changed_at)
         VALUES ($1, $2, $3, 'sale', $4, clock_timestamp())`,
        [lotId, -quantity, stockAfter, deal.id],
      );
      // Balances are bigint and may exceed 2^53: arithmetic stays in SQL, never in Number.
      await rows(
        em,
        `UPDATE wallets SET balance = balance - $2, updated_at = now() WHERE id = $1`,
        [buyer.id, total],
      );
      await rows(
        em,
        `UPDATE wallets SET balance = balance + $2, updated_at = now() WHERE id = $1`,
        [seller.id, total],
      );
      await rows(
        em,
        `INSERT INTO wallet_operations (wallet_id, type, amount, deal_id)
         VALUES ($1, 'purchase', $2, $4), ($3, 'sale', $5, $4)`,
        [buyer.id, -total, seller.id, deal.id, total],
      );

      return {
        id: deal.id,
        lotId,
        sellerId: lot.seller_id,
        buyerId,
        quantity,
        unitPrice,
        total,
        createdAt: deal.created_at,
      };
    });
  }
}
