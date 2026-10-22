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
  // Server-side limits of the app's connections (not of the migration CLI). Without
  // them one stuck transaction holding FOR UPDATE queues every purchase behind it
  // until the pool is exhausted. 0 disables a limit.
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(5000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30000),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(30000),

  REDIS_URL: z.url(),
  OPENSEARCH_URL: z.url().optional(),
  S3_ENDPOINT: z.url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('marketplace'),

  // Comma-separated host:port list.
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_CLIENT_ID: z.string().min(1).default('marketplace'),
  // Put in front of every consumer group name. The tests set their own prefix so that they
  // never join the groups of a stack that is running on the same Kafka.
  KAFKA_GROUP_PREFIX: z.string().default(''),
  KAFKA_TOPIC_LOT_VIEWS: z.string().min(1).default('lot-views'),
  KAFKA_TOPIC_IP_BANS: z.string().min(1).default('ip-bans'),

  MAIL_SMTP_URL: z.string().min(1),
  // Connection, greeting and socket timeout of the SMTP client. The receipt is sent inside a
  // database transaction that sits idle meanwhile: keep this well below
  // DB_IDLE_IN_TRANSACTION_TIMEOUT_MS, or Postgres drops the session while the mail is on
  // its way and the retry sends a second copy.
  MAIL_TIMEOUT_MS: positiveInt.default(10000),
  MAIL_FROM: z
    .string()
    .min(1)
    .default('Marketplace <noreply@marketplace.local>'),
  ADMIN_EMAIL: z.string().min(1).default('admin@marketplace.local'),

  // Namespaces the keys in Redis, so tests and the stack never share a queue.
  BULLMQ_PREFIX: z.string().min(1).default('bull'),
  // A failed job is retried this many times in total (first run included), with
  // exponential pauses starting at JOB_BACKOFF_MS; then it stays in "failed".
  JOB_ATTEMPTS: positiveInt.default(5),
  JOB_BACKOFF_MS: positiveInt.default(1000),

  // Outbox relay: how long to sleep when nothing is waiting, rows per pass.
  OUTBOX_POLL_MS: positiveInt.default(500),
  OUTBOX_BATCH: positiveInt.default(100),
  // Adding a job to a queue whose Redis does not answer in this time fails instead of hanging
  // (the outbox pass rolls back, the ban recorder retries, the scheduler logs).
  QUEUE_ADD_TIMEOUT_MS: positiveInt.default(3000),

  // Views are sent to Kafka in batches off the request path. The buffer is bounded:
  // when Kafka is down views are dropped (analytics, not money), the API never waits.
  CLICKSTREAM_LINGER_MS: positiveInt.default(200),
  CLICKSTREAM_BUFFER_MAX: positiveInt.default(10000),

  // Archiver: a batch goes to S3 at this many messages or after this long, whichever first.
  ARCHIVE_BATCH_SIZE: positiveInt.default(1000),
  ARCHIVE_FLUSH_MS: positiveInt.default(60000),

  // More than ABUSE_MAX_VIEWS views from one IP within ABUSE_WINDOW_MS bans it for ABUSE_BAN_MS.
  ABUSE_MAX_VIEWS: positiveInt.default(300),
  ABUSE_WINDOW_MS: positiveInt.default(60000),
  ABUSE_BAN_MS: positiveInt.default(3600000),

  // Express "trust proxy" setting (e.g. "loopback", "10.0.0.0/8", "1"). Without it req.ip is
  // the socket peer, which behind a balancer is the balancer. "true" trusts every
  // X-Forwarded-For hop and lets a client pick its own IP: local stack only.
  TRUST_PROXY: z.string().min(1).optional(),

  DAILY_REPORT_CRON: z.string().min(1).default('0 9 * * *'),
  DAILY_REPORT_TZ: z.string().min(1).default('UTC'),

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
