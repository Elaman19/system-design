import { z } from 'zod';

/**
 * One view of a lot card, as it travels through `lot-views`. `viewId` is unique per view:
 * the archive can hold a view twice after a consumer-group rebalance, analytics removes
 * the copies by it. `userId` stays null until sign-in exists.
 */
export const viewEventSchema = z.object({
  viewId: z.uuid(),
  lotId: z.uuid(),
  ip: z.string().min(1),
  userId: z.string().nullable(),
  viewedAt: z.iso.datetime(),
});
export type ViewEvent = z.infer<typeof viewEventSchema>;
