import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: positiveInt,

  DB_HOST: z.string().min(1),
  DB_PORT: positiveInt,
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  // Not used by the app yet (no clients wired), but validated when present so a
  // typo fails at startup once they are.
  REDIS_URL: z.url().optional(),
  OPENSEARCH_URL: z.url().optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),

  HEALTH_TIMEOUT_MS: positiveInt.default(1500),
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().nonnegative().default(5000),
  SHUTDOWN_TIMEOUT_MS: positiveInt.default(10000),

  // Slow /work endpoint used to verify graceful shutdown; off unless asked for.
  WORK_ENDPOINT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  return result.data;
}
