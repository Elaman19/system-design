import { z } from 'zod';

// Money is an integer number of cents; quantities reuse the same positive-integer rule.
// Each caller passes its own bound so that every product and sum stays inside
// Number.MAX_SAFE_INTEGER (price * quantity <= 1e11 * 1e4 = 1e15).
export const cents = (max: number) => z.number().int().positive().max(max);
