import { z } from 'zod';
import { cents } from '../common/money.js';
import { uuid } from '../common/uuid.js';

export const MAX_QUANTITY = 10_000;

export const purchaseSchema = z.object({
  buyerId: uuid(),
  lotId: uuid(),
  quantity: cents(MAX_QUANTITY),
});
export type Purchase = z.infer<typeof purchaseSchema>;
