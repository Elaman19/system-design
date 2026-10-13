import { z } from 'zod';
import { cents } from '../common/money.js';

export const MAX_DEPOSIT = 1_000_000_000_000;

export const depositSchema = z.object({
  bankNotificationId: z.string().trim().min(1).max(100),
  amount: cents(MAX_DEPOSIT),
});
export type Deposit = z.infer<typeof depositSchema>;
