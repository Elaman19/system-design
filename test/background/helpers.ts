import { randomUUID } from 'node:crypto';
import type { Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { TxHooks } from '../../src/common/tx-hooks/tx-hooks.js';
import { ENV, type Env, loadEnv } from '../../src/config/env.js';
import { CoreModule } from '../../src/core.module.js';
import { DatabaseModule } from '../../src/db/database.module.js';
import { Mailer, type MailMessage } from '../../src/mail/mailer.js';
import { MAIL_QUEUE } from '../../src/queue/jobs.js';
import { redisConnection } from '../../src/queue/redis.js';
import { TestHooks, sleep } from '../marketplace/helpers.js';

/** Replaces SMTP: keeps what would have been sent, can be made to fail or to be slow. */
export class RecordingMailer extends Mailer {
  sent: MailMessage[] = [];
  failures = 0;
  failAlways = false;
  delayMs = 0;

  async send(message: MailMessage) {
    if (this.delayMs > 0) await sleep(this.delayMs);
    if (this.failAlways || this.failures > 0) {
      this.failures = Math.max(0, this.failures - 1);
      throw new Error('SMTP is down');
    }
    this.sent.push(message);
  }

  to(address: string) {
    return this.sent.filter((m) => m.to === address);
  }
}

export interface Process {
  module: TestingModule;
  env: Env;
  mailer: RecordingMailer;
  hooks: TestHooks;
  db: DataSource;
  get<T>(token: Type<T> | symbol | string): T;
  close: () => Promise<void>;
}

/**
 * One background process of the system (relay, worker, ...) started in-process on
 * `app_test`: the same modules the entrypoints run, mail replaced by a recorder.
 * A queue prefix of its own keeps test files out of each other's Redis keys.
 */
export async function startProcess(
  modules: Type[],
  env: Partial<Env> = {},
  mailer = new RecordingMailer(),
  overrides: [token: unknown, value: unknown][] = [],
): Promise<Process> {
  const hooks = new TestHooks();
  const merged = { ...loadEnv(), ...env };
  let builder = Test.createTestingModule({
    imports: [CoreModule, DatabaseModule, ...modules],
  })
    .overrideProvider(ENV)
    .useValue(merged)
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(TxHooks)
    .useValue(hooks);
  for (const [token, value] of overrides) {
    builder = builder.overrideProvider(token as never).useValue(value);
  }
  const module = await builder.compile();
  await module.init();
  return {
    module,
    env: merged,
    mailer,
    hooks,
    db: module.get(DataSource),
    get: (token) => module.get(token as never),
    close: () => module.close(),
  };
}

export const uniquePrefix = () => `test-${randomUUID()}`;

/** A producer-side handle on the `mail` queue, for adding and inspecting jobs. */
export function mailQueue(prefix: string, redisUrl = loadEnv().REDIS_URL) {
  return new Queue(MAIL_QUEUE, {
    connection: redisConnection(redisUrl),
    prefix,
  });
}

/** Polls until `check` returns something truthy; fails with `what` after the timeout. */
export async function eventually<T>(
  check: () => Promise<T | false | undefined> | T | false | undefined,
  what: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
