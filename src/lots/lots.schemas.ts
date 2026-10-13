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

export const stockSchema = z.object({
  stock: z.number().int().nonnegative().max(MAX_STOCK),
});
export type Stock = z.infer<typeof stockSchema>;

export const priceSchema = z.object({ price: cents(MAX_PRICE) });
export type Price = z.infer<typeof priceSchema>;
