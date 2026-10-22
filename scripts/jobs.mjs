// Usage:
//   node scripts/jobs.mjs counts             jobs per state
//   node scripts/jobs.mjs failed             failed jobs: id, name, attempts, reason
//   node scripts/jobs.mjs retry <id|all>     put failed job(s) back to the queue
//
// Failed jobs are the ones BullMQ gave up on (all attempts used, or an error that
// retrying cannot fix). They stay in Redis until someone looks: this is that look.
// Reads REDIS_URL and BULLMQ_PREFIX from .env, so it works against the Compose stack
// from the host (Redis is published on 6379).
import { config } from 'dotenv';
import { Queue } from 'bullmq';

config({ quiet: true });
const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const queue = new Queue('mail', {
  prefix: process.env.BULLMQ_PREFIX ?? 'bull',
  connection: {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
  },
});

const [command, target] = process.argv.slice(2);
try {
  if (command === 'counts') {
    console.table(
      await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
      ),
    );
  } else if (command === 'failed') {
    const failed = await queue.getFailed();
    console.table(
      failed.map((job) => ({
        id: job.id,
        name: job.name,
        attempts: `${job.attemptsMade}/${job.opts.attempts ?? 1}`,
        failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : '',
        reason: job.failedReason,
        data: JSON.stringify(job.data),
      })),
    );
    console.log(`${failed.length} failed job(s)`);
  } else if (command === 'retry' && target) {
    const jobs =
      target === 'all' ? await queue.getFailed() : [await queue.getJob(target)];
    let retried = 0;
    for (const job of jobs) {
      if (!job) {
        console.error(`no job with id ${target}`);
        process.exitCode = 1;
      } else if ((await job.getState()) !== 'failed') {
        console.error(`job ${job.id} is not failed, skipped`);
      } else {
        await job.retry('failed');
        retried++;
      }
    }
    console.log(`${retried} job(s) put back to the queue`);
  } else {
    console.error(
      'usage: node scripts/jobs.mjs counts | failed | retry <id|all>',
    );
    process.exitCode = 2;
  }
} finally {
  await queue.close();
}
