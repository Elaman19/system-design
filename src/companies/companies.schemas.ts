import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(254).pipe(z.email()),
});
export type CreateCompany = z.infer<typeof createCompanySchema>;
