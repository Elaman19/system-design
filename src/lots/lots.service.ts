import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { rows } from '../db/sql.js';
import type { CreateLot, Price, Publication, Stock } from './lots.schemas.js';
import { TxHooks } from '../common/tx-hooks/tx-hooks.js';

interface LotRow {
  id: string;
  seller_id: string;
  title: string;
  price: string;
  stock: number;
  is_published: boolean;
}

const lotNotFound = () =>
  apiError(HttpStatus.NOT_FOUND, 'LOT_NOT_FOUND', 'Лот не найден');

const view = (lot: LotRow) => ({
  id: lot.id,
  sellerId: lot.seller_id,
  title: lot.title,
  price: Number(lot.price),
  stock: lot.stock,
  published: lot.is_published,
});

@Injectable()
export class LotsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hooks: TxHooks,
  ) {}

  /**
   * Current state in `lots`, plus the first row of every history table. Current
   * state and history are written together or not at all.
   */
  create(dto: CreateLot) {
    return this.dataSource.transaction(async (em) => {
      const [lot] = await rows<LotRow>(
        em,
        `INSERT INTO lots (seller_id, title, price, stock)
         VALUES ($1, $2, $3, $4)
         RETURNING id, seller_id, title, price, stock, is_published`,
        [dto.sellerId, dto.title, dto.price, dto.stock],
      );
      await rows(
        em,
        `INSERT INTO lot_price_history (lot_id, price, valid_from)
         VALUES ($1, $2, clock_timestamp())`,
        [lot.id, dto.price],
      );
      await rows(
        em,
        `INSERT INTO lot_publication_history (lot_id, is_published, changed_at)
         VALUES ($1, false, clock_timestamp())`,
        [lot.id],
      );
      await rows(
        em,
        `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, changed_at)
         VALUES ($1, $2, $2, 'initial', clock_timestamp())`,
        [lot.id, dto.stock],
      );
      await rows(
        em,
        `INSERT INTO lot_delivery_methods (lot_id, method)
         SELECT $1, unnest($2::text[])`,
        [lot.id, dto.deliveryMethods],
      );
      return { ...view(lot), deliveryMethods: dto.deliveryMethods };
    });
  }

  /** The seller hides or shows a lot; the toggle lands in the history in the same transaction. */
  setPublication(id: string, { published }: Publication) {
    return this.dataSource.transaction(async (em) => {
      const [lot] = await rows<LotRow>(
        em,
        `UPDATE lots SET is_published = $2, updated_at = now() WHERE id = $1
         RETURNING id, seller_id, title, price, stock, is_published`,
        [id, published],
      );
      if (!lot) throw lotNotFound();
      await rows(
        em,
        `INSERT INTO lot_publication_history (lot_id, is_published, changed_at)
         VALUES ($1, $2, clock_timestamp())`,
        [id, published],
      );
      return view(lot);
    });
  }

  /** Sets the stock; the row is locked so a concurrent purchase cannot slip between read and write. */
  setStock(id: string, { stock }: Stock) {
    return this.dataSource.transaction(async (em) => {
      const [current] = await rows<{ stock: number }>(
        em,
        `SELECT stock FROM lots WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!current) throw lotNotFound();
      const [lot] = await rows<LotRow>(
        em,
        `UPDATE lots SET stock = $2, updated_at = now() WHERE id = $1
         RETURNING id, seller_id, title, price, stock, is_published`,
        [id, stock],
      );
      await rows(
        em,
        `INSERT INTO lot_stock_history (lot_id, delta, stock_after, reason, changed_at)
         VALUES ($1, $2, $3, 'restock', clock_timestamp())`,
        [id, stock - current.stock, stock],
      );
      return view(lot);
    });
  }

  /** New price on the lot and the matching history row appear together. */
  changePrice(id: string, { price }: Price) {
    return this.dataSource.transaction(async (em) => {
      const [lot] = await rows<LotRow>(
        em,
        `UPDATE lots SET price = $2, updated_at = now() WHERE id = $1
         RETURNING id, seller_id, title, price, stock, is_published`,
        [id, price],
      );
      if (!lot) throw lotNotFound();
      await this.hooks.at('price:afterUpdate');
      await rows(
        em,
        `INSERT INTO lot_price_history (lot_id, price, valid_from)
         VALUES ($1, $2, clock_timestamp())`,
        [id, price],
      );
      return view(lot);
    });
  }
}
