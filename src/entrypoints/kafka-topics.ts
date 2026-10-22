import { config } from 'dotenv';
import pino from 'pino';
import { loadEnv } from '../config/env.js';
import { baseLogOptions } from '../config/logger.config.js';
import { createAdmin } from '../kafka/clients.js';
import { ensureTopics } from '../kafka/topics.js';

// One-shot job like `migrate`: creates the topics before anything reads them.
config({ quiet: true });
const env = loadEnv();
const logger = pino(baseLogOptions(env));
const admin = createAdmin(env);
try {
  const created = await ensureTopics(admin, env);
  logger.info({ created }, 'kafka topics ready');
} catch (error) {
  logger.fatal({ err: error }, 'could not create kafka topics');
  process.exitCode = 1;
} finally {
  await admin.close();
}
