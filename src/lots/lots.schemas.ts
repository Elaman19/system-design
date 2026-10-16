import { z } from 'zod';
import { cents } from '../common/money.js';
import { uuid } from '../common/uuid.js';

export const MAX_PRICE = 100_000_000_000;
export const MAX_STOCK = 10_000;

export const createLotSchema = z.object({
  sellerId: uuid(),
  title: z.string().trim().min(1).max(200),
  price: cents(MAX_PRICE),
  stock: z.number().int().nonnegative().max(MAX_STOCK),
  deliveryMethods: z
    .array(z.enum(['pickup', 'courier', 'freight']))
    .default([]),
});
export type CreateLot = z.infer<typeof createLotSchema>;

export const publicationSchema = z.object({ published: z.boolean() });
export type Publication = z.infer<typeof publicationSchema>;

// A change, not a new total: see LotsService.setStock.
export const stockSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-MAX_STOCK)
    .max(MAX_STOCK)
    .refine((n) => n !== 0, 'must not be 0'),
});
export type Stock = z.infer<typeof stockSchema>;

export const priceSchema = z.object({ price: cents(MAX_PRICE) });
export type Price = z.infer<typeof priceSchema>;

export const MAX_CATALOG_PAGE = 100;

// Query string values arrive as text, hence the coercion of `limit`.
export const catalogSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_CATALOG_PAGE).default(20),
  // Keyset cursor: the id of the last lot on the previous page.
  after: uuid().optional(),
});
export type Catalog = z.infer<typeof catalogSchema>;
